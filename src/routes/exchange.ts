/**
 * COMVERA Exchange, workspace side: request documents from someone without an account, share
 * your own documents with someone outside COMVERA, review what comes back, revoke access, keep
 * track of contacts, and (after signing up) claim exchanges sent to your verified email address.
 *
 * Everything here is scoped to the caller's organisation: an exchange is visible to the
 * organisation that sent it, and read-only to a workspace that explicitly claimed it.
 * Anything else is a 404.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/pool.js';
import { many, one, pool, withTx } from '../db/pool.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/errors.js';
import { canAdminOrg, isUuid, loadSite, requireOrg, requireWritable, type OrgCtx } from '../lib/authz.js';
import { audit } from '../lib/audit.js';
import { publishChange } from '../lib/realtime.js';
import { newToken, sha256 } from '../lib/security.js';
import { queueEmail } from '../lib/email.js';
import { track } from '../lib/events.js';
import { LIBRARY_TYPES } from '../lib/readiness.js';
import {
  accessState, exchangeAudit, refLabel, refreshRequestStatus, sendExchangeEmail, type ExchangeRow,
} from '../lib/exchange.js';
import { sendFile } from './files.js';
import { rl } from './auth.js';

const SENDER_ROLES = ['owner', 'admin', 'reviewer'];
function requireSender(ctx: OrgCtx) {
  if (!SENDER_ROLES.includes(ctx.role)) throw forbidden('Only owners, admins and reviewers can send or review exchanges.');
}
const staff = (ctx: OrgCtx) => ({ id: ctx.user.id, name: ctx.user.name, role: ctx.role === 'reviewer' ? 'Reviewer' : ctx.role === 'member' ? 'Staff' : 'Admin' });
const libraryName = (id: string) => LIBRARY_TYPES.find((t) => t.id === id)?.name ?? id;
const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null);
const day = 86_400_000;

const recipientSchema = {
  company: z.string().trim().max(200).default(''),
  contactName: z.string().trim().max(200).default(''),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().max(40).default(''),
  role: z.string().trim().max(100).default(''),
};
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31.');
const requestItem = z.object({
  documentType: z.string().trim().min(1).max(200),
  personName: z.string().trim().max(200).default(''),
  workerId: z.string().uuid().optional(),
  note: z.string().trim().max(500).default(''),
});

/** Company names that differ only by "(Pty) Ltd", punctuation or case count as the same. */
export function sameCompany(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\b(pty|ltd|limited|cc|inc|proprietary|co|company|\(pty\))\b/g, '').replace(/[^a-z0-9]/g, '');
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

async function upsertRelationship(db: Db, ctx: OrgCtx, r: { name: string; contractorId?: string | null; kind: string }): Promise<string> {
  if (r.contractorId) {
    return (await one<{ id: string }>(
      db,
      `insert into relationships (org_id, counterparty_name, counterparty_kind, contractor_id) values ($1, $2, 'contractor', $3)
       on conflict (contractor_id) do update set last_interaction_at = now(), counterparty_name = excluded.counterparty_name returning id`,
      [ctx.org.id, r.name, r.contractorId],
    ))!.id;
  }
  const found = await one<{ id: string }>(
    db, `select id from relationships where org_id = $1 and contractor_id is null and lower(counterparty_name) = lower($2) limit 1`, [ctx.org.id, r.name]);
  if (found) {
    await db.query('update relationships set last_interaction_at = now() where id = $1', [found.id]);
    return found.id;
  }
  return (await one<{ id: string }>(
    db, `insert into relationships (org_id, counterparty_name, counterparty_kind) values ($1, $2, $3) returning id`, [ctx.org.id, r.name, r.kind]))!.id;
}

async function upsertContact(db: Db, ctx: OrgCtx, relationshipId: string, c: { name: string; email: string; phone: string; role: string }): Promise<string> {
  return (await one<{ id: string }>(
    db,
    `insert into contacts (org_id, relationship_id, name, email, phone, role, last_used_at) values ($1, $2, $3, $4, $5, $6, now())
     on conflict (relationship_id, email) do update set
       name = coalesce(nullif(excluded.name, ''), contacts.name), phone = coalesce(nullif(excluded.phone, ''), contacts.phone),
       role = coalesce(nullif(excluded.role, ''), contacts.role), last_used_at = now()
     returning id`,
    [ctx.org.id, relationshipId, c.name, c.email, c.phone, c.role],
  ))!.id;
}

interface NewItem { documentType: string; personName: string; workerId?: string | null; note?: string; fileId?: string | null }

