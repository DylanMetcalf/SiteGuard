/**
 * COMVERA Exchange: the shared logic behind requesting and sharing specific documents with
 * people who have no COMVERA workspace.
 *
 * Three things stay separate:
 *  - a relationship (an organisation's record of another party) is never a permission;
 *  - an exchange is one scoped transaction, reached with a link plus a one-time code sent to
 *    the recipient's email, and shows that exchange only;
 *  - a workspace is created only when someone explicitly signs up.
 */
import { createHash, randomInt, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Db } from '../db/pool.js';
import { many, one } from '../db/pool.js';
import { badRequest } from './errors.js';
import { sha256 } from './security.js';
import { appUrl, queueEmail } from './email.js';
import { features } from '../config.js';
import { bumpVersion } from './readiness.js';
import { capExpiry, rulesForOrg, submissionCap } from './validity.js';
import { notifyOrg, REVIEWERS } from './notify.js';
import { recheckSiteReady } from './siteready.js';
import { sniffType, storage } from './storage.js';
import { assertClean } from './scan.js';

export interface ExchangeRow {
  id: string;
  ref: number;
  direction: 'request' | 'share';
  sender_org_id: string;
  relationship_id: string | null;
  contact_id: string | null;
  recipient_name: string;
  recipient_email: string;
  recipient_org_name: string;
  recipient_org_id: string | null;
  site_id: string | null;
  message: string;
  recipient_response: string;
  deadline: string | null;
  allow_download: boolean;
  status: string;
  access_expires_at: Date;
  revoked_at: Date | null;
  opened_at: Date | null;
  verified_at: Date | null;
  submitted_at: Date | null;
  completed_at: Date | null;
  claimed_at: Date | null;
  created_by: string | null;
  created_by_name: string;
  created_at: Date;
  email_outbox_id: number | null;
  reminded_at: Date | null;
  remind_count: number;
}

export type ItemKind = 'document' | 'replacement' | 'signature' | 'other';
export const KIND_LABEL: Record<ItemKind, string> = {
  document: 'Document request', replacement: 'Replacement document', signature: 'Signed copy', other: 'Other document',
};

export const EXCHANGE_SESSION_HOURS = 2;
export const CODE_MINUTES = 10;
export const MAX_CODE_ATTEMPTS = 5;
export const refLabel = (ref: number) => `EX-${ref}`;

/** The record exists either way; this says whether its link and sessions still work. */
export function accessState(x: Pick<ExchangeRow, 'revoked_at' | 'access_expires_at'>): 'active' | 'revoked' | 'expired' {
  if (x.revoked_at) return 'revoked';
  if (new Date(x.access_expires_at).getTime() <= Date.now()) return 'expired';
  return 'active';
}

/** j***@example.com — enough for the recipient to recognise, not enough to harvest. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split('@');
  return `${user.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(6, user.length - 1)))}@${domain}`;
}

export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const codeHash = (exchangeId: string, code: string) => sha256(`${exchangeId}:${code}`);

/**
 * Exchange events go into the sending organisation's own audit trail (append-only), with the
 * recipient named by email when they acted, so the history survives even after access ends.
 */
export async function exchangeAudit(
  db: Db,
  x: Pick<ExchangeRow, 'sender_org_id' | 'ref' | 'site_id'>,
  actor: { name: string; role: string; id?: string | null },
  action: string,
  detail = '',
) {
  await db.query(
    `insert into audit_events (org_id, site_id, actor_id, actor_name, actor_role, action, detail) values ($1, $2, $3, $4, $5, $6, $7)`,
    [x.sender_org_id, x.site_id, actor.id ?? null, actor.name.slice(0, 200), actor.role, action, `${refLabel(x.ref)}${detail ? ' — ' + detail : ''}`.slice(0, 500)],
  );
}

export const recipientActor = (email: string) => ({ name: email, role: 'Exchange recipient' });

/** Recomputes a request's overall status from its items after a submission or review. */
export async function refreshRequestStatus(db: Db, exchangeId: string): Promise<string> {
  const items = await many<{ status: string }>(db, 'select status from exchange_items where exchange_id = $1', [exchangeId]);
  const x = (await one<{ status: string; submitted_at: Date | null }>(db, 'select status, submitted_at from exchanges where id = $1', [exchangeId]))!;
  let status = x.status;
  if (items.length && items.every((i) => i.status === 'approved')) status = 'approved';
  else if (items.some((i) => i.status === 'rejected')) status = 'changes_requested';
  else if (x.submitted_at && items.some((i) => i.status === 'submitted')) status = 'submitted';
  await db.query(
    `update exchanges set status = $2, completed_at = case when $2 = 'approved' then coalesce(completed_at, now()) else null end where id = $1`,
    [exchangeId, status],
  );
  return status;
}

