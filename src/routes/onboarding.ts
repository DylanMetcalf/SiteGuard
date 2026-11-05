/**
 * Guided set-up for a new organisation, and the departments / areas of a site.
 * Until set-up is complete the app only allows set-up itself (enforced in app.ts, not just in the page).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, pool, withTx } from '../db/pool.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { isUuid, requireAdmin, requireOrg, requireWritable } from '../lib/authz.js';
import { audit } from '../lib/audit.js';
import { publishChange } from '../lib/realtime.js';
import { onboardingStatus } from '../lib/onboarding.js';
import { track } from '../lib/events.js';
import { rl } from './auth.js';

const t = (n: number) => z.string().trim().max(n);

export default async function onboardingRoutes(app: FastifyInstance) {
  app.get('/api/onboarding', async (req, reply) => {
    const ctx = requireOrg(req.ctx);
    reply.header('cache-control', 'no-store');
    const org = (await one<Record<string, unknown> & { id: string; kind: string; name: string }>(pool,
      `select id, kind, name, reg_number, address, trade, onboarding, onboarding_completed_at from organisations where id = $1`, [ctx.org.id]))!;
    const [status, workplaces] = await Promise.all([
      onboardingStatus(pool, org),
      many(pool, `select w.id, w.name, w.location, coalesce((select json_agg(json_build_object('id', a.id, 'name', a.name, 'kind', a.kind) order by a.kind, a.name) from site_areas a where a.workplace_id = w.id), '[]'::json) as areas
                    from workplaces w where w.org_id = $1 and w.archived_at is null order by w.created_at`, [ctx.org.id]),
    ]);
    return { org: { id: org.id, kind: org.kind, name: org.name, regNumber: org.reg_number, address: org.address, trade: org.trade }, ...status, workplaces,
      canEdit: ['owner', 'admin'].includes(ctx.role) };
  });

  /** Saves one step. Partial answers are kept, so people can come back to it. */
  app.put('/api/onboarding/:step', rl(60), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    requireWritable(ctx);
    const { step } = z.object({ step: z.enum(['organisation', 'contact', 'services', 'documents', 'areas', 'connect']) }).parse(req.params);
    return withTx(async (db) => {
      const cur = ((await one<{ onboarding: Record<string, unknown> }>(db, 'select onboarding from organisations where id = $1 for update', [ctx.org.id]))!.onboarding) ?? {};
      const next: Record<string, unknown> = { ...cur };
      if (step === 'organisation') {
        const b = z.object({ name: t(200).min(1, 'Enter your organisation’s name.'), regNumber: t(60).default(''), address: t(400).default(''),
          phone: t(40).min(6, 'Enter a phone number for the organisation.') }).parse(req.body);
        await db.query(`update organisations set name = $2, reg_number = $3, address = $4 where id = $1`, [ctx.org.id, b.name, b.regNumber, b.address]);
        next.phone = b.phone;
      } else if (step === 'contact') {
        const b = z.object({ name: t(120).min(2, 'Enter the contact’s name.'), role: t(120).default(''), phone: t(40).default(''), email: z.string().trim().email('Enter a valid email address.').max(200).or(z.literal('')).default('') }).parse(req.body);
        if (!b.phone && !b.email) throw badRequest('Give a phone number or an email address for the contact.');
        next.contact = b;
      } else if (step === 'services') {
        const b = z.object({ trade: t(200).min(2, 'Describe what your company does.'), services: t(1000).default(''), industries: z.array(t(60)).max(12).default([]) }).parse(req.body);
        await db.query(`update organisations set trade = $2 where id = $1`, [ctx.org.id, b.trade]);
        next.services = b.services; next.industries = b.industries;
      } else if (step === 'documents') {
        next.documents = z.object({ answer: z.enum(['yes', 'no', 'later']) }).parse(req.body).answer;
      } else if (step === 'areas') {
        next.areasSkipped = z.object({ skipped: z.boolean() }).parse(req.body).skipped;
      } else {
        next.connectSkipped = z.object({ skipped: z.boolean() }).parse(req.body).skipped;
      }
      await db.query(`update organisations set onboarding = $2 where id = $1`, [ctx.org.id, JSON.stringify(next)]);
      await audit(db, ctx, 'Updated set-up', step);
      await publishChange(db, [ctx.org.id]);
      return { ok: true };
    });
  });

  /** Opens the app. Refused until every required step is done (checked here, from the real records). */
  app.post('/api/onboarding/complete', rl(20), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    return withTx(async (db) => {
      const org = (await one<{ id: string; kind: string; name: string; trade: string; onboarding: unknown; onboarding_completed_at: Date | null }>(db,
        `select id, kind, name, trade, onboarding, onboarding_completed_at from organisations where id = $1 for update`, [ctx.org.id]))!;
      const s = await onboardingStatus(db, org);
      if (!s.canComplete) throw conflict('Still to do: ' + s.missing.join(', ') + '.');
      if (!org.onboarding_completed_at) {
        await db.query(`update organisations set onboarding_completed_at = now() where id = $1`, [ctx.org.id]);
        await audit(db, ctx, 'Finished setting up COMVERA', '');
        await track(db, ctx.org.id, 'onboarding_completed');
      }
      await publishChange(db, [ctx.org.id]);
      return { ok: true };
    });
  });

  // ---------- departments and areas of a site ----------
  app.post('/api/workplaces/:id/areas', rl(60), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    requireWritable(ctx);
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    const b = z.object({ name: t(120).min(1, 'Name the department or area.'), kind: z.enum(['department', 'area']).default('area') }).parse(req.body);
    return withTx(async (db) => {
      const w = await one<{ name: string }>(db, `select name from workplaces where id = $1 and org_id = $2`, [id, ctx.org.id]);
      if (!w) throw notFound();
      const a = await one<{ id: string }>(db, `insert into site_areas (org_id, workplace_id, name, kind) values ($1, $2, $3, $4) on conflict (workplace_id, name) do nothing returning id`, [ctx.org.id, id, b.name, b.kind]);
      if (!a) throw conflict('That site already has a department or area with this name.');
      await audit(db, ctx, `Added ${b.kind}`, `${w.name}: ${b.name}`);
      await publishChange(db, [ctx.org.id]);
      return { id: a.id };
    });
  });

  app.delete('/api/workplaces/:id/areas/:areaId', rl(60), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    requireWritable(ctx);
    const { id, areaId } = req.params as { id: string; areaId: string };
    if (!isUuid(id) || !isUuid(areaId)) throw notFound();
    return withTx(async (db) => {
      const a = await one<{ name: string }>(db, `delete from site_areas where id = $1 and workplace_id = $2 and org_id = $3 returning name`, [areaId, id, ctx.org.id]);
      if (!a) throw notFound();
      await audit(db, ctx, 'Removed department or area', a.name);
      await publishChange(db, [ctx.org.id]);
      return { ok: true };
    });
  });
}
