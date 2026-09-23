/**
 * Demo sandboxes and the persona switcher.
 *
 * The role switcher from the original MVP survives only as a demo/QA tool:
 * it swaps the *session* to another demo user (whose real, server-enforced
 * permissions then apply). It works inside a demo sandbox, or anywhere when
 * DEV_ROLE_SWITCHER is on outside production. Real accounts can never be
 * switched into, and demo users cannot sign in with a password.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, pool, withTx, type Db } from '../db/pool.js';
import { features } from '../config.js';
import { forbidden, notFound, unavailable } from '../lib/errors.js';
import { requireUser, type OrgCtx } from '../lib/authz.js';
import { createSession, destroySession } from '../lib/sessions.js';
import { seedDemo } from '../demo/seed.js';
import { storage } from '../lib/storage.js';

export async function personasFor(db: Db, ctx: OrgCtx) {
  let group = ctx.org.is_demo ? ctx.org.demo_group : null;
  if (!group && features.devRoleSwitcher) {
    group = (await one<{ demo_group: string }>(db, `select demo_group from organisations where is_demo order by created_at desc limit 1`))?.demo_group ?? null;
  }
  if (!group) return null;
  return many(
    db,
    `select u.id as "userId", u.name, coalesce(nullif(u.title, ''), m.role) || ' · ' || o.name as label, (u.id = $2) as current
       from users u join memberships m on m.user_id = u.id join organisations o on o.id = m.org_id
      where o.demo_group = $1 and u.is_demo order by o.kind desc, m.role, u.name`,
    [group, ctx.user.id],
  );
}

export default async function demoRoutes(app: FastifyInstance) {
  app.post('/api/demo', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    if (!features.demo) throw unavailable('Demo sandboxes are turned off on this server.');
    await withTx(async (db) => {
      const { entryUserId } = await seedDemo(db);
      const u = (await one<{ last_active_org_id: string }>(db, 'select last_active_org_id from users where id = $1', [entryUserId]))!;
      if (req.ctx) await destroySession(db, reply, req.ctx.sessionId);
      await createSession(db, reply, req, entryUserId, u.last_active_org_id);
    });
    return { ok: true };
  });

  app.post('/api/demo/switch', async (req, reply) => {
    const ctx = requireUser(req.ctx);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.body);
    const target = await one<{ id: string; is_demo: boolean; last_active_org_id: string | null; demo_group: string | null }>(
      pool,
      `select u.id, u.is_demo, u.last_active_org_id, o.demo_group from users u left join organisations o on o.id = u.last_active_org_id where u.id = $1`,
      [userId],
    );
    if (!target || !target.is_demo) throw notFound();
    const inSameSandbox = ctx.org?.is_demo && ctx.org.demo_group && ctx.org.demo_group === target.demo_group;
    if (!inSameSandbox && !features.devRoleSwitcher) throw forbidden('Persona switching is only available inside a demo sandbox.');
    await withTx(async (db) => {
      await destroySession(db, reply, ctx.sessionId);
      await createSession(db, reply, req, target.id, target.last_active_org_id);
    });
    return { ok: true };
  });
}

/** Removes demo sandboxes older than the given age. */
export async function purgeOldDemos(days = 3): Promise<number> {
  const keys: string[] = [];
  const purged = await withTx(async (db) => {
    // Removing whole demo tenants is the one sanctioned way audit rows go away.
    await db.query(`set local siteguard.purge = 'on'`);
    const groups = await many<{ demo_group: string }>(
      db,
      `select distinct demo_group from organisations where is_demo and demo_group is not null and created_at < now() - make_interval(days => $1)`,
      [days],
    );
    for (const { demo_group } of groups) {
      for (const f of await many<{ storage_key: string }>(
        db,
        `select f.storage_key from files f join organisations o on o.id = f.org_id where o.demo_group = $1`,
        [demo_group],
      )) keys.push(f.storage_key);
      await db.query(
        `delete from users where is_demo and id in (select m.user_id from memberships m join organisations o on o.id = m.org_id where o.demo_group = $1)`,
        [demo_group],
      );
      // Sites reference contractors with ON DELETE RESTRICT, so drop sites first.
      await db.query(`delete from sites where org_id in (select id from organisations where demo_group = $1)`, [demo_group]);
      await db.query(`delete from organisations where demo_group = $1`, [demo_group]);
    }
    return groups.length;
  });
  // Objects go only after the rows are gone; a failure here just leaves an orphan.
  for (const key of keys) await storage.remove(key).catch(() => {});
  return purged;
}
