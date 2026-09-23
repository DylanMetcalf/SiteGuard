import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, pool, withTx, type Db } from '../db/pool.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/errors.js';
import {
  actorRole, canAdminOrg, isUuid, limitsEnforced, loadSite, requireHostAdmin, requireOrg, requireReviewer, requireWritable, type OrgCtx,
} from '../lib/authz.js';
import { audit } from '../lib/audit.js';
import { publishChange } from '../lib/realtime.js';
import { appUrl, queueEmail, queueToOrg } from '../lib/email.js';
import { newToken, sha256, shortCode } from '../lib/security.js';
import { computeReadiness, openSevereIncidents } from '../lib/readiness.js';
import { planOf } from '../lib/plans.js';
import { requireVerified } from './org.js';
import { acceptSiteInvitation } from './auth.js';

const text = (max: number) => z.string().trim().max(max);
const emergencySchema = z.object({ musterPoint: text(300), contact: text(300), hospital: text(300) }).partial();
const requirementSchema = z.object({
  category: text(80).min(1),
  name: text(200).min(1),
  source: z.enum(['legal', 'client', 'site', 'project', 'company', 'best_practice', 'platform']),
  why: text(1000).default(''),
});
const newContractorSchema = z.object({
  name: text(200).min(1),
  trade: text(120).default(''),
  contact: text(200).default(''),
  email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal('').transform(() => undefined)),
});

async function resolveContractor(db: Db, ctx: OrgCtx, contractorId: string | undefined, fresh: z.infer<typeof newContractorSchema> | undefined) {
  if (contractorId) {
    if (!isUuid(contractorId)) throw notFound();
    const c = await one<{ id: string; name: string; contact_email: string | null; linked_org_id: string | null }>(
      db,
      'select id, name, contact_email, linked_org_id from contractors where id = $1 and org_id = $2',
      [contractorId, ctx.org.id],
    );
    if (!c) throw notFound('Contractor not found.');
    return c;
  }
  if (!fresh) throw badRequest('Choose a contractor or enter a new one.');
  const c = (await one<{ id: string; name: string; contact_email: string | null; linked_org_id: string | null }>(
    db,
    `insert into contractors (org_id, name, trade, contact_name, contact_email) values ($1, $2, $3, $4, $5)
     returning id, name, contact_email, linked_org_id`,
    [ctx.org.id, fresh.name, fresh.trade, fresh.contact, fresh.email ?? null],
  ))!;
  await audit(db, ctx, 'Added contractor', fresh.name);
  return c;
}

/** Creates a pending invitation and emails whoever should see it. */
async function inviteContractor(
  db: Db,
  ctx: OrgCtx,
  site: { id: string; name: string },
  contractor: { id: string; name: string; contact_email: string | null; linked_org_id: string | null },
) {
  await db.query(`update site_invitations set status = 'revoked' where site_id = $1 and status = 'pending'`, [site.id]);
  const token = newToken();
  await db.query(
    `insert into site_invitations (site_id, org_id, contractor_id, email, token_hash) values ($1, $2, $3, $4, $5)`,
    [site.id, ctx.org.id, contractor.id, contractor.contact_email, sha256(token)],
  );
  const lines = [
    `${ctx.org.name} has invited ${contractor.name} to work on "${site.name}" and submit a safety file through SiteGuard.`,
    'Accepting shows you exactly which documents the site needs and tracks your readiness as you upload them. SiteGuard is free for contractors.',
  ];
  const action = { label: 'View invitation', url: appUrl(`/site-invite?token=${token}`) };
  if (contractor.contact_email) {
    await queueEmail(db, { orgId: ctx.org.id, to: contractor.contact_email, subject: `${ctx.org.name} invited you to a site on SiteGuard`, lines, action });
  }
  if (contractor.linked_org_id) {
    // Already on SiteGuard: tell their admins too; they can also accept in-app.
    await queueToOrg(db, contractor.linked_org_id, ['owner', 'admin'], (to) => ({
      to: to.email,
      subject: `New site invitation from ${ctx.org.name}`,
      lines,
      action: { label: 'Open SiteGuard', url: appUrl('/') },
    }));
  }
  await audit(db, ctx, 'Invited contractor', `${contractor.name} to ${site.name}`, site.id);
}

