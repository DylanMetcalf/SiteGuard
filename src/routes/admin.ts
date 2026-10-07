/**
 * The operator's view of the whole service: sign-ups, plans, usage and health.
 * Only for the addresses in PLATFORM_ADMIN_EMAILS (with a confirmed email);
 * everyone else gets a 404, as if the page did not exist. Read-only, counts and
 * organisation names only — no documents, workers or personal details.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { many, one, pool, withTx } from '../db/pool.js';
import { isPlatformAdmin } from '../config.js';
import { conflict, notFound } from '../lib/errors.js';
import { isUuid, requireUser } from '../lib/authz.js';
import { PLANS } from '../lib/plans.js';
import { CODE_RE } from '../lib/promos.js';
import { DEFAULT_PRICING, pricingTable } from '../lib/pricing.js';
import { publishChange } from '../lib/realtime.js';

/** Platform admins only; everyone else is told the page does not exist. */
function requirePlatformAdmin(req: FastifyRequest) {
  const ctx = requireUser(req.ctx);
  if (!isPlatformAdmin(ctx.user)) throw notFound();
  return ctx;
}

/** Platform actions on a customer's account go into that customer's own audit trail. */
async function auditPlatform(db: import('../db/pool.js').Db, orgId: string, actor: string, action: string, detail: string) {
  await db.query(
    `insert into audit_events (org_id, actor_name, actor_role, action, detail) values ($1, $2, 'COMVERA platform', $3, $4)`,
    [orgId, actor, action, detail.slice(0, 500)],
  );
}

const planName = (id: string) => (PLANS as Record<string, { name: string }>)[id]?.name ?? id;

const n = (sql: string, params: unknown[] = []) => one<{ n: number }>(pool, sql, params).then((r) => r?.n ?? 0);

