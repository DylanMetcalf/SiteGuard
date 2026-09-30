/**
 * Contractor projects: a contractor builds a safety file for a client or site
 * that isn't on SiteGuard (yet). The client is a private record the contractor
 * owns (an organisation with managed_by_org set, which nobody can sign in to),
 * and the project is an ordinary safety file for that client. Everything else
 * (the guide, Document Studio, the builder, workers, the bound PDF, revisions
 * and share links) works on it unchanged. Nobody reviews a project file inside
 * SiteGuard, so submissions are filed as they are and the file never shows
 * "Site Ready"; the contractor sends it to the client as a PDF or a share link.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, withTx, type Db } from '../db/pool.js';
import { canAdminOrg, isContractor, isUuid, limitsEnforced, loadSite, requireOrg, requireWritable, type OrgCtx } from '../lib/authz.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { publishChange } from '../lib/realtime.js';
import { itemsFromPacks } from '../lib/templates.js';
import { planOf } from '../lib/plans.js';
import { emergencySchema, packIdsSchema, requirementSchema, text } from './sites.js';

function requireContractorAdmin(ctx: OrgCtx) {
  if (!isContractor(ctx) || !canAdminOrg(ctx)) throw forbidden('Only contractor owners and admins can set up projects.');
}

/** A project the caller's company owns, locked for changes. */
async function loadProject(db: Db, ctx: OrgCtx, id: string) {
  const access = await loadSite(db, ctx, id);
  if (!access.site.project || access.side !== 'contractor') throw notFound();
  await db.query('select id from sites where id = $1 for update', [id]);
  return access;
}

/** The contractor's private record for a client, reused when the same client name comes up again. */
async function clientRecord(db: Db, ctx: OrgCtx, name: string): Promise<string> {
  const found = await one<{ id: string }>(db, 'select id from organisations where managed_by_org = $1 and lower(name) = lower($2)', [ctx.org.id, name]);
  if (found) return found.id;
  const me = (await one<{ is_demo: boolean; demo_group: string | null }>(db, 'select is_demo, demo_group from organisations where id = $1', [ctx.org.id]))!;
  const org = (await one<{ id: string }>(
    db,
    `insert into organisations (name, kind, plan, subscription_status, seat_limit, managed_by_org, is_demo, demo_group)
     values ($1, 'host', 'host_starter', 'free', 1, $2, $3, $4) returning id`,
    [name, ctx.org.id, me.is_demo, me.demo_group],
  ))!;
  return org.id;
}

/** The contractor's own entry in a client record's directory (one per client). */
async function myEntryAt(db: Db, ctx: OrgCtx, clientId: string): Promise<string> {
  const found = await one<{ id: string }>(db, 'select id from contractors where org_id = $1 and linked_org_id = $2', [clientId, ctx.org.id]);
  if (found) return found.id;
  return (await one<{ id: string }>(
    db,
    `insert into contractors (org_id, name, trade, linked_org_id) values ($1, $2, $3, $4) returning id`,
    [clientId, ctx.org.name, ctx.org.trade ?? '', ctx.org.id],
  ))!.id;
}

