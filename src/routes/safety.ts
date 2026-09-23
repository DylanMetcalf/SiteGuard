import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, withTx, type Db } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { actorRole, canReview, isUuid, loadSite, requireOrg, requireReviewer, requireWritable, type OrgCtx } from '../lib/authz.js';
import { audit, clip } from '../lib/audit.js';
import { publishChange } from '../lib/realtime.js';
import { appUrl, queueToOrg } from '../lib/email.js';
import { INCIDENT_LABELS, PERMIT_LABELS } from '../lib/readiness.js';

const t = (max: number) => z.string().trim().max(max);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dateTime = z
  .string()
  .max(40)
  .refine((v) => !isNaN(Date.parse(v)), 'invalid date/time');
const optionalDateTime = dateTime.optional().or(z.literal('').transform(() => undefined));

const SEVERE_EMAIL = new Set(['lost_time', 'fatality', 'medical_treatment', 'environmental']);

/** Loads a child record and the site it belongs to, checking the caller can see that site. */
async function loadChild(db: Db, ctx: OrgCtx, table: 'incidents' | 'permits' | 'inspections', id: string) {
  if (!isUuid(id)) throw notFound();
  const row = await one<Record<string, any>>(db, `select * from ${table} where id = $1 for update`, [id]);
  if (!row) throw notFound();
  const access = await loadSite(db, ctx, row.site_id);
  return { row, ...access };
}

