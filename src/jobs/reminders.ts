/**
 * Reminder digests. Finds things that need attention — expiring or expired
 * documents and worker certificates, expired permits that were never closed
 * out, incidents left open, overdue requests — and sends each affected person
 * one digest email listing only the items that are new since last time.
 */
import { many, pool, withTx, type Db } from '../db/pool.js';
import { appUrl, queueEmail } from '../lib/email.js';
import { INCIDENT_LABELS, PERMIT_LABELS } from '../lib/readiness.js';

interface Item {
  key: string;
  orgId: string;
  roles: string[] | null;
  line: string;
}

const bucket = (days: number) => (days < 0 ? 'expired' : days <= 7 ? '7d' : '30d');
const when = (days: number) => (days < 0 ? `expired ${-days} day${days === -1 ? '' : 's'} ago` : days === 0 ? 'expires today' : `expires in ${days} day${days === 1 ? '' : 's'}`);

async function collect(db: Db): Promise<Item[]> {
  const items: Item[] = [];
  const optedIn = `coalesce((o.settings->>'reminderDigest')::boolean, true)`;

  // Site documents.
  for (const r of await many(
    db,
    `select d.id, d.expiry_date, (d.expiry_date - current_date) as days, r.name, s.name as site_name, s.org_id as host_id, c.linked_org_id
       from documents d join requirements r on r.id = d.requirement_id join sites s on s.id = r.site_id
       join contractors c on c.id = s.contractor_id join organisations o on o.id = s.org_id
      where d.status in ('complete', 'expiring') and d.expiry_date is not null and d.expiry_date <= current_date + 30
        and d.expiry_date >= current_date - 60 and s.status <> 'declined' and not o.is_demo`,
  )) {
    const b = bucket(r.days);
    const line = `${r.name} on ${r.site_name} ${when(r.days)}.`;
    if (r.linked_org_id) items.push({ key: `doc:${r.id}:${r.expiry_date}:${b}:c`, orgId: r.linked_org_id, roles: null, line });
    if (b === 'expired') items.push({ key: `doc:${r.id}:${r.expiry_date}:${b}:h`, orgId: r.host_id, roles: ['owner', 'admin', 'reviewer'], line });
  }

  // Contractor library documents.
  for (const r of await many(
    db,
    `select d.id, d.expiry_date, (d.expiry_date - current_date) as days, d.library_type, d.library_org_id
       from documents d join organisations o on o.id = d.library_org_id
      where d.library_org_id is not null and d.status = 'complete' and d.expiry_date is not null
        and d.expiry_date <= current_date + 30 and d.expiry_date >= current_date - 60 and not o.is_demo and ${optedIn}`,
  )) {
    items.push({
      key: `lib:${r.id}:${r.expiry_date}:${bucket(r.days)}`,
      orgId: r.library_org_id,
      roles: ['owner', 'admin'],
      line: `Company document "${String(r.library_type).replace(/-/g, ' ')}" ${when(r.days)}.`,
    });
  }

  // Worker certificates.
  for (const r of await many(
    db,
    `select c.id, c.expires_on, (c.expires_on - current_date) as days, c.name, w.full_name, w.org_id
       from worker_certificates c join workers w on w.id = c.worker_id join organisations o on o.id = w.org_id
      where w.active and c.expires_on is not null and c.expires_on <= current_date + 30 and c.expires_on >= current_date - 60
        and not o.is_demo and ${optedIn}`,
  )) {
    items.push({
      key: `cert:${r.id}:${r.expires_on}:${bucket(r.days)}`,
      orgId: r.org_id,
      roles: ['owner', 'admin'],
      line: `${r.full_name}'s ${r.name} ${when(r.days)}.`,
    });
  }

  // Expired permits never closed out.
  for (const r of await many(
    db,
    `select p.id, p.type, p.location, s.name as site_name, s.org_id as host_id, c.linked_org_id
       from permits p join sites s on s.id = p.site_id join contractors c on c.id = s.contractor_id join organisations o on o.id = s.org_id
      where p.status = 'active' and p.valid_to < now() and not o.is_demo`,
  )) {
    const line = `${PERMIT_LABELS[r.type]} permit at ${r.location} (${r.site_name}) has expired but was never closed out.`;
    items.push({ key: `permit:${r.id}:h`, orgId: r.host_id, roles: ['owner', 'admin', 'reviewer'], line });
    if (r.linked_org_id) items.push({ key: `permit:${r.id}:c`, orgId: r.linked_org_id, roles: ['owner', 'admin'], line });
  }

  // Incidents still open after a week — reminded weekly.
  for (const r of await many(
    db,
    `select i.id, i.type, i.occurred_on, (current_date - i.occurred_on) as age, s.name as site_name, s.org_id as host_id,
            to_char(now(), 'IYYY-IW') as week
       from incidents i join sites s on s.id = i.site_id join organisations o on o.id = s.org_id
      where i.status <> 'closed' and i.created_at < now() - interval '7 days' and not o.is_demo`,
  )) {
    items.push({
      key: `incident:${r.id}:${r.week}`,
      orgId: r.host_id,
      roles: ['owner', 'admin', 'reviewer'],
      line: `${INCIDENT_LABELS[r.type]} on ${r.site_name} has been open for ${r.age} days.`,
    });
  }

  // Overdue requests.
  for (const r of await many(
    db,
    `select q.id, q.title, q.due_date, s.name as site_name, c.linked_org_id
       from info_requests q join sites s on s.id = q.site_id join contractors c on c.id = s.contractor_id join organisations o on o.id = s.org_id
      where q.status in ('requested', 'viewed') and q.due_date < current_date and c.linked_org_id is not null and not o.is_demo`,
  )) {
    items.push({ key: `request:${r.id}`, orgId: r.linked_org_id, roles: null, line: `Request "${r.title}" for ${r.site_name} was due ${r.due_date}.` });
  }
  return items;
}

