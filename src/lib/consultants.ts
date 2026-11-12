/**
 * Safety consultants and their client companies.
 *
 * A consultant is a contractor-type organisation on a consultant plan (lib/plans.ts, `clientLimit`). Each client
 * company is its own organisation, linked by `billing_parent_id`. Cover is computed live on every request, never
 * stored: a client is covered while its consultant has access, is in good standing, and the client is among the
 * oldest `clientLimit` live clients. Past the limit, or after the plan lapses, a client falls back to whatever it
 * has on its own (usually nothing: read-only) and nothing is deleted.
 *
 * Anti-abuse rules (the plan's client limit is the product, so it must not be dodged):
 *  - a client is a legal company, identified by its registration number (12 digits once punctuation is removed);
 *  - the registration number is unique among clients and cannot be edited after creation;
 *  - it cannot belong to an existing independent company on COMVERA, nor to the consultant's own company;
 *  - a slot is freed only by archiving, and a client can be archived only if it was never used (a mistake made in
 *    the first day) or has been quiet for 90 days.
 */
import type { Db } from '../db/pool.js';
import { one } from '../db/pool.js';
import type { OrgRow } from './authz.js';
import { grantActive, hasOwnAccess, planOf, standing, type OrgBilling } from './plans.js';

export const COVER_PLAN = 'contractor_pro';
/** A consultant on the free trial can add this many clients (Solo's limit), so a free trial cannot be used to reserve many companies. */
export const TRIAL_CLIENT_LIMIT = 5;

/** How many client companies this consultant can have right now: the plan's limit, or the smaller trial limit while trialing. */
export function clientLimitFor(org: OrgBilling): number {
  const limit = planOf(org).clientLimit ?? 0;
  return org.subscription_status === 'trialing' && !grantActive(org) ? Math.min(limit, TRIAL_CLIENT_LIMIT) : limit;
}
export const QUIET_DAYS = 90;
export const MISTAKE_WINDOW_HOURS = 24;

/** The company registration number without punctuation or case, or null if it is not a 12-digit CIPC-style number. */
export function registrationKey(raw: string): string | null {
  const k = raw.replace(/[^0-9A-Za-z]/g, '').toLowerCase();
  return /^\d{12}$/.test(k) ? k : null;
}

/** Normalises any stored registration number the same way, for comparing with existing companies. */
export const looseKey = (raw: string | null | undefined) => (raw ?? '').replace(/[^0-9A-Za-z]/g, '').toLowerCase();

/**
 * Gives a client company the cover of its consultant's plan for this request (in memory only, never written).
 * Does nothing for ordinary organisations.
 */
export async function applyConsultantCover(db: Db, org: OrgRow): Promise<void> {
  if (!org.billing_parent_id || org.client_archived_at) return;
  const parent = await one<OrgRow & { status?: string }>(db, 'select * from organisations where id = $1 and is_consultant', [org.billing_parent_id]);
  if (!parent) return;
  org.billing_parent_name = parent.name;
  if (parent.status && parent.status !== 'active') return;
  const bill = parent as unknown as OrgBilling;
  if (!hasOwnAccess({ ...bill, kind: 'contractor' }) || standing({ ...bill, kind: 'contractor' }) === 'lapsed') return;
  const limit = planOf(bill).clientLimit ?? 0;
  const rank = (await one<{ n: number }>(
    db,
    `select count(*)::int as n from organisations
      where billing_parent_id = $1 and client_archived_at is null and (created_at, id) < ($2, $3)`,
    [org.billing_parent_id, org.created_at, org.id],
  ))?.n ?? 0;
  if (rank >= limit) return;
  // Cover is the full contractor product, whatever the client had on its own.
  if (!grantActive(org as OrgBilling)) {
    org.grant_plan = COVER_PLAN;
    org.grant_until = null;
    org.grant_source = 'Covered by your consultant';
  }
}

/** Withdraws a person's access to every client company their consultant opened for them (they left, or lost admin rights). */
export async function dropClientAccess(db: Db, consultantOrgId: string, userId: string): Promise<void> {
  const r = await db.query(
    `delete from memberships m using organisations o
      where m.org_id = o.id and o.billing_parent_id = $1 and m.user_id = $2 and m.via_consultant
      returning m.org_id`,
    [consultantOrgId, userId],
  );
  if (r.rowCount) await db.query('update sessions set org_id = null where user_id = $2 and org_id = any($1::uuid[])', [r.rows.map((x: { org_id: string }) => x.org_id), userId]);
}

/** Whether a client can be archived now (and why not), judged on the server, never trusted from the browser. `mistake` means it was never used. */
export async function archiveCheck(db: Db, clientId: string): Promise<{ ok: boolean; mistake?: boolean; reason?: string }> {
  const r = await one<{ age_h: number; used: boolean; quiet_days: number | null; archived: boolean }>(
    db,
    `select extract(epoch from (now() - o.created_at)) / 3600 as age_h,
            (exists (select 1 from files f where f.org_id = o.id)
              or exists (select 1 from audit_events a where a.org_id = o.id)
              or exists (select 1 from contractors c where c.linked_org_id = o.id)
              or exists (select 1 from workers w where w.org_id = o.id)
              or exists (select 1 from org_documents d where d.org_id = o.id)) as used,
            extract(day from (now() - greatest(
              (select max(created_at) from files where org_id = o.id),
              (select max(created_at) from audit_events where org_id = o.id),
              o.created_at)))::int as quiet_days,
            (o.client_archived_at is not null) as archived
       from organisations o where o.id = $1`,
    [clientId],
  );
  if (!r) return { ok: false, reason: 'Not found.' };
  if (r.archived) return { ok: false, reason: 'Already archived.' };
  if (!r.used && Number(r.age_h) <= MISTAKE_WINDOW_HOURS) return { ok: true, mistake: true };
  if ((r.quiet_days ?? 0) >= QUIET_DAYS) return { ok: true };
  return { ok: false, reason: `A client that has been used can be archived after ${QUIET_DAYS} days with no activity. This keeps the plan's client limit fair for everyone.` };
}