export async function declineSiteInvitation(db: Db, ctx: OrgCtx, invitationId: string, viaToken = false) {
  const inv = await one<{ id: string; site_id: string; org_id: string; status: string; linked_org_id: string | null; site_name: string; contractor_id: string }>(
    db,
    `select i.id, i.site_id, i.org_id, i.status, c.linked_org_id, s.name as site_name, i.contractor_id
       from site_invitations i join contractors c on c.id = i.contractor_id join sites s on s.id = i.site_id
      where i.id = $1 for update of i`,
    [invitationId],
  );
  if (!inv) throw notFound();
  if (!viaToken && inv.linked_org_id !== ctx.org.id) throw notFound();
  if (viaToken && inv.linked_org_id && inv.linked_org_id !== ctx.org.id) throw forbidden('This invitation was sent to a different contractor company.');
  if (ctx.org.kind !== 'contractor' || !canAdminOrg(ctx)) throw forbidden('Only contractor owners and admins can respond to site invitations.');
  if (inv.status !== 'pending') throw conflict(`This invitation has already been ${inv.status}.`);
  await db.query(`update site_invitations set status = 'declined', responded_at = now(), responded_by = $2 where id = $1`, [inv.id, ctx.user.id]);
  await db.query(`update sites set status = 'declined' where id = $1 and status = 'invited'`, [inv.site_id]);
  await audit(db, ctx, 'Declined invitation', inv.site_name, inv.site_id);
  await queueToOrg(db, inv.org_id, ['owner', 'admin'], (to) => ({
    to: to.email,
    subject: `${ctx.org.name} declined an invitation`,
    lines: [`${ctx.org.name} declined the invitation to "${inv.site_name}". You can assign a different contractor from the site's page.`],
    action: { label: 'Open site', url: appUrl('/') },
  }));
  await publishChange(db, [inv.org_id, ctx.org.id]);
}