/** Stores a recipient's upload as the requesting organisation's own file (its compliance copy). */
export async function storeExchangeFile(db: Db, orgId: string, buf: Buffer, filename: string, declaredType: string) {
  await assertClean(buf);
  const type = sniffType(buf, declaredType, filename);
  if (!type) throw badRequest('That file type is not supported. Upload a PDF, photo (JPG/PNG/WebP/HEIC), Word, Excel or text file.', 'unsupported_file');
  const safeName = path.basename(filename).replace(/[\x00-\x1f]/g, '').slice(0, 180) || 'document';
  const key = `${orgId}/exchange/${new Date().toISOString().slice(0, 7)}/${randomUUID()}${path.extname(safeName).toLowerCase().slice(0, 10)}`;
  await storage.put(key, buf, type);
  return (await one<{ id: string }>(
    db,
    `insert into files (org_id, storage_key, filename, content_type, size_bytes, sha256) values ($1, $2, $3, $4, $5, $6) returning id`,
    [orgId, key, safeName, type, buf.length, createHash('sha256').update(buf).digest('hex')],
  ))!.id;
}

/**
 * The invitation email: who is asking or sharing, which organisation and site, what exactly, why, by when, and one
 * secure button. Documents are never attached, and subjects name the document but never a person. Returns the outbox
 * id and remembers it on the exchange, so the workspace can say honestly whether the email was only queued.
 */
export async function sendExchangeEmail(db: Db, x: ExchangeRow, senderName: string, token: string, opts: { reminder?: string; extra?: string[] } = {}): Promise<number | null> {
  const items = await many<{ document_type: string; person_name: string; kind: ItemKind; reason: string; due_date: string | null; source_version: string }>(
    db, `select document_type, person_name, kind, reason, to_char(due_date, 'YYYY-MM-DD') as due_date, source_version from exchange_items where exchange_id = $1 order by position`, [x.id]);
  const site = x.site_id ? await one<{ name: string }>(db, 'select name from sites where id = $1', [x.site_id]) : null;
  const request = x.direction === 'request';
  const one1 = items.length === 1 ? items[0] : null;
  const ACTION: Record<ItemKind, string> = { document: 'Document needed', replacement: 'Replacement needed', signature: 'Signed copy needed', other: 'Document needed' };
  const list = items.map((i) => request
    ? `• ${i.kind === 'replacement' || i.kind === 'signature' ? ACTION[i.kind] + ': ' : ''}${i.document_type}${i.person_name ? ` — ${i.kind === 'signature' ? 'for ' : ''}${i.person_name}` : ''}${i.kind === 'signature' && i.source_version ? ` (version ${i.source_version})` : ''}${i.reason ? ` — ${i.reason}` : ''}${i.due_date ? ` — due ${i.due_date}` : ''}`
    : `• ${i.document_type}${i.person_name ? ' — ' + i.person_name : ''}`);
  const expires = new Date(x.access_expires_at).toISOString().slice(0, 10);
  const subject = !request
    ? `${senderName} has shared ${items.length === 1 ? 'a document' : 'documents'} with you (${refLabel(x.ref)})`
    : one1 && one1.kind === 'replacement' ? `Replacement needed: ${one1.document_type} (${refLabel(x.ref)})`
    : one1 && one1.kind === 'signature' ? `Signed copy needed: ${one1.document_type} (${refLabel(x.ref)})`
    : `${senderName} has requested ${items.length === 1 ? 'a document' : 'documents'} from you (${refLabel(x.ref)})`;
  const label = !request ? 'Open shared documents'
    : one1?.kind === 'replacement' ? 'Upload replacement'
    : one1?.kind === 'signature' ? 'Open and return signed copy'
    : 'Open secure request';
  const id = await queueEmail(db, {
    orgId: x.sender_org_id,
    to: x.recipient_email,
    subject,
    lines: [
      `Hi ${x.recipient_name || 'there'},`,
      ...(opts.reminder ? [opts.reminder] : []),
      request
        ? `${senderName} has requested ${items.length === 1 ? 'a document' : 'documents'} from ${x.recipient_org_name || 'you'} through COMVERA${site ? ` for ${site.name}` : ''}:`
        : `${senderName} has securely shared ${items.length === 1 ? 'a document' : 'documents'} with ${x.recipient_org_name || 'you'} through COMVERA:`,
      ...list,
      ...(opts.extra ?? []),
      ...(x.message ? [`Message: “${x.message}”`] : []),
      ...(x.deadline && request && !items.some((i) => i.due_date) ? [`Needed by ${x.deadline}.`] : []),
      `Open the secure ${request ? 'request' : 'share'} below. You'll confirm your email address with a one-time code — no account or password is needed. The link works until ${expires}.`,
    ],
    action: { label, url: appUrl(`/x/${token}`) },
    footer: `You received this because ${senderName} entered this address on COMVERA. Documents are not attached to email; they stay in the secure exchange.`,
  });
  if (id) await db.query('update exchanges set email_outbox_id = $2 where id = $1', [x.id, id]);
  return id;
}

/**
 * What can honestly be said about the request email. "sent" means the mail server accepted it; nobody can know it was read.
 * Without SMTP nothing leaves the server at all, so the screen must not claim otherwise.
 */
