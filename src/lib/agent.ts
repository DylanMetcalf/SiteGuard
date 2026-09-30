/**
 * The compliance agent. On a schedule it reviews every organisation's sites the
 * way a diligent SHE coordinator would, and keeps a prioritised list of what
 * needs attention: stale invitations, reviews waiting, expired or expiring
 * documents, sites ready to approve, overdue requests, serious incidents,
 * permits left open, and worker certificates that have lapsed.
 *
 * Findings are rule-based and deterministic, so they work without an AI key.
 * Each run upserts what it sees and resolves what it no longer sees.
 */
import type { Db } from '../db/pool.js';
import { many, pool, withTx } from '../db/pool.js';
import { computeReadiness } from './readiness.js';
import { publishChange } from './realtime.js';
import { appUrl, queueToOrg } from './email.js';
import { currentContents, diffContents, type FileLine } from './bundle.js';

export type Severity = 'high' | 'medium' | 'low';
export interface FindingAction {
  kind: 'site' | 'workforce' | 'safety' | 'library' | 'studio';
  siteId?: string;
  tab?: string;
}
export interface Finding {
  key: string;
  siteId: string | null;
  severity: Severity;
  title: string;
  detail: string;
  action: FindingAction;
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

async function hostFindings(db: Db, orgId: string): Promise<Finding[]> {
  const out: Finding[] = [];
  const sites = await many<{ id: string; name: string; status: string; contractor: string; age_days: number }>(
    db,
    `select s.id, s.name, s.status, c.name as contractor, (current_date - s.created_at::date) as age_days
       from sites s join contractors c on c.id = s.contractor_id
      where s.org_id = $1 and s.status <> 'declined'`,
    [orgId],
  );
  for (const s of sites) {
    const site = (tab = 'compliance'): FindingAction => ({ kind: 'site', siteId: s.id, tab });
    if (s.status === 'invited' && s.age_days >= 7) {
      out.push({ key: `invite-stale:${s.id}`, siteId: s.id, severity: 'medium', title: `${s.contractor} hasn't accepted ${s.name}`, detail: `Invited ${s.age_days} days ago. Resend the invitation or call them.`, action: site() });
    }
    const rd = await computeReadiness(db, s.id);
    if (rd.total === 0) {
      out.push({ key: `no-reqs:${s.id}`, siteId: s.id, severity: 'medium', title: `${s.name} has no required documents`, detail: 'Add a starter pack so the contractor knows what to submit.', action: site() });
    } else if (s.status === 'in_progress' && rd.submission === 'ready_to_approve') {
      out.push({ key: `ready:${s.id}`, siteId: s.id, severity: 'medium', title: `${s.name} is ready for Site Ready approval`, detail: `All ${plural(rd.total, 'document')} are complete.`, action: site() });
    }
    if (rd.counts.expired && s.status !== 'invited') {
      out.push({ key: `expired:${s.id}`, siteId: s.id, severity: 'high', title: `${plural(rd.counts.expired, 'document')} expired on ${s.name}`, detail: `${s.contractor} needs to upload current versions.`, action: site() });
    }
  }

  const waiting = await many<{ site_id: string; name: string; n: number; oldest: number }>(
    db,
    `select s.id as site_id, s.name, count(*)::int as n, max(current_date - d.updated_at::date)::int as oldest
       from documents d join requirements r on r.id = d.requirement_id join sites s on s.id = r.site_id
      where s.org_id = $1 and d.status = 'awaiting_review' and d.updated_at < now() - interval '2 days'
      group by s.id, s.name`,
    [orgId],
  );
  // Monthly audits (Construction Regulations 2014 expect the client to audit at least every 30 days).
  const auditDue = await many<{ id: string; name: string; contractor: string; last: string | null; days: number }>(
    db,
    `select s.id, s.name, c.name as contractor, to_char(max(a.audited_on), 'YYYY-MM-DD') as last,
            (current_date - coalesce(max(a.audited_on), greatest(s.created_at::date, (select applied_at::date from schema_migrations where name = '011_gate_audits_suspension.sql'))))::int as days
       from sites s join contractors c on c.id = s.contractor_id left join contractor_audits a on a.site_id = s.id
      where s.org_id = $1 and s.status in ('in_progress', 'site_ready')
      -- Counted from when audits arrived in SiteGuard, so existing sites aren't all flagged on day one.
      group by s.id, s.name, c.name
     having (current_date - coalesce(max(a.audited_on), greatest(s.created_at::date, (select applied_at::date from schema_migrations where name = '011_gate_audits_suspension.sql')))) >= 30`,
    [orgId],
  );
  for (const a of auditDue) {
    out.push({ key: `audit-due:${a.id}`, siteId: a.id, severity: a.days >= 45 ? 'high' : 'medium', title: `${a.contractor} is due a site audit on ${a.name}`, detail: a.last ? `Last audited ${a.last} (${a.days} days ago). Audit contractors at least every 30 days.` : `Not audited yet, ${a.days} days after starting. Audit contractors at least every 30 days.`, action: { kind: 'site', siteId: a.id, tab: 'activity' } });
  }
  const overdueFindings = await many<{ site_id: string; name: string; contractor: string; n: number }>(
    db,
    `select s.id as site_id, s.name, c.name as contractor, count(*)::int as n
       from audit_findings f join sites s on s.id = f.site_id join contractors c on c.id = s.contractor_id
      where s.org_id = $1 and f.status <> 'closed' and f.due_on < current_date group by s.id, s.name, c.name`,
    [orgId],
  );
  for (const f of overdueFindings) {
    out.push({ key: `finding-overdue:${f.site_id}`, siteId: f.site_id, severity: 'high', title: `${plural(f.n, 'audit finding')} overdue for ${f.contractor}`, detail: `${f.name}: past the date it was due to be fixed.`, action: { kind: 'site', siteId: f.site_id, tab: 'activity' } });
  }

  for (const w of waiting) {
    out.push({ key: `review:${w.site_id}`, siteId: w.site_id, severity: w.oldest >= 5 ? 'high' : 'medium', title: `${plural(w.n, 'document')} waiting for your review on ${w.name}`, detail: `The oldest has waited ${w.oldest} days. Contractors can't start until they're reviewed.`, action: { kind: 'site', siteId: w.site_id, tab: 'compliance' } });
  }

  const expiring = await many<{ site_id: string; name: string; n: number; soonest: number }>(
    db,
    `select s.id as site_id, s.name, count(*)::int as n, min(d.expiry_date - current_date)::int as soonest
       from documents d join requirements r on r.id = d.requirement_id join sites s on s.id = r.site_id
      where s.org_id = $1 and s.status in ('in_progress', 'site_ready') and d.status in ('complete', 'expiring')
        and d.expiry_date between current_date and current_date + 14
      group by s.id, s.name`,
    [orgId],
  );
  for (const e of expiring) {
    out.push({ key: `expiring:${e.site_id}`, siteId: e.site_id, severity: 'low', title: `${plural(e.n, 'document')} on ${e.name} expire within 2 weeks`, detail: `The first expires in ${plural(e.soonest, 'day')}.`, action: { kind: 'site', siteId: e.site_id, tab: 'compliance' } });
  }

  out.push(...(await sharedSafetyFindings(db, `s.org_id = $1`, orgId)));

  const overdue = await many<{ site_id: string; name: string; n: number }>(
    db,
    `select s.id as site_id, s.name, count(*)::int as n from info_requests q join sites s on s.id = q.site_id
      where s.org_id = $1 and q.status in ('requested', 'viewed') and q.due_date < current_date
      group by s.id, s.name`,
    [orgId],
  );
  for (const o of overdue) {
    out.push({ key: `requests-overdue:${o.site_id}`, siteId: o.site_id, severity: 'medium', title: `${plural(o.n, 'request')} overdue on ${o.name}`, detail: 'The contractor has not responded by the due date.', action: { kind: 'site', siteId: o.site_id, tab: 'requests' } });
  }

  const certs = await many<{ site_id: string; name: string; n: number }>(
    db,
    `select s.id as site_id, s.name, count(distinct w.id)::int as n
       from sites s join site_workers sw on sw.site_id = s.id join workers w on w.id = sw.worker_id and w.active
       join worker_certificates wc on wc.worker_id = w.id
      where s.org_id = $1 and s.status in ('in_progress', 'site_ready') and wc.kind = 'medical_fitness' and wc.expires_on < current_date
        and not exists (select 1 from worker_certificates n where n.worker_id = w.id and n.kind = 'medical_fitness' and (n.expires_on is null or n.expires_on >= current_date))
      group by s.id, s.name`,
    [orgId],
  );
  for (const c of certs) {
    out.push({ key: `worker-medical:${c.site_id}`, siteId: c.site_id, severity: 'high', title: `${plural(c.n, 'worker')} on ${c.name} with an expired medical`, detail: 'They should not be on site until a current certificate of fitness is uploaded.', action: { kind: 'workforce' } });
  }
  return out;
}

/** Incidents, permits and defects apply to both sides of a site. */
async function sharedSafetyFindings(db: Db, siteFilter: string, orgId: string): Promise<Finding[]> {
  const out: Finding[] = [];
  const incidents = await many<{ site_id: string; name: string; serious: number; stale: number }>(
    db,
    `select s.id as site_id, s.name,
            count(*) filter (where i.type in ('lost_time', 'fatality'))::int as serious,
            count(*) filter (where i.occurred_on < current_date - 14)::int as stale
       from incidents i join sites s on s.id = i.site_id join contractors c on c.id = s.contractor_id
      where ${siteFilter} and i.status <> 'closed'
      group by s.id, s.name`,
    [orgId],
  );
  for (const i of incidents) {
    if (i.serious) out.push({ key: `incident-serious:${i.site_id}`, siteId: i.site_id, severity: 'high', title: `Serious incident still open on ${i.name}`, detail: 'A lost-time injury or fatality is open. The site cannot be approved until it is investigated and closed.', action: { kind: 'site', siteId: i.site_id, tab: 'safety' } });
    else if (i.stale) out.push({ key: `incident-stale:${i.site_id}`, siteId: i.site_id, severity: 'medium', title: `${plural(i.stale, 'incident')} open for over 2 weeks on ${i.name}`, detail: 'Record the root cause and corrective actions, then close it out.', action: { kind: 'site', siteId: i.site_id, tab: 'safety' } });
  }
  const permits = await many<{ site_id: string; name: string; n: number }>(
    db,
    `select s.id as site_id, s.name, count(*)::int as n
       from permits p join sites s on s.id = p.site_id join contractors c on c.id = s.contractor_id
      where ${siteFilter} and p.status = 'active' and p.valid_to < now()
      group by s.id, s.name`,
    [orgId],
  );
  for (const p of permits) {
    out.push({ key: `permit-overrun:${p.site_id}`, siteId: p.site_id, severity: 'high', title: `${plural(p.n, 'permit')} past expiry but not closed on ${p.name}`, detail: 'Confirm the work stopped and close the permit, or issue a new one.', action: { kind: 'site', siteId: p.site_id, tab: 'safety' } });
  }
  const defects = await many<{ site_id: string; name: string; n: number }>(
    db,
    `select s.id as site_id, s.name, count(*)::int as n
       from defects d join inspections x on x.id = d.inspection_id join sites s on s.id = x.site_id join contractors c on c.id = s.contractor_id
      where ${siteFilter} and d.severity = 'high' and d.status in ('open', 'assigned') and d.due_date < current_date
      group by s.id, s.name`,
    [orgId],
  );
  for (const d of defects) {
    out.push({ key: `defects-overdue:${d.site_id}`, siteId: d.site_id, severity: 'high', title: `${plural(d.n, 'high-severity defect')} overdue on ${d.name}`, detail: 'Past their due date and not yet resolved.', action: { kind: 'site', siteId: d.site_id, tab: 'safety' } });
  }
  return out;
}

async function contractorFindings(db: Db, orgId: string): Promise<Finding[]> {
  const out: Finding[] = [];
  const invited = await many<{ id: string; name: string; host: string }>(
    db,
    `select s.id, s.name, o.name as host from sites s join contractors c on c.id = s.contractor_id join organisations o on o.id = s.org_id
      where c.linked_org_id = $1 and s.status = 'invited'`,
    [orgId],
  );
  const suspended = await many<{ host: string; reason: string; site_id: string | null }>(
    db,
    `select o.name as host, c.suspended_reason as reason, (select s.id from sites s where s.contractor_id = c.id and s.status <> 'declined' order by s.created_at limit 1) as site_id
       from contractors c join organisations o on o.id = c.org_id where c.linked_org_id = $1 and c.suspended_at is not null`,
    [orgId],
  );
  for (const s of suspended) {
    if (!s.site_id) continue;
    out.push({ key: `suspended:${s.site_id}`, siteId: s.site_id, severity: 'high', title: `Suspended by ${s.host}`, detail: `${s.reason || 'No reason given'}. Your people won't be cleared at their gates until it's lifted.`, action: { kind: 'site', siteId: s.site_id } });
  }
  const openFindings = await many<{ site_id: string; name: string; n: number; overdue: number }>(
    db,
    `select s.id as site_id, s.name, count(*)::int as n, count(*) filter (where f.due_on < current_date)::int as overdue
       from audit_findings f join sites s on s.id = f.site_id join contractors c on c.id = s.contractor_id
      where c.linked_org_id = $1 and f.status = 'open' and s.status <> 'declined' group by s.id, s.name`,
    [orgId],
  );
  for (const f of openFindings) {
    out.push({ key: `findings:${f.site_id}`, siteId: f.site_id, severity: f.overdue ? 'high' : 'medium', title: `${plural(f.n, 'audit finding')} to fix on ${f.name}`, detail: f.overdue ? `${f.overdue} past the due date. Respond once each is fixed.` : 'Fix each one, then tell the site what was done.', action: { kind: 'site', siteId: f.site_id, tab: 'activity' } });
  }
  const compiled = await many<{ site_id: string; name: string; number: number; contents: FileLine[] }>(
    db,
    `select distinct on (v.site_id) v.site_id, s.name, v.number, v.contents
       from safety_file_versions v join sites s on s.id = v.site_id join contractors c on c.id = s.contractor_id
      where c.linked_org_id = $1 and s.status <> 'declined' order by v.site_id, v.number desc`,
    [orgId],
  );
  for (const v of compiled) {
    const changes = diffContents(v.contents, await currentContents(db, v.site_id));
    if (!changes.length) continue;
    out.push({ key: `rebuild:${v.site_id}`, siteId: v.site_id, severity: 'low', title: `Safety file for ${v.name} has changed since Rev ${v.number}`, detail: `${plural(changes.length, 'change')}, e.g. ${changes[0].name}. Download it again to issue Rev ${v.number + 1}.`, action: { kind: 'site', siteId: v.site_id } });
  }
  for (const s of invited) {
    out.push({ key: `invited:${s.id}`, siteId: s.id, severity: 'medium', title: `${s.host} invited you to ${s.name}`, detail: 'Accept the invitation to see what the site needs.', action: { kind: 'site', siteId: s.id } });
  }
  const sites = await many<{ id: string; name: string }>(
    db,
    `select s.id, s.name from sites s join contractors c on c.id = s.contractor_id
      where c.linked_org_id = $1 and s.status in ('in_progress', 'site_ready')`,
    [orgId],
  );
  for (const s of sites) {
    const rd = await computeReadiness(db, s.id);
    const site: FindingAction = { kind: 'site', siteId: s.id, tab: 'compliance' };
    if (rd.counts.correction_required) out.push({ key: `corrections:${s.id}`, siteId: s.id, severity: 'high', title: `${plural(rd.counts.correction_required, 'document')} sent back for correction on ${s.name}`, detail: 'Read the reviewer\'s comments and resubmit.', action: site });
    if (rd.counts.expired) out.push({ key: `expired:${s.id}`, siteId: s.id, severity: 'high', title: `${plural(rd.counts.expired, 'document')} expired on ${s.name}`, detail: 'Upload current versions to stay compliant.', action: site });
    if (rd.counts.missing) out.push({ key: `missing:${s.id}`, siteId: s.id, severity: rd.percent < 50 ? 'medium' : 'low', title: `${plural(rd.counts.missing, 'document')} still needed for ${s.name}`, detail: `The safety file is ${rd.percent}% complete.`, action: site });
    if (rd.counts.expiring) out.push({ key: `expiring:${s.id}`, siteId: s.id, severity: 'low', title: `${plural(rd.counts.expiring, 'document')} on ${s.name} expire within 30 days`, detail: 'Renew them before they lapse.', action: site });
  }
  const requests = await many<{ site_id: string; name: string; n: number; overdue: number }>(
    db,
    `select s.id as site_id, s.name, count(*)::int as n, count(*) filter (where q.due_date < current_date)::int as overdue
       from info_requests q join sites s on s.id = q.site_id join contractors c on c.id = s.contractor_id
      where c.linked_org_id = $1 and s.status in ('in_progress', 'site_ready') and q.status in ('requested', 'viewed')
      group by s.id, s.name`,
    [orgId],
  );
  for (const q of requests) {
    out.push({ key: `requests:${q.site_id}`, siteId: q.site_id, severity: q.overdue ? 'high' : 'medium', title: `${plural(q.n, 'request')} to answer on ${q.name}`, detail: q.overdue ? `${q.overdue} past the due date.` : 'The site is waiting on you.', action: { kind: 'site', siteId: q.site_id, tab: 'requests' } });
  }
  out.push(...(await sharedSafetyFindings(db, `c.linked_org_id = $1 and s.status in ('in_progress', 'site_ready')`, orgId)));

  const certs = await many<{ expired: number; expiring: number }>(
    db,
    `select count(distinct w.id) filter (where wc.expires_on < current_date)::int as expired,
            count(distinct w.id) filter (where wc.expires_on between current_date and current_date + 30)::int as expiring
       from workers w join worker_certificates wc on wc.worker_id = w.id
      where w.org_id = $1 and w.active and wc.expires_on is not null
        and not exists (select 1 from worker_certificates n where n.worker_id = w.id and n.kind = wc.kind and n.name = wc.name and n.id <> wc.id and (n.expires_on is null or n.expires_on > wc.expires_on))`,
    [orgId],
  );
  const c = certs[0];
  if (c?.expired) out.push({ key: 'worker-certs-expired', siteId: null, severity: 'high', title: `${plural(c.expired, 'worker')} with expired certificates`, detail: 'Medicals, inductions or training that have lapsed. Upload renewals in Workforce.', action: { kind: 'workforce' } });
  if (c?.expiring) out.push({ key: 'worker-certs-expiring', siteId: null, severity: 'low', title: `${plural(c.expiring, 'worker')} with certificates expiring within 30 days`, detail: 'Book renewals now so nobody is turned away at the gate.', action: { kind: 'workforce' } });

  const lib = await many<{ n: number }>(
    db,
    `select count(*)::int as n from documents where library_org_id = $1 and status in ('complete', 'expiring') and expiry_date < current_date + 30`,
    [orgId],
  );
  if (lib[0]?.n) out.push({ key: 'library-expiring', siteId: null, severity: 'medium', title: `${plural(lib[0].n, 'company document')} expired or expiring soon`, detail: 'Company documents such as your COID letter and insurance are reused across sites. Renew them once in your library.', action: { kind: 'library' } });
  return out;
}

/** Document Studio documents due for their periodic review (both kinds of organisation). */
async function reviewFindings(db: Db, orgId: string): Promise<Finding[]> {
  const rows = await many<{ overdue: number; due: number; first: string | null }>(
    db,
    `select count(*) filter (where review_due < current_date)::int as overdue,
            count(*) filter (where review_due between current_date and current_date + 30)::int as due,
            min(doc_number || ' ' || title) filter (where review_due < current_date + 30) as first
       from generated_documents where org_id = $1 and superseded_at is null`,
    [orgId],
  );
  const r = rows[0];
  const out: Finding[] = [];
  if (r?.overdue) out.push({ key: 'studio-review-overdue', siteId: null, severity: 'high', title: `${plural(r.overdue, 'document')} past its review date`, detail: 'Controlled documents must be reviewed at least yearly. Open Document Studio and create a new revision.', action: { kind: 'studio' } });
  if (r?.due) out.push({ key: 'studio-review-due', siteId: null, severity: 'low', title: `${plural(r.due, 'document')} due for review within 30 days`, detail: `Starting with ${r.first}. A new revision keeps the same document number.`, action: { kind: 'studio' } });
  return out;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** Reviews one organisation and stores the result. Returns whether anything changed. */
export async function runAgentForOrg(db: Db, org: { id: string; kind: string }): Promise<boolean> {
  const findings = [...(org.kind === 'host' ? await hostFindings(db, org.id) : await contractorFindings(db, org.id)), ...(await reviewFindings(db, org.id))];
  let changed = false;
  for (const f of findings) {
    const r = await db.query<{ inserted: boolean; was_resolved: boolean; old_title: string }>(
      `insert into agent_findings (org_id, site_id, key, severity, title, detail, action)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (org_id, key) do update
         set severity = excluded.severity, title = excluded.title, detail = excluded.detail, action = excluded.action,
             site_id = excluded.site_id, last_seen = now(),
             first_seen = case when agent_findings.resolved_at is null then agent_findings.first_seen else now() end,
             resolved_at = null
       returning (xmax = 0) as inserted`,
      [org.id, f.siteId, f.key, f.severity, f.title, f.detail, JSON.stringify(f.action)],
    );
    if (r.rows[0]?.inserted) changed = true;
  }
  const resolved = await db.query(
    `update agent_findings set resolved_at = now() where org_id = $1 and resolved_at is null and not (key = any($2::text[]))`,
    [org.id, findings.map((f) => f.key)],
  );
  if (resolved.rowCount) changed = true;
  await db.query(`insert into agent_runs (org_id, last_run_at) values ($1, now()) on conflict (org_id) do update set last_run_at = now()`, [org.id]);
  return changed;
}

/** Runs the agent across every organisation. One instance at a time. */
export async function runAgent(): Promise<number> {
  const orgs = await withTx(async (db) => {
    const lock = await many<{ ok: boolean }>(db, 'select pg_try_advisory_xact_lock(727003) as ok');
    if (!lock[0]?.ok) return null;
    return many<{ id: string; kind: string }>(db, `select id, kind from organisations where managed_by_org is null`);
  });
  if (!orgs) return 0;
  let reviewed = 0;
  for (const org of orgs) {
    // One short transaction per organisation keeps locks brief.
    await withTx(async (db) => {
      const changed = await runAgentForOrg(db, org);
      if (changed) await publishChange(db, [org.id]);
    });
    reviewed++;
  }
  return reviewed;
}

export interface FindingView {
  id: string;
  siteId: string | null;
  severity: Severity;
  title: string;
  detail: string;
  action: FindingAction;
  since: string;
}

/** Open findings for an organisation, most urgent first. */
export async function openFindings(orgId: string): Promise<{ lastRunAt: string | null; findings: FindingView[] }> {
  const rows = await many<{ id: string; site_id: string | null; severity: Severity; title: string; detail: string; action: FindingAction; first_seen: Date }>(
    pool,
    `select id, site_id, severity, title, detail, action, first_seen from agent_findings where org_id = $1 and resolved_at is null`,
    [orgId],
  );
  const run = await many<{ last_run_at: Date }>(pool, 'select last_run_at from agent_runs where org_id = $1', [orgId]);
  const findings = rows
    .map((r) => ({ id: r.id, siteId: r.site_id, severity: r.severity, title: r.title, detail: r.detail, action: r.action, since: r.first_seen.toISOString() }))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.since.localeCompare(b.since));
  return { lastRunAt: run[0]?.last_run_at.toISOString() ?? null, findings };
}

/** ISO week label, e.g. 2026-W40, used to send the weekly summary once. */
function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * Monday-morning compliance summary to each organisation's owners and admins,
 * from the agent's open findings. Safe to call hourly: each person gets it once
 * a week, from 06:00 South African time on Monday.
 */
export async function sendWeeklySummaries(now = new Date()): Promise<number> {
  const sast = new Date(now.getTime() + 2 * 3600_000);
  if (sast.getUTCDay() !== 1 || sast.getUTCHours() < 6) return 0;
  const week = isoWeek(sast);
  const orgs = await many<{ id: string; name: string }>(
    pool,
    `select id, name from organisations where not is_demo and managed_by_org is null and coalesce((settings->>'weeklySummary')::boolean, true)`,
  );
  let sent = 0;
  for (const org of orgs) {
    const { findings } = await openFindings(org.id);
    const high = findings.filter((f) => f.severity === 'high').length;
    const lines = findings.length
      ? [
          `The SiteGuard compliance agent has ${plural(findings.length, 'item')} open for ${org.name}${high ? `, ${high} of them high priority` : ''}:`,
          ...findings.slice(0, 10).map((f) => `• [${f.severity}] ${f.title}`),
          ...(findings.length > 10 ? [`…and ${findings.length - 10} more in SiteGuard.`] : []),
        ]
      : [`Nothing needs attention at ${org.name} this week. The compliance agent will keep checking every 15 minutes.`];
    await withTx(async (db) => {
      await queueToOrg(db, org.id, ['owner', 'admin'], (to) => ({
        to: to.email,
        subject: findings.length ? `SiteGuard weekly summary: ${plural(findings.length, 'item')} to action` : 'SiteGuard weekly summary: all clear',
        lines: [`Hi ${to.name},`, ...lines],
        action: { label: 'Open SiteGuard', url: appUrl('/') },
        dedupeKey: `weekly:${org.id}:${to.email}:${week}`,
        footer: 'Admins can turn this summary off under More → Organisation settings → Notifications.',
      }));
    });
    sent++;
  }
  return sent;
}
