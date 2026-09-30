/**
 * Gate clearance: may this person enter this site today? A worker is cleared
 * when all of these hold:
 *  - the contractor's safety file for the site is approved (Site Ready);
 *  - the contractor company isn't suspended by the mine;
 *  - the worker is still employed and has a valid certificate of fitness;
 *  - the worker has a site induction on record that hasn't lapsed. Inductions are
 *    recorded by the contractor as certificates (not per mine yet), so the mine's
 *    induction rule — e.g. 12 months from the induction date — is what gives them teeth.
 * Validity uses the mine's own rules where it set them (lib/validity.ts).
 * Every assigned worker gets an unguessable token for the QR on their gate card.
 */
import { randomBytes } from 'node:crypto';
import { many, type Db } from '../db/pool.js';
import { certExpiry, rulesOf, saToday } from './validity.js';

export interface GateRow {
  siteId: string;
  siteName: string;
  workerId: string;
  name: string;
  occupation: string;
  employeeNo: string;
  company: string;
  trade: string;
  cleared: boolean;
  reasons: string[];
  /** The first date the clearance lapses on its own (a medical or induction expiring). */
  until: string | null;
  token: string;
}


/** Gate status for every worker assigned to the given contractor files (sites rows). */
export async function gateRows(db: Db, siteIds: string[]): Promise<GateRow[]> {
  if (!siteIds.length) return [];
  // Tokens are created on first use, so older assignments get one too.
  const missing = await many<{ site_id: string; worker_id: string }>(db, `select site_id, worker_id from site_workers where site_id = any($1) and gate_token is null`, [siteIds]);
  for (const m of missing) {
    await db.query('update site_workers set gate_token = $3 where site_id = $1 and worker_id = $2 and gate_token is null', [m.site_id, m.worker_id, randomBytes(18).toString('base64url')]);
  }
  const rows = await many<any>(
    db,
    `select s.id as site_id, s.name as site_name, s.status as site_status, c.name as company, c.trade, c.suspended_at, c.suspended_reason,
            o.settings as host_settings, w.id as worker_id, w.full_name, w.occupation, w.employee_no, w.active, sw.gate_token,
            coalesce((select json_agg(json_build_object('kind', wc.kind, 'issued_on', wc.issued_on, 'expires_on', wc.expires_on))
                        from worker_certificates wc where wc.worker_id = w.id and wc.kind in ('medical_fitness', 'induction')), '[]')::jsonb
            -- A signed induction session held for this file counts as an induction on the day it was held.
            || coalesce((select json_agg(json_build_object('kind', 'induction', 'issued_on', t.held_on, 'expires_on', null))
                        from toolbox_attendance a join toolbox_talks t on t.id = a.talk_id
                       where a.worker_id = w.id and t.site_id = s.id and t.kind = 'induction'), '[]')::jsonb as certs
       from site_workers sw join sites s on s.id = sw.site_id join contractors c on c.id = s.contractor_id
       join organisations o on o.id = s.org_id join workers w on w.id = sw.worker_id
      where sw.site_id = any($1) and s.status <> 'declined'
      order by c.name, w.full_name`,
    [siteIds],
  );
  const now = saToday();
  return rows.map((r) => {
    const rules = rulesOf(r.host_settings);
    const reasons: string[] = [];
    if (r.suspended_at) reasons.push(`Company suspended by the site${r.suspended_reason ? `: ${r.suspended_reason}` : ''}`);
    if (r.site_status !== 'site_ready') reasons.push('The contractor\'s safety file for this site isn\'t approved yet');
    if (!r.active) reasons.push('No longer working for the contractor');
    const best = (kind: string) => {
      let until: string | null | undefined, missingIssue = false, any = false;
      for (const c of r.certs as { kind: string; issued_on: string | null; expires_on: string | null }[]) {
        if (c.kind !== kind) continue;
        any = true;
        const e = certExpiry(rules, c);
        if (e.missingIssue) { missingIssue = true; continue; }
        if (e.until === null) { until = null; break; } // valid with no end date
        if (until === undefined || (until !== null && e.until > until)) until = e.until;
      }
      return { any, until, missingIssue };
    };
    const med = best('medical_fitness');
    if (!med.any) reasons.push('No certificate of fitness (medical)');
    else if (med.until === undefined) reasons.push(med.missingIssue ? 'Medical has no issue date, which this site needs' : 'No valid medical');
    else if (med.until !== null && med.until < now) reasons.push(`Medical expired on ${med.until}`);
    const ind = best('induction');
    if (!ind.any) reasons.push('No site induction on record');
    else if (ind.until === undefined) reasons.push(ind.missingIssue ? 'Induction has no issue date, which this site needs' : 'No valid induction');
    else if (ind.until !== null && ind.until < now) reasons.push(`Induction expired on ${ind.until}`);
    const dates = [med.until, ind.until].filter((d): d is string => typeof d === 'string');
    return {
      siteId: r.site_id, siteName: r.site_name, workerId: r.worker_id, name: r.full_name, occupation: r.occupation, employeeNo: r.employee_no,
      company: r.company, trade: r.trade, cleared: reasons.length === 0, reasons,
      until: dates.length ? dates.sort()[0] : null, token: r.gate_token,
    };
  });
}