/** Creates one exchange with a fresh link, emails it and records it. Returns the new row. */
async function createExchange(
  db: Db,
  ctx: OrgCtx,
  e: {
    direction: 'request' | 'share'; relationshipId: string; contactId: string; recipient: { name: string; email: string; company: string };
    siteId: string | null; message: string; deadline: string | null; allowDownload: boolean; accessExpiresAt: Date; items: NewItem[];
  },
): Promise<ExchangeRow> {
  const token = newToken();
  const x = (await one<ExchangeRow>(
    db,
    `insert into exchanges (direction, sender_org_id, relationship_id, contact_id, recipient_name, recipient_email, recipient_org_name, site_id,
                            message, deadline, allow_download, status, link_token_hash, access_expires_at, created_by, created_by_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning *, to_char(deadline, 'YYYY-MM-DD') as deadline`,
    [e.direction, ctx.org.id, e.relationshipId, e.contactId, e.recipient.name, e.recipient.email, e.recipient.company, e.siteId,
      e.message, e.deadline, e.allowDownload, e.direction === 'request' ? 'requested' : 'shared', sha256(token), e.accessExpiresAt, ctx.user.id, ctx.user.name],
  ))!;
  for (const [i, it] of e.items.entries()) {
    await db.query(
      `insert into exchange_items (exchange_id, position, document_type, person_name, worker_id, note, status, file_id) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [x.id, i, it.documentType, it.personName, it.workerId ?? null, it.note ?? '', e.direction === 'request' ? 'requested' : 'shared', it.fileId ?? null],
    );
  }
  const what = `${e.items.length} document${e.items.length === 1 ? '' : 's'} — ${e.recipient.email}`;
  await exchangeAudit(db, x, staff(ctx), e.direction === 'request' ? 'Exchange request created' : 'Secure share created', what);
  await sendExchangeEmail(db, x, ctx.org.name, token);
  await exchangeAudit(db, x, staff(ctx), 'Exchange email sent', e.recipient.email);
  await track(db, ctx.org.id, e.direction === 'request' ? 'exchange_request_sent' : 'exchange_share_sent');
  return x;
}

/** A request's link stays usable for 30 days after its deadline (or 44 days without one). */
const requestExpiry = (deadline: string | null) =>
  new Date(Math.min((deadline ? new Date(deadline).getTime() : Date.now() + 14 * day) + 30 * day, Date.now() + 180 * day));

async function contractorFor(db: Db, ctx: OrgCtx, contractorId: string) {
  if (!isUuid(contractorId)) throw notFound();
  const c = await one<{ id: string; name: string; contact_name: string; contact_email: string | null }>(
    db, 'select id, name, contact_name, contact_email from contractors where id = $1 and org_id = $2', [contractorId, ctx.org.id]);
  if (!c) throw notFound();
  return c;
}

/** The contact to use by default for a contractor: the one used last, else the directory entry's. */
async function defaultContact(db: Db, ctx: OrgCtx, contractorId: string) {
  const c = await contractorFor(db, ctx, contractorId);
  const last = await one<{ name: string; email: string; phone: string; role: string }>(
    db,
    `select k.name, k.email, k.phone, k.role from contacts k join relationships r on r.id = k.relationship_id
      where r.contractor_id = $1 and r.org_id = $2 order by k.last_used_at desc nulls last, k.created_at desc limit 1`,
    [c.id, ctx.org.id],
  );
  if (last) return { contractor: c, contact: last };
  return { contractor: c, contact: c.contact_email ? { name: c.contact_name, email: c.contact_email, phone: '', role: '' } : null };
}

async function checkWorker(db: Db, ctx: OrgCtx, workerId: string | undefined) {
  if (!workerId) return;
  const ok = await one(
    db,
    `select 1 from workers w where w.id = $1 and (w.org_id = $2 or exists (
       select 1 from site_workers sw join sites s on s.id = sw.site_id where sw.worker_id = w.id and s.org_id = $2))`,
    [workerId, ctx.org.id],
  );
  if (!ok) throw notFound();
}

function summary(x: any) {
  return {
    id: x.id, ref: refLabel(x.ref), direction: x.direction, status: x.status, access: accessState(x),
    recipientName: x.recipient_name, recipientEmail: x.recipient_email, recipientOrgName: x.recipient_org_name,
    senderOrgName: x.sender_name ?? null, siteName: x.site_name ?? null, relationshipId: x.relationship_id,
    deadline: x.deadline, createdAt: iso(x.created_at), accessExpiresAt: iso(x.access_expires_at), revokedAt: iso(x.revoked_at),
    openedAt: iso(x.opened_at), verifiedAt: iso(x.verified_at), submittedAt: iso(x.submitted_at), completedAt: iso(x.completed_at),
    claimed: !!x.recipient_org_id, createdByName: x.created_by_name, allowDownload: x.allow_download,
    counts: { items: x.n_items ?? 0, submitted: x.n_submitted ?? 0, approved: x.n_approved ?? 0, rejected: x.n_rejected ?? 0, resubmitted: x.n_resubmitted ?? 0 },
  };
}

const SUMMARY_SQL = `
  select x.*, to_char(x.deadline, 'YYYY-MM-DD') as deadline, o.name as sender_name, s.name as site_name,
         (select count(*)::int from exchange_items i where i.exchange_id = x.id) as n_items,
         (select count(*)::int from exchange_items i where i.exchange_id = x.id and i.status = 'submitted') as n_submitted,
         (select count(*)::int from exchange_items i where i.exchange_id = x.id and i.status = 'approved') as n_approved,
         (select count(*)::int from exchange_items i where i.exchange_id = x.id and i.status = 'rejected') as n_rejected,
         (select count(*)::int from exchange_items i where i.exchange_id = x.id and i.status = 'submitted'
             and exists (select 1 from exchange_submissions u where u.item_id = i.id and u.version > 1 and u.submitted_at is not null)) as n_resubmitted
    from exchanges x join organisations o on o.id = x.sender_org_id left join sites s on s.id = x.site_id`;

/** An exchange the caller's organisation sent (full control) or claimed (read-only). */
async function loadExchange(db: Db, ctx: OrgCtx, id: string, opts: { sentOnly?: boolean; lock?: boolean } = {}) {
  if (!isUuid(id)) throw notFound();
  const x = await one<ExchangeRow & { sender_name: string }>(
    db,
    `select x.*, to_char(x.deadline, 'YYYY-MM-DD') as deadline, o.name as sender_name from exchanges x join organisations o on o.id = x.sender_org_id
      where x.id = $1 and (x.sender_org_id = $2 ${opts.sentOnly ? '' : 'or x.recipient_org_id = $2'}) ${opts.lock ? 'for update of x' : ''}`,
    [id, ctx.org.id],
  );
  if (!x) throw notFound();
  return { x, mine: x.sender_org_id === ctx.org.id };
}

export default async function exchangeRoutes(app: FastifyInstance) {
  /** Everything this organisation sent, plus exchanges it claimed as the recipient. */
  app.get('/api/exchanges', async (req) => {
    const ctx = requireOrg(req.ctx);
    const q = z.object({ contractorId: z.string().uuid().optional(), relationshipId: z.string().uuid().optional() }).parse(req.query);
    const sent = await many(
      pool,
      `${SUMMARY_SQL} where x.sender_org_id = $1
         and ($2::uuid is null or x.relationship_id in (select id from relationships where contractor_id = $2 and org_id = $1))
         and ($3::uuid is null or x.relationship_id = $3)
       order by x.created_at desc limit 500`,
      [ctx.org.id, q.contractorId ?? null, q.relationshipId ?? null],
    );
    const received = q.contractorId || q.relationshipId ? [] : await many(pool, `${SUMMARY_SQL} where x.recipient_org_id = $1 order by x.created_at desc limit 500`, [ctx.org.id]);
    return { sent: sent.map(summary), received: received.map(summary) };
  });

  /** Default contacts for a contractor in the directory (for the request form). */
  app.get('/api/exchanges/contacts', async (req) => {
    const ctx = requireOrg(req.ctx);
    const { contractorId } = z.object({ contractorId: z.string() }).parse(req.query);
    const c = await contractorFor(pool, ctx, contractorId);
    const contacts = await many(
      pool,
      `select k.id, k.name, k.email, k.phone, k.role, k.last_used_at from contacts k join relationships r on r.id = k.relationship_id
        where r.contractor_id = $1 and r.org_id = $2 order by k.last_used_at desc nulls last, k.created_at desc`,
      [c.id, ctx.org.id],
    );
    if (c.contact_email && !contacts.some((k) => k.email.toLowerCase() === c.contact_email!.toLowerCase())) {
      contacts.push({ id: null, name: c.contact_name, email: c.contact_email, phone: '', role: 'Directory contact', last_used_at: null });
    }
    return { contractor: { id: c.id, name: c.name }, contacts };
  });

  /** Request documents from a company (usually a contractor in the directory). */
  app.post('/api/exchanges/request', rl(30), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireSender(ctx);
    requireWritable(ctx);
    const b = z.object({
      contractorId: z.string().optional(),
      ...recipientSchema,
      siteId: z.string().optional(),
      deadline: dateString.optional(),
      message: z.string().trim().max(2000).default(''),
      items: z.array(requestItem).min(1, 'Add at least one document.').max(50),
    }).parse(req.body);
    return withTx(async (db) => {
      let company = b.company;
      if (b.contractorId) company = (await contractorFor(db, ctx, b.contractorId)).name;
      if (!company) throw badRequest('Enter the company name.');
      const siteId = b.siteId ? (await loadSite(db, ctx, b.siteId)).site.id : null;
      for (const it of b.items) await checkWorker(db, ctx, it.workerId);
      const relationshipId = await upsertRelationship(db, ctx, { name: company, contractorId: b.contractorId, kind: ctx.org.kind === 'host' ? 'contractor' : 'other' });
      const contactId = await upsertContact(db, ctx, relationshipId, { name: b.contactName, email: b.email, phone: b.phone, role: b.role });
      const x = await createExchange(db, ctx, {
        direction: 'request', relationshipId, contactId, recipient: { name: b.contactName, email: b.email, company },
        siteId, message: b.message, deadline: b.deadline ?? null, allowDownload: true, accessExpiresAt: requestExpiry(b.deadline ?? null), items: b.items,
      });
      await publishChange(db, [ctx.org.id]);
      return { id: x.id, ref: refLabel(x.ref) };
    });
  });

  /** Your own documents that can be shared: current files your organisation holds. */
  app.get('/api/exchanges/documents', async (req) => {
    const ctx = requireOrg(req.ctx);
    const { q } = z.object({ q: z.string().trim().max(100).default('') }).parse(req.query);
    const docs = await many(
      pool,
      `select 'document' as source, d.id, coalesce(r.name, d.library_type) as name, d.library_type, '' as person, s.name as site,
              to_char(d.expiry_date, 'YYYY-MM-DD') as expiry, f.filename
         from documents d join files f on f.id = d.current_file_id
         left join requirements r on r.id = d.requirement_id left join sites s on s.id = r.site_id
        where f.org_id = $1
       union all
       select 'certificate', wc.id, wc.name, null, w.full_name, null, to_char(wc.expires_on, 'YYYY-MM-DD'), f.filename
         from worker_certificates wc join workers w on w.id = wc.worker_id join files f on f.id = wc.file_id
        where w.org_id = $1 and f.org_id = $1
       union all
       select 'studio', g.id, g.title || ' (' || g.doc_number || ' rev ' || g.revision || ')', null, '', null, null, f.filename
         from generated_documents g join files f on f.id = g.pdf_file_id
        where g.org_id = $1 and f.org_id = $1 and g.superseded_at is null`,
      [ctx.org.id],
    );
    const rows = docs.map((d) => ({
      source: d.source, id: d.id, name: d.library_type ? libraryName(d.library_type) : d.name, person: d.person, site: d.site ?? '', expiry: d.expiry, filename: d.filename,
    }));
    const needle = q.toLowerCase();
    return {
      documents: rows
        .filter((r) => !needle || [r.name, r.person, r.site, r.filename].some((v) => String(v ?? '').toLowerCase().includes(needle)))
        .sort((a, b) => a.name.localeCompare(b.name) || a.person.localeCompare(b.person))
        .slice(0, 300),
    };
  });

  /** Share one or more of your own documents with someone outside COMVERA, as one exchange. */
  app.post('/api/exchanges/share', rl(30), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireSender(ctx);
    requireWritable(ctx);
    const b = z.object({
      ...recipientSchema,
      company: z.string().trim().min(1, 'Enter the company you are sharing with.').max(200),
      counterpartyKind: z.enum(['contractor', 'host', 'other']).optional(),
      message: z.string().trim().max(2000).default(''),
      days: z.coerce.number().int().min(1).max(90).default(14),
      allowDownload: z.boolean().default(true),
      documents: z.array(z.object({ source: z.enum(['document', 'certificate', 'studio']), id: z.string().uuid() })).min(1, 'Select at least one document.').max(50),
    }).parse(req.body);
    return withTx(async (db) => {
      const items: NewItem[] = [];
      const seen = new Set<string>();
      for (const d of b.documents) {
        const key = `${d.source}:${d.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // Only a file this organisation owns can be shared; anything else looks like it doesn't exist.
        const row = d.source === 'document'
          ? await one<any>(db, `select coalesce(r.name, d.library_type) as name, d.library_type, '' as person, null::uuid as worker_id, d.current_file_id as file_id
                                  from documents d join files f on f.id = d.current_file_id left join requirements r on r.id = d.requirement_id
                                 where d.id = $1 and f.org_id = $2`, [d.id, ctx.org.id])
          : d.source === 'certificate'
            ? await one<any>(db, `select wc.name, null as library_type, w.full_name as person, w.id as worker_id, wc.file_id
                                    from worker_certificates wc join workers w on w.id = wc.worker_id join files f on f.id = wc.file_id
                                   where wc.id = $1 and w.org_id = $2 and f.org_id = $2`, [d.id, ctx.org.id])
            : await one<any>(db, `select g.title as name, null as library_type, '' as person, null::uuid as worker_id, g.pdf_file_id as file_id
                                    from generated_documents g join files f on f.id = g.pdf_file_id where g.id = $1 and g.org_id = $2 and f.org_id = $2`, [d.id, ctx.org.id]);
        if (!row) throw new HttpError(404, 'not_found', "One of the selected documents isn't available to share. Refresh and try again.");
        items.push({ documentType: row.library_type ? libraryName(row.library_type) : row.name, personName: row.person ?? '', workerId: row.worker_id, fileId: row.file_id });
      }
      const kind = b.counterpartyKind ?? (ctx.org.kind === 'contractor' ? 'host' : 'contractor');
      const relationshipId = await upsertRelationship(db, ctx, { name: b.company, kind });
      const contactId = await upsertContact(db, ctx, relationshipId, { name: b.contactName, email: b.email, phone: b.phone, role: b.role });
      const x = await createExchange(db, ctx, {
        direction: 'share', relationshipId, contactId, recipient: { name: b.contactName, email: b.email, company: b.company },
        siteId: null, message: b.message, deadline: null, allowDownload: b.allowDownload, accessExpiresAt: new Date(Date.now() + b.days * day), items,
      });
      await publishChange(db, [ctx.org.id]);
      return { id: x.id, ref: refLabel(x.ref) };
    });
  });

  /** Mine side: search compliance records across your sites, to request fresh copies in bulk. */
  app.get('/api/exchanges/records', async (req) => {
    const ctx = requireOrg(req.ctx);
    const { q } = z.object({ q: z.string().trim().min(2, 'Type at least two letters to search.').max(100) }).parse(req.query);
    const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    const rows = await many(
      pool,
      `select * from (
         select distinct on (wc.id) 'certificate' as source, wc.id as record_id, wc.name as document_type, w.full_name as person_name, w.id as worker_id,
                c.id as contractor_id, c.name as contractor_name, to_char(wc.expires_on, 'YYYY-MM-DD') as expiry, s.name as site_name
           from worker_certificates wc join workers w on w.id = wc.worker_id join site_workers sw on sw.worker_id = w.id
           join sites s on s.id = sw.site_id join contractors c on c.id = s.contractor_id
          where s.org_id = $1 and (wc.name ilike $2 or w.full_name ilike $2 or c.name ilike $2)
         union all
         select 'requirement', r.id, r.name, '', null, c.id, c.name, to_char(d.expiry_date, 'YYYY-MM-DD'), s.name
           from requirements r join sites s on s.id = r.site_id join contractors c on c.id = s.contractor_id
           left join documents d on d.requirement_id = r.id
          where s.org_id = $1 and (r.name ilike $2 or c.name ilike $2)
         union all
         select distinct on (rel.contractor_id, i.document_type, i.person_name) 'exchange', i.id, i.document_type, i.person_name, i.worker_id,
                rel.contractor_id, c.name, null, null
           from exchange_items i join exchanges x on x.id = i.exchange_id join relationships rel on rel.id = x.relationship_id
           join contractors c on c.id = rel.contractor_id
          where x.sender_org_id = $1 and x.direction = 'request' and (i.document_type ilike $2 or i.person_name ilike $2 or c.name ilike $2)
       ) t order by contractor_name, document_type, person_name limit 300`,
      [ctx.org.id, like],
    );
    const contacts = new Map<string, { name: string; email: string } | null>();
    for (const id of new Set(rows.map((r) => r.contractor_id as string))) {
      contacts.set(id, (await defaultContact(pool, ctx, id)).contact);
    }
    return {
      records: rows.map((r) => ({
        key: `${r.source}:${r.record_id}`, source: r.source, documentType: r.document_type, personName: r.person_name ?? '', workerId: r.worker_id,
        contractorId: r.contractor_id, contractorName: r.contractor_name, expiry: r.expiry, siteName: r.site_name ?? '',
        contactEmail: contacts.get(r.contractor_id)?.email ?? null, contactName: contacts.get(r.contractor_id)?.name ?? '',
      })),
    };
  });

  /**
   * Bulk request: selected records are grouped by company into one exchange each. With
   * dryRun the grouping and any missing contacts come back without sending anything.
   */
  app.post('/api/exchanges/bulk-request', rl(10), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireSender(ctx);
    requireWritable(ctx);
    const b = z.object({
      items: z.array(requestItem.extend({ contractorId: z.string().uuid() })).min(1, 'Select at least one record.').max(200),
      contacts: z.record(z.string(), z.object({ name: z.string().trim().max(200).default(''), email: z.string().trim().toLowerCase().email().max(254) })).default({}),
      siteId: z.string().optional(),
      deadline: dateString.optional(),
      message: z.string().trim().max(2000).default(''),
      dryRun: z.boolean().default(false),
    }).parse(req.body);
    const groups = new Map<string, z.infer<typeof requestItem>[]>();
    for (const it of b.items) {
      const list = groups.get(it.contractorId) ?? [];
      if (!list.some((x) => x.documentType.toLowerCase() === it.documentType.toLowerCase() && x.personName.toLowerCase() === it.personName.toLowerCase())) list.push(it);
      groups.set(it.contractorId, list);
    }
    const plan: { contractorId: string; contractorName: string; contactName: string; contactEmail: string | null; count: number }[] = [];
    const problems: { contractorId: string; contractorName: string; problem: string }[] = [];
    for (const [contractorId, list] of groups) {
      const { contractor, contact } = await defaultContact(pool, ctx, contractorId);
      const chosen = b.contacts[contractorId] ?? contact;
      plan.push({ contractorId, contractorName: contractor.name, contactName: chosen?.name ?? '', contactEmail: chosen?.email ?? null, count: list.length });
      if (!chosen?.email) problems.push({ contractorId, contractorName: contractor.name, problem: 'No contact email yet — enter one to include this company.' });
    }
    if (b.dryRun) return { groups: plan, problems, created: [] };
    if (problems.length) throw badRequest(`Add a contact email for ${problems.map((p) => p.contractorName).join(', ')} first.`, 'missing_contacts');
    return withTx(async (db) => {
      const siteId = b.siteId ? (await loadSite(db, ctx, b.siteId)).site.id : null;
      const created: { id: string; ref: string; contractorName: string; count: number }[] = [];
      for (const g of plan) {
        const list = groups.get(g.contractorId)!;
        for (const it of list) await checkWorker(db, ctx, it.workerId);
        const relationshipId = await upsertRelationship(db, ctx, { name: g.contractorName, contractorId: g.contractorId, kind: 'contractor' });
        const contactId = await upsertContact(db, ctx, relationshipId, { name: g.contactName, email: g.contactEmail!, phone: '', role: '' });
        const x = await createExchange(db, ctx, {
          direction: 'request', relationshipId, contactId, recipient: { name: g.contactName, email: g.contactEmail!, company: g.contractorName },
          siteId, message: b.message, deadline: b.deadline ?? null, allowDownload: true, accessExpiresAt: requestExpiry(b.deadline ?? null), items: list,
        });
        created.push({ id: x.id, ref: refLabel(x.ref), contractorName: g.contractorName, count: list.length });
      }
      await audit(db, ctx, 'Bulk document request', `${created.length} exchange${created.length === 1 ? '' : 's'}, ${b.items.length} document${b.items.length === 1 ? '' : 's'}`, siteId);
      await publishChange(db, [ctx.org.id]);
      return { groups: plan, problems: [], created };
    });
  });

  /** Exchanges sent to the caller's verified email that a workspace hasn't claimed yet. */
  app.get('/api/exchanges/claimable', async (req) => {
    const ctx = requireOrg(req.ctx);
    if (!ctx.user.email_verified_at) return { verified: false, canClaim: canAdminOrg(ctx), exchanges: [] };
    const rows = await many(
      pool,
      `${SUMMARY_SQL} where x.recipient_email = $1 and x.recipient_org_id is null and x.sender_org_id <> $2 order by x.created_at desc limit 200`,
      [ctx.user.email, ctx.org.id],
    );
    return {
      verified: true,
      canClaim: canAdminOrg(ctx),
      exchanges: rows.map((x) => ({ ...summary(x), sameCompany: sameCompany(x.recipient_org_name || '', ctx.org.name) })),
    };
  });

  /**
   * Links past exchanges to this workspace. Needs a verified email that the exchanges were sent
   * to, an owner/admin, an explicit confirmation, and a second one when the company name the
   * sender typed doesn't match this workspace. Nothing is merged: the sender's records,
   * contacts and relationships are untouched.
   */
  app.post('/api/exchanges/claim', rl(10), async (req) => {
    const ctx = requireOrg(req.ctx);
    if (!canAdminOrg(ctx)) throw forbidden('Only organisation owners and admins can link past exchanges to this workspace.');
    if (!ctx.user.email_verified_at) throw forbidden('Confirm your email address first — we only link exchanges sent to a verified address.');
    const b = z.object({
      ids: z.array(z.string().uuid()).min(1).max(200),
      confirm: z.literal(true, { message: 'Confirm that these exchanges belong to your organisation.' }),
      confirmDifferentCompany: z.boolean().default(false),
    }).parse(req.body);
    return withTx(async (db) => {
      const rows = await many<ExchangeRow>(
        db,
        `select * from exchanges where id = any($1) and recipient_email = $2 and recipient_org_id is null and sender_org_id <> $3 for update`,
        [[...new Set(b.ids)], ctx.user.email, ctx.org.id],
      );
      if (rows.length !== new Set(b.ids).size) throw notFound();
      const mismatched = rows.filter((x) => !sameCompany(x.recipient_org_name || '', ctx.org.name));
      if (mismatched.length && !b.confirmDifferentCompany) {
        throw new HttpError(409, 'confirm_company',
          `${mismatched.length === 1 ? 'One exchange was' : `${mismatched.length} exchanges were`} addressed to a different company name (${[...new Set(mismatched.map((x) => x.recipient_org_name || 'no company given'))].join(', ')}). Confirm they belong to ${ctx.org.name}.`);
      }
      for (const x of rows) {
        await db.query('update exchanges set recipient_org_id = $2, claimed_at = now() where id = $1', [x.id, ctx.org.id]);
        await exchangeAudit(db, x, { name: ctx.user.email, role: 'Exchange recipient' }, 'Exchange linked to recipient workspace', ctx.org.name);
      }
      await audit(db, ctx, 'Claimed exchange history', `${rows.length} exchange${rows.length === 1 ? '' : 's'}: ${rows.map((x) => refLabel(x.ref)).join(', ')}`);
      await track(db, ctx.org.id, 'exchange_claimed');
      await publishChange(db, [ctx.org.id]);
      return { claimed: rows.length };
    });
  });

  app.get('/api/exchanges/:id', async (req) => {
    const ctx = requireOrg(req.ctx);
    const { x, mine } = await loadExchange(pool, ctx, (req.params as { id: string }).id);
    const row = (await one(pool, `${SUMMARY_SQL} where x.id = $1`, [x.id]))!;
    const items = await many(pool, `select i.*, f.filename from exchange_items i left join files f on f.id = i.file_id where i.exchange_id = $1 order by i.position`, [x.id]);
    const subs = mine
      ? await many(pool, `select u.item_id, u.version, u.file_id, u.note, u.submitted_at, f.filename, f.size_bytes from exchange_submissions u
                            join files f on f.id = u.file_id join exchange_items i on i.id = u.item_id
                           where i.exchange_id = $1 and u.submitted_at is not null order by u.version desc`, [x.id])
      : [];
    const history = mine
      ? await many(pool, `select created_at as at, actor_name, actor_role, action, detail from audit_events where org_id = $1 and (detail = $2 or detail like $3) order by id desc limit 200`,
        [ctx.org.id, refLabel(x.ref), `${refLabel(x.ref)} — %`])
      : [];
    const contact = mine && x.contact_id ? await one(pool, 'select name, email, phone, role from contacts where id = $1', [x.contact_id]) : null;
    return {
      exchange: { ...summary(row), message: x.message, recipientResponse: x.recipient_response, mine, contact },
      items: items.map((i) => ({
        id: i.id, documentType: i.document_type, personName: i.person_name, note: i.note, status: i.status,
        reviewNote: i.review_note, reviewedByName: i.reviewed_by_name, reviewedAt: iso(i.reviewed_at), downloadedAt: iso(i.downloaded_at),
        // The sender sees its own file; a claiming recipient only sees shared files, and only while access lasts.
        fileId: mine ? i.file_id : null, filename: mine || i.status === 'shared' ? i.filename : null,
        submissions: subs.filter((s) => s.item_id === i.id).map((s) => ({ version: s.version, fileId: s.file_id, filename: s.filename, size: Number(s.size_bytes), note: s.note, submittedAt: iso(s.submitted_at) })),
      })),
      history: history.map((h) => ({ at: iso(h.at), actor: h.actor_name, role: h.actor_role, action: h.action, detail: h.detail })),
    };
  });

  /** Accept or send back submitted documents. Rejections email the recipient a fresh link once. */
  app.post('/api/exchanges/:id/review', rl(60), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireSender(ctx);
    requireWritable(ctx);
    const b = z.object({
      decisions: z.array(z.object({ itemId: z.string().uuid(), decision: z.enum(['approve', 'reject']), note: z.string().trim().max(1000).default('') })).min(1).max(50),
    }).parse(req.body);
    return withTx(async (db) => {
      const { x } = await loadExchange(db, ctx, (req.params as { id: string }).id, { sentOnly: true, lock: true });
      if (x.direction !== 'request') throw badRequest('Only requested documents are reviewed.');
      const rejected: { name: string; note: string }[] = [];
      for (const d of b.decisions) {
        const item = await one<any>(db, 'select * from exchange_items where id = $1 and exchange_id = $2', [d.itemId, x.id]);
        if (!item) throw notFound();
        if (item.status !== 'submitted') throw conflict(`“${item.document_type}” isn't waiting for review.`);
        if (d.decision === 'reject' && d.note.length < 3) throw badRequest(`Tell ${x.recipient_name || 'the recipient'} what to fix in “${item.document_type}”.`);
        await db.query(
          `update exchange_items set status = $2, review_note = $3, reviewed_by_name = $4, reviewed_at = now() where id = $1`,
          [item.id, d.decision === 'approve' ? 'approved' : 'rejected', d.note, ctx.user.name],
        );
        const label = `${item.document_type}${item.person_name ? ' — ' + item.person_name : ''}`;
        await exchangeAudit(db, x, staff(ctx), d.decision === 'approve' ? 'Exchange document approved' : 'Exchange document rejected', d.note ? `${label}: ${d.note}` : label);
        if (d.decision === 'reject') rejected.push({ name: label, note: d.note });
      }
      const status = await refreshRequestStatus(db, x.id);
      if (rejected.length && !x.revoked_at) {
        // Give the recipient time to replace them, with a new link (the old one stops working).
        const token = newToken();
        const updated = (await one<ExchangeRow>(
          db,
          `update exchanges set link_token_hash = $2, access_expires_at = greatest(access_expires_at, now() + interval '14 days') where id = $1
           returning *, to_char(deadline, 'YYYY-MM-DD') as deadline`,
          [x.id, sha256(token)],
        ))!;
        await sendExchangeEmail(db, updated, ctx.org.name, token, {
          reminder: `${ctx.org.name} reviewed what you sent. ${rejected.length === 1 ? 'One document needs' : `${rejected.length} documents need`} replacing:`,
          extra: rejected.map((r) => `↺ ${r.name} — ${r.note}`),
        });
        await exchangeAudit(db, x, staff(ctx), 'Exchange email sent', `${x.recipient_email} (replacements requested)`);
      }
      if (status === 'approved' && x.status !== 'approved') {
        await exchangeAudit(db, x, staff(ctx), 'Exchange completed');
        await track(db, ctx.org.id, 'exchange_completed');
        await queueEmail(db, {
          orgId: x.sender_org_id, to: x.recipient_email, subject: `${ctx.org.name} accepted your documents (${refLabel(x.ref)})`,
          lines: [`Hi ${x.recipient_name || 'there'},`, `${ctx.org.name} has accepted everything you sent for ${refLabel(x.ref)}. Nothing more is needed.`],
          footer: 'Sent by COMVERA on behalf of the organisation that requested these documents.',
        });
      }
      await publishChange(db, [ctx.org.id]);
      return { status };
    });
  });

  /** Ends access immediately. The record, the files and the history stay. */
  app.post('/api/exchanges/:id/revoke', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireSender(ctx);
    return withTx(async (db) => {
      const { x } = await loadExchange(db, ctx, (req.params as { id: string }).id, { sentOnly: true, lock: true });
      if (x.revoked_at) return { ok: true };
      await db.query('update exchanges set revoked_at = now() where id = $1', [x.id]);
      await db.query('delete from exchange_sessions where exchange_id = $1', [x.id]);
      await exchangeAudit(db, x, staff(ctx), x.direction === 'share' ? 'Share revoked' : 'Request cancelled', x.recipient_email);
      await publishChange(db, [ctx.org.id]);
      return { ok: true };
    });
  });

  /** Sends a new link (the previous one stops working), extending access if it had run out. */
  app.post('/api/exchanges/:id/resend', rl(10), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireSender(ctx);
    requireWritable(ctx);
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(90).optional() }).parse(req.body ?? {});
    return withTx(async (db) => {
      const { x } = await loadExchange(db, ctx, (req.params as { id: string }).id, { sentOnly: true, lock: true });
      if (x.revoked_at) throw conflict('This exchange was revoked. Start a new one instead.');
      if (x.direction === 'request' && x.status === 'approved') throw conflict('Everything in this request has been accepted already.');
      const until = x.direction === 'share'
        ? new Date(Date.now() + (days ?? 14) * day)
        : new Date(Math.max(new Date(x.access_expires_at).getTime(), Date.now() + (days ?? 30) * day));
      const token = newToken();
      const updated = (await one<ExchangeRow>(
        db, `update exchanges set link_token_hash = $2, access_expires_at = $3 where id = $1 returning *, to_char(deadline, 'YYYY-MM-DD') as deadline`,
        [x.id, sha256(token), until],
      ))!;
      await sendExchangeEmail(db, updated, ctx.org.name, token, { reminder: 'A reminder: this is still open.' });
      await exchangeAudit(db, x, staff(ctx), 'Exchange email sent', `${x.recipient_email} (reminder)`);
      await publishChange(db, [ctx.org.id]);
      return { ok: true, accessExpiresAt: until.toISOString() };
    });
  });

  /** A claimed share, opened from the recipient's own workspace while access lasts. */
  app.get('/api/exchanges/:id/items/:itemId/file', async (req, reply) => {
    const ctx = requireOrg(req.ctx);
    const p = req.params as { id: string; itemId: string };
    const { x, mine } = await loadExchange(pool, ctx, p.id);
    if (mine || x.direction !== 'share' || !isUuid(p.itemId)) throw notFound();
    if (accessState(x) !== 'active') throw new HttpError(410, 'gone', 'Access to this share has ended.');
    const download = (req.query as { download?: string }).download === '1';
    if (download && !x.allow_download) throw forbidden('The sender allows viewing only.');
    const file = await one<any>(
      pool, `select f.* from exchange_items i join files f on f.id = i.file_id where i.id = $1 and i.exchange_id = $2 and i.status = 'shared'`, [p.itemId, x.id]);
    if (!file) throw notFound();
    await withTx(async (db) => {
      await exchangeAudit(db, x, { name: `${ctx.user.name} (${ctx.org.name})`, role: 'Exchange recipient' }, download ? 'Exchange document downloaded' : 'Exchange document viewed', file.filename);
      if (download) {
        await db.query('update exchange_items set downloaded_at = coalesce(downloaded_at, now()) where id = $1', [p.itemId]);
        await db.query(`update exchanges set status = 'downloaded' where id = $1`, [x.id]);
      }
      await publishChange(db, [x.sender_org_id]);
    });
    return sendFile(reply, file, download);
  });

  /** The organisation's relationships: who it deals with, contacts, exchange counts, conversion. */
  app.get('/api/relationships', async (req) => {
    const ctx = requireOrg(req.ctx);
    const rows = await many(
      pool,
      `select r.*, c.linked_org_id,
              (select count(*)::int from contacts k where k.relationship_id = r.id) as n_contacts,
              (select count(*)::int from exchanges x where x.relationship_id = r.id) as n_exchanges,
              (select count(*)::int from exchanges x where x.relationship_id = r.id and x.revoked_at is null and x.access_expires_at > now()
                  and x.status not in ('approved')) as n_open,
              exists (select 1 from exchanges x where x.relationship_id = r.id and x.recipient_org_id is not null) as claimed
         from relationships r left join contractors c on c.id = r.contractor_id
        where r.org_id = $1 order by r.last_interaction_at desc limit 1000`,
      [ctx.org.id],
    );
    return {
      relationships: rows.map((r) => ({
        id: r.id, name: r.counterparty_name, kind: r.counterparty_kind, contractorId: r.contractor_id, lastInteractionAt: iso(r.last_interaction_at),
        contacts: r.n_contacts, exchanges: r.n_exchanges, open: r.n_open,
        conversion: r.counterparty_org_id || r.linked_org_id || r.claimed ? 'workspace' : 'exchange_only',
      })),
    };
  });

  app.get('/api/relationships/:id', async (req) => {
    const ctx = requireOrg(req.ctx);
    const id = (req.params as { id: string }).id;
    if (!isUuid(id)) throw notFound();
    const r = await one(pool, 'select * from relationships where id = $1 and org_id = $2', [id, ctx.org.id]);
    if (!r) throw notFound();
    const contacts = await many(pool, 'select id, name, email, phone, role, created_at, last_used_at from contacts where relationship_id = $1 order by last_used_at desc nulls last, created_at', [id]);
    const exchanges = await many(pool, `${SUMMARY_SQL} where x.relationship_id = $1 and x.sender_org_id = $2 order by x.created_at desc`, [id, ctx.org.id]);
    return {
      relationship: { id: r.id, name: r.counterparty_name, kind: r.counterparty_kind, contractorId: r.contractor_id, lastInteractionAt: iso(r.last_interaction_at), createdAt: iso(r.created_at) },
      contacts: contacts.map((k) => ({ id: k.id, name: k.name, email: k.email, phone: k.phone, role: k.role, lastUsedAt: iso(k.last_used_at) })),
      exchanges: exchanges.map(summary),
    };
  });

  app.post('/api/relationships/:id/contacts', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireSender(ctx);
    requireWritable(ctx);
    const id = (req.params as { id: string }).id;
    if (!isUuid(id)) throw notFound();
    const b = z.object({ name: z.string().trim().max(200).default(''), email: recipientSchema.email, phone: recipientSchema.phone, role: recipientSchema.role }).parse(req.body);
    return withTx(async (db) => {
      const r = await one<{ id: string; counterparty_name: string }>(db, 'select id, counterparty_name from relationships where id = $1 and org_id = $2', [id, ctx.org.id]);
      if (!r) throw notFound();
      const k = await one(db,
        `insert into contacts (org_id, relationship_id, name, email, phone, role) values ($1, $2, $3, $4, $5, $6)
         on conflict (relationship_id, email) do update set name = excluded.name, phone = excluded.phone, role = excluded.role returning id`,
        [ctx.org.id, r.id, b.name, b.email, b.phone, b.role]);
      await audit(db, ctx, 'Saved contact', `${r.counterparty_name} — ${b.email}`);
      await publishChange(db, [ctx.org.id]);
      return { id: k.id };
    });
  });

  app.delete('/api/relationships/:id/contacts/:contactId', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireSender(ctx);
    const p = req.params as { id: string; contactId: string };
    if (!isUuid(p.id) || !isUuid(p.contactId)) throw notFound();
    return withTx(async (db) => {
      const k = await one<{ email: string }>(db, 'delete from contacts where id = $1 and relationship_id = $2 and org_id = $3 returning email', [p.contactId, p.id, ctx.org.id]);
      if (!k) throw notFound();
      await audit(db, ctx, 'Removed contact', k.email);
      await publishChange(db, [ctx.org.id]);
      return { ok: true };
    });
  });
}
