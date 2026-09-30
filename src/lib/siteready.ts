/**
 * Site Ready is a live status, not a one-off stamp. When a Site Ready file stops
 * meeting its requirements — a document sent back, withdrawn or expired, a new
 * requirement added, or a lost-time injury or fatality reported — the site goes
 * back to "in progress", with an audit entry and both sides notified. The
 * public verification page and exports read the site's status, so they stop
 * saying "Site Ready" at the same moment.
 */
import { many, one, type Db } from '../db/pool.js';
import { computeReadiness, openSevereIncidents } from './readiness.js';
import { notifyOrg, REVIEWERS } from './notify.js';
import { publishChange } from './realtime.js';

/** Why a Site Ready file no longer qualifies, or null if it still does. Expiring and re-submitted documents still count until they lapse. */
async function lapseReason(db: Db, siteId: string): Promise<string | null> {
  const r = await computeReadiness(db, siteId);
  const parts: string[] = [];
  if (r.counts.expired) parts.push(`${r.counts.expired} document${r.counts.expired === 1 ? '' : 's'} expired`);
  if (r.counts.correction_required) parts.push(`${r.counts.correction_required} sent back for correction`);
  if (r.counts.missing) parts.push(`${r.counts.missing} requirement${r.counts.missing === 1 ? '' : 's'} not met`);
  if (await openSevereIncidents(db, siteId)) parts.push('an open lost-time injury or fatality');
  const sus = await one<{ suspended_reason: string }>(db, 'select c.suspended_reason from sites s join contractors c on c.id = s.contractor_id where s.id = $1 and c.suspended_at is not null', [siteId]);
  if (sus) parts.push(`the contractor is suspended${sus.suspended_reason ? ` (${sus.suspended_reason})` : ''}`);
  return parts.length ? parts.join(', ') : null;
}

/** Re-checks one site; if its Site Ready approval no longer holds, withdraws it. Returns true when it lapsed. */
export async function recheckSiteReady(db: Db, siteId: string, trigger: string): Promise<boolean> {
  const s = await one<{ id: string; name: string; org_id: string; status: string; linked_org_id: string | null }>(
    db,
    `select s.id, s.name, s.org_id, s.status, c.linked_org_id from sites s join contractors c on c.id = s.contractor_id where s.id = $1 for update of s`,
    [siteId],
  );
  if (!s || s.status !== 'site_ready') return false;
  const why = await lapseReason(db, siteId);
  if (!why) return false;
  await db.query(`update sites set status = 'in_progress' where id = $1`, [siteId]);
  await db.query(
    `insert into audit_events (org_id, site_id, actor_id, actor_name, actor_role, action, detail) values ($1, $2, null, 'SiteGuard', 'system', $3, $4)`,
    [s.org_id, siteId, 'Site Ready withdrawn', `${s.name}: ${why} (${trigger})`.slice(0, 500)],
  );
  const note = { kind: 'correction', title: `Site Ready withdrawn: ${s.name}`, body: `${why}. The site must be approved again once everything is back in order.`, link: { kind: 'site' as const, siteId } };
  await notifyOrg(db, s.org_id, [...REVIEWERS], note);
  if (s.linked_org_id) await notifyOrg(db, s.linked_org_id, null, note);
  await publishChange(db, [s.org_id, ...(s.linked_org_id ? [s.linked_org_id] : [])]);
  return true;
}

/** For the background job: re-checks every Site Ready site (catches documents that expired overnight). */
export async function recheckAllSiteReady(db: Db): Promise<number> {
  let n = 0;
  for (const { id } of await many<{ id: string }>(db, `select id from sites where status = 'site_ready'`)) {
    if (await recheckSiteReady(db, id, 'daily check')) n++;
  }
  return n;
}
