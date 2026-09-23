import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, pool, withTx } from '../db/pool.js';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../lib/errors.js';
import {
  requireAdmin, requireOrg, requireWritable, rolesFor, isUuid, limitsEnforced, roleLabel, type OrgCtx, type Role,
} from '../lib/authz.js';
import { newToken, sha256 } from '../lib/security.js';
import { appUrl, queueEmail } from '../lib/email.js';
import { audit } from '../lib/audit.js';
import { publishChange } from '../lib/realtime.js';
import type { Db } from '../db/pool.js';
import { rl } from './auth.js';

export async function seatsUsed(db: Db, orgId: string): Promise<number> {
  const r = await one<{ n: number }>(
    db,
    `select (select count(*) from memberships where org_id = $1)
          + (select count(*) from user_invites where org_id = $1 and accepted_at is null and revoked_at is null and expires_at > now()) as n`,
    [orgId],
  );
  return Number(r?.n ?? 0);
}

async function ownerCount(db: Db, orgId: string): Promise<number> {
  return Number((await one<{ n: number }>(db, `select count(*) as n from memberships where org_id = $1 and role = 'owner'`, [orgId]))?.n ?? 0);
}

export function requireVerified(ctx: OrgCtx) {
  if (!ctx.user.email_verified_at && !ctx.user.is_demo) {
    throw forbidden('Confirm your email address before inviting people — check your inbox, or resend the confirmation from your profile.');
  }
}