export default async function siteRoutes(app: FastifyInstance) {
  app.post('/api/sites', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireHostAdmin(ctx);
    requireWritable(ctx);
    const body = z
      .object({
        name: text(300).min(1),
        location: text(300).default(''),
        contractorId: z.string().optional(),
        newContractor: newContractorSchema.optional(),
        templateSiteId: z.string().optional(),
        requirements: z.array(requirementSchema).max(200).optional(),
        emergency: emergencySchema.optional(),
      })
      .parse(req.body);
    if (body.newContractor?.email) requireVerified(ctx);
    return withTx(async (db) => {
      await db.query('select id from organisations where id = $1 for update', [ctx.org.id]);
      const limit = planOf(ctx.org).siteLimit;
      if (limitsEnforced() && limit !== null) {
        const n = Number((await one<{ n: number }>(db, `select count(*) as n from sites where org_id = $1 and status <> 'declined'`, [ctx.org.id]))!.n);
        if (n >= limit) throw new HttpError(402, 'site_limit', `Your plan includes ${limit} active sites. Upgrade under Billing to add more.`);
      }
      const contractor = await resolveContractor(db, ctx, body.contractorId || undefined, body.newContractor);
      const site = (await one<{ id: string; name: string }>(
        db,
        `insert into sites (org_id, name, location, contractor_id, emergency, created_by) values ($1, $2, $3, $4, $5, $6) returning id, name`,
        [ctx.org.id, body.name, body.location, contractor.id, JSON.stringify(body.emergency ?? {}), ctx.user.id],
      ))!;
      let reqs = body.requirements ?? [];
      if (body.templateSiteId) {
        if (!isUuid(body.templateSiteId)) throw notFound();
        reqs = await many(
          db,
          `select r.category, r.name, r.source, r.why from requirements r join sites s on s.id = r.site_id
            where r.site_id = $1 and s.org_id = $2 order by r.position, r.created_at`,
          [body.templateSiteId, ctx.org.id],
        );
      }
      for (const [i, r] of reqs.entries()) {
        await db.query(
          `insert into requirements (site_id, category, name, source, why, position) values ($1, $2, $3, $4, $5, $6)`,
          [site.id, r.category, r.name, r.source, r.why, i],
        );
      }
      await audit(db, ctx, 'Created site', body.name, site.id);
      await inviteContractor(db, ctx, site, contractor);
      await publishChange(db, [ctx.org.id, ...(contractor.linked_org_id ? [contractor.linked_org_id] : [])]);
      return { id: site.id, contractorName: contractor.name };
    });
  });

  app.patch('/api/sites/:id', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireHostAdmin(ctx);
    requireWritable(ctx);
    const { id } = req.params as { id: string };
    const body = z.object({ name: text(300).min(1).optional(), location: text(300).optional(), emergency: emergencySchema.optional() }).parse(req.body);
    await withTx(async (db) => {
      const { site, side, parties } = await loadSite(db, ctx, id);
      if (side !== 'host') throw forbidden();
      await db.query(
        `update sites set name = coalesce($2, name), location = coalesce($3, location),
                emergency = case when $4::jsonb is null then emergency else emergency || $4::jsonb end
          where id = $1`,
        [site.id, body.name ?? null, body.location ?? null, body.emergency ? JSON.stringify(body.emergency) : null],
      );
      await audit(db, ctx, 'Updated site', [body.name && 'name', body.location !== undefined && 'location', body.emergency && 'emergency info'].filter(Boolean).join(', '), site.id);
      await publishChange(db, parties);
    });
    return { ok: true };
  });

  app.post('/api/sites/:id/reassign', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireHostAdmin(ctx);
    requireWritable(ctx);
    const { id } = req.params as { id: string };
    const body = z.object({ contractorId: z.string().optional(), newContractor: newContractorSchema.optional() }).parse(req.body);
    if (body.newContractor?.email) requireVerified(ctx);
    return withTx(async (db) => {
      const { site, side, parties } = await loadSite(db, ctx, id);
      if (side !== 'host') throw forbidden();
      if (site.status !== 'declined' && site.status !== 'invited') {
        throw conflict('A contractor is already working on this site. Reassignment is only possible before they accept.');
      }
      const contractor = await resolveContractor(db, ctx, body.contractorId || undefined, body.newContractor);
      await db.query(`update sites set contractor_id = $2, status = 'invited' where id = $1`, [site.id, contractor.id]);
      await inviteContractor(db, ctx, site, contractor);
      await publishChange(db, [...parties, ...(contractor.linked_org_id ? [contractor.linked_org_id] : [])]);
      return { ok: true };
    });
  });

  app.post('/api/sites/:id/resend-invitation', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireHostAdmin(ctx);
    requireWritable(ctx);
    requireVerified(ctx);
    const { id } = req.params as { id: string };
    await withTx(async (db) => {
      const { site, side, parties } = await loadSite(db, ctx, id);
      if (side !== 'host') throw forbidden();
      if (site.status !== 'invited') throw conflict('There is no pending invitation on this site.');
      const c = (await one<{ id: string; name: string; contact_email: string | null; linked_org_id: string | null }>(
        db, 'select id, name, contact_email, linked_org_id from contractors where id = $1', [site.contractor_id],
      ))!;
      if (!c.contact_email && !c.linked_org_id) throw badRequest('Add a contact email for this contractor first.');
      await inviteContractor(db, ctx, site, c);
      await publishChange(db, parties);
    });
    return { ok: true };
  });

  // ---- requirements (template editing) ----
  app.post('/api/sites/:id/requirements', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireHostAdmin(ctx);
    requireWritable(ctx);
    const { id } = req.params as { id: string };
    const body = requirementSchema.parse(req.body);
    return withTx(async (db) => {
      const { site, side, parties } = await loadSite(db, ctx, id);
      if (side !== 'host') throw forbidden();
      const r = (await one<{ id: string }>(
        db,
        `insert into requirements (site_id, category, name, source, why, position)
         values ($1, $2, $3, $4, $5, coalesce((select max(position) + 1 from requirements where site_id = $1), 0)) returning id`,
        [site.id, body.category, body.name, body.source, body.why],
      ))!;
      await audit(db, ctx, 'Added requirement', body.name, site.id);
      await publishChange(db, parties);
      return { id: r.id };
    });
  });

  app.delete('/api/requirements/:id', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireHostAdmin(ctx);
    requireWritable(ctx);
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    await withTx(async (db) => {
      const r = await one<{ site_id: string; name: string }>(db, 'select site_id, name from requirements where id = $1', [id]);
      if (!r) throw notFound();
      const { side, parties } = await loadSite(db, ctx, r.site_id);
      if (side !== 'host') throw forbidden();
      const hasHistory = await one(db, `select 1 from documents dd join document_versions v on v.document_id = dd.id where dd.requirement_id = $1 limit 1`, [id]);
      if (hasHistory) throw conflict('Documents have already been submitted against this requirement, so it stays on the record.');
      await db.query('delete from requirements where id = $1', [id]);
      await audit(db, ctx, 'Removed requirement', r.name, r.site_id);
      await publishChange(db, parties);
    });
    return { ok: true };
  });

  // ---- contractor directory ----
  app.patch('/api/contractors/:id', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireHostAdmin(ctx);
    requireWritable(ctx);
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    const body = z
      .object({
        name: text(200).min(1).optional(), trade: text(120).optional(), contact: text(200).optional(),
        email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal('')),
        reg: text(60).optional(), coid: text(60).optional(),
      })
      .parse(req.body);
    await withTx(async (db) => {
      const c = await one<{ name: string }>(
        db,
        `update contractors set name = coalesce($3, name), trade = coalesce($4, trade), contact_name = coalesce($5, contact_name),
                contact_email = case when $6::text is null then contact_email when $6 = '' then null else $6 end,
                reg_number = coalesce($7, reg_number), coid_number = coalesce($8, coid_number)
          where id = $1 and org_id = $2 returning name`,
        [id, ctx.org.id, body.name ?? null, body.trade ?? null, body.contact ?? null, body.email ?? null, body.reg ?? null, body.coid ?? null],
      );
      if (!c) throw notFound();
      await audit(db, ctx, 'Updated contractor', c.name);
      await publishChange(db, [ctx.org.id]);
    });
    return { ok: true };
  });

  // ---- in-app accept/decline (contractor side) ----
  app.post('/api/invitations/:id/:decision', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const { id, decision } = req.params as { id: string; decision: string };
    if (!isUuid(id) || !['accept', 'decline'].includes(decision)) throw notFound();
    return withTx(async (db) => {
      const inv = await one<{ linked_org_id: string | null }>(
        db,
        `select c.linked_org_id from site_invitations i join contractors c on c.id = i.contractor_id where i.id = $1`,
        [id],
      );
      // In-app, only invitations addressed to an already-linked organisation are visible.
      if (!inv || inv.linked_org_id !== ctx.org.id) throw notFound();
      if (decision === 'accept') return acceptSiteInvitation(db, ctx, id);
      await declineSiteInvitation(db, ctx, id);
      return { ok: true };
    });
  });

  // ---- Site Ready approval ----
  app.post('/api/sites/:id/approve', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireReviewer(ctx);
    requireWritable(ctx);
    const { id } = req.params as { id: string };
    return withTx(async (db) => {
      const { site, side, parties } = await loadSite(db, ctx, id);
      if (side !== 'host') throw forbidden();
      await db.query('select id from sites where id = $1 for update', [site.id]);
      if (site.status === 'site_ready') throw conflict('This site is already approved.');
      if (site.status !== 'in_progress') throw conflict('The contractor must accept the invitation before the site can be approved.');
      if (await openSevereIncidents(db, site.id)) {
        throw conflict("Can't approve — an open lost time injury or fatality investigation needs closing first.");
      }
      const r = await computeReadiness(db, site.id);
      if (r.submission !== 'ready_to_approve') {
        throw conflict('Every requirement must be complete (and none expiring) before the site can be marked Site Ready.');
      }
      const verificationId = `SG-${new Date().getFullYear()}-${shortCode(8)}`;
      const prev = await one<{ version: string }>(db, 'select version from approvals where site_id = $1', [site.id]);
      const version = prev ? `v${parseInt(prev.version.slice(1), 10) + 1}.0` : 'v1.0';
      await db.query(
        `insert into approvals (site_id, approver_id, approver_name, approver_role, org_name, approved_on, version, verification_id, readiness_percent)
         values ($1, $2, $3, $4, $5, current_date, $6, $7, $8)
         on conflict (site_id) do update set approver_id = excluded.approver_id, approver_name = excluded.approver_name,
           approver_role = excluded.approver_role, org_name = excluded.org_name, approved_on = excluded.approved_on,
           version = excluded.version, verification_id = excluded.verification_id, readiness_percent = excluded.readiness_percent`,
        [site.id, ctx.user.id, ctx.user.name, actorRole(ctx), ctx.org.name, version, verificationId, r.percent],
      );
      await db.query(`update sites set status = 'site_ready' where id = $1`, [site.id]);
      await audit(db, ctx, 'Approved — Site Ready', `${site.name} (${r.percent}% readiness at approval)`, site.id);
      if (site.linked_org_id) {
        await queueToOrg(db, site.linked_org_id, null, (to) => ({
          to: to.email,
          subject: `${site.name} is Site Ready`,
          lines: [`${ctx.org.name} approved your safety file for "${site.name}". The site is now marked Site Ready (verification ${verificationId}).`],
          action: { label: 'View verification', url: appUrl(`/verify/${verificationId}`) },
        }));
      }
      await publishChange(db, parties);
      return { verificationId };
    });
  });

  app.get('/api/sites/:id/readiness', async (req) => {
    const ctx = requireOrg(req.ctx);
    const { id } = req.params as { id: string };
    await loadSite(pool, ctx, id);
    return computeReadiness(pool, id);
  });
}
