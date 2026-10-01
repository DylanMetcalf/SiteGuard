/**
 * The operator's view of the whole service: sign-ups, plans, usage and health.
 * Only for the addresses in PLATFORM_ADMIN_EMAILS (with a confirmed email);
 * everyone else gets a 404, as if the page did not exist. Read-only, counts and
 * organisation names only — no documents, workers or personal details.
 */
import type { FastifyInstance } from 'fastify';
import { many, one, pool } from '../db/pool.js';
import { isPlatformAdmin } from '../config.js';
import { notFound } from '../lib/errors.js';
import { requireUser } from '../lib/authz.js';
import { PLANS } from '../lib/plans.js';

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
    };
  });
}
