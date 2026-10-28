/**
 * Support access: an organisation's own admin lets COMVERA support look at the account for a limited
 * time (1 hour to 3 days), and can end it at any time. Read-only, names and statuses only, never file
 * contents (see routes/manager.ts). It works on a lapsed account too, since that is often when help is needed.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, pool, withTx } from '../db/pool.js';
import { requireAdmin, requireOrg } from '../lib/authz.js';
import { audit } from '../lib/audit.js';
import { rl } from './auth.js';

export default async function supportAccessRoutes(app: FastifyInstance) {
  async function status(orgId: string) {
    const active = await one<{ id: string; expires_at: Date; granted_by_name: string; reason: string }>(pool,
      `select id, expires_at, granted_by_name, reason from support_access_grants where org_id = $1 and revoked_at is null and expires_at > now() order by expires_at desc limit 1`, [orgId]);
    const history = await many<{ at: Date; by: string; until: Date; revokedAt: Date | null }>(pool,
      `select created_at as at, granted_by_name as by, expires_at as until, revoked_at as "revokedAt" from support_access_grants where org_id = $1 order by created_at desc limit 5`, [orgId]);
    return { active: active ? { expiresAt: active.expires_at, grantedBy: active.granted_by_name, reason: active.reason } : null, history };
  }

  app.get('/api/support-access', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    return status(ctx.org.id);
  });

  app.post('/api/support-access', rl(10), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    const b = z.object({ hours: z.coerce.number().int().min(1).max(72).default(24), reason: z.string().trim().max(300).default('') }).parse(req.body);
    await withTx(async (db) => {
      await db.query(`update support_access_grants set revoked_at = now() where org_id = $1 and revoked_at is null`, [ctx.org.id]);
      await db.query(
        `insert into support_access_grants (org_id, granted_by, granted_by_name, reason, expires_at) values ($1, $2, $3, $4, now() + ($5 || ' hours')::interval)`,
        [ctx.org.id, ctx.user.id, ctx.user.name, b.reason, String(b.hours)],
      );
      await audit(db, ctx, 'Allowed COMVERA support to view the account', `For ${b.hours} hour${b.hours === 1 ? '' : 's'}, read-only${b.reason ? ': ' + b.reason : ''}`);
    });
    return status(ctx.org.id);
  });

  app.post('/api/support-access/revoke', rl(20), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    await withTx(async (db) => {
      const r = await db.query(`update support_access_grants set revoked_at = now() where org_id = $1 and revoked_at is null and expires_at > now()`, [ctx.org.id]);
      if (r.rowCount) await audit(db, ctx, 'Ended COMVERA support access', '');
    });
    return status(ctx.org.id);
  });
}