export default async function orgRoutes(app: FastifyInstance) {
  app.patch('/api/org', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    requireWritable(ctx);
    const s = z.string().trim().max(200);
    const body = z
      .object({ name: s.min(1).optional(), reg_number: s.optional(), coid_number: s.optional(), vat_number: s.optional(), address: z.string().trim().max(400).optional(), trade: s.optional() })
      .parse(req.body);
    await withTx(async (db) => {
      const sets: string[] = [];
      const vals: unknown[] = [ctx.org.id];
      for (const [k, v] of Object.entries(body)) {
        if (v === undefined) continue;
        vals.push(v);
        sets.push(`${k} = $${vals.length}`);
      }
      if (!sets.length) return;
      await db.query(`update organisations set ${sets.join(', ')} where id = $1`, vals);
      await audit(db, ctx, 'Updated organisation profile', Object.keys(body).join(', '));
      await publishChange(db, [ctx.org.id]);
    });
    return { ok: true };
  });

  app.get('/api/org/members', async (req) => {
    const ctx = requireOrg(req.ctx);
    const members = await many(
      pool,
      `select u.id, u.name, u.email, u.title, m.role, m.created_at, (u.email_verified_at is not null) as verified
         from memberships m join users u on u.id = m.user_id where m.org_id = $1 order by m.created_at`,
      [ctx.org.id],
    );
    const invites = ['owner', 'admin'].includes(ctx.role)
      ? await many(
          pool,
          `select id, email, role, created_at, expires_at from user_invites
            where org_id = $1 and accepted_at is null and revoked_at is null and expires_at > now() order by created_at`,
          [ctx.org.id],
        )
      : [];
    return {
      members,
      invites,
      seatLimit: ctx.org.seat_limit,
      seatsUsed: await seatsUsed(pool, ctx.org.id),
      limitsEnforced: limitsEnforced(),
      roles: rolesFor(ctx.org.kind).map((r) => ({ id: r, label: roleLabel(ctx.org.kind, r) })),
    };
  });

  app.post('/api/org/invites', rl(20), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    requireWritable(ctx);
    requireVerified(ctx);
    const body = z
      .object({ email: z.string().trim().toLowerCase().email().max(254), role: z.enum(['owner', 'admin', 'reviewer', 'member']) })
      .parse(req.body);
    if (!rolesFor(ctx.org.kind).includes(body.role)) throw badRequest('That role is not available for this kind of organisation.');
    if (body.role === 'owner' && ctx.role !== 'owner') throw forbidden('Only owners can invite another owner.');
    return withTx(async (db) => {
      await db.query('select id from organisations where id = $1 for update', [ctx.org.id]);
      if (await one(db, `select 1 from memberships m join users u on u.id = m.user_id where m.org_id = $1 and u.email = $2`, [ctx.org.id, body.email])) {
        throw conflict('That person is already a member.');
      }
      await db.query(
        `update user_invites set revoked_at = now() where org_id = $1 and email = $2 and accepted_at is null and revoked_at is null`,
        [ctx.org.id, body.email],
      );
      if (limitsEnforced() && (await seatsUsed(db, ctx.org.id)) >= ctx.org.seat_limit) {
        throw new HttpError(
          402,
          'seat_limit',
          `All ${ctx.org.seat_limit} seats are in use. Add seats under Billing, or remove someone first.`,
        );
      }
      const token = newToken();
      const inv = (await one<{ id: string }>(
        db,
        `insert into user_invites (org_id, email, role, token_hash, invited_by, expires_at)
         values ($1, $2, $3, $4, $5, now() + interval '7 days') returning id`,
        [ctx.org.id, body.email, body.role, sha256(token), ctx.user.id],
      ))!;
      await queueEmail(db, {
        orgId: ctx.org.id,
        to: body.email,
        subject: `${ctx.user.name} invited you to ${ctx.org.name} on SiteGuard`,
        lines: [
          `${ctx.user.name} has invited you to join ${ctx.org.name} on SiteGuard as ${roleLabel(ctx.org.kind, body.role)}.`,
          'SiteGuard keeps contractor safety files, permits, incidents and site readiness in one place. The link below expires in 7 days.',
        ],
        action: { label: 'Accept invitation', url: appUrl(`/invite?token=${token}`) },
      });
      await audit(db, ctx, 'Invited user', `${body.email} as ${roleLabel(ctx.org.kind, body.role)}`);
      await publishChange(db, [ctx.org.id]);
      return { id: inv.id };
    });
  });

  app.delete('/api/org/invites/:id', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    await withTx(async (db) => {
      const r = await one<{ email: string }>(
        db,
        `update user_invites set revoked_at = now() where id = $1 and org_id = $2 and accepted_at is null returning email`,
        [id, ctx.org.id],
      );
      if (!r) throw notFound();
      await audit(db, ctx, 'Revoked invitation', r.email);
      await publishChange(db, [ctx.org.id]);
    });
    return { ok: true };
  });

  app.patch('/api/org/members/:userId', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    requireWritable(ctx);
    const { userId } = req.params as { userId: string };
    if (!isUuid(userId)) throw notFound();
    const { role } = z.object({ role: z.enum(['owner', 'admin', 'reviewer', 'member']) }).parse(req.body);
    if (!rolesFor(ctx.org.kind).includes(role)) throw badRequest('That role is not available for this kind of organisation.');
    await withTx(async (db) => {
      await db.query('select id from organisations where id = $1 for update', [ctx.org.id]);
      const m = await one<{ role: Role; name: string }>(
        db,
        `select m.role, u.name from memberships m join users u on u.id = m.user_id where m.org_id = $1 and m.user_id = $2`,
        [ctx.org.id, userId],
      );
      if (!m) throw notFound();
      if ((m.role === 'owner' || role === 'owner') && ctx.role !== 'owner') throw forbidden('Only owners can change owner roles.');
      if (m.role === 'owner' && role !== 'owner' && (await ownerCount(db, ctx.org.id)) <= 1) {
        throw conflict('An organisation needs at least one owner.');
      }
      await db.query('update memberships set role = $3 where org_id = $1 and user_id = $2', [ctx.org.id, userId, role]);
      await audit(db, ctx, 'Changed role', `${m.name}: ${roleLabel(ctx.org.kind, m.role)} → ${roleLabel(ctx.org.kind, role)}`);
      await publishChange(db, [ctx.org.id]);
    });
    return { ok: true };
  });

  app.delete('/api/org/members/:userId', async (req) => {
    const ctx = requireOrg(req.ctx);
    const { userId } = req.params as { userId: string };
    if (!isUuid(userId)) throw notFound();
    const self = userId === ctx.user.id;
    if (!self) requireAdmin(ctx);
    await withTx(async (db) => {
      await db.query('select id from organisations where id = $1 for update', [ctx.org.id]);
      const m = await one<{ role: Role; name: string }>(
        db,
        `select m.role, u.name from memberships m join users u on u.id = m.user_id where m.org_id = $1 and m.user_id = $2`,
        [ctx.org.id, userId],
      );
      if (!m) throw notFound();
      if (m.role === 'owner' && !self && ctx.role !== 'owner') throw forbidden('Only owners can remove an owner.');
      if (m.role === 'owner' && (await ownerCount(db, ctx.org.id)) <= 1) {
        throw conflict('An organisation needs at least one owner. Make someone else an owner first.');
      }
      await db.query('delete from memberships where org_id = $1 and user_id = $2', [ctx.org.id, userId]);
      // Their sessions in this org lose access immediately.
      await db.query('update sessions set org_id = null where user_id = $1 and org_id = $2', [userId, ctx.org.id]);
      await audit(db, ctx, self ? 'Left organisation' : 'Removed member', m.name);
      await publishChange(db, [ctx.org.id]);
    });
    return { ok: true };
  });

  app.patch('/api/org/settings', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    requireWritable(ctx);
    const body = z
      .object({
        inspectxEnabled: z.boolean().optional(),
        inspectxBaseUrl: z.string().trim().max(300).refine((v) => v === '' || /^https:\/\//.test(v), 'must start with https://').optional(),
        reminderDigest: z.boolean().optional(),
      })
      .parse(req.body);
    await withTx(async (db) => {
      await db.query(`update organisations set settings = settings || $2::jsonb where id = $1`, [ctx.org.id, JSON.stringify(body)]);
      await audit(db, ctx, 'Updated settings', Object.entries(body).map(([k, v]) => `${k}=${v}`).join(', '));
      await publishChange(db, [ctx.org.id]);
    });
    return { ok: true };
  });

  app.get('/api/audit', async (req) => {
    const ctx = requireOrg(req.ctx);
    const q = z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        siteId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(5000).default(1000),
      })
      .parse(req.query);
    return { events: await auditFor(pool, ctx, q) };
  });
}