export default async function projectRoutes(app: FastifyInstance) {
  app.post('/api/projects', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireContractorAdmin(ctx);
    requireWritable(ctx);
    const body = z
      .object({
        clientName: text(200).min(1),
        clientContact: text(300).default(''),
        name: text(300).min(1),
        location: text(300).default(''),
        packIds: packIdsSchema.default([]),
        requirements: z.array(requirementSchema).max(200).default([]),
        copyFromSiteId: z.string().optional(),
        emergency: emergencySchema.optional(),
      })
      .parse(req.body);
    return withTx(async (db) => {
      await db.query('select id from organisations where id = $1 for update', [ctx.org.id]);
      const limit = planOf(ctx.org).projectLimit;
      if (limitsEnforced() && limit !== null) {
        const n = Number((await one<{ n: number }>(db, `select count(*)::int as n from sites s join organisations o on o.id = s.org_id where o.managed_by_org = $1 and s.status <> 'declined'`, [ctx.org.id]))!.n);
        if (n >= limit) throw new HttpError(402, 'project_limit', `Your plan includes ${limit} project${limit === 1 ? '' : 's'}. Upgrade to Contractor Pro under Plan & billing for unlimited projects.`);
      }
      const clientId = await clientRecord(db, ctx, body.clientName);
      const contractor = { id: await myEntryAt(db, ctx, clientId) };
      const site = (await one<{ id: string }>(
        db,
        `insert into sites (org_id, name, location, contractor_id, status, emergency, client_contact, created_by)
         values ($1, $2, $3, $4, 'in_progress', $5, $6, $7) returning id`,
        [clientId, body.name, body.location, contractor.id, JSON.stringify(body.emergency ?? {}), body.clientContact, ctx.user.id],
      ))!;
      // Requirements: copied from one of the contractor's own files if asked, then any starter packs, then anything typed.
      let reqs: { category: string; name: string; source: string; why: string }[] = [];
      if (body.copyFromSiteId) {
        const from = await loadSite(db, ctx, body.copyFromSiteId);
        reqs = await many(db, 'select category, name, source, why from requirements where site_id = $1 order by position, created_at', [from.site.id]);
      }
      reqs = reqs.concat(itemsFromPacks(body.packIds, reqs.map((r) => r.name)));
      for (const r of body.requirements) if (!reqs.some((x) => x.name.toLowerCase() === r.name.toLowerCase())) reqs.push(r);
      for (const [i, r] of reqs.entries()) {
        await db.query(`insert into requirements (site_id, category, name, source, why, position) values ($1, $2, $3, $4, $5, $6)`, [site.id, r.category, r.name, r.source, r.why, i]);
      }
      await audit(db, ctx, 'Created project', `${body.name} for ${body.clientName} (${reqs.length} requirement${reqs.length === 1 ? '' : 's'})`, site.id);
      await publishChange(db, [ctx.org.id]);
      return { id: site.id, requirements: reqs.length };
    });
  });

  app.patch('/api/projects/:id', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireContractorAdmin(ctx);
    requireWritable(ctx);
    const body = z
      .object({ name: text(300).min(1).optional(), location: text(300).optional(), clientName: text(200).min(1).optional(), clientContact: text(300).optional(), emergency: emergencySchema.optional() })
      .parse(req.body);
    return withTx(async (db) => {
      await db.query('select id from organisations where id = $1 for update', [ctx.org.id]);
      const { site } = await loadProject(db, ctx, (req.params as { id: string }).id);
      let orgId = site.org_id;
      if (body.clientName && body.clientName !== site.host_name && body.clientName.toLowerCase() === site.host_name.toLowerCase()) {
        // Only the spelling changed: correct the client record itself (it's this contractor's own).
        await db.query('update organisations set name = $2 where id = $1 and managed_by_org = $3', [site.org_id, body.clientName, ctx.org.id]);
      } else if (body.clientName && body.clientName.toLowerCase() !== site.host_name.toLowerCase()) {
        // Move the project to another client record; the contractor entry moves with it.
        orgId = await clientRecord(db, ctx, body.clientName);
      }
      const contractorId = orgId === site.org_id ? site.contractor_id : await myEntryAt(db, ctx, orgId);
      await db.query(
        `update sites set org_id = $2, contractor_id = $7, name = coalesce($3, name), location = coalesce($4, location), client_contact = coalesce($5, client_contact),
                emergency = case when $6::jsonb is null then emergency else emergency || $6::jsonb end
          where id = $1`,
        [site.id, orgId, body.name ?? null, body.location ?? null, body.clientContact ?? null, body.emergency ? JSON.stringify(body.emergency) : null, contractorId],
      );
      if (orgId !== site.org_id) await dropEmptyClient(db, site.org_id);
      await audit(db, ctx, 'Updated project', [body.name && 'name', body.location !== undefined && 'location', body.clientName && 'client', body.clientContact !== undefined && 'client contact', body.emergency && 'emergency info'].filter(Boolean).join(', ') || 'no changes', site.id);
      await publishChange(db, [ctx.org.id]);
      return { ok: true };
    });
  });

  app.post('/api/projects/:id/requirements', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireContractorAdmin(ctx);
    requireWritable(ctx);
    const body = z.object({ packIds: packIdsSchema.default([]), requirements: z.array(requirementSchema).max(200).default([]) }).parse(req.body);
    return withTx(async (db) => {
      const { site } = await loadProject(db, ctx, (req.params as { id: string }).id);
      const existing = await many<{ name: string }>(db, 'select name from requirements where site_id = $1', [site.id]);
      const have = new Set(existing.map((r) => r.name.toLowerCase()));
      const add = [...itemsFromPacks(body.packIds, existing.map((r) => r.name)), ...body.requirements].filter((r) => {
        const k = r.name.toLowerCase();
        if (have.has(k)) return false;
        have.add(k);
        return true;
      });
      if (!add.length) throw badRequest('Those requirements are already on this project.');
      for (const r of add) {
        await db.query(
          `insert into requirements (site_id, category, name, source, why, position)
           values ($1, $2, $3, $4, $5, coalesce((select max(position) + 1 from requirements where site_id = $1), 0))`,
          [site.id, r.category, r.name, r.source, r.why],
        );
      }
      await audit(db, ctx, 'Added project requirements', add.map((r) => r.name).slice(0, 10).join(', ') + (add.length > 10 ? ` and ${add.length - 10} more` : ''), site.id);
      await publishChange(db, [ctx.org.id]);
      return { added: add.length };
    });
  });

  app.post('/api/projects/:id/requirements/:reqId/remove', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireContractorAdmin(ctx);
    requireWritable(ctx);
    const { id, reqId } = req.params as { id: string; reqId: string };
    if (!isUuid(reqId)) throw notFound();
    return withTx(async (db) => {
      const { site } = await loadProject(db, ctx, id);
      const r = await one<{ name: string }>(db, 'select name from requirements where id = $1 and site_id = $2', [reqId, site.id]);
      if (!r) throw notFound();
      const hasHistory = await one(db, `select 1 from documents dd join document_versions v on v.document_id = dd.id where dd.requirement_id = $1 limit 1`, [reqId]);
      if (hasHistory) throw conflict('A document has already been filed against this requirement, so it stays on the record.');
      await db.query('delete from requirements where id = $1', [reqId]);
      await audit(db, ctx, 'Removed project requirement', r.name, site.id);
      await publishChange(db, [ctx.org.id]);
      return { ok: true };
    });
  });

  /**
   * Archives a project: it disappears from the contractor's lists. Nothing is deleted, because the
   * audit trail and any filed documents are the record of what was prepared and sent.
   */
  app.post('/api/projects/:id/archive', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireContractorAdmin(ctx);
    requireWritable(ctx);
    return withTx(async (db) => {
      const { site } = await loadProject(db, ctx, (req.params as { id: string }).id);
      await db.query(`update sites set status = 'declined' where id = $1`, [site.id]);
      // Links sent to the client stop working when the project is archived.
      await db.query('update share_links set revoked_at = now() where site_id = $1 and revoked_at is null', [site.id]);
      await audit(db, ctx, 'Archived project', `${site.name} for ${site.host_name}`, site.id);
      await publishChange(db, [ctx.org.id]);
      return { ok: true };
    });
  });
}

/** A client record with no projects left is removed. */
async function dropEmptyClient(db: Db, orgId: string) {
  const used = await one(db, 'select 1 from sites where org_id = $1 limit 1', [orgId]);
  if (!used) {
    await db.query('delete from contractors where org_id = $1', [orgId]);
    await db.query('delete from organisations where id = $1 and managed_by_org is not null', [orgId]);
  }
}
