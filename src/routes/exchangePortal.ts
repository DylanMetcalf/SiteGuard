/**
 * COMVERA Exchange, recipient side: the temporary portal behind an exchange link.
 *
 * The link alone opens nothing but a cover page. The recipient confirms the email address the
 * exchange was sent to, receives a 6-digit code there, and gets a short-lived session for that
 * one exchange (cookie `cx`, scoped to /api/x, SameSite=Strict). No user, organisation,
 * membership, password or trial is ever created here, and the session cannot reach anything in a
 * workspace. Writes need the session's own CSRF header (x-exchange-csrf).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/pool.js';
import { many, one, pool, withTx } from '../db/pool.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/errors.js';
import { isUuid } from '../lib/authz.js';
import { isProd } from '../config.js';
import { newToken, safeEqual, sha256 } from '../lib/security.js';
import { queueEmail } from '../lib/email.js';
import { publishChange } from '../lib/realtime.js';
import { track } from '../lib/events.js';
import {
  accessState, CODE_MINUTES, codeHash, EXCHANGE_SESSION_HOURS, exchangeAudit, maskEmail, MAX_CODE_ATTEMPTS, newCode,
  notifySender, recipientActor, refLabel, refreshRequestStatus, storeExchangeFile, type ExchangeRow,
} from '../lib/exchange.js';
import { sendFile } from './files.js';
import { rl } from './auth.js';

export const EXCHANGE_COOKIE = 'cx';
const COOKIE_PATH = '/api/x';
const CODES_PER_HOUR = 5;

const GONE: Record<string, string> = {
  revoked: 'The sender has withdrawn this exchange. Contact them if you still need it.',
  expired: 'This exchange has expired. Ask the sender to send it again.',
};

async function byToken(db: Db, token: string, lock = false) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  return one<ExchangeRow & { sender_name: string }>(
    db,
    `select x.*, to_char(x.deadline, 'YYYY-MM-DD') as deadline, o.name as sender_name from exchanges x join organisations o on o.id = x.sender_org_id
      where x.link_token_hash = $1 ${lock ? 'for update of x' : ''}`,
    [sha256(token)],
  );
}

/** A link that isn't (or is no longer) valid. Same answer whether it never existed or was replaced. */
const badLink = () => new HttpError(404, 'exchange_link', "This link isn't valid. Use the most recent email you received — a new email replaces older links.");
const ended = (x: ExchangeRow) => new HttpError(410, 'exchange_ended', GONE[accessState(x)] ?? 'This exchange is no longer available.');

/** Anything before a session exists must be JSON, so a cross-site form can't submit it. */
function requireJson(req: FastifyRequest) {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'unsupported_media_type', 'Expected JSON.');
}

interface PortalSession { x: ExchangeRow & { sender_name: string }; email: string; csrf: string; tokenHash: string }

async function session(req: FastifyRequest, db: Db = pool, write = false): Promise<PortalSession> {
  const raw = req.cookies[EXCHANGE_COOKIE];
  if (!raw || raw.length > 100) throw new HttpError(401, 'exchange_session', 'Confirm your email address to continue.');
  const s = await one<{ token_hash: string; exchange_id: string; email: string; csrf_token: string }>(
    db, 'select token_hash, exchange_id, email, csrf_token from exchange_sessions where token_hash = $1 and expires_at > now()', [sha256(raw)]);
  if (!s) throw new HttpError(401, 'exchange_session', 'Your secure session has ended. Confirm your email address again to continue.');
  const x = await one<ExchangeRow & { sender_name: string }>(
    db,
    `select x.*, to_char(x.deadline, 'YYYY-MM-DD') as deadline, o.name as sender_name from exchanges x join organisations o on o.id = x.sender_org_id
      where x.id = $1 ${write ? 'for update of x' : ''}`,
    [s.exchange_id],
  );
  if (!x || x.recipient_email.toLowerCase() !== s.email.toLowerCase()) throw new HttpError(401, 'exchange_session', 'Confirm your email address to continue.');
  if (accessState(x) !== 'active') throw ended(x);
  if (write) {
    const header = req.headers['x-exchange-csrf'];
    if (typeof header !== 'string' || !safeEqual(header, s.csrf_token)) throw new HttpError(403, 'csrf', 'Your session token is stale — refresh the page and try again.');
  }
  return { x, email: s.email, csrf: s.csrf_token, tokenHash: s.token_hash };
}

