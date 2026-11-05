/**
 * Document Studio uploads: every organisation's own documents (policies, procedures, templates, certificates,
 * registration, insurance, personnel and equipment records), with versions.
 *
 * Who sees what:
 *  - internal: everyone in the organisation;
 *  - restricted: only its owners and admins (for example medical or personal records);
 *  - contractors: also contractors with a live safety file at one of its sites (that site, or every site when
 *    no site is set). Nothing else is ever visible to another organisation.
 * An upload is "received", never "approved": approval stays in the site review workflows.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { many, one, pool, withTx, type Db } from '../db/pool.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { canAdminOrg, isUuid, requireOrg, requireWritable, type OrgCtx } from '../lib/authz.js';
import { audit } from '../lib/audit.js';
import { publishChange } from '../lib/realtime.js';
import { track } from '../lib/events.js';
import { storeFile } from './documents.js';
import { sendFile } from './files.js';
import { rl } from './auth.js';

const TYPES = ['policy', 'procedure', 'template', 'certificate', 'report', 'induction', 'emergency', 'risk_assessment', 'method_statement',
  'registration', 'insurance', 'training', 'equipment', 'other'] as const;
const t = (n: number) => z.string().trim().max(n);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).nullable().default(null).transform((v) => v || null);
const meta = z.object({
  name: t(200).min(1, 'Give the document a name.'),
  description: t(1000).default(''),
  docType: z.enum(TYPES).default('other'),
  scope: z.enum(['company', 'site', 'project', 'personnel', 'equipment']).default('company'),
  workplaceId: z.string().uuid().nullable().default(null),
  areaId: z.string().uuid().nullable().default(null),
  siteId: z.string().uuid().nullable().default(null),
  subject: t(200).default(''),
  requirement: z.enum(['mandatory', 'recommended', 'informational']).default('informational'),
  visibility: z.enum(['internal', 'restricted', 'contractors']).default('internal'),
  issueDate: date, expiryDate: date,
  ownerName: t(120).default(''),
});
type Meta = z.infer<typeof meta>;

type DocRow = { id: string; org_id: string; visibility: string; workplace_id: string | null; current_file_id: string | null; name: string; created_by: string | null };

/** The documents a contractor may read from the sites it works on. */
const SHARED_WITH = `exists (select 1 from sites s join contractors c on c.id = s.contractor_id
                             where c.linked_org_id = $1 and s.org_id = d.org_id and s.status in ('in_progress', 'site_ready')
                               and ((d.workplace_id is null and d.scope = 'company') or s.workplace_id = d.workplace_id))`;

async function canRead(db: Db, ctx: OrgCtx, d: DocRow): Promise<boolean> {
  if (d.org_id === ctx.org.id) return d.visibility !== 'restricted' || canAdminOrg(ctx);
  if (d.visibility !== 'contractors') return false;
  return !!(await one(db, `select 1 from org_documents d where d.id = $2 and d.archived_at is null and ${SHARED_WITH}`, [ctx.org.id, d.id]));
}

async function own(db: Db, ctx: OrgCtx, id: string, lock = false): Promise<DocRow> {
  if (!isUuid(id)) throw notFound();
  const d = await one<DocRow>(db, `select id, org_id, visibility, workplace_id, current_file_id, name, created_by from org_documents where id = $1 and org_id = $2 ${lock ? 'for update' : ''}`, [id, ctx.org.id]);
  if (!d || (d.visibility === 'restricted' && !canAdminOrg(ctx))) throw notFound();
  return d;
}

/** The links must point inside this organisation. */
/** On a mine's side, Site Staff read only (as everywhere else); owners, admins and reviewers manage documents. */
function requireDocWriter(ctx: OrgCtx) {
  if (ctx.org.kind === 'host' && ctx.role === 'member') throw forbidden('Site Staff can read documents but not change them. Ask an admin or reviewer.');
}

async function checkLinks(db: Db, ctx: OrgCtx, m: Meta) {
  if (m.visibility === 'contractors' && m.scope !== 'company' && !m.workplaceId) throw badRequest('Choose the site whose contractors may see it, or make it company-wide.');
  if (m.visibility === 'restricted' && !canAdminOrg(ctx)) throw forbidden('Only an owner or admin can restrict a document.');
  if (m.visibility === 'contractors' && ctx.org.kind !== 'host') throw badRequest('Only a site can share documents with its contractors.');
  if (m.workplaceId && !(await one(db, `select 1 from workplaces where id = $1 and org_id = $2`, [m.workplaceId, ctx.org.id]))) throw notFound();
  if (m.areaId && !(await one(db, `select 1 from site_areas where id = $1 and org_id = $2 and ($3::uuid is null or workplace_id = $3)`, [m.areaId, ctx.org.id, m.workplaceId]))) throw notFound();
  if (m.siteId && !(await one(db, `select 1 from sites s left join contractors c on c.id = s.contractor_id left join organisations p on p.id = s.org_id
                                     where s.id = $1 and (s.org_id = $2 or c.linked_org_id = $2 or p.managed_by_org = $2)`, [m.siteId, ctx.org.id]))) throw notFound();
}

