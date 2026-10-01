import type { FastifyInstance } from 'fastify';
import { TOOLS } from '../lib/knowledge.js';
import { z } from 'zod';
import { canAdminOrg, isUuid, requireAdmin, requireOrg, requireWritable } from '../lib/authz.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { sniffType } from '../lib/storage.js';
import { many, one, pool, withTx } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { publishChange } from '../lib/realtime.js';
import { BLUEPRINTS, CATEGORIES } from '../lib/studio/blueprints.js';
import { generateDocument } from '../lib/studio/generate.js';
import { storeFile } from './documents.js';
import { rl } from './auth.js';

const values = z.record(z.string().max(40), z.string().max(4000)).refine((o) => Object.keys(o).length <= 30, 'too many fields');

export default async function studioRoutes(app: FastifyInstance) {
  /** The document library: categories, and each blueprint's questions. */
  /** The tool and equipment library (hazards, controls, checks, PPE) used by sessions and documents. */
  app.get('/api/tools', async (req, reply) => {
    requireOrg(req.ctx);
    reply.header('cache-control', 'private, max-age=3600');
    return { tools: TOOLS.map((t) => ({ label: t.label, category: t.category })) };
  });

  app.get('/api/studio/blueprints', async (req) => {
    requireOrg(req.ctx);
    return {
      categories: CATEGORIES,
      blueprints: BLUEPRINTS.map((b) => ({ id: b.id, code: b.code, name: b.name, category: b.category, description: b.description, fields: b.fields, reviewMonths: b.reviewMonths })),
    };
  });

  app.get('/api/studio/documents', async (req) => {
    const ctx = requireOrg(req.ctx);
    const rows = await many<Record<string, unknown>>(
      pool,
      `select g.id, g.blueprint, g.title, g.doc_number as "docNumber", g.revision, g.ai, g.site_id as "siteId", g.requirement_id as "requirementId",
              g.pdf_file_id as "pdfFileId", g.docx_file_id as "docxFileId", g.created_by_name as "createdBy", g.created_at as "createdAt",
              to_char(g.review_due, 'YYYY-MM-DD') as "reviewDue", s.name as "siteName",
              sub.status as "submittedStatus", to_char(sub.expiry_date, 'YYYY-MM-DD') as "submittedExpiry",
              (sub.current_file_id = g.pdf_file_id) as "latestSubmitted", (sub.status is not null) as "everSubmitted",
              r.name as "requirementName"
         from generated_documents g left join sites s on s.id = g.site_id left join requirements r on r.id = g.requirement_id
         -- Where any revision of this document is the live file of a requirement, that requirement's status.
         left join lateral (
           select d.status, d.expiry_date, d.current_file_id from documents d
             join generated_documents g2 on g2.pdf_file_id = d.current_file_id and g2.org_id = g.org_id and g2.doc_number = g.doc_number
            order by d.updated_at desc limit 1
         ) sub on true
        where g.org_id = $1 and g.superseded_at is null
        order by g.created_at desc limit 300`,
      [ctx.org.id],
    );
    return { documents: rows };
  });

  /** Deletes a document (all revisions) that has never been submitted to a site. Submitted ones are part of the record. */
  app.delete('/api/studio/documents/:id', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    await withTx(async (db) => {
      const g = await one<{ doc_number: string; title: string; created_by: string | null; site_id: string | null }>(
        db, 'select doc_number, title, created_by, site_id from generated_documents where id = $1 and org_id = $2 for update', [id, ctx.org.id]);
      if (!g) throw notFound();
      if (g.created_by !== ctx.user.id && !canAdminOrg(ctx)) throw forbidden('Only the person who created this document, or an admin, can delete it.');
      const used = await one(
        db,
        `select 1 from generated_documents g join document_versions v on v.file_id = g.pdf_file_id where g.org_id = $1 and g.doc_number = $2 limit 1`,
        [ctx.org.id, g.doc_number]);
      if (used) throw conflict('This document has been submitted to a site, so it is part of the site\'s record and can\'t be deleted. Make a new revision instead.');
      // Unhook it from any requirement where it is attached but not yet submitted.
      await db.query(
        `update documents set pending_file_id = null where pending_file_id in (select pdf_file_id from generated_documents where org_id = $1 and doc_number = $2)`,
        [ctx.org.id, g.doc_number]);
      await db.query('delete from review_links where org_id = $1 and doc_number = $2', [ctx.org.id, g.doc_number]);
      await db.query('delete from doc_comments where org_id = $1 and doc_number = $2', [ctx.org.id, g.doc_number]);
      await db.query('delete from generated_documents where org_id = $1 and doc_number = $2', [ctx.org.id, g.doc_number]);
      await audit(db, ctx, 'Deleted document', `${g.doc_number} — ${g.title} (never submitted)`, g.site_id);
      await publishChange(db, [ctx.org.id]);
    });
    return { ok: true };
  });

  app.get('/api/studio/documents/:id', async (req) => {
    const ctx = requireOrg(req.ctx);
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    const doc = await one<Record<string, unknown>>(
      pool,
      `select id, blueprint, title, doc_number as "docNumber", revision, ai, inputs, content, site_id as "siteId", requirement_id as "requirementId",
              pdf_file_id as "pdfFileId", docx_file_id as "docxFileId", to_char(review_due, 'YYYY-MM-DD') as "reviewDue", created_by_name as "createdBy", created_at as "createdAt"
         from generated_documents where id = $1 and org_id = $2`,
      [id, ctx.org.id],
    );
    if (!doc) throw notFound();
    const history = await many(pool, `select id, revision, revision_note as "note", created_by_name as "by", created_at as "createdAt" from generated_documents where org_id = $1 and doc_number = $2 order by revision desc`, [ctx.org.id, doc.docNumber]);
    return { ...doc, history };
  });

  /** Creates a document, or a new revision with `reviseOf`. May take up to a minute with AI. */
  app.post('/api/studio/documents', rl(30), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const body = z
      .object({
        blueprintId: z.string().max(40),
        values: values.default({}),
        siteId: z.string().optional(),
        requirementId: z.string().optional(),
        research: z.boolean().default(false),
        reviseOf: z.string().optional(),
        revisionNote: z.string().trim().max(300).optional(),
      })
      .parse(req.body);
    const out = await generateDocument(ctx, body, req.log);
    await withTx(async (db) => {
      await audit(db, ctx, out.revision ? 'Revised document' : 'Generated document', `${out.docNumber} Rev ${out.revision} — ${out.title}`, out.siteId);
      await publishChange(db, [ctx.org.id]);
    });
    return out;
  });

  // ---- Company branding for generated documents ----

  app.patch('/api/org/branding', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    requireWritable(ctx);
    const body = z
      .object({
        brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #16325C').optional(),
        docPrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{0,12}$/, 'Letters, numbers and dashes only, up to 12').optional(),
      })
      .parse(req.body);
    await withTx(async (db) => {
      await db.query(`update organisations set settings = settings || $2::jsonb where id = $1`, [ctx.org.id, JSON.stringify(body)]);
      await audit(db, ctx, 'Updated document branding', Object.entries(body).map(([k, v]) => `${k}=${v}`).join(', '));
      await publishChange(db, [ctx.org.id]);
    });
    return { ok: true };
  });

  app.post('/api/org/logo', rl(10), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    requireWritable(ctx);
    const file = await req.file();
    if (!file) throw badRequest('Attach an image.');
    const buf = await file.toBuffer();
    if (!buf.length) throw badRequest('That file is empty.');
    if (buf.length > 2 * 1024 * 1024) throw badRequest('Use a logo under 2 MB.');
    const type = sniffType(buf, file.mimetype, file.filename);
    if (type !== 'image/png' && type !== 'image/jpeg') throw badRequest('Upload the logo as a PNG or JPG.', 'unsupported_file');
    const stored = await withTx(async (db) => {
      const f = await storeFile(db, ctx, buf, file.filename, file.mimetype);
      await db.query(`update organisations set settings = settings || jsonb_build_object('logoFileId', $2::text) where id = $1`, [ctx.org.id, f.id]);
      await audit(db, ctx, 'Uploaded company logo', f.filename);
      await publishChange(db, [ctx.org.id]);
      return f;
    });
    return { fileId: stored.id };
  });

  app.delete('/api/org/logo', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    requireWritable(ctx);
    await withTx(async (db) => {
      await db.query(`update organisations set settings = settings - 'logoFileId' where id = $1`, [ctx.org.id]);
      await audit(db, ctx, 'Removed company logo', '');
      await publishChange(db, [ctx.org.id]);
    });
    return { ok: true };
  });
}