/** Only what the recipient needs for this exchange — no ids or details of anything else. */
async function view(db: Db, s: PortalSession) {
  const { x } = s;
  const items = await many(db, `select i.id, i.document_type, i.person_name, i.note, i.status, i.review_note, i.downloaded_at, f.filename
                                   from exchange_items i left join files f on f.id = i.file_id where i.exchange_id = $1 order by i.position`, [x.id]);
  const subs = x.direction === 'request'
    ? await many(db, `select u.item_id, u.version, u.submitted_at, u.uploaded_at, f.filename from exchange_submissions u join files f on f.id = u.file_id
                       join exchange_items i on i.id = u.item_id where i.exchange_id = $1 order by u.version desc`, [x.id])
    : [];
  const site = x.site_id ? await one<{ name: string }>(db, 'select name from sites where id = $1', [x.site_id]) : null;
  return {
    csrf: s.csrf,
    exchange: {
      ref: refLabel(x.ref), direction: x.direction, senderName: x.sender_name, recipientName: x.recipient_name, recipientOrgName: x.recipient_org_name,
      email: s.email, message: x.message, deadline: x.deadline, siteName: site?.name ?? null, status: x.status, allowDownload: x.allow_download,
      accessExpiresAt: new Date(x.access_expires_at).toISOString(), submittedAt: x.submitted_at ? new Date(x.submitted_at).toISOString() : null,
      recipientResponse: x.recipient_response,
    },
    items: items.map((i) => {
      const mine = subs.filter((u) => u.item_id === i.id);
      const draft = mine.find((u) => !u.submitted_at);
      const sent = mine.find((u) => u.submitted_at);
      return {
        id: i.id, documentType: i.document_type, personName: i.person_name, note: i.note, status: i.status, reviewNote: i.status === 'rejected' ? i.review_note : '',
        filename: x.direction === 'share' ? i.filename : null, downloaded: !!i.downloaded_at,
        draft: draft ? { filename: draft.filename, uploadedAt: new Date(draft.uploaded_at).toISOString() } : null,
        submitted: sent ? { filename: sent.filename, version: sent.version, submittedAt: new Date(sent.submitted_at).toISOString() } : null,
      };
    }),
  };
}

function setSessionCookie(reply: FastifyReply, token: string, expires: Date) {
  reply.setCookie(EXCHANGE_COOKIE, token, { path: COOKIE_PATH, httpOnly: true, sameSite: 'strict', secure: isProd, expires });
}

