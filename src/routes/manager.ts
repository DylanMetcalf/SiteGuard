/**
 * The manager portal's API: the platform operator's view of the whole service.
 *
 * Signing in is the ordinary sign-in plus a second step (authenticator app). There is no separate
 * password and no hidden address: anyone who is not a platform admin gets a 404, and an admin's
 * session must have passed the second step in the last 12 hours.
 *
 * What it shows without the customer's say-so: counts, plans, dates, people's names and emails,
 * payment and email status. What it shows only while the customer's own admin has switched on
 * "support access" (limited time, revocable): sites, requirement and document names with their
 * status, and recent activity. It never shows file contents, and nothing here can change a
 * customer's documents. Every action is written to platform_actions (and the customer's own audit
 * trail when it concerns them).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { many, one, pool, withTx } from '../db/pool.js';
import { config, features, platformAdminCount } from '../config.js';
import { conflict, forbidden, HttpError, notFound, unauthorized } from '../lib/errors.js';
import { isUuid, type Ctx } from '../lib/authz.js';
import { ANY_ORG, REAL_ORG, requireAdminUser, requireManager } from '../lib/managerAuth.js';
import { PLANS, defaultPlanFor, type OrgKind } from '../lib/plans.js';
import { logPlatformAction } from '../lib/platformLog.js';
import { securityEvent } from '../lib/securityLog.js';
import { mfaNotice } from './mfa.js';
import { publishChange } from '../lib/realtime.js';
import { consumeMfaCode, finishEnrolment, lockedOut, mfaEnabled, recordMfaFailure, startEnrolment } from '../lib/mfa.js';
import { queueResetEmail, rl } from './auth.js';

const MFA_MAX_AGE_MS = 12 * 3600_000;

const num = (v: unknown) => Number(v ?? 0);
const page = z.coerce.number().int().min(0).max(1000).default(0);

/** Documents on this organisation's files: a host's sites, a contractor's linked files and projects. */
const SCOPE_SITES = `select s.id from sites s join organisations so on so.id = s.org_id left join contractors c on c.id = s.contractor_id
                      where (s.org_id = $1 or so.managed_by_org = $1 or c.linked_org_id = $1) and s.status <> 'declined'`;

async function orgCounts(orgId: string) {
  const [docs, files, other] = await Promise.all([
    many<{ status: string; n: number }>(pool,
      `select d.status, count(*)::int as n from documents d join requirements r on r.id = d.requirement_id
        where r.site_id in (${SCOPE_SITES}) group by d.status`, [orgId]),
    one<{ sites: number; workplaces: number; projects: number }>(pool,
      `select (select count(*) from sites s where s.org_id = $1 and s.status <> 'declined' and s.workplace_id is null and not exists (select 1 from organisations m where m.id = s.org_id and m.managed_by_org is not null))::int as sites,
              (select count(*) from workplaces where org_id = $1 and archived_at is null)::int as workplaces,
              (select count(*) from sites s join organisations m on m.id = s.org_id where m.managed_by_org = $1 and s.status <> 'declined')::int as projects`, [orgId]),
    one<{ studio: number; libraryDocs: number; exchanges: number; templates: number; safetyFiles: number }>(pool,
      `select (select count(*) from generated_documents where org_id = $1)::int as studio,
              (select count(*) from documents where library_org_id = $1 and current_file_id is not null)::int as "libraryDocs",
              (select count(*) from exchanges where sender_org_id = $1)::int as exchanges,
              (select count(*) from requirement_templates where org_id = $1 and superseded_at is null and archived_at is null)::int as templates,
              (select count(*) from safety_file_versions v join sites s on s.id = v.site_id where s.id in (${SCOPE_SITES}))::int as "safetyFiles"`, [orgId]),
  ]);
  return { documentsByStatus: Object.fromEntries(docs.map((d) => [d.status, d.n])), ...files, ...other };
}

async function activeGrant(orgId: string) {
  return one<{ id: string; expires_at: Date; granted_by_name: string; reason: string }>(
    pool, `select id, expires_at, granted_by_name, reason from support_access_grants where org_id = $1 and revoked_at is null and expires_at > now() order by expires_at desc limit 1`, [orgId],
  );
}

