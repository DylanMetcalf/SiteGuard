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
import { sniffType, storage } from './storage.js';
import { notifyOrg } from './notify.js';

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
}

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

/** The invitation email: who is asking or sharing, what, by when, and one secure button. */
export async function sendExchangeEmail(db: Db, x: ExchangeRow, senderName: string, token: string, opts: { reminder?: string; extra?: string[] } = {}) {
  const items = await many<{ document_type: string; person_name: string }>(db, 'select document_type, person_name from exchange_items where exchange_id = $1 order by position', [x.id]);
  const site = x.site_id ? await one<{ name: string }>(db, 'select name from sites where id = $1', [x.site_id]) : null;
  const list = items.map((i) => `• ${i.document_type}${i.person_name ? ' — ' + i.person_name : ''}`);
  const request = x.direction === 'request';
  const expires = new Date(x.access_expires_at).toISOString().slice(0, 10);
  await queueEmail(db, {
    orgId: x.sender_org_id,
    to: x.recipient_email,
    subject: request ? `${senderName} has requested documents from you (${refLabel(x.ref)})` : `${senderName} has shared ${items.length === 1 ? 'a document' : 'documents'} with you (${refLabel(x.ref)})`,
    lines: [
      `Hi ${x.recipient_name || 'there'},`,
      ...(opts.reminder ? [opts.reminder] : []),
      request
        ? `${senderName} has requested ${items.length === 1 ? 'a document' : 'documents'} from ${x.recipient_org_name || 'you'} through COMVERA${site ? ` for ${site.name}` : ''}:`
        : `${senderName} has securely shared ${items.length === 1 ? 'a document' : 'documents'} with ${x.recipient_org_name || 'you'} through COMVERA:`,
      ...list,
      ...(opts.extra ?? []),
      ...(x.message ? [`Message: “${x.message}”`] : []),
      ...(x.deadline && request ? [`Needed by ${x.deadline}.`] : []),
      `Open the secure ${request ? 'request' : 'share'} below. You'll confirm your email address with a one-time code — no account or password is needed. The link works until ${expires}.`,
    ],
    action: { label: request ? 'Open secure request' : 'Open shared documents', url: appUrl(`/x/${token}`) },
    footer: `You received this because ${senderName} entered this address on COMVERA. Documents are not attached to email; they stay in the secure exchange.`,
  });
}

/** Tells the sender's team (owners, admins, reviewers) when something comes back. */
export async function notifySender(db: Db, x: Pick<ExchangeRow, 'id' | 'sender_org_id'>, title: string, body = '') {
  await notifyOrg(db, x.sender_org_id, ['owner', 'admin', 'reviewer'], { kind: 'exchange', title, body, link: { kind: 'exchange', id: x.id } });
}