async function readUpload(req: FastifyRequest) {
  const file = await req.file();
  if (!file) throw badRequest('Attach a file.');
  const buf = await file.toBuffer();
  if (!buf.length) throw badRequest('That file is empty.');
  const raw = (file.fields as Record<string, { value?: string } | undefined>).meta?.value;
  let parsed: unknown = {};
  if (raw) { try { parsed = JSON.parse(raw); } catch { throw badRequest('The document details could not be read.'); } }
  return { file, buf, parsed };
}

const LIST = `select d.id, d.name, d.description, d.doc_type as "docType", d.scope, d.workplace_id as "workplaceId", w.name as "workplaceName",
                     d.area_id as "areaId", a.name as "areaName", d.site_id as "siteId", d.subject, d.requirement, d.visibility,
                     to_char(d.issue_date, 'YYYY-MM-DD') as "issueDate", to_char(d.expiry_date, 'YYYY-MM-DD') as "expiryDate", d.owner_name as "ownerName",
                     d.version, d.archived_at as "archivedAt", d.created_at as "createdAt", d.updated_at as "updatedAt",
                     f.filename, f.content_type as "contentType", f.size_bytes as "size", o.name as "orgName"
                from org_documents d join organisations o on o.id = d.org_id left join files f on f.id = d.current_file_id
                left join workplaces w on w.id = d.workplace_id left join site_areas a on a.id = d.area_id`;

