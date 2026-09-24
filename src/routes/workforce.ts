/**
 * Per-worker records (medical fitness, induction, competency, training),
 * the legal appointments register, toolbox talk attendance with signatures,
 * and per-user dashboard preferences.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, pool, withTx, type Db } from '../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { isHost, isUuid, loadSite, requireAdmin, requireOrg, requireWritable, type OrgCtx } from '../lib/authz.js';
import { audit, clip } from '../lib/audit.js';
import { publishChange } from '../lib/realtime.js';
import { storeFile } from './documents.js';
import { fileUrl } from './bootstrap.js';
import { rl } from './auth.js';

const t = (max: number) => z.string().trim().max(max);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optDate = date.optional().or(z.literal('').transform(() => undefined));
const optUuid = z.string().uuid().optional().or(z.literal('').transform(() => undefined));

const d = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Site viewers ("Site Staff") on the host side can't manage records. */
function requireEditor(ctx: OrgCtx) {
  if (isHost(ctx) && ctx.role === 'member') throw forbidden('Your role is view-only for this.');
}

async function ownWorker(db: Db, ctx: OrgCtx, id: string) {
  if (!isUuid(id)) throw notFound();
  const w = await one<{ id: string; full_name: string }>(db, 'select id, full_name from workers where id = $1 and org_id = $2', [id, ctx.org.id]);
  if (!w) throw notFound();
  return w;
}

async function ownFile(db: Db, ctx: OrgCtx, fileId: string | undefined) {
  if (!fileId) return null;
  const f = await one<{ id: string }>(db, 'select id from files where id = $1 and org_id = $2', [fileId, ctx.org.id]);
  if (!f) throw notFound('File not found.');
  return f.id;
}

/** Sites (visible to the caller) that a worker is assigned to → organisations to notify. */
async function workerParties(db: Db, ctx: OrgCtx, workerId: string): Promise<string[]> {
  const rows = await many<{ org_id: string; linked_org_id: string | null }>(
    db,
    `select s.org_id, c.linked_org_id from site_workers sw join sites s on s.id = sw.site_id join contractors c on c.id = s.contractor_id
      where sw.worker_id = $1`,
    [workerId],
  );
  return [ctx.org.id, ...rows.flatMap((r) => [r.org_id, r.linked_org_id ?? ''])].filter(Boolean);
}

export async function workforceState(db: Db, ctx: OrgCtx, activeSiteIds: string[]) {
  const workers: Record<string, any> = {};
  const siteWorkers: Record<string, string[]> = {};
  for (const id of activeSiteIds) siteWorkers[id] = [];

  const rows = await many(
    db,
    `select w.*, o.name as org_name,
            coalesce((select array_agg(sw.site_id) from site_workers sw where sw.worker_id = w.id and sw.site_id = any($2::uuid[])), '{}') as site_ids
       from workers w join organisations o on o.id = w.org_id
      where w.org_id = $1
         or exists (select 1 from site_workers sw where sw.worker_id = w.id and sw.site_id = any($2::uuid[]))
      order by w.full_name`,
    [ctx.org.id, activeSiteIds],
  );
  for (const w of rows) {
    workers[w.id] = {
      id: w.id, name: w.full_name, employeeNo: w.employee_no, idLast4: w.id_last4, occupation: w.occupation, phone: w.phone,
      active: w.active, own: w.org_id === ctx.org.id, orgName: w.org_name, siteIds: w.site_ids, certificates: [],
    };
    for (const s of w.site_ids as string[]) siteWorkers[s]?.push(w.id);
  }
  if (rows.length) {
    const certs = await many(
      db,
      `select c.*, f.filename from worker_certificates c left join files f on f.id = c.file_id
        where c.worker_id = any($1::uuid[]) order by c.kind, c.expires_on nulls last`,
      [rows.map((w) => w.id)],
    );
    for (const c of certs) {
      workers[c.worker_id].certificates.push({
        id: c.id, kind: c.kind, name: c.name, issuer: c.issuer, issuedOn: c.issued_on, expiresOn: c.expires_on,
        restrictions: c.restrictions, fileUrl: fileUrl(c.file_id), fileName: c.filename,
      });
    }
  }

  const appointments = (
    await many(
      db,
      `select a.*, o.name as org_name, f.filename from appointments a join organisations o on o.id = a.org_id
         left join files f on f.id = a.file_id
        where a.org_id = $1 or a.site_id = any($2::uuid[])
        order by a.revoked_at nulls first, a.start_date desc`,
      [ctx.org.id, activeSiteIds],
    )
  ).map((a) => ({
    id: a.id, siteId: a.site_id, appointeeName: a.appointee_name, workerId: a.worker_id, type: a.appointment_type,
    legalReference: a.legal_reference, appointedBy: a.appointed_by, startDate: a.start_date, endDate: a.end_date,
    fileUrl: fileUrl(a.file_id), fileName: a.filename, revokedAt: d(a.revoked_at), own: a.org_id === ctx.org.id, orgName: a.org_name,
  }));

  const toolboxTalks: Record<string, any[]> = {};
  for (const id of activeSiteIds) toolboxTalks[id] = [];
  if (activeSiteIds.length) {
    const talks = await many(
      db,
      `select tt.*, o.name as org_name from toolbox_talks tt join organisations o on o.id = tt.org_id
        where tt.site_id = any($1::uuid[]) order by tt.held_on desc, tt.created_at desc`,
      [activeSiteIds],
    );
    const byId: Record<string, any> = {};
    for (const tt of talks) {
      byId[tt.id] = { id: tt.id, siteId: tt.site_id, topic: tt.topic, content: tt.content, presenter: tt.presenter_name, heldOn: tt.held_on, orgName: tt.org_name, attendance: [] };
      toolboxTalks[tt.site_id].push(byId[tt.id]);
    }
    if (talks.length) {
      for (const a of await many(db, `select id, talk_id, worker_id, attendee_name, signed_at from toolbox_attendance where talk_id = any($1::uuid[]) order by signed_at`, [talks.map((x) => x.id)])) {
        byId[a.talk_id].attendance.push({ id: a.id, workerId: a.worker_id, name: a.attendee_name, signedAt: d(a.signed_at), signatureUrl: `/api/toolbox-attendance/${a.id}/signature` });
      }
    }
  }

  const prefs = await one<{ dashboard: object }>(db, 'select dashboard from user_prefs where user_id = $1 and org_id = $2', [ctx.user.id, ctx.org.id]);

  return { workers, siteWorkers, appointments, toolboxTalks, dashboardPrefs: prefs?.dashboard ?? {} };
}

