import type { FastifyInstance, FastifyReply } from 'fastify';
import { many, one, pool, type Db } from '../db/pool.js';
import { notFound } from '../lib/errors.js';
import { isUuid, loadSite, requireOrg, type OrgCtx } from '../lib/authz.js';
import { contentDisposition, storage } from '../lib/storage.js';

interface FileRow {
  id: string;
  org_id: string;
  storage_key: string;
  filename: string;
  content_type: string;
}

async function anySiteVisible(db: Db, ctx: OrgCtx, siteIds: string[]): Promise<boolean> {
  for (const id of new Set(siteIds)) {
    try {
      await loadSite(db, ctx, id);
      return true;
    } catch {
      /* not visible — keep looking */
    }
  }
  return false;
}

/**
 * A file is readable by the organisation that uploaded it, and by the other
 * party on a site where it has been *submitted* (a document version, a worker
 * certificate for someone assigned to the site, or a site appointment).
 * Draft attachments that were never submitted stay private to the uploader.
 */
export async function canReadFile(db: Db, ctx: OrgCtx, file: FileRow): Promise<boolean> {
  if (file.org_id === ctx.org.id) return true;
  const sites = await many<{ site_id: string }>(
    db,
    `select r.site_id from document_versions v join documents d on d.id = v.document_id join requirements r on r.id = d.requirement_id
      where v.file_id = $1
     union
     select sw.site_id from worker_certificates wc join site_workers sw on sw.worker_id = wc.worker_id where wc.file_id = $1
     union
     select a.site_id from appointments a where a.file_id = $1 and a.site_id is not null`,
    [file.id],
  );
  return anySiteVisible(db, ctx, sites.map((s) => s.site_id));
}

export async function sendFile(reply: FastifyReply, file: FileRow, download: boolean) {
  const target = await storage.get(file.storage_key, file.filename, file.content_type);
  reply.header('cache-control', 'private, no-store');
  reply.header('x-content-type-options', 'nosniff');
  // Uploaded content is never allowed to run script in our origin.
  reply.header('content-security-policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
  if ('url' in target) return reply.redirect(target.url, 302);
  reply.header('content-type', file.content_type);
  reply.header('content-length', target.size);
  reply.header('content-disposition', contentDisposition(file.filename, !download));
  return reply.send(target.stream);
}

export default async function fileRoutes(app: FastifyInstance) {
  app.get('/api/files/:id', async (req, reply) => {
    const ctx = requireOrg(req.ctx);
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    const file = await one<FileRow>(pool, 'select id, org_id, storage_key, filename, content_type from files where id = $1', [id]);
    if (!file || !(await canReadFile(pool, ctx, file))) throw notFound();
    return sendFile(reply, file, (req.query as { download?: string }).download === '1');
  });
}
