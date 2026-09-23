/**
 * Readiness rules, mirrored from the original client so the server makes the
 * binding decisions (e.g. whether a site may be approved) itself.
 */
import type { Db } from '../db/pool.js';
import { many } from '../db/pool.js';

export type DocStatus = 'missing' | 'complete' | 'expiring' | 'expired' | 'awaiting_review' | 'correction_required';

export function daysUntil(date: string | null | undefined, now = new Date()): number | null {
  if (!date) return null;
  const d = new Date(date + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((d.getTime() - today) / 86400000);
}

export function effectiveStatus(doc: { status: string; expiry_date?: string | null } | null): DocStatus {
  if (!doc || !doc.status) return 'missing';
  if ((doc.status === 'complete' || doc.status === 'expiring') && doc.expiry_date) {
    const days = daysUntil(doc.expiry_date);
    if (days !== null) {
      if (days < 0) return 'expired';
      if (days <= 30) return 'expiring';
      return 'complete';
    }
  }
  return doc.status as DocStatus;
}

export interface Readiness {
  total: number;
  counts: Record<DocStatus, number>;
  percent: number;
  submission: 'no_requirements' | 'changes_required' | 'under_review' | 'ready_to_approve' | 'in_progress';
}

export async function computeReadiness(db: Db, siteId: string): Promise<Readiness> {
  const rows = await many<{ status: string | null; expiry_date: string | null }>(
    db,
    `select d.status, d.expiry_date from requirements r
       left join documents d on d.requirement_id = r.id
      where r.site_id = $1`,
    [siteId],
  );
  const counts: Record<DocStatus, number> = {
    complete: 0, missing: 0, expiring: 0, expired: 0, awaiting_review: 0, correction_required: 0,
  };
  for (const r of rows) counts[effectiveStatus(r.status ? { status: r.status, expiry_date: r.expiry_date } : null)]++;
  const total = rows.length;
  const percent = total ? Math.round((counts.complete / total) * 100) : 0;
  let submission: Readiness['submission'];
  if (!total) submission = 'no_requirements';
  else if (counts.correction_required || counts.expired) submission = 'changes_required';
  else if (counts.awaiting_review) submission = 'under_review';
  else if (counts.missing === 0 && counts.expiring === 0) submission = 'ready_to_approve';
  else submission = 'in_progress';
  return { total, counts, percent, submission };
}

export async function openSevereIncidents(db: Db, siteId: string): Promise<number> {
  const rows = await many<{ n: number }>(
    db,
    `select count(*)::int as n from incidents
      where site_id = $1 and status <> 'closed' and type in ('lost_time', 'fatality')`,
    [siteId],
  );
  return rows[0]?.n ?? 0;
}

export function bumpVersion(v: string | null): string {
  if (!v) return 'v1.0';
  const m = v.match(/v(\d+)\.(\d+)/);
  if (!m) return 'v1.0';
  return `v${m[1]}.${parseInt(m[2], 10) + 1}`;
}

export const LIBRARY_TYPES = [
  { id: 'good-standing', category: 'Company Documents', name: 'Letter of Good Standing (COID)', source: 'legal', why: 'Reusable across every site — most sites require this before work starts.' },
  { id: 'insurance', category: 'Company Documents', name: 'Public liability insurance', source: 'client', why: 'Most sites require at least R5m cover; keep one current copy here.' },
  { id: 'she-policy', category: 'Company Documents', name: 'Health & Safety policy', source: 'legal', why: 'Required under the MHSA for every site you work on.' },
  { id: 'environmental-policy', category: 'Company Documents', name: 'Environmental policy', source: 'best_practice', why: 'Increasingly expected by sites working near environmentally sensitive areas.' },
] as const;

export const INCIDENT_LABELS: Record<string, string> = {
  near_miss: 'Near miss',
  first_aid: 'First aid case',
  medical_treatment: 'Medical treatment case',
  lost_time: 'Lost time injury',
  fatality: 'Fatality',
  property_damage: 'Property damage',
  environmental: 'Environmental incident',
};

export const PERMIT_LABELS: Record<string, string> = {
  hot_work: 'Hot work',
  heights: 'Working at heights',
  confined_space: 'Confined space entry',
  excavation: 'Excavation',
  lifting: 'Lifting operation',
  electrical_isolation: 'Electrical isolation / LOTO',
};
