import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, withTx, type Db } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { actorRole, isUuid, loadSite, requireOrg, requireReviewer, requireWritable, type OrgCtx } from '../lib/authz.js';
import { audit } from '../lib/audit.js';
import { publishChange } from '../lib/realtime.js';
import { appUrl, queueEmail, queueToOrg } from '../lib/email.js';

async function loadRequest(db: Db, ctx: OrgCtx, id: string) {
  if (!isUuid(id)) throw notFound();
  const row = await one<Record<string, any>>(db, 'select * from info_requests where id = $1 for update', [id]);
  if (!row) throw notFound();
  const access = await loadSite(db, ctx, row.site_id);
  return { row, ...access };
}

const requestBody = z.object({
  type: z.enum(['document', 'information', 'feedback']),
  title: z.string().trim().min(1).max(300),
  message: z.string().trim().max(5000).default(''),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('').transform(() => undefined)),
});
type RequestBody = z.infer<typeof requestBody> & { linkedReqId?: string };

async function sendRequest(db: Db, ctx: OrgCtx, site: { id: string; name: string; contractor_name: string; linked_org_id: string | null }, body: RequestBody): Promise<string> {
  const r = (await one<{ id: string }>(
    db,
    `insert into info_requests (site_id, type, title, message, due_date, requested_by, requested_by_name, requested_by_role, linked_requirement_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [site.id, body.type, body.title, body.message, body.dueDate ?? null, ctx.user.id, ctx.user.name, actorRole(ctx), body.linkedReqId ?? null],
  ))!;
  await audit(db, ctx, 'Sent request', `${body.title} → ${site.contractor_name}`, site.id);
  if (site.linked_org_id) {
    await queueToOrg(db, site.linked_org_id, null, (to) => ({
      to: to.email,
      subject: `${ctx.org.name} requested: ${body.title}`,
      lines: [
        `${ctx.user.name} (${ctx.org.name}) sent a ${body.type} request for ${site.name}${body.dueDate ? `, due ${body.dueDate}` : ''}:`,
        body.message || body.title,
      ],
      action: { label: 'Respond in SiteGuard', url: appUrl('/') },
    }));
  }
  return r.id;
}

export default async function requestRoutes(app: FastifyInstance) {
  app.post('/api/sites/:id/requests', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireReviewer(ctx);
    requireWritable(ctx);
    const body = requestBody.extend({ linkedReqId: z.string().uuid().optional().or(z.literal('').transform(() => undefined)) }).parse(req.body);
    const { id } = req.params as { id: string };
    return withTx(async (db) => {
      const { site, side, parties } = await loadSite(db, ctx, id);
      if (side !== 'host') throw forbidden();
      if (body.linkedReqId && !(await one(db, 'select 1 from requirements where id = $1 and site_id = $2', [body.linkedReqId, site.id]))) {
        throw notFound('That requirement is not on this site.');
      }
      const r = await sendRequest(db, ctx, site, body);
      await publishChange(db, parties);
      return { id: r };
    });
  });

  /**
   * One request to every contractor on a site (or the ones the mine picks), e.g.
   * "Updated Letter of Good Standing by 30 November". Each contractor gets its own
   * request on its own file; when the request names a requirement, each is linked
   * to that contractor's requirement of the same name.
   */
  app.post('/api/workplaces/:id/requests', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireReviewer(ctx);
    requireWritable(ctx);
    const body = requestBody.extend({ requirementName: z.string().trim().max(300).optional(), siteIds: z.array(z.string().uuid()).max(500).optional() }).parse(req.body);
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    return withTx(async (db) => {
      if (!(await one(db, 'select 1 from workplaces where id = $1 and org_id = $2', [id, ctx.org.id]))) throw notFound();
      const files = await many<{ id: string }>(
        db,
        `select id from sites where workplace_id = $1 and org_id = $2 and status <> 'declined'${body.siteIds ? ' and id = any($3::uuid[])' : ''}`,
        body.siteIds ? [id, ctx.org.id, body.siteIds] : [id, ctx.org.id],
      );
      if (!files.length) throw badRequest('No contractors on this site to ask yet.');
      const parties = new Set<string>([ctx.org.id]);
      for (const f of files) {
        const { site } = await loadSite(db, ctx, f.id);
        const linked = body.requirementName
          ? await one<{ id: string }>(db, 'select id from requirements where site_id = $1 and lower(name) = lower($2)', [site.id, body.requirementName])
          : null;
        await sendRequest(db, ctx, site, { ...body, linkedReqId: linked?.id });
        if (site.linked_org_id) parties.add(site.linked_org_id);
      }
      await publishChange(db, [...parties]);
      return { sent: files.length };
    });
  });

  app.post('/api/requests/:id/viewed', async (req) => {
    const ctx = requireOrg(req.ctx);
    const { id } = req.params as { id: string };
    return withTx(async (db) => {
      const { row, side, parties } = await loadRequest(db, ctx, id);
      if (side === 'contractor' && row.status === 'requested') {
        await db.query(`update info_requests set status = 'viewed' where id = $1`, [id]);
        await publishChange(db, parties);
      }
      return { ok: true };
    });
  });

  app.post('/api/requests/:id/respond', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const { text } = z.object({ text: z.string().trim().min(1).max(5000) }).parse(req.body);
    const { id } = req.params as { id: string };
    return withTx(async (db) => {
      const { row, side, site, parties } = await loadRequest(db, ctx, id);
      if (side !== 'contractor') throw forbidden('Only the contractor responds to requests.');
      if (row.status === 'completed') throw conflict('This request is already completed.');
      await db.query(`update info_requests set response = $2, responded_at = now(), status = 'submitted' where id = $1`, [id, text]);
      await audit(db, ctx, 'Responded to request', row.title, row.site_id);
      const requester = row.requested_by
        ? await one<{ email: string; is_demo: boolean }>(db, 'select email, is_demo from users where id = $1', [row.requested_by])
        : null;
      if (requester && !requester.is_demo) {
        await queueEmail(db, {
          orgId: site.org_id,
          to: requester.email,
          subject: `Response received: ${row.title}`,
          lines: [`${ctx.org.name} responded to your request on ${site.name}:`, text],
          action: { label: 'Review response', url: appUrl('/') },
        });
      }
      await publishChange(db, parties);
      return { ok: true };
    });
  });

  app.post('/api/requests/:id/complete', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireReviewer(ctx);
    requireWritable(ctx);
    const { id } = req.params as { id: string };
    return withTx(async (db) => {
      const { row, side, parties } = await loadRequest(db, ctx, id);
      if (side !== 'host') throw forbidden();
      if (row.status === 'completed') throw conflict('Already completed.');
      await db.query(`update info_requests set status = 'completed' where id = $1`, [id]);
      await audit(db, ctx, 'Marked request completed', row.title, row.site_id);
      await publishChange(db, parties);
      return { ok: true };
    });
  });
}
