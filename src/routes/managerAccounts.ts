/**
 * Account control for the platform owner: customers and people, their status (active / suspended /
 * deactivated), flags for review, test classification, and the protected deletion workflow.
 *
 * These are four different things and stay different:
 *  - flag: a note for review. It blocks nothing.
 *  - suspend / deactivate: access is switched off and sessions end. Nothing is removed. Reversible.
 *  - deletion: scheduled, waits 14 days, then needs a fresh authenticator code, the password and the
 *    typed name. It is the only thing here that cannot be undone.
 * Nothing in this file is decided by an automated rule: suspicious accounts are only listed.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, pool, withTx, type Db } from '../db/pool.js';
import { isPlatformAdmin } from '../config.js';
import { PLANS } from '../lib/plans.js';
import { conflict, notFound } from '../lib/errors.js';
import { isUuid, type Ctx } from '../lib/authz.js';
import { ANY_ORG, requireManager, stepUp } from '../lib/managerAuth.js';
import { logPlatformAction } from '../lib/platformLog.js';
import { securityEvent } from '../lib/securityLog.js';
import { storage } from '../lib/storage.js';
import { rl } from './auth.js';

export const DELETION_WAIT_DAYS = 14;
const FLAGS = ['suspicious', 'suspected_bot', 'spam', 'duplicate', 'under_investigation'] as const;
const CLASSES = ['customer', 'internal_test', 'development'] as const;
const planName = (id: unknown) => (PLANS as Record<string, { name: string }>)[id as string]?.name ?? String(id ?? '');
const reason = z.string().trim().min(3).max(300);
const page = z.coerce.number().int().min(0).max(1000).default(0);
const idParam = (req: { params: unknown }) => {
  const { id } = req.params as { id: string };
  if (!isUuid(id)) throw notFound();
  return id;
};

type OrgBrief = { id: string; name: string; kind: string; status: string; is_demo: boolean; subscription_status: string | null };

async function loadOrg(db: Db, id: string, lock = false): Promise<OrgBrief> {
  const o = await one<OrgBrief>(db, `select o.id, o.name, o.kind, o.status, o.is_demo, o.subscription_status from organisations o where o.id = $1 and ${ANY_ORG} ${lock ? 'for update' : ''}`, [id]);
  if (!o) throw notFound();
  return o;
}

const isOwnerAddress = (m: { email: string; email_verified_at?: unknown }) => isPlatformAdmin({ email: m.email, email_verified_at: new Date(), is_demo: false }); // protected even if unverified

async function orgHasPlatformAdmin(db: Db, orgId: string) {
  const ms = await many<{ email: string; email_verified_at: Date | null }>(db, `select u.email, u.email_verified_at from memberships m join users u on u.id = m.user_id where m.org_id = $1`, [orgId]);
  return ms.some(isOwnerAddress);
}

/** What permanent deletion would remove and keep. Shown before anything is scheduled, and again before it runs. */
export async function deletionImpact(db: Db, orgId: string) {
  const [members, content, others, retained] = await Promise.all([
    many<{ id: string; name: string; email: string; role: string; other_orgs: number }>(db,
      `select u.id, u.name, u.email, m.role, (select count(*) from memberships x where x.user_id = u.id and x.org_id <> $1)::int as other_orgs
         from memberships m join users u on u.id = m.user_id where m.org_id = $1 order by m.created_at`, [orgId]),
    one<Record<string, number>>(db,
      `with scope as (select id from organisations where id = $1 or managed_by_org = $1)
       select (select count(*) from workplaces where org_id in (select id from scope))::int as sites,
              (select count(*) from sites where org_id in (select id from scope) and status <> 'declined')::int as "contractorFiles",
              (select count(*) from organisations where managed_by_org = $1)::int as "clientRecords",
              (select count(*) from files where org_id in (select id from scope))::int as files,
              (select coalesce(sum(size_bytes), 0)::bigint::text from files where org_id in (select id from scope)) as bytes,
              (select count(*) from documents d join requirements r on r.id = d.requirement_id join sites s on s.id = r.site_id where s.org_id in (select id from scope))::int as documents,
              (select count(*) from generated_documents where org_id in (select id from scope))::int as "studioDocuments",
              (select count(*) from exchanges where sender_org_id = $1)::int as exchanges,
              (select count(*) from user_invites where org_id = $1 and accepted_at is null and revoked_at is null)::int as "pendingInvites",
              (select count(*) from audit_events where org_id in (select id from scope))::int as "auditEvents"`, [orgId]),
    one<{ linkedAtOthers: number; contractorsLinked: number; docsAtOthers: number }>(db,
      `select (select count(distinct d.id) from documents d join files f on f.id = d.current_file_id where f.org_id = any(array(select id from organisations where id = $1 or managed_by_org = $1))
                 and d.requirement_id in (select r.id from requirements r join sites s on s.id = r.site_id where s.org_id <> $1 and s.org_id <> all(array(select id from organisations where managed_by_org = $1))))::int as "docsAtOthers",
              (select count(*) from contractors c join sites s on s.contractor_id = c.id where c.linked_org_id = $1 and s.org_id <> $1)::int as "linkedAtOthers",
              (select count(*) from contractors where org_id = $1 and linked_org_id is not null)::int as "contractorsLinked"`, [orgId]),
    one<{ payments: number; actions: number }>(db,
      `select (select count(*) from payments where org_id = $1)::int as payments, (select count(*) from platform_actions where org_id = $1)::int as actions`, [orgId]),
  ]);
  return {
    people: { total: members.length, removed: members.filter((m) => m.other_orgs === 0).length, kept: members.filter((m) => m.other_orgs > 0).length,
      list: members.map((m) => ({ name: m.name, email: m.email, role: m.role, outcome: m.other_orgs === 0 ? 'account deleted' : 'only membership removed (belongs to other organisations)' })) },
    removed: content,
    relationships: {
      contractorsLinkedFromThisOrganisation: others?.contractorsLinked ?? 0,
      sitesAtOtherOrganisationsKeepTheirRecordsButLoseTheLink: others?.linkedAtOthers ?? 0,
      documentsAtOtherOrganisationsLoseTheirFile: others?.docsAtOthers ?? 0,
    },
    kept: {
      paymentRecords: retained?.payments ?? 0,
      platformActionLog: retained?.actions ?? 0,
      note: 'Payment records and this deletion are kept in a permanent ledger. Everything else the organisation owns, including its files and its own audit trail, is removed. Files are erased from storage.',
    },
    reversible: false,
  };
}

