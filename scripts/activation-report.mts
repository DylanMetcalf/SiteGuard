/**
 * Activation and time-to-value, from the privacy-safe milestone events (lib/events.ts: an organisation and the name of a
 * milestone, nothing else). Run it against any database, read-only:
 *   DATABASE_URL=postgres://… npx tsx scripts/activation-report.mts [days]      (default 30)
 * It prints, for organisations that signed up in the period, how many reached each step and how long it took
 * (median hours from sign-up). A step with few organisations is shown as "too few to judge".
 */
import { createRequire } from 'node:module';
const req = createRequire(new URL('../package.json', import.meta.url).pathname);
const pg = req('pg');

const days = Math.max(1, Number(process.argv[2] || 30));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();

const STEPS: [string, string][] = [
  ['signup', 'Signed up'],
  ['onboarding_completed', 'Finished guided set-up'],
  ['site_created', 'Created a site'],
  ['site_joined', 'Joined a site with a code'],
  ['client_company_added', 'Added a client company (consultants)'],
  ['document_requested', 'Asked for a document'],
  ['document_upload', 'Uploaded a document'],
  ['review_completed', 'Completed a review'],
  ['approval_completed', 'Approved a document'],
  ['first_safety_file', 'Built a safety file'],
  ['safety_file_export', 'Exported a safety file'],
  ['oscar_opened', 'Opened Oscar'],
  ['subscription_started', 'Started paying'],
  ['subscription_cancelled', 'Cancelled'],
];

const cohort = (await db.query(
  `select e.org_id, min(e.created_at) as signed_up from product_events e join organisations o on o.id = e.org_id
    where e.event = 'signup' and e.created_at > now() - ($1 * interval '1 day') and not o.is_demo and o.account_class is distinct from 'test'
    group by e.org_id`, [days])).rows;
console.log(`\nActivation report: organisations that signed up in the last ${days} days (demo and test accounts excluded)`);
console.log(`Cohort size: ${cohort.length}\n`);
if (!cohort.length) { console.log('Nobody yet. Run it again after the first sign-ups.'); await db.end(); process.exit(0); }
const ids = cohort.map((c: any) => c.org_id);
const events = (await db.query(`select org_id, event, min(created_at) as first_at from product_events where org_id = any($1::uuid[]) group by org_id, event`, [ids])).rows;
const first = new Map<string, Map<string, Date>>();
for (const e of events) { if (!first.has(e.event)) first.set(e.event, new Map()); first.get(e.event)!.set(e.org_id, new Date(e.first_at)); }
const signed = new Map(cohort.map((c: any) => [c.org_id, new Date(c.signed_up)]));
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const fmt = (h: number | null) => h === null ? '' : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`;
console.log('Step'.padEnd(40) + 'Orgs'.padStart(6) + '   % of cohort   Median time from sign-up');
for (const [ev, label] of STEPS) {
  const m = first.get(ev) ?? new Map();
  const reached = ids.filter((id: string) => m.has(id));
  const hours = reached.map((id: string) => (m.get(id)!.getTime() - signed.get(id)!.getTime()) / 3600_000).filter((h: number) => h >= 0);
  const pct = Math.round(100 * reached.length / ids.length);
  console.log(label.padEnd(40) + String(reached.length).padStart(6) + `   ${String(pct).padStart(4)}%        ` + (reached.length < 5 && ev !== 'signup' ? (reached.length ? 'too few to judge' : '') : fmt(median(hours))));
}
const act = ids.filter((id: string) => first.get('document_upload')?.has(id) || first.get('first_safety_file')?.has(id) || first.get('approval_completed')?.has(id));
console.log(`\nActivated (uploaded a document, built a file or approved one): ${act.length} of ${ids.length} (${Math.round(100 * act.length / ids.length)}%)`);
const stuck = ids.filter((id: string) => !first.get('onboarding_completed')?.has(id)).length;
console.log(`Did not finish guided set-up: ${stuck} of ${ids.length}${stuck ? '  (the clearest place people give up; watch this number first)' : ''}`);
await db.end();
