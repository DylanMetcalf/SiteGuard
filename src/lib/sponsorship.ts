/**
 * Site-sponsored contractor access.
 *
 * A mine or site that subscribes to COMVERA sponsors each contractor's file on
 * its own sites: the contractor can complete that site's requirements, documents
 * and safety file without paying. The sponsorship covers that one file only. Any
 * other safety file (another client's site, the contractor's own projects) needs
 * the contractor's own plan, trial or promo grant.
 *
 * A sponsorship is in force while it has not been ended, its dates allow it, and
 * the sponsoring organisation itself is in good standing.
 */
import type { Db } from '../db/pool.js';
import { many, one } from '../db/pool.js';
import { features } from '../config.js';
import { standing, type OrgBilling } from './plans.js';

interface SponsorRow extends OrgBilling {
  ends_at: Date | null;
  ended_at: Date | null;
  starts_at: Date;
  sponsor_kind: string;
}

const SPONSOR_SQL = `select sp.id, sp.site_id, sp.starts_at, sp.ends_at, sp.ended_at, sp.sponsor_org_id, o.name as sponsor_name,
                            o.kind as sponsor_kind, o.plan, o.subscription_status, o.trial_ends_at, o.grant_plan, o.grant_until
                       from sponsorships sp
                       join organisations o on o.id = sp.sponsor_org_id
                       join sites s on s.id = sp.site_id`;

function inForce(r: SponsorRow): boolean {
  const now = Date.now();
  if (r.ended_at || new Date(r.starts_at).getTime() > now) return false;
  if (r.ends_at && new Date(r.ends_at).getTime() <= now) return false;
  // The sponsor's own standing, judged as the host it is (never as a sponsored contractor).
  return standing({ ...r, kind: r.sponsor_kind, sponsored: false }) !== 'lapsed';
}

/** Whether any site currently sponsors this contractor (lets it keep working on those files). */
export async function hasActiveSponsorship(db: Db, contractorOrgId: string): Promise<boolean> {
  if (!features.billing) return false;
  const rows = await many<SponsorRow>(
    db,
    `${SPONSOR_SQL} where sp.contractor_org_id = $1 and s.status not in ('declined', 'invited')`,
    [contractorOrgId],
  );
  return rows.some(inForce);
}

/** The sponsorship of one contractor file, and whether it is in force. */
export async function siteSponsorship(db: Db, siteId: string) {
  const r = await one<SponsorRow & { id: string; sponsor_name: string; sponsor_org_id: string }>(db, `${SPONSOR_SQL} where sp.site_id = $1`, [siteId]);
  if (!r) return null;
  return { id: r.id, sponsorOrgId: r.sponsor_org_id, sponsorName: r.sponsor_name, endsAt: r.ends_at, endedAt: r.ended_at, active: inForce(r) };
}

/** Site ids among the given ones that are sponsored right now. */
export async function sponsoredSiteIds(db: Db, siteIds: string[]): Promise<Set<string>> {
  if (!siteIds.length) return new Set();
  const rows = await many<SponsorRow & { site_id: string }>(db, `${SPONSOR_SQL} where sp.site_id = any($1::uuid[])`, [siteIds]);
  return new Set(rows.filter(inForce).map((r) => r.site_id));
}

/** Called when a contractor joins a mine's site (by code or invitation). Re-opens an ended one. */
export async function sponsorFile(db: Db, siteId: string): Promise<void> {
  await db.query(
    `insert into sponsorships (sponsor_org_id, contractor_org_id, site_id)
     select s.org_id, c.linked_org_id, s.id
       from sites s join contractors c on c.id = s.contractor_id join organisations o on o.id = s.org_id
      where s.id = $1 and c.linked_org_id is not null and o.managed_by_org is null
     on conflict (site_id) do update set ended_at = null, ended_reason = null, contractor_org_id = excluded.contractor_org_id`,
    [siteId],
  );
}