export default async function managerAccountRoutes(app: FastifyInstance) {
  // ---------- customers ----------
  app.get('/api/manager/orgs', rl(60), async (req, reply) => {
    await requireManager(req);
    reply.header('cache-control', 'no-store');
    const f = z.object({
      q: z.string().trim().max(100).default(''), kind: z.enum(['', 'host', 'contractor']).default(''), billing: z.string().max(30).default(''),
      status: z.enum(['', 'active', 'suspended', 'deactivated']).default(''), cls: z.enum(['', 'customer', 'internal_test', 'development', 'demo']).default(''),
      flagged: z.enum(['', '1']).default(''), page,
    }).parse(req.query);
    const rows = await many(pool,
      `select o.id, o.name, o.kind, o.plan, coalesce(o.subscription_status, 'none') as billing, o.trial_ends_at as "trialEndsAt", o.created_at as "createdAt",
              o.status, o.flag_kind as "flagKind", case when o.is_demo then 'demo' else o.account_class end as class,
              (select count(*) from memberships m where m.org_id = o.id)::int as members,
              (select count(*) from memberships m join users u on u.id = m.user_id where m.org_id = o.id and u.email_verified_at is not null)::int as verified,
              (select max(s.last_seen_at) from sessions s join memberships m on m.user_id = s.user_id where m.org_id = o.id) as "lastActive",
              (select count(*) from workplaces w where w.org_id = o.id and w.archived_at is null)::int as workplaces,
              (select count(*) from sites s where s.org_id = o.id and s.status <> 'declined')::int as files,
              exists (select 1 from deletion_requests d where d.org_id = o.id and d.status = 'scheduled') as "deletionScheduled"
         from organisations o
        where ${ANY_ORG}
          and ($1 = '' or o.name ilike '%' || $1 || '%' or exists (select 1 from memberships m join users u on u.id = m.user_id where m.org_id = o.id and (u.email ilike '%' || $1 || '%' or u.name ilike '%' || $1 || '%')))
          and ($2 = '' or o.kind = $2) and ($3 = '' or coalesce(o.subscription_status, 'none') = $3) and ($4 = '' or o.status = $4)
          and (case when $5 = '' then not o.is_demo when $5 = 'demo' then o.is_demo else (not o.is_demo and o.account_class = $5) end)
          and ($6 = '' or o.flag_kind is not null)
        order by o.created_at desc limit 26 offset $7`, [f.q, f.kind, f.billing, f.status, f.cls, f.flagged, f.page * 25]);
    return { orgs: rows.slice(0, 25).map((o) => ({ ...o, planName: planName((o as { plan: string }).plan) })), more: rows.length > 25 };
  });

  app.get('/api/manager/orgs/:id', rl(60), async (req, reply) => {
    await requireManager(req);
    reply.header('cache-control', 'no-store');
    const id = idParam(req);
    const org = await one<Record<string, unknown>>(pool,
      `select o.id, o.name, o.kind, o.plan, coalesce(o.subscription_status, 'none') as billing, o.trial_ends_at as "trialEndsAt", o.current_period_end as "periodEnd",
              o.grant_plan as "grantPlan", o.grant_until as "grantUntil", o.grant_source as "grantSource", o.seat_limit as "seatLimit", o.created_at as "createdAt",
              o.billing_provider as "billingProvider", (o.paystack_subscription_code is not null) as "hasPaystackSubscription", (o.stripe_subscription_id is not null) as "hasStripeSubscription",
              o.status, o.status_reason as "statusReason", o.status_changed_at as "statusChangedAt", o.status_changed_by as "statusChangedBy",
              o.flag_kind as "flagKind", o.flag_reason as "flagReason", o.flagged_at as "flaggedAt",
              case when o.is_demo then 'demo' else o.account_class end as class, o.reg_number as "regNumber", o.trade
         from organisations o where o.id = $1 and ${ANY_ORG}`, [id]);
    if (!org) throw notFound();
    const [sites, contractors, invites, deletion, lastActive, payments, actions, grant] = await Promise.all([
      many(pool, `select w.id, w.name, w.location, w.created_at as "createdAt" from workplaces w where w.org_id = $1 and w.archived_at is null order by w.created_at desc limit 50`, [id]),
      many(pool,
        `select c.id, c.name, lo.name as "linkedName", lo.id as "linkedOrgId",
                (select count(*) from sites s where s.contractor_id = c.id and s.status <> 'declined')::int as files
           from contractors c left join organisations lo on lo.id = c.linked_org_id where c.org_id = $1 order by c.name limit 100`, [id]),
      one<{ users: number; sites: number }>(pool,
        `select (select count(*) from user_invites where org_id = $1 and accepted_at is null and revoked_at is null and expires_at > now())::int as users,
                (select count(*) from site_invitations where org_id = $1 and status = 'pending')::int as sites`, [id]),
      one(pool, `select id, reason, requested_by as "requestedBy", requested_at as "requestedAt", scheduled_for as "scheduledFor", impact from deletion_requests where org_id = $1 and status = 'scheduled'`, [id]),
      one<{ at: Date | null }>(pool, `select max(s.last_seen_at) as at from sessions s join memberships m on m.user_id = s.user_id where m.org_id = $1`, [id]),
      many(pool, `select reference, kind, plan_id as "planId", amount_cents as "amountCents", status, failure_reason as "failureReason", created_at as "createdAt", paid_at as "paidAt" from payments where org_id = $1 order by created_at desc limit 10`, [id]),
      many(pool, `select admin_email as "by", action, detail, created_at as "at" from platform_actions where org_id = $1 order by created_at desc limit 15`, [id]),
      one<{ expires_at: Date; granted_by_name: string; reason: string }>(pool, `select expires_at, granted_by_name, reason from support_access_grants where org_id = $1 and revoked_at is null and expires_at > now() order by expires_at desc limit 1`, [id]),
    ]);
    return { org: { ...org, planName: planName(org.plan), lastActive: lastActive?.at ?? null }, sites, contractors, invites, deletion, payments, actions,
      supportAccess: grant ? { expiresAt: grant.expires_at, grantedBy: grant.granted_by_name, reason: grant.reason } : null, deletionWaitDays: DELETION_WAIT_DAYS };
  });

  /** Numbers for the sidebar: only things that need a person. */
  app.get('/api/manager/badges', rl(120), async (req, reply) => {
    await requireManager(req);
    reply.header('cache-control', 'no-store');
    const b = await one<{ review: number; attention: number; inbox: number }>(pool,
      `select ((select count(*) from organisations o where o.managed_by_org is null and o.flag_kind is not null) + (select count(*) from users where flag_kind is not null)
               + (select count(*) from deletion_requests where status = 'scheduled'))::int as review,
              ((select count(*) from email_outbox where status = 'failed' and created_at > now() - interval '30 days')
               + (select count(*) from organisations o where o.managed_by_org is null and not o.is_demo and o.subscription_status = 'past_due'))::int as attention,
              ((select count(*) from feedback where handled_at is null) + (select count(*) from enquiries where handled_at is null))::int as inbox`);
    return b ?? { review: 0, attention: 0, inbox: 0 };
  });

  /** Suspend, deactivate or reactivate. Ends every session in that organisation. Never removes anything. */
  app.post('/api/manager/orgs/:id/status', rl(20), async (req) => {
    const ctx = await requireManager(req);
    const id = idParam(req);
    const b = z.object({ status: z.enum(['active', 'suspended', 'deactivated']), reason, confirmName: z.string().max(300).default('') }).parse(req.body);
    return withTx(async (db) => {
      const o = await loadOrg(db, id, true);
      if (o.is_demo) throw conflict('Demo sandboxes are cleared automatically, so they have no status.');
      if (o.status === b.status) throw conflict('It is already ' + b.status + '.');
      if (b.status !== 'active') {
        if (b.confirmName.trim() !== o.name) throw conflict('Type the organisation’s exact name to confirm.');
        if (await orgHasPlatformAdmin(db, id)) throw conflict('A platform owner belongs to this organisation, so it cannot be switched off.');
      } else if (await one(db, `select 1 from deletion_requests where org_id = $1 and status = 'scheduled'`, [id])) {
        throw conflict('Cancel the deletion request before reactivating.');
      }
      await db.query(`update organisations set status = $2, status_reason = $3, status_changed_at = now(), status_changed_by = $4 where id = $1`, [id, b.status, b.reason, ctx.user.email]);
      const ended = await db.query('delete from sessions where org_id = $1', [id]);
      const label = { active: 'Reactivated', suspended: 'Suspended', deactivated: 'Deactivated' }[b.status];
      await db.query(`insert into audit_events (org_id, actor_name, actor_role, action, detail) values ($1, $2, 'COMVERA platform', $3, $4)`, [id, ctx.user.name, label + ' the account', b.reason]);
      await logPlatformAction(db, ctx, label + ' an organisation', id, `${o.name}: ${b.reason}`, req.ip);
      securityEvent(req, 'account_status_changed', { target: 'organisation', status: b.status, sessionsEnded: ended.rowCount ?? 0 });
      return { ok: true, sessionsEnded: ended.rowCount ?? 0 };
    });
  });

  app.post('/api/manager/orgs/:id/flag', rl(30), async (req) => {
    const ctx = await requireManager(req);
    const id = idParam(req);
    const b = z.object({ kind: z.enum(FLAGS), reason }).parse(req.body);
    return withTx(async (db) => {
      const o = await loadOrg(db, id, true);
      await db.query(`update organisations set flag_kind = $2, flag_reason = $3, flagged_at = now() where id = $1`, [id, b.kind, b.reason]);
      await logPlatformAction(db, ctx, 'Flagged an organisation (' + b.kind + ')', id, `${o.name}: ${b.reason}`, req.ip);
      return { ok: true };
    });
  });
  app.post('/api/manager/orgs/:id/unflag', rl(30), async (req) => {
    const ctx = await requireManager(req);
    const id = idParam(req);
    return withTx(async (db) => {
      const o = await loadOrg(db, id, true);
      await db.query(`update organisations set flag_kind = null, flag_reason = '', flagged_at = null where id = $1`, [id]);
      await logPlatformAction(db, ctx, 'Cleared a flag on an organisation', id, o.name, req.ip);
      return { ok: true };
    });
  });

  /** Separates internal test and development accounts from real customers (they leave the counts, never the list). */
  app.post('/api/manager/orgs/:id/class', rl(30), async (req) => {
    const ctx = await requireManager(req);
    const id = idParam(req);
    const b = z.object({ class: z.enum(CLASSES) }).parse(req.body);
    return withTx(async (db) => {
      const o = await loadOrg(db, id, true);
      if (o.is_demo) throw conflict('Demo sandboxes are already separate.');
      await db.query(`update organisations set account_class = $2 where id = $1`, [id, b.class]);
      await logPlatformAction(db, ctx, 'Classified an organisation as ' + b.class, id, o.name, req.ip);
      return { ok: true };
    });
  });

  // ---------- protected permanent deletion ----------
  app.get('/api/manager/orgs/:id/deletion-preview', rl(20), async (req, reply) => {
    await requireManager(req);
    reply.header('cache-control', 'no-store');
    const id = idParam(req);
    const o = await loadOrg(pool, id);
    return { org: { id: o.id, name: o.name, kind: o.kind, status: o.status }, impact: await deletionImpact(pool, id), waitDays: DELETION_WAIT_DAYS,
      blockers: await deletionBlockers(o) };
  });

  async function deletionBlockers(o: OrgBrief) {
    const out: string[] = [];
    if (o.is_demo) out.push('Demo sandboxes are cleared automatically.');
    if (o.status !== 'deactivated') out.push('Deactivate the organisation first. Deletion is only for accounts that are already closed.');
    if (['active', 'past_due'].includes(o.subscription_status ?? '')) out.push('It has a paid subscription. Cancel it with the payment provider first so no one is charged for a deleted account.');
    if (await orgHasPlatformAdmin(pool, o.id)) out.push('A platform owner belongs to this organisation.');
    return out;
  }

  app.post('/api/manager/orgs/:id/deletion/schedule', rl(5), async (req) => {
    const ctx = await requireManager(req);
    const id = idParam(req);
    const b = z.object({ reason, confirmName: z.string().max(300), password: z.string().min(1).max(200), code: z.string().trim().min(1).max(20) }).parse(req.body);
    const o = await loadOrg(pool, id);
    const blockers = await deletionBlockers(o);
    if (blockers.length) throw conflict(blockers[0]);
    if (b.confirmName.trim() !== o.name) throw conflict('Type the organisation’s exact name to confirm.');
    if (await one(pool, `select 1 from deletion_requests where org_id = $1 and status = 'scheduled'`, [id])) throw conflict('Deletion is already scheduled.');
    await stepUp(req, ctx, b.password, b.code);
    return withTx(async (db) => {
      await loadOrg(db, id, true);
      if (await one(db, `select 1 from deletion_requests where org_id = $1 and status = 'scheduled'`, [id])) throw conflict('Deletion is already scheduled.');
      const impact = await deletionImpact(db, id);
      impact.people.list = []; // counts only: names and emails must not outlive the deletion
      const r = (await one<{ id: string; scheduled_for: Date }>(db,
        `insert into deletion_requests (org_id, org_name, org_kind, reason, requested_by, scheduled_for, impact) values ($1, $2, $3, $4, $5, now() + make_interval(days => $6), $7)
         returning id, scheduled_for`, [id, o.name, o.kind, b.reason, ctx.user.email, DELETION_WAIT_DAYS, JSON.stringify(impact)]))!;
      await logPlatformAction(db, ctx, 'Scheduled permanent deletion of an organisation', id, `${o.name}: ${b.reason}; earliest ${r.scheduled_for.toISOString().slice(0, 10)}`, req.ip);
      securityEvent(req, 'account_deletion_scheduled', { target: 'organisation' });
      return { ok: true, scheduledFor: r.scheduled_for };
    });
  });

  app.post('/api/manager/orgs/:id/deletion/cancel', rl(10), async (req) => {
    const ctx = await requireManager(req);
    const id = idParam(req);
    return withTx(async (db) => {
      const r = await one<{ org_name: string }>(db, `update deletion_requests set status = 'cancelled', closed_by = $2, closed_at = now() where org_id = $1 and status = 'scheduled' returning org_name`, [id, ctx.user.email]);
      if (!r) throw notFound();
      await logPlatformAction(db, ctx, 'Cancelled a deletion request', id, r.org_name, req.ip);
      return { ok: true };
    });
  });

  app.post('/api/manager/orgs/:id/deletion/execute', rl(5), async (req) => {
    const ctx = await requireManager(req);
    const id = idParam(req);
    const b = z.object({ confirmName: z.string().max(300), password: z.string().min(1).max(200), code: z.string().trim().min(1).max(20) }).parse(req.body);
    const o = await loadOrg(pool, id);
    const dr = await one<{ id: string; reason: string; scheduled_for: Date }>(pool, `select id, reason, scheduled_for from deletion_requests where org_id = $1 and status = 'scheduled'`, [id]);
    if (!dr) throw conflict('Nothing is scheduled for this organisation.');
    if (new Date(dr.scheduled_for) > new Date()) throw conflict(`The waiting period is not over. Earliest: ${new Date(dr.scheduled_for).toISOString().slice(0, 10)}.`);
    const blockers = await deletionBlockers(o);
    if (blockers.length) throw conflict(blockers[0]);
    if (b.confirmName.trim() !== o.name) throw conflict('Type the organisation’s exact name to confirm.');
    await stepUp(req, ctx, b.password, b.code);

    const keys: string[] = [];
    const removed = await withTx(async (db) => {
      await db.query(`set local siteguard.purge = 'on'`); // lets this one transaction remove the organisation's own audit trail
      const live = await loadOrg(db, id, true);
      const still = await one<{ scheduled_for: Date }>(db, `select scheduled_for from deletion_requests where id = $1 and status = 'scheduled' for update`, [dr.id]);
      if (!still || new Date(still.scheduled_for) > new Date()) throw conflict('The deletion was cancelled or is not due. Nothing was deleted.');
      const nowBlocked = await deletionBlockers(live);
      if (nowBlocked.length) throw conflict(nowBlocked[0]);
      const impact = await deletionImpact(db, id);
      const scope = (await many<{ id: string }>(db, `select id from organisations where id = $1 or managed_by_org = $1`, [id])).map((r) => r.id);
      for (const f of await many<{ storage_key: string }>(db, `select storage_key from files where org_id = any($1::uuid[])`, [scope])) keys.push(f.storage_key);
      const payments = await many(db, `select reference, kind, plan_id as "planId", amount_cents as "amountCents", status, created_at as "createdAt", paid_at as "paidAt" from payments where org_id = any($1::uuid[])`, [scope]);
      // People who belong nowhere else are deleted; everyone else only loses this membership.
      const gone = (await many<{ id: string; email: string; email_verified_at: Date | null }>(db,
        `select u.id, u.email, u.email_verified_at from memberships m join users u on u.id = m.user_id
          where m.org_id = $1 and not u.is_demo and not exists (select 1 from memberships x where x.user_id = u.id and x.org_id <> $1)`, [id])).filter((u) => !isOwnerAddress(u)).map((u) => u.id);
      await db.query(`update audit_events set actor_name = 'Deleted user', actor_id = null where actor_id = any($1::uuid[])`, [gone]);
      await db.query(`delete from exchanges where sender_org_id = any($1::uuid[])`, [scope]); // their uploads reference files with ON DELETE RESTRICT
      await db.query(`delete from sites where org_id = any($1::uuid[])`, [scope]); // sites reference contractors with ON DELETE RESTRICT
      await db.query(`delete from organisations where id = any($1::uuid[])`, [scope]);
      if (gone.length) await db.query(`delete from users where id = any($1::uuid[])`, [gone]);
      await db.query(
        `insert into deletion_ledger (request_id, org_id, org_name, org_kind, deleted_by, reason, removed, payments) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [dr.id, id, o.name, o.kind, ctx.user.email, dr.reason, JSON.stringify({ ...impact.removed, peopleDeleted: gone.length, membershipsRemoved: impact.people.total }), JSON.stringify(payments)]);
      await db.query(`update deletion_requests set status = 'completed', impact = '{}'::jsonb, closed_by = $2, closed_at = now() where id = $1`, [dr.id, ctx.user.email]);
      await logPlatformAction(db, ctx, 'Permanently deleted an organisation', null, `${o.name} (${o.kind}); ${gone.length} people deleted; ${keys.length} files`, req.ip);
      return { people: gone.length, files: keys.length };
    });
    // Stored files go only after the rows are gone; a failure just leaves an orphan the next clean-up can find.
    for (const k of keys) await storage.remove(k).catch(() => {});
    securityEvent(req, 'account_deleted', { target: 'organisation' });
    return { ok: true, ...removed };
  });

  // ---------- people ----------
  app.get('/api/manager/users', rl(60), async (req, reply) => {
    await requireManager(req);
    reply.header('cache-control', 'no-store');
    const f = z.object({
      q: z.string().trim().max(100).default(''), orgId: z.string().default(''), role: z.enum(['', 'owner', 'admin', 'reviewer', 'member']).default(''),
      verified: z.enum(['', 'yes', 'no']).default(''), status: z.enum(['', 'active', 'suspended', 'deactivated']).default(''),
      cls: z.enum(['', 'customer', 'internal_test', 'development', 'demo']).default(''), flagged: z.enum(['', '1']).default(''), page,
    }).parse(req.query);
    if (f.orgId && !isUuid(f.orgId)) throw notFound();
    const rows = await many(pool,
      `select u.id, u.name, u.email, u.email_verified_at is not null as verified, u.status, u.flag_kind as "flagKind", case when u.is_demo then 'demo' else u.account_class end as class,
              u.created_at as "createdAt", (select max(s.last_seen_at) from sessions s where s.user_id = u.id) as "lastSeen",
              coalesce((select json_agg(json_build_object('id', o.id, 'name', o.name, 'role', m.role) order by m.created_at) from memberships m join organisations o on o.id = m.org_id where m.user_id = u.id), '[]'::json) as orgs
         from users u
        where ($1 = '' or u.name ilike '%' || $1 || '%' or u.email ilike '%' || $1 || '%')
          and ($2 = '' or exists (select 1 from memberships m where m.user_id = u.id and m.org_id = $2::uuid))
          and ($3 = '' or exists (select 1 from memberships m where m.user_id = u.id and m.role = $3))
          and ($4 = '' or ($4 = 'yes') = (u.email_verified_at is not null)) and ($5 = '' or u.status = $5)
          and (case when $6 = '' then not u.is_demo when $6 = 'demo' then u.is_demo else (not u.is_demo and u.account_class = $6) end)
          and ($7 = '' or u.flag_kind is not null)
        order by u.created_at desc limit 26 offset $8`,
      [f.q, f.orgId || '', f.role, f.verified, f.status, f.cls, f.flagged, f.page * 25]);
    return { users: rows.slice(0, 25), more: rows.length > 25 };
  });

  app.get('/api/manager/users/:id', rl(60), async (req, reply) => {
    await requireManager(req);
    reply.header('cache-control', 'no-store');
    const id = idParam(req);
    const user = await one<Record<string, unknown>>(pool,
      `select u.id, u.name, u.email, u.title, u.phone, u.email_verified_at as "verifiedAt", u.created_at as "createdAt", u.status, u.status_reason as "statusReason",
              u.status_changed_at as "statusChangedAt", u.status_changed_by as "statusChangedBy", u.flag_kind as "flagKind", u.flag_reason as "flagReason", u.flagged_at as "flaggedAt",
              case when u.is_demo then 'demo' else u.account_class end as class, u.failed_login_count as "failedLogins", (u.locked_until > now()) as locked,
              exists (select 1 from user_mfa f where f.user_id = u.id and f.enabled_at is not null) as mfa,
              (select count(*) from sessions s where s.user_id = u.id and s.expires_at > now())::int as sessions,
              (select max(s.last_seen_at) from sessions s where s.user_id = u.id) as "lastSeen", u.email as "emailAddress"
         from users u where u.id = $1`, [id]);
    if (!user) throw notFound();
    const [orgs, actions] = await Promise.all([
      many(pool, `select o.id, o.name, o.kind, o.status, m.role, m.created_at as "joinedAt" from memberships m join organisations o on o.id = m.org_id where m.user_id = $1 order by m.created_at`, [id]),
      many(pool, `select admin_email as "by", action, detail, created_at as "at" from platform_actions where detail ilike '%' || $1 || '%' order by id desc limit 10`, [user.email as string]),
    ]);
    return { user: { ...user, platformOwner: isOwnerAddress({ email: user.email as string, email_verified_at: user.verifiedAt }) }, orgs, actions, deletionWaitDays: DELETION_WAIT_DAYS };
  });

  async function personTarget(db: Db, ctx: Ctx, id: string) {
    const u = await one<{ id: string; name: string; email: string; email_verified_at: Date | null; is_demo: boolean; status: string; status_changed_at: Date | null }>(
      db, `select id, name, email, email_verified_at, is_demo, status, status_changed_at from users where id = $1 for update`, [id]);
    if (!u) throw notFound();
    if (u.is_demo) throw conflict('Demo people are cleared automatically.');
    if (u.id === ctx.user.id) throw conflict('You cannot do this to your own account.');
    if (isOwnerAddress(u)) throw conflict('This is a platform owner address. It is managed in the server settings, not here.');
    return u;
  }

  app.post('/api/manager/users/:id/status', rl(20), async (req) => {
    const ctx = await requireManager(req);
    const id = idParam(req);
    const b = z.object({ status: z.enum(['active', 'suspended', 'deactivated']), reason, confirmEmail: z.string().max(300).default('') }).parse(req.body);
    return withTx(async (db) => {
      const u = await personTarget(db, ctx, id);
      if (u.status === b.status) throw conflict('Already ' + b.status + '.');
      if (b.status !== 'active' && b.confirmEmail.trim().toLowerCase() !== u.email.toLowerCase()) throw conflict('Type the person’s exact email address to confirm.');
      await db.query(`update users set status = $2, status_reason = $3, status_changed_at = now(), status_changed_by = $4 where id = $1`, [id, b.status, b.reason, ctx.user.email]);
      const ended = await db.query('delete from sessions where user_id = $1', [id]);
      await db.query('delete from login_challenges where user_id = $1', [id]);
      const label = { active: 'Reactivated', suspended: 'Suspended', deactivated: 'Deactivated' }[b.status];
      await logPlatformAction(db, ctx, label + ' a person', null, `${u.email}: ${b.reason}`, req.ip);
      securityEvent(req, 'account_status_changed', { target: 'user', status: b.status, userId: id });
      return { ok: true, sessionsEnded: ended.rowCount ?? 0 };
    });
  });

  app.post('/api/manager/users/:id/flag', rl(30), async (req) => {
    const ctx = await requireManager(req);
    const id = idParam(req);
    const b = z.object({ kind: z.enum(FLAGS), reason }).parse(req.body);
    return withTx(async (db) => {
      const u = await personTarget(db, ctx, id);
      await db.query(`update users set flag_kind = $2, flag_reason = $3, flagged_at = now() where id = $1`, [id, b.kind, b.reason]);
      await logPlatformAction(db, ctx, 'Flagged a person (' + b.kind + ')', null, `${u.email}: ${b.reason}`, req.ip);
      return { ok: true };
    });
  });
  app.post('/api/manager/users/:id/unflag', rl(30), async (req) => {
    const ctx = await requireManager(req);
    const id = idParam(req);
    return withTx(async (db) => {
      const u = await personTarget(db, ctx, id);
      await db.query(`update users set flag_kind = null, flag_reason = '', flagged_at = null where id = $1`, [id]);
      await logPlatformAction(db, ctx, 'Cleared a flag on a person', null, u.email, req.ip);
      return { ok: true };
    });
  });
  app.post('/api/manager/users/:id/class', rl(30), async (req) => {
    const ctx = await requireManager(req);
    const id = idParam(req);
    const b = z.object({ class: z.enum(CLASSES) }).parse(req.body);
    return withTx(async (db) => {
      const u = await personTarget(db, ctx, id);
      await db.query(`update users set account_class = $2 where id = $1`, [id, b.class]);
      await logPlatformAction(db, ctx, 'Classified a person as ' + b.class, null, u.email, req.ip);
      return { ok: true };
    });
  });
  app.post('/api/manager/users/:id/revoke-sessions', rl(20), async (req) => {
    const ctx = await requireManager(req);
    const id = idParam(req);
    return withTx(async (db) => {
      const u = await personTarget(db, ctx, id);
      const ended = await db.query('delete from sessions where user_id = $1', [id]);
      await logPlatformAction(db, ctx, 'Ended all sessions for a person', null, `${u.email}: ${ended.rowCount ?? 0}`, req.ip);
      return { ok: true, sessionsEnded: ended.rowCount ?? 0 };
    });
  });

  /** Permanent: only a person who has been deactivated for the full waiting period, who is not the only person in an organisation. */
  app.post('/api/manager/users/:id/delete', rl(5), async (req) => {
    const ctx = await requireManager(req);
    const id = idParam(req);
    const b = z.object({ confirmEmail: z.string().max(300), password: z.string().min(1).max(200), code: z.string().trim().min(1).max(20) }).parse(req.body);
    const u = await personTarget(pool, ctx, id);
    if (u.status !== 'deactivated') throw conflict('Deactivate the person first.');
    if (!u.status_changed_at || Date.now() - new Date(u.status_changed_at).getTime() < DELETION_WAIT_DAYS * 86400_000) {
      throw conflict(`A person can be deleted ${DELETION_WAIT_DAYS} days after they were deactivated.`);
    }
    if (b.confirmEmail.trim().toLowerCase() !== u.email.toLowerCase()) throw conflict('Type the person’s exact email address to confirm.');
    const sole = await one<{ name: string }>(pool,
      `select o.name from memberships m join organisations o on o.id = m.org_id where m.user_id = $1 and (select count(*) from memberships x where x.org_id = o.id) = 1 limit 1`, [id]);
    if (sole) throw conflict(`They are the only person in ${sole.name}. Delete the organisation instead.`);
    await stepUp(req, ctx, b.password, b.code);
    await withTx(async (db) => {
      await db.query(`set local siteguard.purge = 'on'`);
      await personTarget(db, ctx, id);
      await db.query(`update audit_events set actor_name = 'Deleted user', actor_id = null where actor_id = $1`, [id]);
      await db.query('delete from users where id = $1', [id]);
      await logPlatformAction(db, ctx, 'Permanently deleted a person', null, u.email, req.ip);
    });
    securityEvent(req, 'account_deleted', { target: 'user' });
    return { ok: true };
  });

  // ---------- review queue: suggestions only, never an automatic action ----------
  app.get('/api/manager/review', rl(30), async (req, reply) => {
    await requireManager(req);
    reply.header('cache-control', 'no-store');
    const [flaggedOrgs, flaggedUsers, unverified, duplicates, abandoned, scheduled] = await Promise.all([
      many(pool, `select o.id, o.name, o.kind, o.flag_kind as "flagKind", o.flag_reason as "flagReason", o.flagged_at as "flaggedAt", o.status from organisations o where ${ANY_ORG} and o.flag_kind is not null order by o.flagged_at desc limit 100`),
      many(pool, `select u.id, u.name, u.email, u.flag_kind as "flagKind", u.flag_reason as "flagReason", u.flagged_at as "flaggedAt", u.status from users u where u.flag_kind is not null order by u.flagged_at desc limit 100`),
      many(pool, `select u.id, u.name, u.email, u.created_at as "createdAt", u.status from users u where not u.is_demo and u.account_class = 'customer' and u.email_verified_at is null and u.flag_kind is null
                   and u.created_at < now() - interval '3 days' order by u.created_at desc limit 100`),
      many(pool, `select lower(trim(o.name)) as key, json_agg(json_build_object('id', o.id, 'name', o.name, 'kind', o.kind, 'createdAt', o.created_at, 'status', o.status) order by o.created_at) as orgs
                    from organisations o where ${ANY_ORG} and not o.is_demo and o.account_class = 'customer' group by 1 having count(*) > 1 limit 50`),
      many(pool, `select o.id, o.name, o.kind, o.created_at as "createdAt", o.status from organisations o
                   where ${ANY_ORG} and not o.is_demo and o.account_class = 'customer' and o.status = 'active' and o.flag_kind is null and o.created_at < now() - interval '30 days'
                     and not exists (select 1 from workplaces w where w.org_id = o.id) and not exists (select 1 from sites s where s.org_id = o.id)
                     and not exists (select 1 from contractors c where c.linked_org_id = o.id)
                     and not exists (select 1 from sessions s join memberships m on m.user_id = s.user_id where m.org_id = o.id and s.last_seen_at > now() - interval '30 days')
                   order by o.created_at limit 100`),
      many(pool, `select d.org_id as "orgId", d.org_name as "name", d.requested_by as "requestedBy", d.scheduled_for as "scheduledFor", d.reason from deletion_requests d where d.status = 'scheduled' order by d.scheduled_for`),
    ]);
    return { flaggedOrgs, flaggedUsers, unverified, duplicates, abandoned, scheduled };
  });
}
