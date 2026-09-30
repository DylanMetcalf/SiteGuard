/**
 * Mine-set validity rules: how long a mine accepts certain documents, counted
 * from their issue (medicals, inductions) or from submission (letters and
 * certificates). They make expiry a rule of the site rather than whatever date
 * a contractor types. Stored on the mine's organisation settings.
 */
import { one, type Db } from '../db/pool.js';

export interface ValidityRules {
  /** Certificates of fitness: valid this many months from their issue date. */
  medical?: number;
  /** Site inductions: valid this many months from their issue date. */
  induction?: number;
  /** Letter of Good Standing (COID): accepted for at most this many months from submission. */
  goodStanding?: number;
  /** Public liability insurance: accepted for at most this many months from submission. */
  insurance?: number;
}

export const RULE_KEYS = ['medical', 'induction', 'goodStanding', 'insurance'] as const;

export function rulesOf(settings: unknown): ValidityRules {
  const s = (settings ?? {}) as Record<string, unknown>;
  const r = (s.validityRules ?? {}) as Record<string, unknown>;
  const out: ValidityRules = {};
  for (const k of RULE_KEYS) {
    const v = Number(r[k]);
    if (Number.isInteger(v) && v >= 1 && v <= 60) out[k] = v;
  }
  return out;
}

export async function rulesForOrg(db: Db, orgId: string): Promise<ValidityRules> {
  const o = await one<{ settings: unknown }>(db, 'select settings from organisations where id = $1', [orgId]);
  return rulesOf(o?.settings);
}

const addMonths = (iso: string, m: number) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + m);
  return d.toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);

/** The rule (months, counted from submission) that applies to a requirement's name, if any. */
export function submissionCap(rules: ValidityRules, requirementName: string): { months: number; label: string } | null {
  if (rules.goodStanding && /good\s*standing|\bcoid\b/i.test(requirementName)) return { months: rules.goodStanding, label: 'Letter of Good Standing' };
  if (rules.insurance && /liability\s+insurance|public\s+liability/i.test(requirementName)) return { months: rules.insurance, label: 'public liability insurance' };
  if (rules.medical && /medical|fitness/i.test(requirementName)) return { months: rules.medical, label: 'medical certificates' };
  return null;
}

/** Caps an expiry date at "today + months" when a rule applies. */
export function capExpiry(expiry: string | null, months: number): string {
  const cap = addMonths(today(), months);
  return !expiry || expiry > cap ? cap : expiry;
}

/** Effective expiry of a worker certificate at a mine: the earlier of its own date and issue + the mine's months. */
export function certExpiry(rules: ValidityRules, c: { kind: string; issued_on: string | null; expires_on: string | null }): { until: string | null; missingIssue: boolean } {
  const months = c.kind === 'medical_fitness' ? rules.medical : c.kind === 'induction' ? rules.induction : undefined;
  if (!months) return { until: c.expires_on, missingIssue: false };
  if (!c.issued_on) return { until: c.expires_on, missingIssue: true };
  const byRule = addMonths(c.issued_on, months);
  return { until: !c.expires_on || c.expires_on > byRule ? byRule : c.expires_on, missingIssue: false };
}