export default async function exchangePortalRoutes(app: FastifyInstance) {
  /** The cover page: who sent it and to which (masked) address. Records the first open. */
  app.post('/api/x/open', rl(30), async (req) => {
    requireJson(req);
    const { token } = z.object({ token: z.string().max(100) }).parse(req.body);
    return withTx(async (db) => {
      const x = await byToken(db, token, true);
      if (!x) throw badLink();
      if (accessState(x) !== 'active') throw ended(x);
      if (!x.opened_at) {
        await db.query(
          `update exchanges set opened_at = now(), status = case when status in ('requested', 'shared') then 'opened' else status end where id = $1`, [x.id]);
        await exchangeAudit(db, x, { name: maskEmail(x.recipient_email), role: 'Exchange recipient' }, 'Exchange opened');
        await publishChange(db, [x.sender_org_id]);
      }
      // A still-valid session for this same exchange skips the code step.
      const raw = req.cookies[EXCHANGE_COOKIE];
      const live = raw && raw.length <= 100
        ? await one(db, 'select 1 from exchange_sessions where token_hash = $1 and exchange_id = $2 and expires_at > now()', [sha256(raw), x.id])
        : null;
      const n = (await one<{ n: number }>(db, 'select count(*)::int as n from exchange_items where exchange_id = $1', [x.id]))!.n;
      return {
        ref: refLabel(x.ref), direction: x.direction, senderName: x.sender_name, maskedEmail: maskEmail(x.recipient_email),
        itemCount: n, accessExpiresAt: new Date(x.access_expires_at).toISOString(), signedIn: !!live,
      };
    });
  });

  /** Emails a one-time code — only if the address matches. The answer is the same either way. */
  app.post('/api/x/code', rl(5), async (req) => {
    requireJson(req);
    const b = z.object({ token: z.string().max(100), email: z.string().trim().toLowerCase().email().max(254) }).parse(req.body);
    const generic = { sent: true, message: "If that's the address this was sent to, a 6-digit code is on its way. It works for 10 minutes." };
    return withTx(async (db) => {
      const x = await byToken(db, b.token, true);
      if (!x) throw badLink();
      if (accessState(x) !== 'active') throw ended(x);
      if (b.email !== x.recipient_email.toLowerCase()) {
        await exchangeAudit(db, x, { name: 'Unknown', role: 'Exchange visitor' }, 'Verification attempted', 'with a different email address');
        return generic;
      }
      const recent = (await one<{ n: number }>(db, `select count(*)::int as n from exchange_codes where exchange_id = $1 and created_at > now() - interval '1 hour'`, [x.id]))!.n;
      if (recent >= CODES_PER_HOUR) throw new HttpError(429, 'rate_limited', 'Too many codes requested. Wait an hour, or ask the sender to send the request again.');
      const code = newCode();
      await db.query('update exchange_codes set used_at = now() where exchange_id = $1 and used_at is null', [x.id]);
      await db.query(`insert into exchange_codes (exchange_id, code_hash, expires_at) values ($1, $2, now() + make_interval(mins => $3))`, [x.id, codeHash(x.id, code), CODE_MINUTES]);
      await queueEmail(db, {
        orgId: x.sender_org_id,
        to: x.recipient_email,
        subject: `Your COMVERA code: ${code}`,
        lines: [`Your one-time code for ${refLabel(x.ref)} from ${x.sender_name} is:`, code, `It works for ${CODE_MINUTES} minutes. If you didn't ask for it, you can ignore this email.`],
        footer: 'COMVERA never asks for this code by phone or email. Only enter it on the COMVERA page you opened.',
      });
      await exchangeAudit(db, x, recipientActor(x.recipient_email), 'Verification code sent');
      return generic;
    });
  });

  /** Checks the code and starts a short session for this exchange only. */
  app.post('/api/x/verify', rl(10), async (req, reply) => {
    requireJson(req);
    const b = z.object({
      token: z.string().max(100),
      email: z.string().trim().toLowerCase().email().max(254),
      code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.'),
    }).parse(req.body);
    const result = await withTx(async (db) => {
      const x = await byToken(db, b.token, true);
      if (!x) throw badLink();
      if (accessState(x) !== 'active') throw ended(x);
      const c = await one<{ id: number; code_hash: string; attempts: number }>(
        db, `select id, code_hash, attempts from exchange_codes where exchange_id = $1 and used_at is null and expires_at > now() order by created_at desc limit 1 for update`, [x.id]);
      if (!c) return { error: badRequest('That code has expired or was already used. Request a new one.', 'code_expired') };
      if (c.attempts >= MAX_CODE_ATTEMPTS) return { error: new HttpError(429, 'too_many_attempts', 'Too many incorrect attempts. Request a new code.') };
      const right = b.email === x.recipient_email.toLowerCase() && safeEqual(codeHash(x.id, b.code), c.code_hash);
      if (!right) {
        await db.query('update exchange_codes set attempts = attempts + 1 where id = $1', [c.id]);
        await exchangeAudit(db, x, { name: 'Unknown', role: 'Exchange visitor' }, 'Verification failed', `attempt ${c.attempts + 1} of ${MAX_CODE_ATTEMPTS}`);
        const left = MAX_CODE_ATTEMPTS - c.attempts - 1;
        return { error: badRequest(left > 0 ? `That code isn't right. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many incorrect attempts. Request a new code.', 'wrong_code') };
      }
      await db.query('update exchange_codes set used_at = now() where exchange_id = $1 and used_at is null', [x.id]);
      const token = newToken();
      const csrf = newToken();
      const expires = new Date(Math.min(Date.now() + EXCHANGE_SESSION_HOURS * 3_600_000, new Date(x.access_expires_at).getTime()));
      await db.query('insert into exchange_sessions (token_hash, exchange_id, email, csrf_token, ip, expires_at) values ($1, $2, $3, $4, $5, $6)',
        [sha256(token), x.id, x.recipient_email, csrf, req.ip, expires]);
      await db.query(
        `update exchanges set verified_at = coalesce(verified_at, now()), status = case when status in ('requested', 'opened') and direction = 'request' then 'verified' else status end where id = $1`,
        [x.id]);
      await exchangeAudit(db, x, recipientActor(x.recipient_email), 'Verification completed');
      await publishChange(db, [x.sender_org_id]);
      return { token, expires, csrf };
    });
    // Failed attempts are committed before the error is returned, so they always count.
    if ('error' in result) throw result.error;
    setSessionCookie(reply, result.token, result.expires);
    return { ok: true, csrf: result.csrf };
  });

  app.get('/api/x/exchange', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    return view(pool, await session(req));
  });

  /** Uploads a file for one requested document. It stays a draft until the recipient submits. */
  app.post('/api/x/items/:id/upload', rl(60), async (req) => {
    const itemId = (req.params as { id: string }).id;
    const s0 = await session(req, pool, true);
    if (s0.x.direction !== 'request' || !isUuid(itemId)) throw notFound();
    const file = await req.file();
    if (!file) throw badRequest('Attach a file.');
    const buf = await file.toBuffer();
    if (!buf.length) throw badRequest('That file is empty.');
    return withTx(async (db) => {
      const s = await session(req, db, true);
      const item = await one<{ id: string; status: string; document_type: string; person_name: string }>(
        db, 'select id, status, document_type, person_name from exchange_items where id = $1 and exchange_id = $2 for update', [itemId, s.x.id]);
      if (!item) throw notFound();
      if (item.status === 'approved') throw conflict('This document has already been accepted.');
      if (item.status === 'submitted') throw conflict("This document is with the sender for review. You can replace it if they ask for changes.");
      const replacing = item.status === 'rejected'
        || !!(await one(db, 'select 1 from exchange_submissions where item_id = $1 and submitted_at is null', [item.id]));
      await db.query('delete from exchange_submissions where item_id = $1 and submitted_at is null', [item.id]);
      // The upload becomes the requesting organisation's own copy; the sender's original stays with the sender.
      const fileId = await storeExchangeFile(db, s.x.sender_org_id, buf, file.filename, file.mimetype);
      const v = (await one<{ v: number }>(db, 'select coalesce(max(version), 0) + 1 as v from exchange_submissions where item_id = $1', [item.id]))!.v;
      await db.query('insert into exchange_submissions (item_id, version, file_id, submitted_by_email) values ($1, $2, $3, $4)', [item.id, v, fileId, s.email]);
      const label = `${item.document_type}${item.person_name ? ' — ' + item.person_name : ''}`;
      await exchangeAudit(db, s.x, recipientActor(s.email), replacing ? 'Exchange document replaced' : 'Exchange document uploaded', label);
      return view(db, s);
    });
  });

  /** Sends every uploaded draft to the requester for review. */
  app.post('/api/x/submit', rl(20), async (req) => {
    const b = z.object({ message: z.string().trim().max(2000).default('') }).parse(req.body ?? {});
    return withTx(async (db) => {
      const s = await session(req, db, true);
      if (s.x.direction !== 'request') throw notFound();
      const drafts = await many<{ id: string; item_id: string; file_id: string; version: number; document_type: string }>(
        db,
        `select u.id, u.item_id, u.file_id, u.version, i.document_type from exchange_submissions u join exchange_items i on i.id = u.item_id
          where i.exchange_id = $1 and u.submitted_at is null and i.status in ('requested', 'rejected')`,
        [s.x.id],
      );
      if (!drafts.length) throw badRequest('Upload at least one document before submitting.');
      for (const d of drafts) {
        await db.query('update exchange_submissions set submitted_at = now(), note = $2 where id = $1', [d.id, b.message]);
        await db.query(`update exchange_items set status = 'submitted', file_id = $2, reviewed_at = null, reviewed_by_name = '' where id = $1`, [d.item_id, d.file_id]);
      }
      const resubmission = drafts.some((d) => d.version > 1) || !!s.x.submitted_at;
      await db.query('update exchanges set submitted_at = now(), recipient_response = case when $2 <> \'\' then $2 else recipient_response end where id = $1', [s.x.id, b.message]);
      await refreshRequestStatus(db, s.x.id);
      const what = `${drafts.length} document${drafts.length === 1 ? '' : 's'}`;
      await exchangeAudit(db, s.x, recipientActor(s.email), resubmission ? 'Exchange resubmitted' : 'Exchange submitted', what);
      const who = s.x.recipient_org_name || s.x.recipient_name || s.email;
      await notifySender(db, s.x, `${who} ${resubmission ? 'resubmitted' : 'submitted'} ${what} (${refLabel(s.x.ref)})`, b.message);
      const creator = s.x.created_by ? await one<{ email: string }>(db, 'select email from users where id = $1', [s.x.created_by]) : null;
      if (creator) {
        await queueEmail(db, {
          orgId: s.x.sender_org_id, to: creator.email,
          subject: `${who} ${resubmission ? 'resubmitted' : 'submitted'} documents (${refLabel(s.x.ref)})`,
          lines: [`${who} ${resubmission ? 'resubmitted' : 'submitted'} ${what} for ${refLabel(s.x.ref)}.`, ...(b.message ? [`Their message: “${b.message}”`] : []), 'Open Exchanges in COMVERA to review them.'],
        });
      }
      await track(db, s.x.sender_org_id, 'exchange_submitted');
      await publishChange(db, [s.x.sender_org_id]);
      return view(db, s);
    });
  });

  /** Opens (or downloads, when the sender allows it) one shared document. */
  app.get('/api/x/items/:id/file', async (req, reply) => {
    const itemId = (req.params as { id: string }).id;
    const s = await session(req);
    if (s.x.direction !== 'share' || !isUuid(itemId)) throw notFound();
    const download = (req.query as { download?: string }).download === '1';
    if (download && !s.x.allow_download) throw forbidden('The sender allows viewing only.');
    const file = await one<any>(
      pool, `select f.* from exchange_items i join files f on f.id = i.file_id where i.id = $1 and i.exchange_id = $2 and i.status = 'shared'`, [itemId, s.x.id]);
    if (!file) throw notFound();
    await withTx(async (db) => {
      await exchangeAudit(db, s.x, recipientActor(s.email), download ? 'Exchange document downloaded' : 'Exchange document viewed', file.filename);
      if (download) {
        await db.query('update exchange_items set downloaded_at = coalesce(downloaded_at, now()) where id = $1', [itemId]);
        await db.query(`update exchanges set status = 'downloaded' where id = $1`, [s.x.id]);
      }
      await publishChange(db, [s.x.sender_org_id]);
    });
    return sendFile(reply, file, download);
  });

  /** Product news by email: only ever with an explicit yes, and a no is recorded too. */
  app.post('/api/x/consent', async (req) => {
    const b = z.object({ consented: z.boolean() }).parse(req.body);
    const s = await session(req, pool, true);
    await pool.query(
      `insert into marketing_consents (email, consented, source, updated_at) values ($1, $2, 'exchange', now())
       on conflict (email) do update set consented = excluded.consented, source = excluded.source, updated_at = now()`,
      [s.email, b.consented],
    );
    return { ok: true };
  });

  app.post('/api/x/signout', async (req, reply) => {
    const raw = req.cookies[EXCHANGE_COOKIE];
    if (raw && raw.length <= 100) await pool.query('delete from exchange_sessions where token_hash = $1', [sha256(raw)]);
    reply.clearCookie(EXCHANGE_COOKIE, { path: COOKIE_PATH });
    return { ok: true };
  });

  // The portal page itself. The token stays in the address bar only; the page never sends a referrer.
  app.get('/x/:token', async (_req, reply) => {
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').header('x-robots-tag', 'noindex, nofollow');
    return reply.sendFile('exchange.html', { cacheControl: false });
  });
}
