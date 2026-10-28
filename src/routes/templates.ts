/**
 * Site templates: a mine uploads its own form for a requirement (its induction questionnaire, its
 * method-statement format, its medical form); the contractor downloads it, completes it and uploads
 * the completed copy as the document for that requirement, which is then reviewed as usual.
 * Nothing is filled in or approved automatically.
 *
 * A template applies to every contractor file at a workplace, or to one contractor file, and is
 * matched to requirements by name. Replacing a template keeps the earlier version.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, pool, withTx, type Db } from '../db/pool.js';
import { badRequest, notFound } from '../lib/errors.js';
import { isUuid, requireHostAdmin, requireOrg, requireWritable, type OrgCtx } from '../lib/authz.js';
import { audit } from '../lib/audit.js';
import { publishChange } from '../lib/realtime.js';
import { notifyOrg } from '../lib/notify.js';
import { storeFile } from './documents.js';
import { anySiteVisible, sendFile } from './files.js';
import { rl } from './auth.js';

export interface TemplateRow {
  id: string;
  org_id: string;
  workplace_id: string | null;
  site_id: string | null;
  requirement_name: string;
  title: string;
  description: string;
  file_id: string;
  version: number;
  created_by_name: string;
  created_at: Date;
  superseded_at: Date | null;
  archived_at: Date | null;
}

/** Contractor organisations with a live file in the template's scope (to tell them about it). */
async function contractorOrgsIn(db: Db, scope: { workplace_id: string | null; site_id: string | null }): Promise<string[]> {
  const rows = await many<{ org: string }>(
    db,
    `select distinct c.linked_org_id as org from sites s join contractors c on c.id = s.contractor_id
      where ${scope.workplace_id ? 's.workplace_id = $1' : 's.id = $1'} and c.linked_org_id is not null and s.status not in ('declined', 'invited')`,
    [scope.workplace_id ?? scope.site_id],
  );
  return rows.map((r) => r.org);
}

/** The host owns its templates; a contractor may read one through a file of its own in that scope. */
async function canReadTemplate(db: Db, ctx: OrgCtx, t: TemplateRow): Promise<boolean> {
  if (t.org_id === ctx.org.id) return true;
  const ids = t.site_id
    ? [t.site_id]
    : (await many<{ id: string }>(db, `select s.id from sites s join contractors c on c.id = s.contractor_id where s.workplace_id = $1 and c.linked_org_id = $2`, [t.workplace_id, ctx.org.id])).map((r) => r.id);
  return anySiteVisible(db, ctx, ids);
}

/** Current templates for these contractor files, keyed by file id (for the app state). */
export async function templatesForSites(db: Db, sites: { id: string; workplace_id?: string | null }[]) {
  const out: Record<string, { id: string; requirementName: string; title: string; description: string; version: number; filename: string; updatedAt: string }[]> = {};
  if (!sites.length) return out;
  const wps = [...new Set(sites.map((s) => s.workplace_id).filter(Boolean))] as string[];
  const rows = await many<TemplateRow & { filename: string }>(
    db,
    `select t.*, f.filename from requirement_templates t join files f on f.id = t.file_id
      where t.superseded_at is null and t.archived_at is null and (t.site_id = any($1::uuid[]) or t.workplace_id = any($2::uuid[]))
      order by t.requirement_name`,
    [sites.map((s) => s.id), wps],
  );
  for (const s of sites) {
    out[s.id] = rows
      .filter((t) => t.site_id === s.id || (!!s.workplace_id && t.workplace_id === s.workplace_id))
      .map((t) => ({ id: t.id, requirementName: t.requirement_name, title: t.title, description: t.description, version: t.version, filename: t.filename, updatedAt: new Date(t.created_at).toISOString() }));
  }
  return out;
}