export default async function safetyRoutes(app: FastifyInstance) {
  // ---------------- Incidents ----------------
  app.post('/api/sites/:id/incidents', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const body = z
      .object({
        type: z.enum(['near_miss', 'first_aid', 'medical_treatment', 'lost_time', 'fatality', 'property_damage', 'environmental']),
        date: date.optional(),
        person: t(300).default(''),
        description: t(5000).min(1),
        actions: t(5000).default(''),
      })
      .parse(req.body);
    const { id } = req.params as { id: string };
    return withTx(async (db) => {
      const { site, parties } = await loadSite(db, ctx, id);
      const inc = (await one<{ id: string }>(
        db,
        `insert into incidents (site_id, type, occurred_on, person, description, immediate_actions, reported_by, reported_by_name, reported_by_role, reported_by_org_id)
         values ($1, $2, coalesce($3::date, current_date), $4, $5, $6, $7, $8, $9, $10) returning id`,
        [site.id, body.type, body.date ?? null, body.person, body.description, body.actions, ctx.user.id, ctx.user.name, actorRole(ctx), ctx.org.id],
      ))!;
      const label = INCIDENT_LABELS[body.type];
      await audit(db, ctx, 'Reported incident', `${label} — ${clip(body.description)}`, site.id);
      if (SEVERE_EMAIL.has(body.type)) {
        const lines = [
          `${ctx.user.name} (${ctx.org.name}) reported a ${label.toLowerCase()} on ${site.name}.`,
          clip(body.description, 400),
          ...(body.type === 'lost_time' || body.type === 'fatality'
            ? ['The site cannot be marked Site Ready until this investigation is closed. Statutory reporting obligations under the MHSA may apply outside SiteGuard.']
            : []),
        ];
        const mail = (to: { email: string }) => ({ to: to.email, subject: `${label} reported: ${site.name}`, lines, action: { label: 'Open incident', url: appUrl('/') } });
        await queueToOrg(db, site.org_id, ['owner', 'admin', 'reviewer'], mail);
        if (site.linked_org_id) await queueToOrg(db, site.linked_org_id, ['owner', 'admin'], mail);
      }
      await publishChange(db, parties);
      return { id: inc.id };
    });
  });

  app.patch('/api/incidents/:id', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireReviewer(ctx);
    requireWritable(ctx);
    const body = z.object({ rootCause: t(5000).default(''), correctiveActions: t(5000).default(''), close: z.boolean().default(false) }).parse(req.body);
    const { id } = req.params as { id: string };
    return withTx(async (db) => {
      const { row, side, parties } = await loadChild(db, ctx, 'incidents', id);
      if (side !== 'host') throw forbidden();
      if (row.status === 'closed') throw conflict('This incident is already closed.');
      if (body.close && (!body.rootCause || !body.correctiveActions)) {
        throw badRequest('Record the root cause and corrective actions before closing the incident.');
      }
      await db.query(
        `update incidents set root_cause = $2, corrective_actions = $3, status = $4, closed_at = case when $5 then now() else null end where id = $1`,
        [id, body.rootCause, body.correctiveActions, body.close ? 'closed' : 'investigating', body.close],
      );
      await audit(db, ctx, body.close ? 'Closed incident' : 'Updated investigation', INCIDENT_LABELS[row.type], row.site_id);
      await publishChange(db, parties);
      return { ok: true };
    });
  });

  // ---------------- Permits to work ----------------
  app.post('/api/sites/:id/permits', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const body = z
      .object({
        type: z.enum(['hot_work', 'heights', 'confined_space', 'excavation', 'lifting', 'electrical_isolation']),
        location: t(300).min(1),
        description: t(3000).default(''),
        precautions: t(3000).default(''),
        issuedTo: t(200).default(''),
        validFrom: optionalDateTime,
        validTo: optionalDateTime,
      })
      .parse(req.body);
    if (body.validFrom && body.validTo && Date.parse(body.validTo) <= Date.parse(body.validFrom)) {
      throw badRequest('"Valid to" must be after "valid from".');
    }
    const { id } = req.params as { id: string };
    return withTx(async (db) => {
      const { site, side, parties } = await loadSite(db, ctx, id);
      // Contractors request; site reviewers issue directly.
      const issuing = side === 'host';
      if (issuing) requireReviewer(ctx);
      const p = (await one<{ id: string }>(
        db,
        `insert into permits (site_id, type, location, description, precautions, issued_to, issued_by_name, requested_by_name, valid_from, valid_to, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
        [
          site.id, body.type, body.location, body.description, body.precautions, body.issuedTo,
          issuing ? ctx.user.name : '', issuing ? '' : ctx.user.name,
          body.validFrom ? new Date(body.validFrom) : null, body.validTo ? new Date(body.validTo) : null,
          issuing ? 'active' : 'pending',
        ],
      ))!;
      await audit(db, ctx, issuing ? 'Issued permit' : 'Requested permit', `${PERMIT_LABELS[body.type]} — ${body.location}`, site.id);
      if (!issuing) {
        await queueToOrg(db, site.org_id, ['owner', 'admin', 'reviewer'], (to) => ({
          to: to.email,
          subject: `Permit requested: ${PERMIT_LABELS[body.type]} on ${site.name}`,
          lines: [`${ctx.user.name} (${ctx.org.name}) requested a ${PERMIT_LABELS[body.type].toLowerCase()} permit at ${body.location}.`],
          action: { label: 'Review permit', url: appUrl('/') },
          dedupeKey: `permit-request:${p.id}:${to.email}`,
        }));
      }
      await publishChange(db, parties);
      return { id: p.id };
    });
  });

  app.post('/api/permits/:id/issue', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireReviewer(ctx);
    requireWritable(ctx);
    const body = z.object({ validFrom: optionalDateTime, validTo: optionalDateTime }).parse(req.body ?? {});
    const { id } = req.params as { id: string };
    return withTx(async (db) => {
      const { row, side, parties } = await loadChild(db, ctx, 'permits', id);
      if (side !== 'host') throw forbidden();
      if (row.status !== 'pending') throw conflict('Only pending permits can be issued.');
      const from = body.validFrom ? new Date(body.validFrom) : row.valid_from;
      const to = body.validTo ? new Date(body.validTo) : row.valid_to;
      if (!to) throw badRequest('Set when the permit expires ("valid to") before issuing it.');
      if (from && new Date(to) <= new Date(from)) throw badRequest('"Valid to" must be after "valid from".');
      await db.query(`update permits set status = 'active', issued_by_name = $2, valid_from = $3, valid_to = $4 where id = $1`, [id, ctx.user.name, from, to]);
      await audit(db, ctx, 'Issued permit', `${PERMIT_LABELS[row.type]} — ${row.location}`, row.site_id);
      await publishChange(db, parties);
      return { ok: true };
    });
  });

  app.post('/api/permits/:id/close', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const { notes } = z.object({ notes: t(3000).default('') }).parse(req.body ?? {});
    const { id } = req.params as { id: string };
    return withTx(async (db) => {
      const { row, side, parties } = await loadChild(db, ctx, 'permits', id);
      if (row.status === 'closed') throw conflict('This permit is already closed.');
      // Either party may close out a live permit; a pending request may be withdrawn by the contractor or refused by a reviewer.
      if (row.status === 'pending' && side === 'host' && !canReview(ctx)) throw forbidden();
      await db.query(`update permits set status = 'closed', closed_by_name = $2, closed_at = now(), close_notes = $3 where id = $1`, [id, ctx.user.name, notes]);
      await audit(db, ctx, row.status === 'pending' ? 'Withdrew permit request' : 'Closed out permit', `${PERMIT_LABELS[row.type]} — ${row.location}`, row.site_id);
      await publishChange(db, parties);
      return { ok: true };
    });
  });

  // ---------------- Site diary ----------------
  app.post('/api/sites/:id/diary', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const body = z
      .object({
        crew: z.coerce.number().int().min(0).max(100000).default(0),
        weather: t(200).default(''),
        summary: t(5000).min(1),
        incident: z.boolean().default(false),
        incidentNote: t(3000).default(''),
        date: date.optional(),
      })
      .parse(req.body);
    const { id } = req.params as { id: string };
    return withTx(async (db) => {
      const { site, parties } = await loadSite(db, ctx, id);
      const e = (await one<{ id: string }>(
        db,
        `insert into diary_entries (site_id, entry_date, author_id, author_name, crew, weather, summary, incident, incident_note)
         values ($1, coalesce($2::date, current_date), $3, $4, $5, $6, $7, $8, $9) returning id`,
        [site.id, body.date ?? null, ctx.user.id, ctx.user.name, body.crew, body.weather || 'Not recorded', body.summary, body.incident, body.incidentNote],
      ))!;
      await audit(db, ctx, body.incident ? 'Logged site diary — incident flagged' : 'Logged site diary', clip(body.summary), site.id);
      await publishChange(db, parties);
      return { id: e.id };
    });
  });

  // ---------------- Inspections & defects ----------------
  app.post('/api/sites/:id/inspections', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireReviewer(ctx);
    requireWritable(ctx);
    const body = z.object({ title: t(300).min(1), type: t(120).default('Inspection'), externalRef: t(200).default('') }).parse(req.body);
    const { id } = req.params as { id: string };
    return withTx(async (db) => {
      const { site, side, parties } = await loadSite(db, ctx, id);
      if (side !== 'host') throw forbidden();
      const i = (await one<{ id: string }>(
        db,
        `insert into inspections (site_id, title, type, inspector_name, inspected_on, external_ref) values ($1, $2, $3, $4, current_date, $5) returning id`,
        [site.id, body.title, body.type || 'Inspection', ctx.user.name, body.externalRef],
      ))!;
      await audit(db, ctx, 'Logged inspection', body.title, site.id);
      await publishChange(db, parties);
      return { id: i.id };
    });
  });

  app.post('/api/inspections/:id/defects', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireReviewer(ctx);
    requireWritable(ctx);
    const body = z
      .object({ description: t(3000).min(1), severity: z.enum(['high', 'medium', 'low']), assignedTo: t(200).default(''), dueDate: date.optional().or(z.literal('').transform(() => undefined)) })
      .parse(req.body);
    const { id } = req.params as { id: string };
    return withTx(async (db) => {
      const { row, side, site, parties } = await loadChild(db, ctx, 'inspections', id);
      if (side !== 'host') throw forbidden();
      const d = (await one<{ id: string }>(
        db,
        `insert into defects (inspection_id, description, severity, assigned_to, due_date) values ($1, $2, $3, $4, $5) returning id`,
        [id, body.description, body.severity, body.assignedTo || site.contractor_name, body.dueDate ?? null],
      ))!;
      await db.query(`update inspections set status = 'open' where id = $1`, [id]);
      await audit(db, ctx, 'Logged defect', clip(body.description), row.site_id);
      if (site.linked_org_id && body.severity === 'high') {
        await queueToOrg(db, site.linked_org_id, ['owner', 'admin'], (to) => ({
          to: to.email,
          subject: `High-severity defect on ${site.name}`,
          lines: [`${ctx.user.name} logged a high-severity defect during "${row.title}":`, clip(body.description, 400)],
          action: { label: 'Open SiteGuard', url: appUrl('/') },
        }));
      }
      await publishChange(db, parties);
      return { id: d.id };
    });
  });

  app.post('/api/defects/:id/:action', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const { id, action } = req.params as { id: string; action: string };
    if (!isUuid(id) || !['resolve', 'verify'].includes(action)) throw notFound();
    return withTx(async (db) => {
      const d = await one<{ id: string; inspection_id: string; status: string; description: string }>(
        db,
        'select id, inspection_id, status, description from defects where id = $1 for update',
        [id],
      );
      if (!d) throw notFound();
      const { row, side, parties } = await loadChild(db, ctx, 'inspections', d.inspection_id);
      if (action === 'resolve') {
        if (side !== 'contractor') throw forbidden('The contractor marks defects resolved; the site verifies them.');
        if (!['open', 'assigned'].includes(d.status)) throw conflict('This defect is not open.');
        await db.query(`update defects set status = 'resolved' where id = $1`, [id]);
        await audit(db, ctx, 'Marked defect resolved', clip(d.description), row.site_id);
      } else {
        requireReviewer(ctx);
        if (side !== 'host') throw forbidden();
        if (d.status !== 'resolved') throw conflict('Only resolved defects can be verified.');
        await db.query(`update defects set status = 'verified', closed_at = current_date where id = $1`, [id]);
        await audit(db, ctx, 'Verified & closed defect', clip(d.description), row.site_id);
        const open = await one(db, `select 1 from defects where inspection_id = $1 and status <> 'verified' limit 1`, [d.inspection_id]);
        if (!open) await db.query(`update inspections set status = 'closed' where id = $1`, [d.inspection_id]);
      }
      await publishChange(db, parties);
      return { ok: true };
    });
  });
}
