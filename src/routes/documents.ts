import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { one, pool, withTx, type Db } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { actorRole, isUuid, loadSite, requireOrg, requireReviewer, requireWritable, type OrgCtx } from '../lib/authz.js';
import { audit, clip } from '../lib/audit.js';
import { publishChange } from '../lib/realtime.js';
import { appUrl, queueToOrg } from '../lib/email.js';
import { bumpVersion, effectiveStatus, LIBRARY_TYPES } from '../lib/readiness.js';
import { sniffType, storage } from '../lib/storage.js';
import { aiAllowed } from '../lib/plans.js';
import { extractExpiryDate } from '../lib/ai.js';
import { rl } from './auth.js';

export interface Slot {
  kind: 'site' | 'library';
  side: 'host' | 'contractor';
  name: string;
  siteId: string | null;
  siteName: string | null;
  parties: string[];
  requirementId: string | null;
  libraryType: string | null;
  contractorOrgId: string | null;
  hostOrgId: string | null;
}

/**
 * Resolves a document "slot" — a site requirement id, or `lib:<orgId>:<type>`
 * for a contractor's reusable company document — and checks the caller can see it.
 */
export async function resolveSlot(db: Db, ctx: OrgCtx, slot: string): Promise<Slot> {
  if (slot.startsWith('lib:')) {
    const [, orgId, type] = slot.split(':');
    const t = LIBRARY_TYPES.find((x) => x.id === type);
    if (orgId !== ctx.org.id || ctx.org.kind !== 'contractor' || !t) throw notFound();
    return {
      kind: 'library', side: 'contractor', name: t.name, siteId: null, siteName: null, parties: [ctx.org.id],
      requirementId: null, libraryType: t.id, contractorOrgId: ctx.org.id, hostOrgId: null,
    };
  }
  if (!isUuid(slot)) throw notFound();
  const r = await one<{ site_id: string; name: string }>(db, 'select site_id, name from requirements where id = $1', [slot]);
  if (!r) throw notFound();
  const access = await loadSite(db, ctx, r.site_id);
  return {
    kind: 'site', side: access.side, name: r.name, siteId: r.site_id, siteName: access.site.name, parties: access.parties,
    requirementId: slot, libraryType: null, contractorOrgId: access.site.linked_org_id, hostOrgId: access.site.org_id,
  };
}

interface DocRow {
  id: string;
  status: string;
  version: string | null;
  expiry_date: string | null;
  pending_file_id: string | null;
  current_file_id: string | null;
  note: string;
}

/** Fetches (creating if needed) the live document row for a slot, locked for update. */
async function docFor(db: Db, s: Slot): Promise<DocRow> {
  if (s.kind === 'site') {
    await db.query(`insert into documents (requirement_id) values ($1) on conflict (requirement_id) do nothing`, [s.requirementId]);
    return (await one<DocRow>(db, 'select * from documents where requirement_id = $1 for update', [s.requirementId]))!;
  }
  await db.query(
    `insert into documents (library_org_id, library_type) values ($1, $2) on conflict (library_org_id, library_type) do nothing`,
    [s.contractorOrgId, s.libraryType],
  );
  return (await one<DocRow>(db, 'select * from documents where library_org_id = $1 and library_type = $2 for update', [s.contractorOrgId, s.libraryType]))!;
}

function requireSubmitter(s: Slot) {
  if (s.side !== 'contractor') throw forbidden('Only the contractor submits documents against a requirement.');
}

