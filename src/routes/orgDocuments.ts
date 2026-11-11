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
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { canAdminOrg, isUuid, requireHostAdmin, requireOrg, requireWritable, type OrgCtx } from '../lib/authz.js';
import { storage } from '../lib/storage.js';
import { addWorkplaceRequirements, loadWorkplace } from './workplaces.js';
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
  folderId: z.string().uuid().nullable().default(null),
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
  if (m.folderId && !(await one(db, `select 1 from doc_folders where id = $1 and org_id = $2`, [m.folderId, ctx.org.id]))) throw notFound();
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
                     f.filename, f.content_type as "contentType", f.size_bytes as "size", o.name as "orgName", d.folder_id as "folderId"
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
        `insert into org_documents (org_id, name, description, doc_type, scope, workplace_id, area_id, site_id, subject, requirement, visibility, issue_date, expiry_date, owner_name, current_file_id, created_by, folder_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) returning id`,
        [ctx.org.id, m.name, m.description, m.docType, m.scope, m.workplaceId, m.areaId, m.siteId, m.subject, m.requirement, m.visibility, m.issueDate, m.expiryDate, m.ownerName, f.id, ctx.user.id, m.folderId]))!;
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
    return { document: doc, versions, mine: d.org_id === ctx.org.id, requiredAt: d.org_id === ctx.org.id ? await requiredAt(pool, ctx.org.id, id) : [] };
  });

  app.patch('/api/org-docs/:id', rl(60), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    requireDocWriter(ctx);
    const m = meta.parse(req.body);
    return withTx(async (db) => {
      const d = await own(db, ctx, (req.params as { id: string }).id, true);
      await checkLinks(db, ctx, m);
      const cur = (await one<{ visibility: string; workplace_id: string | null }>(db, `select visibility, workplace_id from org_documents where id = $1`, [d.id]))!;
      if ((await requiredAt(db, ctx.org.id, d.id)).length && (m.visibility !== 'contractors' || (cur.workplace_id ?? null) !== (m.workplaceId ?? null))) {
        throw conflict('Contractors are asked to submit this document, so it must stay shared with them at its site. Remove the requirement first.');
      }
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

  /** Where this document is a required submission (a mine's own document only). */
  async function requiredAt(db: Db, orgId: string, docId: string) {
    return many<{ id: string; name: string; requirement: string }>(db,
      `select w.id, w.name, e->>'name' as requirement from workplaces w, jsonb_array_elements(w.requirements) e
        where w.org_id = $1 and w.archived_at is null and e->>'templateDocId' = $2`, [orgId, docId]);
  }

  /**
   * A mine makes an uploaded document something every contractor at a site must complete and submit:
   * it becomes a site requirement (in every contractor's file there, and for anyone who joins later),
   * with this document as the template they download. Submissions then go through the normal review.
   */
  app.post('/api/org-docs/:id/require', rl(30), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireHostAdmin(ctx);
    requireWritable(ctx);
    const b = z.object({ workplaceId: z.string().uuid(), name: t(200).optional(), category: t(80).default('Site documents'), why: t(1000).default(''), optional: z.boolean().default(false) }).parse(req.body);
    return withTx(async (db) => {
      const d = await own(db, ctx, (req.params as { id: string }).id, true);
      const full = (await one<{ archived_at: Date | null; workplace_id: string | null; scope: string }>(db, `select archived_at, workplace_id, scope from org_documents where id = $1`, [d.id]))!;
      const w = await loadWorkplace(db, ctx, b.workplaceId, true); // 404 for anyone else's site, before anything else is said
      if (!(await one(db, `select 1 from workplaces where id = $1 and archived_at is null`, [w.id]))) throw conflict('That site is archived.');
      if (full.archived_at) throw conflict('Restore the document before asking contractors for it.');
      if (d.visibility === 'restricted') throw conflict('This document is for owners and admins only. Change who can see it before sharing it with contractors.');
      if (full.workplace_id && full.workplace_id !== b.workplaceId) throw conflict('This document belongs to another site. Upload it for this site, or make it company-wide.');
      const name = (b.name || d.name).trim();
      if (w.requirements.some((r) => r.name.toLowerCase() === name.toLowerCase())) throw conflict('This site already has a requirement with that name.');
      // Contractors need to be able to open the template: it is shared with the site's contractors.
      // Shared with this site's contractors only: a document with no site is tied to this one (never to every site).
      await db.query(`update org_documents set visibility = 'contractors', requirement = $2, workplace_id = coalesce(workplace_id, $3), scope = case when workplace_id is null then 'site' else scope end, updated_at = now() where id = $1`,
        [d.id, b.optional ? 'recommended' : 'mandatory', w.id]);
      const touched = await addWorkplaceRequirements(db, ctx, w, [{ category: b.category, name, source: 'site', why: b.why || `Use the template from ${ctx.org.name}: download it, complete it and submit it here.`, optional: b.optional, templateDocId: d.id }]);
      await audit(db, ctx, 'Asked contractors to submit a document', `${w.name}: ${name}`);
      return { ok: true, contractorsUpdated: touched };
    });
  });

  /**
   * Permanent: the document, every version and its stored files. A site requirement made from it stays (with the
   * contractors' submissions) but loses its template link. Owners and admins, or the person who uploaded it.
   */
  app.delete('/api/org-docs/:id', rl(30), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    requireDocWriter(ctx);
    const keys: string[] = [];
    const name = await withTx(async (db) => {
      const d = await own(db, ctx, (req.params as { id: string }).id, true);
      if (!canAdminOrg(ctx) && d.created_by !== ctx.user.id) throw forbidden('Only the person who uploaded it, or an admin, can delete this document.');
      const live = await requiredAt(db, ctx.org.id, d.id);
      if (live.length && (req.query as { force?: string }).force !== '1') throw conflict(`Contractors are asked to submit this at ${live.map((x) => x.name).join(', ')}. Deleting it removes the template but keeps the requirement. Confirm to delete anyway.`);
      await audit(db, ctx, 'Deleting a document', `${d.name}${live.length ? ' (was a required template at ' + live.map((x) => x.name).join(', ') + ')' : ''}`);
      const files = await many<{ id: string; storage_key: string }>(db,
        `select f.id, f.storage_key from files f where f.id in (select file_id from org_document_versions where document_id = $1 union select current_file_id from org_documents where id = $1)`, [d.id]);
      await db.query(`delete from org_documents where id = $1`, [d.id]);
      // Only files nothing else points at are erased (a file can also be a submitted copy elsewhere).
      for (const f of files) {
        const used = await one(db, `select 1 from document_versions where file_id = $1 union all select 1 from documents where current_file_id = $1 or pending_file_id = $1 limit 1`, [f.id]);
        if (!used) { await db.query(`delete from files where id = $1`, [f.id]); keys.push(f.storage_key); }
      }
      await audit(db, ctx, 'Deleted a document', d.name);
      await publishChange(db, [ctx.org.id]);
      return d.name;
    });
    for (const k of keys) await storage.remove(k).catch(() => {});
    return { ok: true, name, filesErased: keys.length };
  });

  // ---------- folders ----------
  app.get('/api/doc-folders', rl(120), async (req, reply) => {
    const ctx = requireOrg(req.ctx);
    reply.header('cache-control', 'no-store');
    const folders = await many(pool,
      `select f.id, f.name, f.workplace_id as "workplaceId", w.name as "workplaceName", f.site_id as "siteId", s.name as "siteName", so.name as "siteOwner",
              f.contractor_id as "contractorId", c.name as "contractorName",
              (select count(*) from org_documents d where d.folder_id = f.id and d.archived_at is null and (d.visibility <> 'restricted' or $2))::int as documents
         from doc_folders f left join workplaces w on w.id = f.workplace_id left join sites s on s.id = f.site_id left join organisations so on so.id = s.org_id
         left join contractors c on c.id = f.contractor_id
        where f.org_id = $1 order by f.name`, [ctx.org.id, canAdminOrg(ctx)]);
    return { folders };
  });

  const folderBody = z.object({ name: t(120).min(1, 'Name the folder.'), workplaceId: z.string().uuid().nullable().default(null), siteId: z.string().uuid().nullable().default(null), contractorId: z.string().uuid().nullable().default(null) });
  /** A folder can point at one thing this organisation can see: its own site, a contractor in its directory, or a safety file it works on. */
  async function checkFolderLinks(db: Db, ctx: OrgCtx, b: z.infer<typeof folderBody>) {
    if ([b.workplaceId, b.siteId, b.contractorId].filter(Boolean).length > 1) throw badRequest('Link a folder to one site or one contractor.');
    if (b.workplaceId && !(await one(db, `select 1 from workplaces where id = $1 and org_id = $2`, [b.workplaceId, ctx.org.id]))) throw notFound();
    if (b.contractorId && !(await one(db, `select 1 from contractors where id = $1 and org_id = $2`, [b.contractorId, ctx.org.id]))) throw notFound();
    if (b.siteId && !(await one(db, `select 1 from sites s left join contractors c on c.id = s.contractor_id left join organisations p on p.id = s.org_id
                                       where s.id = $1 and (s.org_id = $2 or c.linked_org_id = $2 or p.managed_by_org = $2)`, [b.siteId, ctx.org.id]))) throw notFound();
  }
  app.post('/api/doc-folders', rl(60), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    requireDocWriter(ctx);
    const b = folderBody.parse(req.body);
    return withTx(async (db) => {
      await checkFolderLinks(db, ctx, b);
      const f = await one<{ id: string }>(db, `insert into doc_folders (org_id, name, workplace_id, site_id, contractor_id, created_by) values ($1, $2, $3, $4, $5, $6) on conflict do nothing returning id`,
        [ctx.org.id, b.name, b.workplaceId, b.siteId, b.contractorId, ctx.user.id]);
      if (!f) throw conflict('You already have a folder with that name.');
      await audit(db, ctx, 'Created a folder', b.name);
      await publishChange(db, [ctx.org.id]);
      return { id: f.id };
    });
  });
  app.patch('/api/doc-folders/:id', rl(60), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    requireDocWriter(ctx);
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    const b = folderBody.parse(req.body);
    return withTx(async (db) => {
      await checkFolderLinks(db, ctx, b);
      const r = await db.query(`update doc_folders set name = $3, workplace_id = $4, site_id = $5, contractor_id = $6 where id = $1 and org_id = $2`, [id, ctx.org.id, b.name, b.workplaceId, b.siteId, b.contractorId]).catch((e) => {
        if (String(e.code) === '23505') throw conflict('You already have a folder with that name.');
        throw e;
      });
      if (!r.rowCount) throw notFound();
      await audit(db, ctx, 'Updated a folder', b.name);
      await publishChange(db, [ctx.org.id]);
      return { ok: true };
    });
  });
  /** Deleting a folder never deletes documents: they move out of it. */
  app.delete('/api/doc-folders/:id', rl(60), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    requireDocWriter(ctx);
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    return withTx(async (db) => {
      const f = await one<{ name: string }>(db, `delete from doc_folders where id = $1 and org_id = $2 returning name`, [id, ctx.org.id]);
      if (!f) throw notFound();
      await audit(db, ctx, 'Deleted a folder (documents kept)', f.name);
      await publishChange(db, [ctx.org.id]);
      return { ok: true };
    });
  });
  app.post('/api/org-docs/:id/folder', rl(60), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    requireDocWriter(ctx);
    const { folderId } = z.object({ folderId: z.string().uuid().nullable() }).parse(req.body);
    return withTx(async (db) => {
      const d = await own(db, ctx, (req.params as { id: string }).id, true);
      if (folderId && !(await one(db, `select 1 from doc_folders where id = $1 and org_id = $2`, [folderId, ctx.org.id]))) throw notFound();
      await db.query(`update org_documents set folder_id = $2, updated_at = now() where id = $1`, [d.id, folderId]);
      await audit(db, ctx, 'Moved a document', d.name);
      await publishChange(db, [ctx.org.id]);
      return { ok: true };
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