export default async function orgDocumentRoutes(app: FastifyInstance) {
  /** This organisation's own uploads (restricted ones only for owners and admins). */
  app.get('/api/org-docs', rl(120), async (req, reply) => {
    const ctx = requireOrg(req.ctx);
    reply.header('cache-control', 'no-store');
    const { archived } = z.object({ archived: z.enum(['', '1']).default('') }).parse(req.query);
    const docs = await many(pool, `${LIST} where d.org_id = $1 and (d.visibility <> 'restricted' or $2) and ((d.archived_at is null) <> ($3 = '1'))
                                    order by d.updated_at desc limit 2000`, [ctx.org.id, canAdminOrg(ctx), archived]);
    return { documents: docs };
  });

  /** For a contractor: what the sites it works on have shared with their contractors. */
  app.get('/api/org-docs/shared', rl(60), async (req, reply) => {
    const ctx = requireOrg(req.ctx);
    reply.header('cache-control', 'no-store');
    if (ctx.org.kind !== 'contractor') return { documents: [] };
    const docs = await many(pool, `${LIST} where d.org_id <> $1 and d.visibility = 'contractors' and d.archived_at is null and ${SHARED_WITH}
                                    order by o.name, d.name limit 1000`, [ctx.org.id]);
    return { documents: docs };
  });

  app.post('/api/org-docs', rl(60), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    requireDocWriter(ctx);
    const { file, buf, parsed } = await readUpload(req);
    const m = meta.parse({ name: (parsed as { name?: string }).name || file.filename.replace(/\.[a-z0-9]+$/i, ''), ...(parsed as object) });
    return withTx(async (db) => {
      await checkLinks(db, ctx, m);
      const f = await storeFile(db, ctx, buf, file.filename, file.mimetype);
      const d = (await one<{ id: string }>(db,
        `insert into org_documents (org_id, name, description, doc_type, scope, workplace_id, area_id, site_id, subject, requirement, visibility, issue_date, expiry_date, owner_name, current_file_id, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning id`,
        [ctx.org.id, m.name, m.description, m.docType, m.scope, m.workplaceId, m.areaId, m.siteId, m.subject, m.requirement, m.visibility, m.issueDate, m.expiryDate, m.ownerName, f.id, ctx.user.id]))!;
      await db.query(`insert into org_document_versions (document_id, version, file_id, uploaded_by, uploaded_by_name) values ($1, 1, $2, $3, $4)`, [d.id, f.id, ctx.user.id, ctx.user.name]);
      await audit(db, ctx, 'Uploaded a document', `${m.name} (${f.filename})`);
      await track(db, ctx.org.id, 'org_document_upload');
      await publishChange(db, [ctx.org.id]);
      return { id: d.id, fileName: f.filename };
    });
  });

  app.get('/api/org-docs/:id', rl(120), async (req, reply) => {
    const ctx = requireOrg(req.ctx);
    reply.header('cache-control', 'no-store');
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    const d = await one<DocRow>(pool, `select id, org_id, visibility, workplace_id, current_file_id, name, created_by from org_documents where id = $1`, [id]);
    if (!d || !(await canRead(pool, ctx, d))) throw notFound();
    const [doc, versions] = await Promise.all([
      one(pool, `${LIST} where d.id = $1`, [id]),
      d.org_id === ctx.org.id
        ? many(pool, `select v.version, v.note, v.uploaded_by_name as "by", v.created_at as "at", f.filename, f.size_bytes as size from org_document_versions v join files f on f.id = v.file_id where v.document_id = $1 order by v.version desc`, [id])
        : Promise.resolve([]),
    ]);
    return { document: doc, versions, mine: d.org_id === ctx.org.id };
  });

  app.patch('/api/org-docs/:id', rl(60), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    requireDocWriter(ctx);
    const m = meta.parse(req.body);
    return withTx(async (db) => {
      const d = await own(db, ctx, (req.params as { id: string }).id, true);
      await checkLinks(db, ctx, m);
      await db.query(`update org_documents set name = $2, description = $3, doc_type = $4, scope = $5, workplace_id = $6, area_id = $7, site_id = $8, subject = $9,
                        requirement = $10, visibility = $11, issue_date = $12, expiry_date = $13, owner_name = $14, updated_at = now() where id = $1`,
        [d.id, m.name, m.description, m.docType, m.scope, m.workplaceId, m.areaId, m.siteId, m.subject, m.requirement, m.visibility, m.issueDate, m.expiryDate, m.ownerName]);
      await audit(db, ctx, 'Updated document details', m.name);
      await publishChange(db, [ctx.org.id]);
      return { ok: true };
    });
  });

  /** A replacement keeps every earlier version. */
  app.post('/api/org-docs/:id/version', rl(60), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    requireDocWriter(ctx);
    const { file, buf, parsed } = await readUpload(req);
    const note = z.object({ note: t(300).default('') }).parse(parsed).note;
    return withTx(async (db) => {
      const d = await own(db, ctx, (req.params as { id: string }).id, true);
      const f = await storeFile(db, ctx, buf, file.filename, file.mimetype);
      const v = (await one<{ version: number }>(db, `update org_documents set version = version + 1, current_file_id = $2, updated_at = now() where id = $1 returning version`, [d.id, f.id]))!;
      await db.query(`insert into org_document_versions (document_id, version, file_id, note, uploaded_by, uploaded_by_name) values ($1, $2, $3, $4, $5, $6)`, [d.id, v.version, f.id, note, ctx.user.id, ctx.user.name]);
      await audit(db, ctx, 'Uploaded a new version', `${d.name} v${v.version}`);
      await publishChange(db, [ctx.org.id]);
      return { version: v.version };
    });
  });

  app.post('/api/org-docs/:id/archive', rl(60), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    requireDocWriter(ctx);
    const { archived } = z.object({ archived: z.boolean() }).parse(req.body);
    return withTx(async (db) => {
      const d = await own(db, ctx, (req.params as { id: string }).id, true);
      if (!canAdminOrg(ctx) && d.created_by !== ctx.user.id) throw forbidden('Only the person who uploaded it, or an admin, can archive this document.');
      await db.query(`update org_documents set archived_at = case when $2 then now() end, updated_at = now() where id = $1`, [d.id, archived]);
      await audit(db, ctx, archived ? 'Archived a document' : 'Restored a document', d.name);
      await publishChange(db, [ctx.org.id]);
      return { ok: true };
    });
  });

  /** The file itself: the current version, or an earlier one (own organisation only). */
  app.get('/api/org-docs/:id/file', rl(120), async (req, reply) => {
    const ctx = requireOrg(req.ctx);
    const { id } = req.params as { id: string };
    const q = z.object({ v: z.coerce.number().int().min(1).optional(), download: z.enum(['0', '1']).default('0') }).parse(req.query);
    if (!isUuid(id)) throw notFound();
    const d = await one<DocRow>(pool, `select id, org_id, visibility, workplace_id, current_file_id, name, created_by from org_documents where id = $1`, [id]);
    if (!d || !(await canRead(pool, ctx, d))) throw notFound();
    const fileId = q.v && d.org_id === ctx.org.id
      ? (await one<{ file_id: string }>(pool, `select file_id from org_document_versions where document_id = $1 and version = $2`, [id, q.v]))?.file_id
      : d.current_file_id;
    if (!fileId) throw notFound();
    const file = await one<{ id: string; org_id: string; storage_key: string; filename: string; content_type: string }>(pool,
      'select id, org_id, storage_key, filename, content_type from files where id = $1', [fileId]);
    if (!file) throw notFound();
    if (q.download === '1' || d.org_id !== ctx.org.id) await audit(pool, ctx, q.download === '1' ? 'Downloaded file' : 'Opened file', `${d.name} (${file.filename})`);
    return sendFile(reply, file, q.download === '1');
  });
}