export default async function templateRoutes(app: FastifyInstance) {
  /** Upload a template, or a new version of one (multipart, field "file"; details in the query string). */
  app.post('/api/templates', rl(30), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireHostAdmin(ctx);
    requireWritable(ctx);
    const q = z.object({
      workplaceId: z.string().optional(),
      siteId: z.string().optional(),
      requirement: z.string().trim().min(1).max(200),
      title: z.string().trim().max(200).optional(),
      description: z.string().trim().max(1000).default(''),
    }).parse(req.query);
    if (!!q.workplaceId === !!q.siteId) throw badRequest('Choose a workplace or a contractor file for this template.');
    const scopeId = (q.workplaceId ?? q.siteId)!;
    if (!isUuid(scopeId)) throw notFound();
    const file = await req.file();
    if (!file) throw badRequest('Attach the template file.');
    const buf = await file.toBuffer();
    if (!buf.length) throw badRequest('That file is empty.');
    return withTx(async (db) => {
      // Only the host's own workplace or its own contractor file (a contractor's project is not a host's).
      const owned = q.workplaceId
        ? await one(db, 'select id from workplaces where id = $1 and org_id = $2 for update', [scopeId, ctx.org.id])
        : await one(db, 'select id from sites where id = $1 and org_id = $2 for update', [scopeId, ctx.org.id]);
      if (!owned) throw notFound();
      const f = await storeFile(db, ctx, buf, file.filename, file.mimetype);
      const prev = await one<{ id: string; version: number }>(
        db,
        `select id, version from requirement_templates where coalesce(workplace_id, site_id) = $1 and lower(requirement_name) = lower($2) order by version desc limit 1`,
        [scopeId, q.requirement],
      );
      await db.query(
        `update requirement_templates set superseded_at = now() where coalesce(workplace_id, site_id) = $1 and lower(requirement_name) = lower($2) and superseded_at is null`,
        [scopeId, q.requirement],
      );
      const version = (prev?.version ?? 0) + 1;
      const t = (await one<TemplateRow>(
        db,
        `insert into requirement_templates (org_id, workplace_id, site_id, requirement_name, title, description, file_id, version, created_by, created_by_name)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
        [ctx.org.id, q.workplaceId ?? null, q.siteId ?? null, q.requirement, q.title || q.requirement, q.description, f.id, version, ctx.user.id, ctx.user.name],
      ))!;
      await audit(db, ctx, version > 1 ? 'Replaced site template' : 'Added site template', `${q.requirement} — ${f.filename} (version ${version})`, q.siteId ?? null);
      const orgs = await contractorOrgsIn(db, t);
      for (const org of orgs) {
        await notifyOrg(db, org, null, { kind: 'site', title: `${version > 1 ? 'Updated' : 'New'} template from ${ctx.org.name}: ${q.requirement}`, body: 'Download it from the requirement, complete it and upload your copy.' });
      }
      await publishChange(db, [ctx.org.id, ...orgs]);
      return { id: t.id, version };
    });
  });

  /** Every template in a scope, earlier versions included (host only). */
  app.get('/api/templates', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireHostAdmin(ctx);
    const q = z.object({ workplaceId: z.string().optional(), siteId: z.string().optional() }).parse(req.query);
    const scopeId = q.workplaceId ?? q.siteId;
    if (!scopeId || !isUuid(scopeId)) throw notFound();
    const rows = await many<TemplateRow & { filename: string }>(
      pool,
      `select t.*, f.filename from requirement_templates t join files f on f.id = t.file_id
        where t.org_id = $1 and coalesce(t.workplace_id, t.site_id) = $2 order by lower(t.requirement_name), t.version desc`,
      [ctx.org.id, scopeId],
    );
    return {
      templates: rows.map((t) => ({
        id: t.id, requirementName: t.requirement_name, title: t.title, description: t.description, version: t.version, filename: t.filename,
        by: t.created_by_name, createdAt: t.created_at, current: !t.superseded_at && !t.archived_at, archivedAt: t.archived_at,
      })),
    };
  });

  app.get('/api/templates/:id/file', async (req, reply) => {
    const ctx = requireOrg(req.ctx);
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    const t = await one<TemplateRow>(pool, 'select * from requirement_templates where id = $1', [id]);
    if (!t || !(await canReadTemplate(pool, ctx, t))) throw notFound();
    // A contractor sees current templates only; the host can open every version.
    if (t.org_id !== ctx.org.id && (t.superseded_at || t.archived_at)) throw notFound();
    const file = (await one<{ id: string; org_id: string; storage_key: string; filename: string; content_type: string }>(pool, 'select id, org_id, storage_key, filename, content_type from files where id = $1', [t.file_id]))!;
    if (t.org_id !== ctx.org.id) await audit(pool, ctx, 'Downloaded site template', `${t.requirement_name} — ${file.filename} (version ${t.version})`, t.site_id);
    return sendFile(reply, file, true);
  });

  app.post('/api/templates/:id/archive', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireHostAdmin(ctx);
    requireWritable(ctx);
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    return withTx(async (db) => {
      const t = await one<TemplateRow>(db, 'select * from requirement_templates where id = $1 and org_id = $2 for update', [id, ctx.org.id]);
      if (!t) throw notFound();
      await db.query('update requirement_templates set archived_at = now() where id = $1 and archived_at is null', [id]);
      await audit(db, ctx, 'Removed site template', `${t.requirement_name} (version ${t.version})`, t.site_id);
      await publishChange(db, [ctx.org.id, ...(await contractorOrgsIn(db, t))]);
      return { ok: true };
    });
  });
}