export default async function adminRoutes(app: FastifyInstance) {
  app.get('/api/admin/overview', async (req, reply) => {
    const ctx = requireUser(req.ctx);
    if (!isPlatformAdmin(ctx.user)) throw notFound();
    reply.header('cache-control', 'no-store');
    const real = `not o.is_demo and o.managed_by_org is null`;
    const [orgs, plans, statuses] = await Promise.all([
      many<{ kind: string; total: number; last30: number }>(pool,
        `select o.kind, count(*)::int as total, count(*) filter (where o.created_at > now() - interval '30 days')::int as last30
           from organisations o where ${real} group by o.kind order by o.kind`),
      many<{ plan: string; n: number }>(pool, `select o.plan, count(*)::int as n from organisations o where ${real} group by o.plan order by n desc`),
      many<{ status: string; n: number }>(pool, `select coalesce(o.subscription_status, 'none') as status, count(*)::int as n from organisations o where ${real} group by 1 order by n desc`),
    ]);
    const [users, active7, sites, projects, workplaces, docsFiled, studioDocs, safetyFiles, aiRequests] = await Promise.all([
      n(`select count(*)::int as n from users where not is_demo`),
      n(`select count(distinct s.user_id)::int as n from sessions s join users u on u.id = s.user_id where not u.is_demo and s.last_seen_at > now() - interval '7 days'`),
      n(`select count(*)::int as n from sites s join organisations o on o.id = s.org_id where not o.is_demo and o.managed_by_org is null`),
      n(`select count(*)::int as n from sites s join organisations o on o.id = s.org_id where not o.is_demo and o.managed_by_org is not null`),
      n(`select count(*)::int as n from workplaces w join organisations o on o.id = w.org_id where not o.is_demo`),
      n(`select count(*)::int as n from documents where current_file_id is not null`),
      n(`select count(*)::int as n from generated_documents g join organisations o on o.id = g.org_id where not o.is_demo`),
      n(`select count(*)::int as n from safety_file_versions`),
      n(`select coalesce(sum(requests), 0)::int as n from ai_usage where month = $1`, [new Date().toISOString().slice(0, 7)]),
    ]);
    const [emailFailed, emailStuck] = await Promise.all([
      n(`select count(*)::int as n from email_outbox where status = 'failed' and created_at > now() - interval '7 days'`),
      n(`select count(*)::int as n from email_outbox where status = 'pending' and send_after < now() - interval '1 hour'`),
    ]);
    const signups = await many(pool,
      `select o.name, o.kind, o.plan, coalesce(o.subscription_status, 'none') as status, o.created_at as "createdAt",
              (select count(*)::int from memberships m where m.org_id = o.id) as members
         from organisations o where ${real} order by o.created_at desc limit 15`);
    const feedback = await many(pool,
      `select f.kind, left(f.message, 300) as message, f.created_at as "createdAt", o.name as org
         from feedback f left join organisations o on o.id = f.org_id order by f.created_at desc limit 10`);
    return {
      generatedAt: new Date().toISOString(),
      organisations: orgs, plans: plans.map((p) => ({ ...p, plan: planName(p.plan) })), subscriptionStatus: statuses,
      usage: { users, activeUsers7d: active7, sites, projects, workplaces, documentsFiled: docsFiled, studioDocuments: studioDocs, safetyFileRevisions: safetyFiles, aiRequestsThisMonth: aiRequests },
      health: { emailFailed7d: emailFailed, emailStuck, uptimeSeconds: Math.round(process.uptime()) },
      recentSignups: signups.map((o: { plan: string }) => ({ ...o, plan: planName(o.plan) })),
      recentFeedback: feedback,
      enquiries: await many(pool, `select name, email, phone, company, topic, left(message, 500) as message, created_at as "createdAt" from enquiries order by created_at desc limit 10`),
    };
  });

  /* ---------- promo codes ---------- */
  app.get('/api/admin/promos', async (req) => {
    requirePlatformAdmin(req);
    return { promos: await many(pool, `select p.id, p.code, p.description, p.plan, p.percent_off as "percentOff", p.duration_days as "durationDays", p.org_kind as "orgKind",
        o.name as "orgName", p.expires_at as "expiresAt", p.max_redemptions as "maxRedemptions", p.redemptions, p.active, p.created_at as "createdAt"
        from promo_codes p left join organisations o on o.id = p.org_id order by p.created_at desc`) };
  });

  app.post('/api/admin/promos', async (req) => {
    const ctx = requirePlatformAdmin(req);
    const b = z.object({
      code: z.string().trim().regex(CODE_RE, 'Use 3–40 letters, numbers, dashes or underscores.'),
      description: z.string().trim().max(200).default(''),
      plan: z.string().refine((p) => !!PLANS[p] && PLANS[p].id !== 'contractor_free', 'Unknown plan'),
      percentOff: z.number().int().min(1).max(100).default(100),
      durationDays: z.number().int().min(1).max(3650).nullable().default(null),
      orgId: z.string().uuid().nullable().default(null),
      expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
      maxRedemptions: z.number().int().min(1).max(100000).nullable().default(null),
      stripeCoupon: z.string().trim().max(100).nullable().default(null),
    }).parse(req.body);
    if (b.percentOff < 100 && !b.stripeCoupon) throw conflict('A partial discount needs the matching Stripe coupon id.');
    if (b.orgId && !(await one(pool, 'select 1 from organisations where id = $1 and kind = $2', [b.orgId, PLANS[b.plan].kind]))) throw notFound('That organisation does not exist or is the wrong kind for this plan.');
    const row = await one<{ id: string }>(pool,
      `insert into promo_codes (code, description, plan, percent_off, duration_days, org_kind, org_id, expires_at, max_redemptions, stripe_coupon, created_by_name)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (code) do nothing returning id`,
      [b.code, b.description, b.plan, b.percentOff, b.durationDays, PLANS[b.plan].kind, b.orgId, b.expiresAt ? `${b.expiresAt}T23:59:59+02:00` : null, b.maxRedemptions, b.stripeCoupon, ctx.user.name]);
    if (!row) throw conflict('That code already exists.');
    req.log.info({ promo: b.code, by: ctx.user.email }, 'promo code created');
    return { id: row.id };
  });

  app.post('/api/admin/promos/:id/active', async (req) => {
    requirePlatformAdmin(req);
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    const r = await pool.query('update promo_codes set active = $2 where id = $1', [id, active]);
    if (!r.rowCount) throw notFound();
    return { ok: true };
  });

  /* ---------- organisations: find one, give or remove a plan (e.g. enterprise) ---------- */
  app.get('/api/admin/orgs', async (req) => {
    requirePlatformAdmin(req);
    const { q } = z.object({ q: z.string().trim().max(100).default('') }).parse(req.query);
    return { orgs: await many(pool,
      `select o.id, o.name, o.kind, o.plan, coalesce(o.subscription_status, 'none') as status, o.trial_ends_at as "trialEndsAt",
              o.grant_plan as "grantPlan", o.grant_until as "grantUntil", o.grant_source as "grantSource", o.created_at as "createdAt"
         from organisations o where not o.is_demo and o.managed_by_org is null and ($1 = '' or o.name ilike '%' || $1 || '%')
        order by o.created_at desc limit 25`, [q]) };
  });

  app.post('/api/admin/orgs/:id/grant', async (req) => {
    const ctx = requirePlatformAdmin(req);
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    const b = z.object({
      plan: z.string().nullable(),
      until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
      note: z.string().trim().max(100).default(''),
    }).parse(req.body);
    await withTx(async (db) => {
      const org = await one<{ kind: string; name: string }>(db, 'select kind, name from organisations where id = $1 and not is_demo and managed_by_org is null for update', [id]);
      if (!org) throw notFound();
      if (b.plan && (!PLANS[b.plan] || PLANS[b.plan].kind !== org.kind || b.plan === 'contractor_free')) throw conflict('That plan is not for this kind of organisation.');
      const until = b.until ? `${b.until}T23:59:59+02:00` : null;
      await db.query('update organisations set grant_plan = $2, grant_until = $3, grant_source = $4 where id = $1', [id, b.plan, b.plan ? until : null, b.plan ? `admin${b.note ? ': ' + b.note : ''}` : null]);
      await auditPlatform(db, id, ctx.user.name, b.plan ? 'Plan given by COMVERA' : 'Plan from COMVERA removed', b.plan ? `${PLANS[b.plan].name}${b.until ? ' until ' + b.until : ', no end date'}` : '');
      await publishChange(db, [id]);
    });
    return { ok: true };
  });

  /* ---------- pricing page ---------- */
  app.put('/api/admin/pricing/:planId', async (req) => {
    const ctx = requirePlatformAdmin(req);
    const { planId } = req.params as { planId: string };
    if (!DEFAULT_PRICING[planId]) throw notFound();
    const b = z.object({
      priceCents: z.number().int().min(0).max(100_000_000).nullable(),
      currency: z.string().regex(/^[A-Z]{3}$/).default('ZAR'),
      per: z.string().trim().min(1).max(40).default('month'),
      blurb: z.string().trim().max(300).nullable().default(null),
      highlights: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
      visible: z.boolean().default(true),
    }).parse(req.body);
    await pool.query(
      `insert into plan_settings (plan_id, price_cents, currency, per, blurb, highlights, visible, updated_by_name, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now())
       on conflict (plan_id) do update set price_cents = $2, currency = $3, per = $4, blurb = $5, highlights = $6, visible = $7, updated_by_name = $8, updated_at = now()`,
      [planId, b.priceCents, b.currency, b.per, b.blurb || null, b.highlights, b.visible, ctx.user.name]);
    return { ok: true };
  });

  app.get('/api/admin/pricing', async (req) => {
    requirePlatformAdmin(req);
    return { plans: await pricingTable(pool) };
  });
}