/** Sends digests for any new items. Returns how many emails were queued. */
export async function runReminders(): Promise<number> {
  return withTx(async (db) => {
    // Only one instance runs this at a time.
    const lock = await many<{ ok: boolean }>(db, 'select pg_try_advisory_xact_lock(727002) as ok');
    if (!lock[0]?.ok) return 0;

    const fresh: Item[] = [];
    for (const item of await collect(db)) {
      const res = await db.query('insert into reminder_log (key) values ($1) on conflict do nothing', [item.key]);
      if (res.rowCount) fresh.push(item);
    }
    if (!fresh.length) return 0;

    const perRecipient = new Map<string, { name: string; orgId: string; lines: Set<string> }>();
    for (const item of fresh) {
      const members = await many<{ email: string; name: string }>(
        db,
        `select u.email, u.name from memberships m join users u on u.id = m.user_id
          where m.org_id = $1 and ($2::text[] is null or m.role = any($2)) and not u.is_demo`,
        [item.orgId, item.roles],
      );
      for (const m of members) {
        const entry = perRecipient.get(m.email) ?? { name: m.name, orgId: item.orgId, lines: new Set<string>() };
        entry.lines.add(item.line);
        perRecipient.set(m.email, entry);
      }
    }
    const stamp = new Date().toISOString().slice(0, 13);
    for (const [email, { name, orgId, lines }] of perRecipient) {
      const list = [...lines];
      await queueEmail(db, {
        orgId,
        to: email,
        subject: `SiteGuard: ${list.length} item${list.length === 1 ? '' : 's'} need${list.length === 1 ? 's' : ''} attention`,
        lines: [`Hi ${name},`, 'These need attention:', ...list.map((l) => `• ${l}`)],
        action: { label: 'Open SiteGuard', url: appUrl('/') },
        dedupeKey: `digest:${email}:${stamp}`,
        footer: 'Admins can turn these digests off under Admin → Notifications.',
      });
    }
    return perRecipient.size;
  });
}

export async function cleanupExpired(): Promise<void> {
  await pool.query(`delete from sessions where expires_at < now()`);
  await pool.query(`delete from email_tokens where expires_at < now() - interval '7 days'`);
  await pool.query(`delete from reminder_log where sent_at < now() - interval '180 days'`);
}
