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
import { isPlatformAdmin } from '../config.js';
import { conflict, forbidden, HttpError, notFound, unauthorized } from '../lib/errors.js';
import { isUuid, requireUser, type Ctx } from '../lib/authz.js';
import { PLANS, defaultPlanFor, type OrgKind } from '../lib/plans.js';
import { logPlatformAction } from '../lib/platformLog.js';
import { publishChange } from '../lib/realtime.js';
import { hashRecovery, matchStep, newRecoveryCodes, newSecret, openSecret, otpauthUrl, sealSecret } from '../lib/totp.js';
import { queueResetEmail, rl } from './auth.js';

const MFA_MAX_AGE_MS = 12 * 3600_000;
const REAL_ORG = `not o.is_demo and o.managed_by_org is null`;

function requireAdminUser(req: FastifyRequest): Ctx {
  const ctx = requireUser(req.ctx);
  if (!isPlatformAdmin(ctx.user)) throw notFound();
  return ctx;
}

/** A platform admin whose session has passed the second step recently. */
async function requireManager(req: FastifyRequest): Promise<Ctx> {
  const ctx = requireAdminUser(req);
  const mfa = await one<{ enabled_at: Date | null }>(pool, 'select enabled_at from admin_mfa where user_id = $1', [ctx.user.id]);
  const fresh = ctx.mfaVerifiedAt && Date.now() - new Date(ctx.mfaVerifiedAt).getTime() < MFA_MAX_AGE_MS;
  if (!mfa?.enabled_at || !fresh) throw new HttpError(403, 'mfa_required', 'Enter your authenticator code to continue.');
  return ctx;
}

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
    const mfa = await one<{ enabled_at: Date | null }>(pool, 'select enabled_at from admin_mfa where user_id = $1', [ctx.user.id]);
    const fresh = !!ctx.mfaVerifiedAt && Date.now() - new Date(ctx.mfaVerifiedAt).getTime() < MFA_MAX_AGE_MS;
    return { email: ctx.user.email, name: ctx.user.name, enrolled: !!mfa?.enabled_at, verified: !!mfa?.enabled_at && fresh };
  });

  app.post('/api/manager/mfa/setup', rl(5), async (req) => {
    const ctx = requireAdminUser(req);
    const have = await one<{ enabled_at: Date | null }>(pool, 'select enabled_at from admin_mfa where user_id = $1', [ctx.user.id]);
    if (have?.enabled_at) throw conflict('The second step is already set up for this account.');
    const secret = newSecret();
    await pool.query(
      `insert into admin_mfa (user_id, secret) values ($1, $2)
       on conflict (user_id) do update set secret = excluded.secret, created_at = now()`,
      [ctx.user.id, sealSecret(secret)],
    );
    return { secret, otpauth: otpauthUrl(ctx.user.email, secret) };
  });

  /** Sign-in failures on the second step lock the account like password failures do. */
  async function failedCode(userId: string) {
    await pool.query(
      `update users set failed_login_count = failed_login_count + 1,
              locked_until = case when failed_login_count + 1 >= 10 then now() + interval '15 minutes' else locked_until end where id = $1`, [userId]);
    throw unauthorized('That code is not right. Check your authenticator app and try again.');
  }
  async function checkNotLocked(userId: string) {
    const u = await one<{ locked_until: Date | null }>(pool, 'select locked_until from users where id = $1', [userId]);
    if (u?.locked_until && new Date(u.locked_until) > new Date()) throw new HttpError(423, 'locked', 'Too many wrong codes. Try again in 15 minutes.');
  }

  app.post('/api/manager/mfa/enable', rl(10), async (req) => {
    const ctx = requireAdminUser(req);
    const { code } = z.object({ code: z.string().trim().max(10) }).parse(req.body);
    await checkNotLocked(ctx.user.id);
    const row = await one<{ secret: string; enabled_at: Date | null }>(pool, 'select secret, enabled_at from admin_mfa where user_id = $1', [ctx.user.id]);
    if (!row || row.enabled_at) throw conflict('Start the setup again.');
    const secret = openSecret(row.secret);
    const step = secret ? matchStep(secret, code) : null;
    if (step === null) return failedCode(ctx.user.id);
    const { codes, hashes } = newRecoveryCodes();
    await withTx(async (db) => {
      await db.query('update admin_mfa set enabled_at = now(), last_step = $2, recovery_hashes = $3 where user_id = $1', [ctx.user.id, step, hashes]);
      await db.query('update sessions set mfa_verified_at = now() where id = $1', [ctx.sessionId]);
      await logPlatformAction(db, ctx, 'Set up the second sign-in step', null, '', req.ip);
    });
    return { ok: true, recoveryCodes: codes };
  });

  app.post('/api/manager/mfa/verify', rl(10), async (req) => {
    const ctx = requireAdminUser(req);
    const { code } = z.object({ code: z.string().trim().min(1).max(20) }).parse(req.body);
    await checkNotLocked(ctx.user.id);
    const row = await one<{ secret: string; enabled_at: Date | null; last_step: string; recovery_hashes: string[] }>(
      pool, 'select secret, enabled_at, last_step, recovery_hashes from admin_mfa where user_id = $1', [ctx.user.id]);
    if (!row?.enabled_at) throw conflict('Set up the second step first.');
    let how = '';
    await withTx(async (db) => {
      const secret = openSecret(row.secret);
      const step = secret && /^\d{6}$/.test(code) ? matchStep(secret, code) : null;
      if (step !== null && step > Number(row.last_step)) {
        await db.query('update admin_mfa set last_step = $2 where user_id = $1', [ctx.user.id, step]);
        how = 'authenticator code';
      } else if (!/^\d{6}$/.test(code) && row.recovery_hashes.includes(hashRecovery(code))) {
        await db.query('update admin_mfa set recovery_hashes = array_remove(recovery_hashes, $2) where user_id = $1', [ctx.user.id, hashRecovery(code)]);
        how = 'recovery code';
      }
      if (how) {
        await db.query('update sessions set mfa_verified_at = now() where id = $1', [ctx.sessionId]);
        await db.query('update users set failed_login_count = 0, locked_until = null where id = $1', [ctx.user.id]);
        await logPlatformAction(db, ctx, 'Signed in to the manager portal', null, `with ${how}`, req.ip);
      }
    });
    if (!how) return failedCode(ctx.user.id);
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
    return { orgs, status, paidPlans: plans, users, content, exchanges: exch, email: mail, payments: pay, openInbox: (inbox as { open: number }).open, pastDue: past };
  });

  // ---------- customers ----------
  app.get('/api/manager/orgs', rl(60), async (req, reply) => {
    await requireManager(req);
    reply.header('cache-control', 'no-store');
    const f = z.object({ q: z.string().trim().max(100).default(''), kind: z.enum(['', 'host', 'contractor']).default(''), status: z.string().max(30).default(''), page }).parse(req.query);
    const rows = await many(pool,
      `select o.id, o.name, o.kind, o.plan, coalesce(o.subscription_status, 'none') as status, o.trial_ends_at as "trialEndsAt", o.created_at as "createdAt",
              (select count(*) from memberships m where m.org_id = o.id)::int as members,
              (select max(s.last_seen_at) from sessions s join memberships m on m.user_id = s.user_id where m.org_id = o.id) as "lastActive",
              (select count(*) from workplaces w where w.org_id = o.id and w.archived_at is null)::int as workplaces,
              (select count(*) from sites s where s.org_id = o.id and s.status <> 'declined')::int as files
         from organisations o
        where ${REAL_ORG} and ($1 = '' or o.name ilike '%' || $1 || '%' or exists (select 1 from memberships m join users u on u.id = m.user_id where m.org_id = o.id and u.email ilike '%' || $1 || '%'))
          and ($2 = '' or o.kind = $2) and ($3 = '' or coalesce(o.subscription_status, 'none') = $3)
        order by o.created_at desc limit 26 offset $4`, [f.q, f.kind, f.status, f.page * 25]);
    return { orgs: rows.slice(0, 25), more: rows.length > 25 };
  });

  app.get('/api/manager/orgs/:id', rl(60), async (req, reply) => {
    await requireManager(req);
    reply.header('cache-control', 'no-store');
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    const org = await one<Record<string, unknown>>(pool,
      `select o.id, o.name, o.kind, o.plan, coalesce(o.subscription_status, 'none') as status, o.trial_ends_at as "trialEndsAt", o.current_period_end as "periodEnd",
              o.grant_plan as "grantPlan", o.grant_until as "grantUntil", o.grant_source as "grantSource", o.seat_limit as "seatLimit", o.created_at as "createdAt",
              o.billing_provider as "billingProvider", (o.paystack_subscription_code is not null) as "hasPaystackSubscription", (o.stripe_subscription_id is not null) as "hasStripeSubscription"
         from organisations o where o.id = $1 and ${REAL_ORG}`, [id]);
    if (!org) throw notFound();
    const [members, counts, payments, actions, grant] = await Promise.all([
      many(pool,
        `select u.id, u.name, u.email, m.role, u.email_verified_at is not null as verified, u.created_at as "joinedAt",
                (select max(s.last_seen_at) from sessions s where s.user_id = u.id) as "lastSeen",
                exists (select 1 from email_outbox e where e.to_email = u.email and e.status = 'failed' and e.created_at > now() - interval '30 days') as "emailProblem"
           from memberships m join users u on u.id = m.user_id where m.org_id = $1 order by m.created_at`, [id]),
      orgCounts(id),
      many(pool, `select reference, kind, plan_id as "planId", amount_cents as "amountCents", status, failure_reason as "failureReason", created_at as "createdAt", paid_at as "paidAt" from payments where org_id = $1 order by created_at desc limit 10`, [id]),
      many(pool, `select admin_email as "by", action, detail, created_at as "at" from platform_actions where org_id = $1 order by created_at desc limit 10`, [id]),
      activeGrant(id),
    ]);
    return {
      org: { ...org, planName: (PLANS as Record<string, { name: string }>)[org.plan as string]?.name ?? org.plan },
      members, counts, payments, actions,
      supportAccess: grant ? { expiresAt: grant.expires_at, grantedBy: grant.granted_by_name, reason: grant.reason } : null,
    };
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
    const grant = await activeGrant(id);
    if (!grant) throw forbidden('This customer has not switched on support access. Ask them to turn it on under Settings.');
    const org = await one<{ id: string; name: string }>(pool, `select o.id, o.name from organisations o where o.id = $1 and ${REAL_ORG}`, [id]);
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
      await logPlatformAction(db, ctx, 'Viewed customer account (support access)', id, `${org.name}; grant until ${new Date(grant.expires_at).toISOString()}`, req.ip);
      await db.query(
        `insert into audit_events (org_id, actor_id, actor_name, actor_role, action, detail) values ($1, $2, $3, 'COMVERA support', 'COMVERA support viewed this account', $4)`,
        [id, ctx.user.id, ctx.user.name, 'Read-only, using the support access you switched on.'],
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
          where u.id = $1 and not u.is_demo and ${REAL_ORG} limit 1`, [id]);
      if (!u) throw notFound();
      await queueResetEmail(db, u);
      await logPlatformAction(db, ctx, 'Sent a password reset email', u.org_id, `to ${u.email}`, req.ip);
      return { ok: true };
    });
  });

  app.post('/api/manager/orgs/:id/extend-trial', rl(20), async (req) => {
    const ctx = await requireManager(req);
    const { id } = req.params as { id: string };
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(30) }).parse(req.body);
    if (!isUuid(id)) throw notFound();
    return withTx(async (db) => {
      const o = await one<{ id: string; kind: OrgKind; status: string; name: string }>(db,
        `select o.id, o.kind, coalesce(o.subscription_status, 'none') as status, o.name from organisations o where o.id = $1 and ${REAL_ORG} for update`, [id]);
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