/** Stores an uploaded buffer as a private file owned by the caller's organisation. */
export async function storeFile(db: Db, ctx: OrgCtx, buf: Buffer, filename: string, declaredType: string) {
  const type = sniffType(buf, declaredType, filename);
  if (!type) throw badRequest('That file type is not supported. Upload a PDF, photo (JPG/PNG/WebP/HEIC), Word, Excel or text file.', 'unsupported_file');
  const safeName = path.basename(filename).replace(/[\x00-\x1f]/g, '').slice(0, 180) || 'document';
  const key = `${ctx.org.id}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}${path.extname(safeName).toLowerCase().slice(0, 10)}`;
  await storage.put(key, buf, type);
  const f = (await one<{ id: string }>(
    db,
    `insert into files (org_id, storage_key, filename, content_type, size_bytes, sha256, uploaded_by)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [ctx.org.id, key, safeName, type, buf.length, createHash('sha256').update(buf).digest('hex'), ctx.user.id],
  ))!;
  return { id: f.id, filename: safeName, contentType: type };
}

export default async function documentRoutes(app: FastifyInstance) {
  const slotParam = (req: { params: unknown }) => decodeURIComponent((req.params as { slot: string }).slot);

  app.post('/api/documents/:slot/file', rl(60), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const slot = slotParam(req);
    const s = await resolveSlot(pool, ctx, slot);
    requireSubmitter(s);
    const file = await req.file();
    if (!file) throw badRequest('Attach a file.');
    const buf = await file.toBuffer();
    if (!buf.length) throw badRequest('That file is empty.');
    const stored = await withTx(async (db) => {
      const doc = await docFor(db, s);
      if (doc.status === 'awaiting_review') throw conflict('This document is waiting on review. You can replace it if the reviewer asks for a correction.');
      const f = await storeFile(db, ctx, buf, file.filename, file.mimetype);
      await db.query('update documents set pending_file_id = $2 where id = $1', [doc.id, f.id]);
      await publishChange(db, [ctx.org.id]);
      return f;
    });
    let detectedExpiry: string | null = null;
    if (aiAllowed(ctx.org) && (stored.contentType.startsWith('image/') || stored.contentType === 'application/pdf') && stored.contentType !== 'image/heic') {
      detectedExpiry = await extractExpiryDate(ctx.org.id, buf, stored.contentType, req.log);
    }
    return { fileId: stored.id, fileName: stored.filename, detectedExpiry };
  });

  app.post('/api/documents/:slot/submit', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const body = z
      .object({
        note: z.string().trim().max(2000).default(''),
        expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('').transform(() => undefined)),
        aiDrafted: z.boolean().default(false),
      })
      .parse(req.body ?? {});
    const slot = slotParam(req);
    return withTx(async (db) => {
      const s = await resolveSlot(db, ctx, slot);
      requireSubmitter(s);
      const doc = await docFor(db, s);
      if (!doc.pending_file_id) throw badRequest('Attach a file before submitting.', 'no_file');
      const eff = effectiveStatus(doc);
      if (doc.status === 'awaiting_review') throw conflict('Already submitted — waiting on review.');
      const version = bumpVersion(doc.version);
      const expiry = body.expiryDate ?? null;
      await db.query(
        `insert into document_versions (document_id, version, file_id, note, expiry_date, ai_drafted, submitted_by, submitted_by_name)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [doc.id, version, doc.pending_file_id, body.note, expiry, body.aiDrafted, ctx.user.id, ctx.user.name],
      );
      // Company library documents have no reviewer — they are the contractor's own record.
      const status = s.kind === 'library' ? 'complete' : 'awaiting_review';
      await db.query(
        `update documents set status = $2, version = $3, current_file_id = pending_file_id, pending_file_id = null,
                note = $4, expiry_date = $5, updated_at = now() where id = $1`,
        [doc.id, status, version, body.note, expiry],
      );
      if (s.requirementId) {
        // Any open request tied to this requirement is answered by the submission.
        await db.query(
          `update info_requests set status = 'submitted', responded_at = now(), response = $2
            where linked_requirement_id = $1 and status in ('requested', 'viewed')`,
          [s.requirementId, `Document submitted (${version}).`],
        );
      }
      const resubmit = eff === 'correction_required' || eff === 'expired' || eff === 'expiring';
      await audit(db, ctx, body.aiDrafted ? 'Saved AI-drafted document' : resubmit ? 'Resubmitted document' : 'Submitted document', `${s.name} (${version})`, s.siteId);
      await publishChange(db, s.parties);
      return { version, status };
    });
  });

  app.post('/api/documents/:slot/approve', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireReviewer(ctx);
    requireWritable(ctx);
    const slot = slotParam(req);
    return withTx(async (db) => {
      const s = await resolveSlot(db, ctx, slot);
      if (s.side !== 'host') throw forbidden();
      const doc = await docFor(db, s);
      if (!['awaiting_review', 'correction_required'].includes(doc.status) || !doc.current_file_id) {
        throw conflict('There is no submitted version to approve.');
      }
      await db.query(`update documents set status = 'complete', updated_at = now() where id = $1`, [doc.id]);
      await audit(db, ctx, 'Approved document', `${s.name} (${doc.version})`, s.siteId);
      await publishChange(db, s.parties);
      return { ok: true };
    });
  });

  app.post('/api/documents/:slot/correction', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireReviewer(ctx);
    requireWritable(ctx);
    const { text } = z.object({ text: z.string().trim().min(1).max(4000) }).parse(req.body);
    const slot = slotParam(req);
    return withTx(async (db) => {
      const s = await resolveSlot(db, ctx, slot);
      if (s.side !== 'host') throw forbidden();
      const doc = await docFor(db, s);
      await db.query(`update documents set status = 'correction_required', updated_at = now() where id = $1`, [doc.id]);
      await db.query(
        `insert into reviews (document_id, author_id, author_name, author_role, kind, text) values ($1, $2, $3, $4, 'correction', $5)`,
        [doc.id, ctx.user.id, ctx.user.name, actorRole(ctx), text],
      );
      await audit(db, ctx, 'Requested correction', `${s.name} — "${clip(text)}"`, s.siteId);
      if (s.contractorOrgId) {
        await queueToOrg(db, s.contractorOrgId, null, (to) => ({
          to: to.email,
          subject: `Correction requested: ${s.name}`,
          lines: [`${ctx.user.name} (${ctx.org.name}) asked for a correction to "${s.name}" on ${s.siteName}:`, `"${text}"`],
          action: { label: 'Open SiteGuard', url: appUrl('/') },
        }));
      }
      await publishChange(db, s.parties);
      return { ok: true };
    });
  });

  app.post('/api/documents/:slot/comment', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const { text } = z.object({ text: z.string().trim().min(1).max(4000) }).parse(req.body);
    const slot = slotParam(req);
    return withTx(async (db) => {
      const s = await resolveSlot(db, ctx, slot);
      if (s.kind !== 'site') throw badRequest('Comments are for site requirements.');
      const doc = await docFor(db, s);
      await db.query(
        `insert into reviews (document_id, author_id, author_name, author_role, kind, text) values ($1, $2, $3, $4, 'comment', $5)`,
        [doc.id, ctx.user.id, ctx.user.name, actorRole(ctx), text],
      );
      await audit(db, ctx, 'Commented on document', `${s.name} — "${clip(text)}"`, s.siteId);
      await publishChange(db, s.parties);
      return { ok: true };
    });
  });

  /** Withdraws a document back to "missing". Versions stay in the history. */
  app.delete('/api/documents/:slot', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const slot = slotParam(req);
    return withTx(async (db) => {
      const s = await resolveSlot(db, ctx, slot);
      requireSubmitter(s);
      const doc = await docFor(db, s);
      await db.query(
        `update documents set status = 'missing', current_file_id = null, pending_file_id = null, expiry_date = null,
                note = '', updated_at = now() where id = $1`,
        [doc.id],
      );
      await audit(db, ctx, 'Withdrew document', s.name, s.siteId);
      await publishChange(db, s.parties);
      return { ok: true };
    });
  });
}