export default async function workforceRoutes(app: FastifyInstance) {
  /** Generic private upload (certificates, appointment letters). Returns a file id owned by the caller's org. */
  app.post('/api/uploads', rl(60), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    requireEditor(ctx);
    const file = await req.file();
    if (!file) throw badRequest('Attach a file.');
    const buf = await file.toBuffer();
    if (!buf.length) throw badRequest('That file is empty.');
    const f = await withTx((db) => storeFile(db, ctx, buf, file.filename, file.mimetype));
    return { fileId: f.id, fileName: f.filename };
  });

  // ---- workers ----
  const workerBody = z.object({
    fullName: t(200).min(1),
    employeeNo: t(60).default(''),
    idLast4: z.string().trim().regex(/^[0-9A-Za-z]{0,4}$/, 'last 4 characters only').default(''),
    occupation: t(120).default(''),
    phone: t(60).default(''),
  });

  app.post('/api/workers', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    requireEditor(ctx);
    const b = workerBody.parse(req.body);
    return withTx(async (db) => {
      const w = (await one<{ id: string }>(
        db,
        `insert into workers (org_id, full_name, employee_no, id_last4, occupation, phone) values ($1, $2, $3, $4, $5, $6) returning id`,
        [ctx.org.id, b.fullName, b.employeeNo, b.idLast4, b.occupation, b.phone],
      ))!;
      await audit(db, ctx, 'Added worker', b.fullName);
      await publishChange(db, [ctx.org.id]);
      return { id: w.id };
    });
  });

  app.patch('/api/workers/:id', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    requireEditor(ctx);
    const b = workerBody.partial().extend({ active: z.boolean().optional() }).parse(req.body);
    const { id } = req.params as { id: string };
    await withTx(async (db) => {
      const w = await ownWorker(db, ctx, id);
      await db.query(
        `update workers set full_name = coalesce($2, full_name), employee_no = coalesce($3, employee_no), id_last4 = coalesce($4, id_last4),
                occupation = coalesce($5, occupation), phone = coalesce($6, phone), active = coalesce($7, active) where id = $1`,
        [id, b.fullName ?? null, b.employeeNo ?? null, b.idLast4 ?? null, b.occupation ?? null, b.phone ?? null, b.active ?? null],
      );
      await audit(db, ctx, b.active === false ? 'Deactivated worker' : 'Updated worker', w.full_name);
      await publishChange(db, await workerParties(db, ctx, id));
    });
    return { ok: true };
  });

  app.post('/api/workers/:id/certificates', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    requireEditor(ctx);
    const b = z
      .object({
        kind: z.enum(['medical_fitness', 'induction', 'competency', 'training', 'other']),
        name: t(200).min(1),
        issuer: t(200).default(''),
        issuedOn: optDate,
        expiresOn: optDate,
        restrictions: t(1000).default(''),
        fileId: optUuid,
      })
      .parse(req.body);
    const { id } = req.params as { id: string };
    return withTx(async (db) => {
      const w = await ownWorker(db, ctx, id);
      const fileId = await ownFile(db, ctx, b.fileId);
      const c = (await one<{ id: string }>(
        db,
        `insert into worker_certificates (worker_id, kind, name, issuer, issued_on, expires_on, restrictions, file_id, created_by_name)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [id, b.kind, b.name, b.issuer, b.issuedOn ?? null, b.expiresOn ?? null, b.restrictions, fileId, ctx.user.name],
      ))!;
      await audit(db, ctx, 'Recorded worker certificate', `${w.full_name} — ${b.name}${b.expiresOn ? ` (expires ${b.expiresOn})` : ''}`);
      await publishChange(db, await workerParties(db, ctx, id));
      return { id: c.id };
    });
  });

  app.delete('/api/certificates/:id', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    requireEditor(ctx);
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    await withTx(async (db) => {
      const c = await one<{ worker_id: string; name: string; full_name: string }>(
        db,
        `select c.worker_id, c.name, w.full_name from worker_certificates c join workers w on w.id = c.worker_id where c.id = $1 and w.org_id = $2`,
        [id, ctx.org.id],
      );
      if (!c) throw notFound();
      const parties = await workerParties(db, ctx, c.worker_id);
      await db.query('delete from worker_certificates where id = $1', [id]);
      await audit(db, ctx, 'Removed worker certificate', `${c.full_name} — ${c.name}`);
      await publishChange(db, parties);
    });
    return { ok: true };
  });

  app.post('/api/sites/:id/workers', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const { workerId } = z.object({ workerId: z.string().uuid() }).parse(req.body);
    const { id } = req.params as { id: string };
    await withTx(async (db) => {
      const { site, side, parties } = await loadSite(db, ctx, id);
      if (side !== 'contractor') throw forbidden('The contractor assigns their own workers to a site.');
      const w = await ownWorker(db, ctx, workerId);
      await db.query('insert into site_workers (site_id, worker_id) values ($1, $2) on conflict do nothing', [site.id, workerId]);
      await audit(db, ctx, 'Assigned worker to site', w.full_name, site.id);
      await publishChange(db, parties);
    });
    return { ok: true };
  });

  app.delete('/api/sites/:id/workers/:workerId', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const { id, workerId } = req.params as { id: string; workerId: string };
    await withTx(async (db) => {
      const { site, side, parties } = await loadSite(db, ctx, id);
      if (side !== 'contractor') throw forbidden();
      const w = await ownWorker(db, ctx, workerId);
      await db.query('delete from site_workers where site_id = $1 and worker_id = $2', [site.id, workerId]);
      await audit(db, ctx, 'Removed worker from site', w.full_name, site.id);
      await publishChange(db, parties);
    });
    return { ok: true };
  });

  // ---- legal appointments register ----
  app.post('/api/appointments', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    requireWritable(ctx);
    const b = z
      .object({
        siteId: optUuid,
        appointeeName: t(200).min(1),
        workerId: optUuid,
        appointmentType: t(200).min(1),
        legalReference: t(200).default(''),
        appointedBy: t(200).default(''),
        startDate: date,
        endDate: optDate,
        fileId: optUuid,
      })
      .parse(req.body);
    if (b.endDate && b.endDate < b.startDate) throw badRequest('End date must be after the start date.');
    return withTx(async (db) => {
      let parties = [ctx.org.id];
      if (b.siteId) parties = (await loadSite(db, ctx, b.siteId)).parties;
      if (b.workerId) await ownWorker(db, ctx, b.workerId);
      const fileId = await ownFile(db, ctx, b.fileId);
      const a = (await one<{ id: string }>(
        db,
        `insert into appointments (org_id, site_id, appointee_name, worker_id, appointment_type, legal_reference, appointed_by, start_date, end_date, file_id, created_by_name)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
        [ctx.org.id, b.siteId ?? null, b.appointeeName, b.workerId ?? null, b.appointmentType, b.legalReference, b.appointedBy || ctx.user.name, b.startDate, b.endDate ?? null, fileId, ctx.user.name],
      ))!;
      await audit(db, ctx, 'Recorded appointment', `${b.appointeeName} — ${b.appointmentType}`, b.siteId ?? null);
      await publishChange(db, parties);
      return { id: a.id };
    });
  });

  app.post('/api/appointments/:id/revoke', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    requireWritable(ctx);
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    await withTx(async (db) => {
      const a = await one<{ site_id: string | null; appointee_name: string; appointment_type: string; revoked_at: Date | null }>(
        db,
        'select site_id, appointee_name, appointment_type, revoked_at from appointments where id = $1 and org_id = $2 for update',
        [id, ctx.org.id],
      );
      if (!a) throw notFound();
      if (a.revoked_at) throw conflict('Already revoked.');
      await db.query('update appointments set revoked_at = now() where id = $1', [id]);
      await audit(db, ctx, 'Revoked appointment', `${a.appointee_name} — ${a.appointment_type}`, a.site_id);
      const parties = a.site_id ? (await loadSite(db, ctx, a.site_id)).parties : [ctx.org.id];
      await publishChange(db, parties);
    });
    return { ok: true };
  });

  // ---- toolbox talks ----
  app.post('/api/sites/:id/toolbox-talks', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    requireEditor(ctx);
    const b = z.object({ topic: t(300).min(1), content: t(20000).default(''), heldOn: optDate, presenter: t(200).optional() }).parse(req.body);
    const { id } = req.params as { id: string };
    return withTx(async (db) => {
      const { site, parties } = await loadSite(db, ctx, id);
      const tt = (await one<{ id: string }>(
        db,
        `insert into toolbox_talks (site_id, org_id, topic, content, presenter_name, held_on) values ($1, $2, $3, $4, $5, coalesce($6::date, current_date)) returning id`,
        [site.id, ctx.org.id, b.topic, b.content, b.presenter || ctx.user.name, b.heldOn ?? null],
      ))!;
      await audit(db, ctx, 'Recorded toolbox talk', b.topic, site.id);
      await publishChange(db, parties);
      return { id: tt.id };
    });
  });

  app.post('/api/toolbox-talks/:id/attendance', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    requireEditor(ctx);
    const b = z
      .object({
        attendeeName: t(200).min(1),
        workerId: optUuid,
        signature: z.string().max(120000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'must be a PNG signature'),
      })
      .parse(req.body);
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    return withTx(async (db) => {
      const tt = await one<{ site_id: string; topic: string }>(db, 'select site_id, topic from toolbox_talks where id = $1', [id]);
      if (!tt) throw notFound();
      const { parties } = await loadSite(db, ctx, tt.site_id);
      if (b.workerId) {
        const ok = await one(
          db,
          `select 1 from workers w where w.id = $1 and (w.org_id = $2 or exists (select 1 from site_workers sw where sw.worker_id = w.id and sw.site_id = $3))`,
          [b.workerId, ctx.org.id, tt.site_id],
        );
        if (!ok) throw notFound('Worker not found.');
      }
      const a = (await one<{ id: string }>(
        db,
        `insert into toolbox_attendance (talk_id, worker_id, attendee_name, signature) values ($1, $2, $3, $4) returning id`,
        [id, b.workerId ?? null, b.attendeeName, b.signature],
      ))!;
      await audit(db, ctx, 'Signed toolbox talk attendance', `${b.attendeeName} — ${clip(tt.topic)}`, tt.site_id);
      await publishChange(db, parties);
      return { id: a.id };
    });
  });

  app.get('/api/toolbox-attendance/:id/signature', async (req, reply) => {
    const ctx = requireOrg(req.ctx);
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    const a = await one<{ signature: string; site_id: string }>(
      pool,
      `select a.signature, t.site_id from toolbox_attendance a join toolbox_talks t on t.id = a.talk_id where a.id = $1`,
      [id],
    );
    if (!a) throw notFound();
    await loadSite(pool, ctx, a.site_id);
    const png = Buffer.from(a.signature.split(',')[1], 'base64');
    reply.header('content-type', 'image/png').header('cache-control', 'private, max-age=86400');
    return reply.send(png);
  });

  // ---- dashboard preferences ----
  app.put('/api/me/dashboard', async (req) => {
    const ctx = requireOrg(req.ctx);
    const b = z
      .object({ order: z.array(z.string().max(40)).max(30).default([]), hidden: z.array(z.string().max(40)).max(30).default([]) })
      .parse(req.body);
    await pool.query(
      `insert into user_prefs (user_id, org_id, dashboard) values ($1, $2, $3)
       on conflict (user_id, org_id) do update set dashboard = excluded.dashboard`,
      [ctx.user.id, ctx.org.id, JSON.stringify(b)],
    );
    return { ok: true };
  });

}