export async function emailState(db: Db, x: Pick<ExchangeRow, 'email_outbox_id'>): Promise<{ state: 'not_configured' | 'none' | 'queued' | 'retrying' | 'sent' | 'failed'; error?: string }> {
  if (!features.email) return { state: 'not_configured' };
  if (!x.email_outbox_id) return { state: 'none' };
  const r = await one<{ status: string; attempts: number; last_error: string | null }>(db, 'select status, attempts, last_error from email_outbox where id = $1', [x.email_outbox_id]);
  if (!r) return { state: 'none' };
  if (r.status === 'sent') return { state: 'sent' };
  if (r.status === 'failed') return { state: 'failed', error: 'The mail server did not accept it after several tries.' };
  return { state: r.attempts > 0 ? 'retrying' : 'queued' };
}

/**
 * Files a returned document on the requirement it answers, as a NEW version waiting for review. Earlier versions and
 * their review history stay. Nothing becomes approved here, so nobody turns Site Ready by uploading.
 */
export async function fileToRequirement(
  db: Db, x: Pick<ExchangeRow, 'sender_org_id' | 'ref' | 'site_id'>, item: { requirement_id: string | null; expiry_date: string | null; document_type: string },
  fileId: string, note: string, email: string,
): Promise<string | null> {
  if (!item.requirement_id) return null;
  const req = await one<{ id: string; name: string; site_id: string }>(
    db, `select r.id, r.name, r.site_id from requirements r join sites s on s.id = r.site_id where r.id = $1 and s.org_id = $2`, [item.requirement_id, x.sender_org_id]);
  if (!req) return null;
  await db.query(`insert into documents (requirement_id) values ($1) on conflict (requirement_id) do nothing`, [req.id]);
  const doc = (await one<{ id: string; version: string | null }>(db, 'select id, version from documents where requirement_id = $1 for update', [req.id]))!;
  const version = bumpVersion(doc.version);
  let expiry = item.expiry_date;
  const cap = submissionCap(await rulesForOrg(db, x.sender_org_id), req.name);
  if (cap) expiry = capExpiry(expiry, cap.months);
  const text = [note, `Returned through ${refLabel(x.ref)}.`].filter(Boolean).join(' ');
  await db.query(
    `insert into document_versions (document_id, version, file_id, note, expiry_date, submitted_by, submitted_by_name) values ($1, $2, $3, $4, $5, null, $6)`,
    [doc.id, version, fileId, text, expiry, `${email} (secure link)`.slice(0, 200)],
  );
  await db.query(
    `update documents set status = 'awaiting_review', version = $2, current_file_id = $3, pending_file_id = null, note = $4, expiry_date = $5, updated_at = now() where id = $1`,
    [doc.id, version, fileId, text, expiry],
  );
  await notifyOrg(db, x.sender_org_id, REVIEWERS, {
    kind: 'submitted', title: `Returned for review: ${req.name}`, body: `${refLabel(x.ref)} · ${version}`, link: { kind: 'req', id: req.id, siteId: req.site_id },
  });
  return version;
}

/** A reviewer's decision on a requirement-linked return, applied to the requirement's document exactly as the normal review does. */
export async function decideRequirement(
  db: Db, x: Pick<ExchangeRow, 'sender_org_id' | 'ref'>, item: { requirement_id: string | null; file_id: string | null }, decision: 'approve' | 'reject', note: string,
  actor: { id: string; name: string; role: string },
): Promise<void> {
  if (!item.requirement_id) return;
  const doc = await one<{ id: string; current_file_id: string | null }>(db, 'select id, current_file_id from documents where requirement_id = $1 for update', [item.requirement_id]);
  // If the contractor has since filed something else, this decision must not touch it.
  if (!doc || !item.file_id || doc.current_file_id !== item.file_id) return;
  const req = await one<{ id: string; name: string; site_id: string }>(db, 'select id, name, site_id from requirements where id = $1', [item.requirement_id]);
  if (!req) return;
  if (decision === 'approve') {
    await db.query(`update documents set status = 'complete', updated_at = now() where id = $1`, [doc.id]);
    await db.query(`insert into reviews (document_id, author_id, author_name, author_role, kind, text) values ($1, $2, $3, $4, 'approval', $5)`, [doc.id, actor.id, actor.name, actor.role, note || `Accepted (${refLabel(x.ref)})`]);
  } else {
    await db.query(`update documents set status = 'correction_required', updated_at = now() where id = $1`, [doc.id]);
    await db.query(`insert into reviews (document_id, author_id, author_name, author_role, kind, text) values ($1, $2, $3, $4, 'correction', $5)`, [doc.id, actor.id, actor.name, actor.role, note]);
    await recheckSiteReady(db, req.site_id, `${req.name} sent back`);
  }
}

/** Tells the sender's team (owners, admins, reviewers) when something comes back. */
export async function notifySender(db: Db, x: Pick<ExchangeRow, 'id' | 'sender_org_id'>, title: string, body = '') {
  await notifyOrg(db, x.sender_org_id, ['owner', 'admin', 'reviewer'], { kind: 'exchange', title, body, link: { kind: 'exchange', id: x.id } });
}
