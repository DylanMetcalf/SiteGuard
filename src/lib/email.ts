/**
 * Email is written to an outbox table inside the same transaction as the
 * change that caused it, then delivered by a background worker. A rolled-back
 * action never sends mail, and a crashed send is retried.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import type { Db } from '../db/pool.js';
import { many, pool } from '../db/pool.js';
import { config } from '../config.js';

export interface OutgoingEmail {
  to: string;
  subject: string;
  /** Short paragraphs; rendered as plain text and simple HTML. */
  lines: string[];
  action?: { label: string; url: string };
  orgId?: string | null;
  /** Prevents duplicates (e.g. one expiry reminder per document per threshold). */
  dedupeKey?: string;
  footer?: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderEmail(e: OutgoingEmail): { text: string; html: string } {
  const footer =
    e.footer ?? 'You are receiving this because you have a SiteGuard account or were invited to one.';
  const text = [
    ...e.lines,
    ...(e.action ? ['', `${e.action.label}: ${e.action.url}`] : []),
    '',
    '—',
    'SiteGuard · Contractor compliance & site safety',
    footer,
  ].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#E3E5DB;font-family:Helvetica,Arial,sans-serif;color:#15181B;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#F1F2EA;border:1px solid #C7CABC;border-radius:4px;">
<tr><td style="padding:16px 20px;border-bottom:1px solid #C7CABC;font-weight:700;font-size:16px;">SiteGuard</td></tr>
<tr><td style="padding:18px 20px;font-size:14px;line-height:1.55;">
${e.lines.map((l) => `<p style="margin:0 0 12px;">${esc(l)}</p>`).join('')}
${
  e.action
    ? `<p style="margin:18px 0 6px;"><a href="${esc(e.action.url)}" style="background:#C85417;color:#fff;text-decoration:none;padding:10px 16px;border-radius:3px;font-weight:600;display:inline-block;">${esc(e.action.label)}</a></p>
<p style="margin:10px 0 0;font-size:11px;color:#6B7178;word-break:break-all;">${esc(e.action.url)}</p>`
    : ''
}
</td></tr>
<tr><td style="padding:12px 20px;border-top:1px solid #C7CABC;font-size:11px;color:#6B7178;">${esc(footer)}</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

export async function queueEmail(db: Db, e: OutgoingEmail): Promise<void> {
  const { text, html } = renderEmail(e);
  await db.query(
    `insert into email_outbox (org_id, to_email, subject, text_body, html_body, dedupe_key)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (dedupe_key) do nothing`,
    [e.orgId ?? null, e.to, e.subject, text, html, e.dedupeKey ?? null],
  );
}

/** Emails a set of organisation members, optionally filtered by role. */
export async function queueToOrg(
  db: Db,
  orgId: string,
  roles: string[] | null,
  build: (to: { email: string; name: string }) => OutgoingEmail,
): Promise<void> {
  const members = await many<{ email: string; name: string }>(
    db,
    `select u.email, u.name from memberships m join users u on u.id = m.user_id
      where m.org_id = $1 and ($2::text[] is null or m.role = any($2)) and not u.is_demo`,
    [orgId, roles],
  );
  for (const m of members) await queueEmail(db, { orgId, ...build(m) });
}

let transport: Transporter | null = null;
function getTransport(): Transporter | null {
  if (!config.SMTP_URL) return null;
  transport ??= nodemailer.createTransport(config.SMTP_URL);
  return transport;
}

/** Delivers a batch of pending outbox rows. Safe to run on several instances at once. */
export async function deliverPendingEmail(log: (msg: string) => void = console.log, batch = 20): Promise<number> {
  const client = await pool.connect();
  let sent = 0;
  try {
    await client.query('begin');
    const rows = await many<{ id: number; to_email: string; subject: string; text_body: string; html_body: string; attempts: number }>(
      client,
      `select id, to_email, subject, text_body, html_body, attempts from email_outbox
        where status = 'pending' and send_after <= now()
        order by id limit $1 for update skip locked`,
      [batch],
    );
    const t = getTransport();
    for (const row of rows) {
      try {
        if (t) {
          await t.sendMail({ from: config.EMAIL_FROM, to: row.to_email, subject: row.subject, text: row.text_body, html: row.html_body });
        } else if (config.NODE_ENV !== 'test') {
          log(`email (SMTP not configured, not sent) → ${row.to_email}: ${row.subject}\n${row.text_body}\n`);
        }
        await client.query(`update email_outbox set status = 'sent', sent_at = now(), attempts = attempts + 1 where id = $1`, [row.id]);
        sent++;
      } catch (err) {
        const attempts = row.attempts + 1;
        await client.query(
          `update email_outbox set attempts = $2, last_error = $3,
                  status = case when $2 >= 6 then 'failed' else 'pending' end,
                  send_after = now() + make_interval(mins => power(2, $2)::int)
            where id = $1`,
          [row.id, attempts, String((err as Error).message).slice(0, 500)],
        );
        log(`email to ${row.to_email} failed (attempt ${attempts}): ${(err as Error).message}`);
      }
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return sent;
}

export const appUrl = (path: string) => config.APP_URL.replace(/\/$/, '') + path;