export default async function managerRoutes(app: FastifyInstance) {
  // ---------- second step ----------
  app.get('/api/manager/me', async (req, reply) => {
    const ctx = requireAdminUser(req);
    reply.header('cache-control', 'no-store');
    const mfa = await one<{ enabled_at: Date | null }>(pool, 'select enabled_at from user_mfa where user_id = $1', [ctx.user.id]);
    const fresh = !!ctx.mfaVerifiedAt && Date.now() - new Date(ctx.mfaVerifiedAt).getTime() < MFA_MAX_AGE_MS;
    return { email: ctx.user.email, name: ctx.user.name, enrolled: !!mfa?.enabled_at, verified: !!mfa?.enabled_at && fresh };
  });

  app.post('/api/manager/mfa/setup', rl(5), async (req) => {
    const ctx = requireAdminUser(req);
    const r = await withTx((db) => startEnrolment(db, ctx.user.id, ctx.user.email));
    if (!r) throw conflict('The second step is already set up for this account.');
    return r;
  });

  async function failedCode(userId: string, req: FastifyRequest): Promise<never> {
    securityEvent(req, 'mfa_failed', { userId });
    await recordMfaFailure(pool, userId);
    throw unauthorized('That code is not right. Check your authenticator app and try again.');
  }
  async function checkNotLocked(userId: string) {
    if (await lockedOut(pool, userId)) throw new HttpError(423, 'locked', 'Too many wrong codes. Try again in 15 minutes.');
  }

  app.post('/api/manager/mfa/enable', rl(10), async (req) => {
    const ctx = requireAdminUser(req);
    const { code } = z.object({ code: z.string().trim().max(10) }).parse(req.body);
    await checkNotLocked(ctx.user.id);
    const codes = await withTx(async (db) => {
      const c = await finishEnrolment(db, ctx.user.id, code);
      if (!c) return null;
      await db.query('update sessions set mfa_verified_at = now() where id = $1', [ctx.sessionId]);
      await logPlatformAction(db, ctx, 'Set up the second sign-in step', null, '', req.ip);
      return c;
    });
    if (!codes) return failedCode(ctx.user.id, req);
    securityEvent(req, 'mfa_enrolled');
    return { ok: true, recoveryCodes: codes };
  });

  app.post('/api/manager/mfa/verify', rl(10), async (req) => {
    const ctx = requireAdminUser(req);
    const { code } = z.object({ code: z.string().trim().min(1).max(20) }).parse(req.body);
    await checkNotLocked(ctx.user.id);
    if (!(await mfaEnabled(pool, ctx.user.id))) throw conflict('Set up the second step first.');
    const how = await withTx(async (db) => {
      const h = await consumeMfaCode(db, ctx.user.id, code);
      if (h) {
        await db.query('update sessions set mfa_verified_at = now() where id = $1', [ctx.sessionId]);
        await db.query('update users set failed_login_count = 0, locked_until = null where id = $1', [ctx.user.id]);
        await logPlatformAction(db, ctx, 'Signed in to the manager portal', null, `with ${h}`, req.ip);
      }
      return h;
    });
    if (!how) return failedCode(ctx.user.id, req);
    securityEvent(req, 'mfa_verified', { method: how });
    return { ok: true, usedRecoveryCode: how === 'recovery code' };
  });

  // ---------- overview ----------
  app.get('/api/manager/overview', rl(60), async (req, reply) => {
    await requireManager(req);
    reply.header('cache-control', 'no-store');
    const q = async (sql: string, params: unknown[] = []) => num((await one<{ n: number }>(pool, sql, params))?.n);
    const [orgs, status, plans, users, content, exch, mail, pay, inbox] = await Promise.all([
      many(pool, `select o.kind, count(*)::int as total, count(*) filter (where o.created_at > now() - interval '7 days')::int as last7 from organisations o where ${REAL_ORG} group by o.kind`),
      many<{ s: string; n: number }>(pool, `select coalesce(o.subscription_status, 'none') as s, count(*)::int as n from organisations o where ${REAL_ORG} group by 1`),
      many<{ plan: string; n: number }>(pool, `select o.plan, count(*)::int as n from organisations o where ${REAL_ORG} and o.subscription_status in ('active', 'past_due') group by 1 order by 2 desc`),
      one(pool, `select count(*)::int as total, count(*) filter (where created_at > now() - interval '7 days')::int as last7,
                        (select count(distinct s.user_id)::int from sessions s join users x on x.id = s.user_id where not x.is_demo and s.last_seen_at > now() - interval '7 days') as active7
                   from users where not is_demo`),
      one(pool, `select (select count(*) from sites s join organisations o on o.id = s.org_id where ${REAL_ORG} and s.status <> 'declined')::int as files,
                        (select count(*) from workplaces w join organisations o on o.id = w.org_id where not o.is_demo and w.archived_at is null)::int as workplaces,
                        (select count(*) from sites s join organisations o on o.id = s.org_id where not o.is_demo and o.managed_by_org is not null and s.status <> 'declined')::int as projects,
                        (select count(*) from generated_documents g join organisations o on o.id = g.org_id where not o.is_demo)::int as "studioDocs",
                        (select count(*) from requirement_templates where superseded_at is null and archived_at is null)::int as templates,
                        (select count(*) from documents where current_file_id is not null)::int as "documentsFiled"`),
      many<{ status: string; n: number }>(pool, `select x.status, count(*)::int as n from exchanges x join organisations o on o.id = x.sender_org_id where not o.is_demo group by 1`),
      one(pool, `select count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'failed' and created_at > now() - interval '30 days')::int as failed,
                        count(*) filter (where status = 'sent' and created_at > now() - interval '7 days')::int as sent7 from email_outbox`),
      one(pool, `select coalesce(sum(amount_cents) filter (where status = 'success' and paid_at > now() - interval '30 days'), 0)::bigint as paid30,
                        count(*) filter (where status = 'success' and paid_at > now() - interval '30 days')::int as n30,
                        count(*) filter (where status in ('failed') and created_at > now() - interval '14 days')::int as failed14 from payments`),
      one(pool, `select (select count(*) from feedback where handled_at is null)::int + (select count(*) from enquiries where handled_at is null)::int as open`),
    ]);
    const past = await q(`select count(*)::int as n from organisations o where ${REAL_ORG} and o.subscription_status = 'past_due'`);
    const [accounts, recentOrgs, recentlyActive, recentActions] = await Promise.all([
      one(pool, `select (select count(*) from organisations o where ${REAL_ORG})::int as orgs,
                        (select count(*) from organisations o where ${REAL_ORG} and o.kind = 'host' and o.status = 'active')::int as "activeHosts",
                        (select count(*) from organisations o where ${REAL_ORG} and o.kind = 'contractor' and o.status = 'active')::int as "activeContractors",
                        (select count(*) from organisations o where ${REAL_ORG} and o.status <> 'active')::int as closed,
                        (select count(*) from organisations o where ${ANY_ORG} and not o.is_demo and o.account_class <> 'customer')::int as "internalTest",
                        (select count(*) from organisations o where ${ANY_ORG} and o.is_demo)::int as demo,
                        (select count(*) from organisations o where ${ANY_ORG} and o.flag_kind is not null)::int + (select count(*) from users where flag_kind is not null)::int as flagged,
                        (select count(*) from users where not is_demo and account_class = 'customer' and email_verified_at is null)::int as unverified,
                        (select count(*) from user_invites where accepted_at is null and revoked_at is null and expires_at > now())::int
                          + (select count(*) from site_invitations where status = 'pending')::int as "pendingInvites",
                        (select count(*) from deletion_requests where status = 'scheduled')::int as "deletionsScheduled"`),
      many(pool, `select o.id, o.name, o.kind, o.created_at as "at" from organisations o where ${REAL_ORG} order by o.created_at desc limit 6`),
      many(pool, `select o.id, o.name, o.kind, max(s.last_seen_at) as "at" from organisations o join memberships m on m.org_id = o.id join sessions s on s.user_id = m.user_id
                   where ${REAL_ORG} group by o.id order by max(s.last_seen_at) desc limit 6`),
      many(pool, `select a.admin_email as "by", a.action, a.detail, a.created_at as "at", a.org_id as "orgId" from platform_actions a order by a.id desc limit 8`),
    ]);
    return { orgs, status, paidPlans: plans, users, content, exchanges: exch, email: mail, payments: pay, openInbox: (inbox as { open: number }).open, pastDue: past,
      accounts, recentOrgs, recentlyActive, recentActions };
  });

  // ---------- setup checklist: every item says what it is, why it matters, where to act, and its real state ----------
  type Item = { id: string; title: string; status: 'done' | 'todo' | 'attention' | 'optional' | 'manual'; detail: string; why: string;
    how: string; go: { view: string; label: string } | null; auto: boolean };
  app.get('/api/manager/setup', rl(30), async (req, reply) => {
    await requireManager(req);
    reply.header('cache-control', 'no-store');
    const host = new URL(config.APP_URL).hostname;
    const [failedMail, priced, customers, ticked] = await Promise.all([
      one<{ n: number }>(pool, `select count(*)::int as n from email_outbox where status = 'failed' and created_at > now() - interval '30 days'`),
      one<{ n: number }>(pool, `select count(*)::int as n from plan_settings`),
      one<{ n: number }>(pool, `select count(*)::int as n from organisations o where ${REAL_ORG}`),
      many<{ item_id: string; done_by: string; done_at: Date }>(pool, `select item_id, done_by, done_at from platform_checklist`),
    ]);
    const tick = new Map(ticked.map((t) => [t.item_id, t]));
    const onRender = /^localhost$|\.onrender\.com$/.test(host);
    const mail = failedMail?.n ?? 0;
    const manual = (id: string, title: string, detail: string, why: string, how: string): Item => {
      const t = tick.get(id);
      return { id, title, status: t ? 'done' : 'manual', detail: t ? `Ticked off by ${t.done_by} on ${t.done_at.toISOString().slice(0, 10)}.` : detail, why, how, go: null, auto: false };
    };
    const items: Item[] = [
      { id: 'domain', title: 'Your own web address', status: onRender ? 'todo' : 'done', auto: true,
        detail: onRender ? 'Links in emails still use ' + host + '.' : 'Links in emails use ' + host + '.',
        why: 'Customers trust a comvera.co.za link far more than a technical one, and emails link back to this address.',
        how: 'In Render: Settings → Custom Domains → add comvera.co.za. Then set APP_URL to https://comvera.co.za under Environment.', go: null },
      { id: 'email', title: 'Email sending', status: !features.email ? 'todo' : mail > 0 ? 'attention' : 'done', auto: true,
        detail: !features.email ? 'Not switched on.' : mail > 0 ? mail + ' email(s) failed in the last 30 days.' : 'Switched on, and no failed emails in 30 days.',
        why: 'Without email, sign-up confirmation, password resets, invitations and document requests cannot reach anyone.',
        how: 'In Render → Environment set SMTP_URL and EMAIL_FROM. Failed emails can be re-sent from Needs attention.', go: mail > 0 ? { view: 'attention', label: 'Open needs attention' } : null },
      { id: 'support', title: 'A support email address on the site', status: config.SUPPORT_EMAIL ? 'done' : 'todo', auto: true,
        detail: config.SUPPORT_EMAIL ? 'Shown to customers: ' + config.SUPPORT_EMAIL : 'Not set.',
        why: 'Customers need somewhere to write when something goes wrong.', how: 'In Render → Environment set SUPPORT_EMAIL.', go: null },
      { id: 'mfakey', title: 'Authenticator secrets are encrypted', status: config.MFA_SECRET_KEY ? 'done' : 'todo', auto: true,
        detail: config.MFA_SECRET_KEY ? 'MFA_SECRET_KEY is set.' : 'MFA_SECRET_KEY is not set, so authenticator secrets are stored unencrypted.',
        why: 'If the database were ever copied, encrypted secrets could not be used to generate your sign-in codes.',
        how: 'In Render → Environment set MFA_SECRET_KEY to 16 or more random characters, then set up your authenticator again.', go: null },
      { id: 'admins', title: 'Who can open this portal', status: platformAdminCount > 0 ? 'done' : 'todo', auto: true,
        detail: platformAdminCount + ' address' + (platformAdminCount === 1 ? '' : 'es') + ' on the list.',
        why: 'Everyone on this list can see every customer and suspend accounts, so keep it to the people who truly need it.',
        how: 'The list is PLATFORM_ADMIN_EMAILS in Render → Environment. Each address must also have confirmed their email.', go: null },
      { id: 'payments', title: 'Taking payments', status: features.payments ? 'done' : 'optional', auto: true,
        detail: features.payments ? 'Switched on through ' + features.paymentProvider + '.' : 'Not switched on.',
        why: 'Needed only when you start charging. A free pilot works without it.',
        how: 'Open a Paystack account and set PAYSTACK_SECRET_KEY in Render (test key first). Do a test purchase and a cancel before real customers pay.', go: { view: 'pricing', label: 'Review prices' } },
      { id: 'plans', title: 'Plans and limits enforced', status: features.billing ? 'done' : 'optional', auto: true,
        detail: features.billing ? 'Trials and plan limits are on.' : 'Off: everyone has full access with no limits.',
        why: 'Fine for a free pilot. Switch it on when you want trials to end and limits to apply.', how: 'Set ENFORCE_PLANS=true in Render → Environment.', go: null },
      { id: 'prices', title: 'Prices reviewed', status: (priced?.n ?? 0) > 0 ? 'done' : 'optional', auto: true,
        detail: (priced?.n ?? 0) > 0 ? 'You have set your own prices.' : 'Still the starting prices.',
        why: 'The public pricing page and what customers are charged both come from these prices.', how: 'Open Prices and save each plan once you are happy with it.', go: { view: 'pricing', label: 'Open prices' } },
      { id: 'storage', title: 'Where uploaded files are kept', status: config.STORAGE_DRIVER === 's3' ? 'done' : 'optional', auto: true,
        detail: config.STORAGE_DRIVER === 's3' ? 'Private cloud storage.' : 'On the server’s own disk.',
        why: 'Files on the server disk are lost if the server is rebuilt. Fine to start; move to private cloud storage before you have many customers.', how: 'Set STORAGE_DRIVER=s3 and the bucket settings in Render → Environment.', go: null },
      { id: 'ai', title: 'AI drafting', status: features.ai ? 'done' : 'optional', auto: true,
        detail: features.ai ? 'Switched on.' : 'Off: documents use the built-in templates.',
        why: 'Switches on the AI assistant and AI-assisted drafting. Everything still works without it.', how: 'Add ANTHROPIC_API_KEY in Render → Environment.', go: null },
      { id: 'firstcustomer', title: 'A first real customer', status: (customers?.n ?? 0) > 1 ? 'done' : 'optional', auto: true,
        detail: (customers?.n ?? 0) > 1 ? (customers!.n + ' customer organisations so far.') : 'No customers yet apart from your own.',
        why: 'Real use is the only way to learn what matters. Test accounts do not count here.', how: 'Invite two or three friendly mines and their contractors for a free pilot.', go: { view: 'customers', label: 'Open customers' } },
      manual('testaccounts', 'Your own test accounts are marked as tests', 'Tick when your own test organisations are marked Internal test.',
        'Marked test accounts leave your customer counts and statistics, so the numbers you read are real.', 'Open Customers, open each of your own test organisations and choose Mark as internal test.'),
      manual('legal', 'Privacy and Terms checked by a lawyer', 'The pages are drafts.', 'You are collecting personal information. A South African attorney should confirm the pages say what is true and legal.', 'Send /privacy and /terms to your attorney, then tick this when they have signed off.'),
      manual('popia', 'POPIA paperwork', 'Not done yet.', 'POPIA expects an Information Officer and written agreements with the companies that handle customer data for you.', 'Register an Information Officer, and sign data agreements with Render, your email provider and Paystack.'),
      manual('backup', 'A backup restore test', 'Not done yet.', 'A backup you have never restored is only a hope.', 'In Render, restore the latest database backup into a NEW database and open a site. 15 minutes, once a month.'),
    ];
    return { items };
  });

  /** Only items that are done by hand can be ticked here; the rest are worked out from the real settings. */
  app.post('/api/manager/setup/:id', rl(30), async (req) => {
    const ctx = await requireManager(req);
    const { id } = z.object({ id: z.enum(['testaccounts', 'legal', 'popia', 'backup']) }).parse(req.params);
    const { done } = z.object({ done: z.boolean() }).parse(req.body);
    return withTx(async (db) => {
      if (done) await db.query(`insert into platform_checklist (item_id, done_by) values ($1, $2) on conflict (item_id) do update set done_by = $2, done_at = now()`, [id, ctx.user.email]);
      else await db.query('delete from platform_checklist where item_id = $1', [id]);
      await logPlatformAction(db, ctx, (done ? 'Ticked' : 'Un-ticked') + ' a setup item', null, id, req.ip);
      return { ok: true };
    });
  });

  /**
   * Only while the customer has switched support access on. Names and statuses, never file contents.
   * Each look is recorded for the platform and in the customer's own audit trail.
   */
  app.get('/api/manager/orgs/:id/support-view', rl(30), async (req, reply) => {
    const ctx = await requireManager(req);
    reply.header('cache-control', 'no-store');
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    // Every look needs a stated reason, which goes into both the platform log and the customer's own audit trail.
    const { reason } = z.object({ reason: z.string().trim().min(3).max(200) }).parse(req.query);
    const grant = await activeGrant(id);
    if (!grant) throw forbidden('This customer has not switched on support access. Ask them to turn it on under Settings.');
    const org = await one<{ id: string; name: string }>(pool, `select o.id, o.name from organisations o where o.id = $1 and ${ANY_ORG}`, [id]);
    if (!org) throw notFound();
    const [sites, docs, audit] = await Promise.all([
      many(pool,
        `select s.id, s.name, s.location, s.status, so.name as "ownerName", c.name as "contractorName", s.workplace_id as "workplaceId",
                (select count(*) from requirements r where r.site_id = s.id)::int as requirements,
                (select count(*) from requirements r join documents d on d.requirement_id = r.id where r.site_id = s.id and d.status = 'complete')::int as approved,
                (select count(*) from requirements r join documents d on d.requirement_id = r.id where r.site_id = s.id and d.status in ('awaiting_review'))::int as waiting,
                (select count(*) from requirements r join documents d on d.requirement_id = r.id where r.site_id = s.id and d.status = 'correction_required')::int as corrections
           from sites s join organisations so on so.id = s.org_id left join contractors c on c.id = s.contractor_id
          where s.id in (${SCOPE_SITES}) order by s.created_at desc limit 100`, [id]),
      many(pool,
        `select s.name as "siteName", r.category, r.name, r.optional, coalesce(d.status, 'missing') as status, d.version, d.expiry_date as "expiryDate", d.updated_at as "updatedAt"
           from requirements r join sites s on s.id = r.site_id left join documents d on d.requirement_id = r.id
          where r.site_id in (${SCOPE_SITES}) order by s.name, r.position limit 400`, [id]),
      many(pool, `select actor_name as "who", actor_role as "role", action, detail, created_at as "at" from audit_events where org_id = $1 order by created_at desc limit 50`, [id]),
    ]);
    await withTx(async (db) => {
      await logPlatformAction(db, ctx, 'Viewed customer account (support access)', id, `${org.name}; ${reason}; grant until ${new Date(grant.expires_at).toISOString()}`, req.ip);
      await db.query(
        `insert into audit_events (org_id, actor_id, actor_name, actor_role, action, detail) values ($1, $2, $3, 'COMVERA support', 'COMVERA support viewed this account', $4)`,
        [id, ctx.user.id, ctx.user.name, 'Reason: ' + reason + '. Read-only, using the support access you switched on.'],
      );
    });
    return { org, grantExpiresAt: grant.expires_at, sites, documents: docs, recentActivity: audit };
  });

  // ---------- things that need attention ----------
  app.get('/api/manager/attention', rl(60), async (req, reply) => {
    await requireManager(req);
    reply.header('cache-control', 'no-store');
    const [failedEmails, pastDue, trials, payments, stale, unverified, inbox] = await Promise.all([
      many(pool, `select id, to_email as "to", subject, left(coalesce(last_error, ''), 200) as error, attempts, created_at as "at", org_id as "orgId" from email_outbox where status = 'failed' and created_at > now() - interval '30 days' order by created_at desc limit 50`),
      many(pool, `select o.id, o.name, o.kind, o.plan, o.current_period_end as "periodEnd" from organisations o where ${REAL_ORG} and o.subscription_status = 'past_due' order by o.name limit 50`),
      many(pool, `select o.id, o.name, o.kind, o.trial_ends_at as "trialEndsAt" from organisations o where ${REAL_ORG} and o.subscription_status = 'trialing' and o.trial_ends_at between now() and now() + interval '3 days' order by o.trial_ends_at limit 50`),
      many(pool, `select p.reference, p.org_id as "orgId", o.name, p.kind, p.amount_cents as "amountCents", p.status, left(p.failure_reason, 200) as "failureReason", p.created_at as "at"
                    from payments p join organisations o on o.id = p.org_id
                   where (p.status = 'failed' and p.created_at > now() - interval '14 days') or (p.status = 'pending' and p.created_at < now() - interval '1 day' and p.created_at > now() - interval '14 days')
                   order by p.created_at desc limit 50`),
      many(pool, `select o.id, o.name, o.kind, o.created_at as "createdAt" from organisations o
                   where ${REAL_ORG} and o.created_at between now() - interval '30 days' and now() - interval '7 days'
                     and not exists (select 1 from workplaces w where w.org_id = o.id) and not exists (select 1 from sites s where s.org_id = o.id)
                     and not exists (select 1 from sites s join contractors c on c.id = s.contractor_id where c.linked_org_id = o.id)
                   order by o.created_at desc limit 50`),
      many(pool, `select u.id, u.name, u.email, u.created_at as "createdAt" from users u where not u.is_demo and u.email_verified_at is null and u.created_at < now() - interval '3 days' and u.created_at > now() - interval '30 days' order by u.created_at desc limit 50`),
      one(pool, `select (select count(*) from feedback where handled_at is null)::int as feedback, (select count(*) from enquiries where handled_at is null)::int as enquiries`),
    ]);
    return { failedEmails, pastDue, trialsEnding: trials, payments, noActivity: stale, unverifiedUsers: unverified, openInbox: inbox };
  });

  // ---------- support inbox ----------
  app.get('/api/manager/inbox', rl(60), async (req, reply) => {
    await requireManager(req);
    reply.header('cache-control', 'no-store');
    const items = await many(pool,
      `select * from (
         select 'feedback' as source, f.id, f.kind as topic, f.message, coalesce(u.name, '') as "name", coalesce(u.email::text, '') as email, coalesce(o.name, '') as company, f.org_id as "orgId",
                f.created_at as "at", f.handled_at as "handledAt", f.admin_note as note
           from feedback f left join users u on u.id = f.user_id left join organisations o on o.id = f.org_id
         union all
         select 'enquiry', e.id, e.topic, e.message, e.name, e.email::text, e.company, null, e.created_at, e.handled_at, e.admin_note from enquiries e
       ) x order by ("handledAt" is not null), "at" desc limit 100`);
    return { items };
  });

  app.post('/api/manager/inbox/:source/:id/handle', rl(30), async (req) => {
    const ctx = await requireManager(req);
    const { source, id } = z.object({ source: z.enum(['feedback', 'enquiry']), id: z.string() }).parse(req.params);
    const { note } = z.object({ note: z.string().trim().max(1000).default('') }).parse(req.body);
    if (!isUuid(id)) throw notFound();
    return withTx(async (db) => {
      const done = await one(db, `update ${source === 'feedback' ? 'feedback' : 'enquiries'} set handled_at = now(), admin_note = $2 where id = $1 and handled_at is null returning id`, [id, note]);
      if (!done) throw notFound();
      await logPlatformAction(db, ctx, `Marked ${source} as handled`, null, note.slice(0, 200), req.ip);
      return { ok: true };
    });
  });

  // ---------- activity log ----------
  app.get('/api/manager/actions', rl(60), async (req, reply) => {
    await requireManager(req);
    reply.header('cache-control', 'no-store');
    const { page: p } = z.object({ page }).parse(req.query);
    const rows = await many(pool,
      `select a.id, a.admin_email as "by", a.action, a.detail, a.ip, a.created_at as "at", a.org_id as "orgId", o.name as "orgName"
         from platform_actions a left join organisations o on o.id = a.org_id order by a.id desc limit 101 offset $1`, [p * 100]);
    return { actions: rows.slice(0, 100), more: rows.length > 100 };
  });

  // ---------- small, reversible things the operator can do ----------
  app.post('/api/manager/emails/:id/requeue', rl(30), async (req) => {
    const ctx = await requireManager(req);
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id < 1) throw notFound();
    return withTx(async (db) => {
      const e = await one<{ org_id: string | null; to_email: string }>(db,
        `update email_outbox set status = 'pending', attempts = 0, last_error = null, send_after = now() where id = $1 and status = 'failed' returning org_id, to_email`, [id]);
      if (!e) throw notFound();
      await logPlatformAction(db, ctx, 'Re-queued a failed email', e.org_id, `to ${e.to_email}`, req.ip);
      return { ok: true };
    });
  });

  app.post('/api/manager/users/:id/reset-email', rl(10), async (req) => {
    const ctx = await requireManager(req);
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    return withTx(async (db) => {
      const u = await one<{ id: string; name: string; email: string; org_id: string }>(db,
        `select u.id, u.name, u.email, m.org_id from users u join memberships m on m.user_id = u.id join organisations o on o.id = m.org_id
          where u.id = $1 and not u.is_demo and ${ANY_ORG} limit 1`, [id]);
      if (!u) throw notFound();
      await queueResetEmail(db, u);
      await logPlatformAction(db, ctx, 'Sent a password reset email', u.org_id, `to ${u.email}`, req.ip);
      return { ok: true };
    });
  });

  /** A customer lost their phone and recovery codes: remove their second step after checking who they are. */
  app.post('/api/manager/users/:id/reset-mfa', rl(10), async (req) => {
    const ctx = await requireManager(req);
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    const { reason } = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body);
    const u = await withTx(async (db) => {
      const user = await one<{ id: string; name: string; email: string; org_id: string | null }>(db,
        `select u.id, u.name, u.email, (select m.org_id from memberships m where m.user_id = u.id limit 1) as org_id from users u where u.id = $1 and not u.is_demo`, [id]);
      if (!user) throw notFound();
      const r = await db.query('delete from user_mfa where user_id = $1', [id]);
      if (!r.rowCount) throw conflict('This person does not have two-step sign-in on.');
      await db.query('delete from sessions where user_id = $1', [id]);
      await mfaNotice(db, user, false, 'COMVERA support');
      await logPlatformAction(db, ctx, 'Reset two-step sign-in', user.org_id, `${user.email}: ${reason}`, req.ip);
      return user;
    });
    securityEvent(req, 'mfa_reset_by_platform', { userId: u.id });
    return { ok: true };
  });

  app.post('/api/manager/orgs/:id/extend-trial', rl(20), async (req) => {
    const ctx = await requireManager(req);
    const { id } = req.params as { id: string };
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(30) }).parse(req.body);
    if (!isUuid(id)) throw notFound();
    return withTx(async (db) => {
      const o = await one<{ id: string; kind: OrgKind; status: string; name: string }>(db,
        `select o.id, o.kind, coalesce(o.subscription_status, 'none') as status, o.name from organisations o where o.id = $1 and ${ANY_ORG} for update`, [id]);
      if (!o) throw notFound();
      if (['active', 'past_due'].includes(o.status)) throw conflict('This customer has a paid subscription, so there is no trial to extend.');
      const plan = defaultPlanFor(o.kind).plan;
      await db.query(
        `update organisations set subscription_status = 'trialing', plan = $2, trial_ends_at = greatest(coalesce(trial_ends_at, now()), now()) + ($3 || ' days')::interval where id = $1`,
        [id, plan.id, String(days)],
      );
      await db.query(`insert into audit_events (org_id, actor_name, actor_role, action, detail) values ($1, $2, 'COMVERA platform', 'Extended trial', $3)`, [id, ctx.user.name, `${days} days`]);
      await logPlatformAction(db, ctx, 'Extended a trial', id, `${o.name}: +${days} days`, req.ip);
      await publishChange(db, [id]);
      return { ok: true };
    });
  });
}