/**
 * The audit events an organisation can see: everything its own people did,
 * plus everything anyone did on a site it is a party to.
 */
export async function auditFor(
  db: Db,
  ctx: OrgCtx,
  q: { from?: string; to?: string; siteId?: string; limit: number },
) {
  return many(
    db,
    `with my_sites as (
       -- Hosts see their sites' whole history. A contractor sees a host's site
       -- only from when it was invited, and only events by the host or itself.
       select s.id, s.org_id as host_id,
              case when s.org_id = $1 then '-infinity'::timestamptz
                   else (select min(i.sent_at) from site_invitations i
                          where i.site_id = s.id and i.contractor_id = s.contractor_id and i.status = 'accepted') end as since
         from sites s join contractors c on c.id = s.contractor_id
        where s.org_id = $1 or (c.linked_org_id = $1 and s.status not in ('invited', 'declined'))
     )
     select a.id, a.created_at as ts, a.actor_name as actor, a.actor_role as role, a.action, a.detail, a.site_id as "siteId"
       from audit_events a
       left join my_sites ms on ms.id = a.site_id
      where (a.org_id = $1
             or (ms.id is not null and ms.host_id = $1)
             or (ms.id is not null and a.created_at >= coalesce(ms.since, 'infinity') and a.org_id in (ms.host_id, $1)))
        and ($2::date is null or a.created_at >= $2::date)
        and ($3::date is null or a.created_at < $3::date + 1)
        and ($4::uuid is null or a.site_id = $4)
      order by a.created_at desc, a.id desc
      limit $5`,
    [ctx.org.id, q.from ?? null, q.to ?? null, q.siteId ?? null, q.limit],
  );
}
