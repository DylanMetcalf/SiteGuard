import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, pool, withTx, type Db } from '../db/pool.js';
import { config } from '../config.js';
import { badRequest, conflict, forbidden, HttpError, notFound, unauthorized } from '../lib/errors.js';
import { hashPassword, newToken, passwordProblem, sha256, verifyPassword, dummyPasswordHash } from '../lib/security.js';
import { createSession, destroySession, SESSION_COOKIE } from '../lib/sessions.js';
import { requireUser, requireOrg, canAdminOrg, type Role, type OrgCtx } from '../lib/authz.js';
import { appUrl, queueEmail } from '../lib/email.js';
import { defaultPlanFor, type OrgKind } from '../lib/plans.js';
import { audit } from '../lib/audit.js';
import { publishChange } from '../lib/realtime.js';

export const rl = (max: number) => ({
  config: { rateLimit: { max: config.NODE_ENV === 'test' ? max * 100 : max, timeWindow: '1 minute' } },
});

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(1).max(200);
const name = z.string().trim().min(1).max(200);

export async function createOrganisation(db: Db, orgName: string, kind: OrgKind, extra: Partial<{ is_demo: boolean; demo_group: string }> = {}) {
  const { plan, status, trialEndsAt } = defaultPlanFor(kind);
  return (await one<{ id: string }>(
    db,
    `insert into organisations (name, kind, plan, subscription_status, trial_ends_at, seat_limit, is_demo, demo_group)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [orgName, kind, plan.id, status, trialEndsAt, plan.defaultSeats, extra.is_demo ?? false, extra.demo_group ?? null],
  ))!;
}

async function sendVerification(db: Db, userId: string, to: string, userName: string) {
  const token = newToken();
  await db.query(
    `insert into email_tokens (token_hash, user_id, purpose, expires_at) values ($1, $2, 'verify_email', now() + interval '3 days')`,
    [sha256(token), userId],
  );
  await queueEmail(db, {
    to,
    subject: 'Confirm your email for SiteGuard',
    lines: [`Hi ${userName},`, 'Confirm your email address to finish setting up your SiteGuard account. This link expires in 3 days.'],
    action: { label: 'Confirm email', url: appUrl(`/verify-email?token=${token}`) },
  });
}

/** Links a contractor directory entry to a contractor organisation and accepts the site invitation. */
export async function acceptSiteInvitation(db: Db, ctx: OrgCtx, invitationId: string): Promise<{ siteId: string; hostOrgId: string }> {
  const inv = await one<{ id: string; site_id: string; org_id: string; contractor_id: string; status: string; linked_org_id: string | null; site_name: string }>(
    db,
    `select i.id, i.site_id, i.org_id, i.contractor_id, i.status, c.linked_org_id, s.name as site_name
       from site_invitations i join contractors c on c.id = i.contractor_id join sites s on s.id = i.site_id
      where i.id = $1 for update of i`,
    [invitationId],
  );
  if (!inv) throw notFound('That invitation no longer exists.');
  if (inv.status !== 'pending') throw conflict(`This invitation has already been ${inv.status}.`);
  if (ctx.org.kind !== 'contractor') throw forbidden('Switch to your contractor organisation to accept site invitations.');
  if (!canAdminOrg(ctx)) throw forbidden('Only contractor owners and admins can accept site invitations.');
  if (inv.linked_org_id && inv.linked_org_id !== ctx.org.id) throw forbidden('This invitation was sent to a different contractor company.');
  if (inv.org_id === ctx.org.id) throw forbidden('An organisation cannot accept its own invitation.');
  if (!inv.linked_org_id) {
    const clash = await one(db, 'select 1 from contractors where org_id = $1 and linked_org_id = $2', [inv.org_id, ctx.org.id]);
    if (clash) {
      // This host already knows us under another directory entry — fold the site onto that one.
      await db.query(
        `update sites set contractor_id = (select id from contractors where org_id = $1 and linked_org_id = $2) where id = $3`,
        [inv.org_id, ctx.org.id, inv.site_id],
      );
    } else {
      await db.query('update contractors set linked_org_id = $1 where id = $2', [ctx.org.id, inv.contractor_id]);
    }
  }
  await db.query(`update site_invitations set status = 'accepted', responded_at = now(), responded_by = $2 where id = $1`, [inv.id, ctx.user.id]);
  await db.query(`update sites set status = 'in_progress' where id = $1 and status = 'invited'`, [inv.site_id]);
  await audit(db, ctx, 'Accepted invitation', inv.site_name, inv.site_id);
  await publishChange(db, [inv.org_id, ctx.org.id]);
  return { siteId: inv.site_id, hostOrgId: inv.org_id };
}

export default async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/signup', rl(10), async (req, reply) => {
    const body = z
      .object({
        name,
        email,
        password,
        orgName: z.string().trim().max(200).optional(),
        orgKind: z.enum(['host', 'contractor']).optional(),
        inviteToken: z.string().max(100).optional(),
        siteInviteToken: z.string().max(100).optional(),
      })
      .parse(req.body);
    const problem = passwordProblem(body.password);
    if (problem) throw badRequest(problem, 'weak_password');

    const result = await withTx(async (db) => {
      if (await one(db, 'select 1 from users where email = $1', [body.email])) {
        throw conflict('An account with that email already exists — sign in instead.');
      }
      let orgId: string;
      let role: Role = 'owner';
      let verified = false;
      let siteInvitationId: string | null = null;

      if (body.inviteToken) {
        const inv = await one<{ id: string; org_id: string; email: string; role: Role }>(
          db,
          `select id, org_id, email, role from user_invites
            where token_hash = $1 and accepted_at is null and revoked_at is null and expires_at > now() for update`,
          [sha256(body.inviteToken)],
        );
        if (!inv) throw badRequest('That invitation link has expired or was already used. Ask for a new one.', 'invalid_invite');
        if (inv.email.toLowerCase() !== body.email) throw badRequest(`This invitation was sent to ${inv.email}. Sign up with that address.`, 'invite_email_mismatch');
        orgId = inv.org_id;
        role = inv.role;
        verified = true; // they proved control of the address by opening the link
        await db.query('update user_invites set accepted_at = now() where id = $1', [inv.id]);
      } else {
        if (!body.orgName) throw badRequest('Organisation name is required.');
        let kind: OrgKind = body.orgKind ?? 'host';
        if (body.siteInviteToken) {
          const si = await one<{ id: string; email: string | null }>(
            db,
            `select id, email from site_invitations where token_hash = $1 and status = 'pending'`,
            [sha256(body.siteInviteToken)],
          );
          if (!si) throw badRequest('That site invitation has expired or was already answered.', 'invalid_invite');
          siteInvitationId = si.id;
          kind = 'contractor';
          verified = !!si.email && si.email.toLowerCase() === body.email;
        }
        orgId = (await createOrganisation(db, body.orgName, kind)).id;
      }

      const user = (await one<{ id: string }>(
        db,
        `insert into users (email, name, password_hash, email_verified_at, last_active_org_id)
         values ($1, $2, $3, $4, $5) returning id`,
        [body.email, body.name, await hashPassword(body.password), verified ? new Date() : null, orgId],
      ))!;
      await db.query('insert into memberships (org_id, user_id, role) values ($1, $2, $3)', [orgId, user.id, role]);
      if (!verified) await sendVerification(db, user.id, body.email, body.name);

      const org = (await one(db, 'select * from organisations where id = $1', [orgId]))!;
      const ctx = { user: { id: user.id, email: body.email, name: body.name, title: '', phone: '', email_verified_at: null, is_demo: false }, sessionId: '', csrfToken: '', org, role } as OrgCtx;
      await audit(db, ctx, body.inviteToken ? 'Joined organisation' : 'Organisation created', org.name);
      if (siteInvitationId) await acceptSiteInvitation(db, ctx, siteInvitationId);
      await publishChange(db, [orgId]);
      await createSession(db, reply, req, user.id, orgId);
      return { ok: true };
    });
    return result;
  });

  app.post('/api/auth/login', rl(10), async (req, reply) => {
    const body = z.object({ email, password }).parse(req.body);
    const user = await one<{ id: string; password_hash: string | null; last_active_org_id: string | null; locked_until: Date | null }>(
      pool,
      'select id, password_hash, last_active_org_id, locked_until from users where email = $1 and not is_demo',
      [body.email],
    );
    if (user?.locked_until && new Date(user.locked_until) > new Date()) {
      throw new HttpError(423, 'locked', 'Too many failed attempts. Try again in 15 minutes, or reset your password.');
    }
    const ok = await verifyPassword(body.password, user?.password_hash ?? (await dummyPasswordHash()));
    if (!user || !ok) {
      if (user) {
        await pool.query(
          `update users set failed_login_count = failed_login_count + 1,
                  locked_until = case when failed_login_count + 1 >= 10 then now() + interval '15 minutes' else locked_until end
            where id = $1`,
          [user.id],
        );
      }
      throw unauthorized('Email or password is incorrect.');
    }
    await pool.query('update users set failed_login_count = 0, locked_until = null where id = $1', [user.id]);
    const orgId =
      (await one<{ org_id: string }>(
        pool,
        `select org_id from memberships where user_id = $1 order by (org_id = $2) desc, created_at limit 1`,
        [user.id, user.last_active_org_id],
      ))?.org_id ?? null;
    await createSession(pool, reply, req, user.id, orgId);
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.ctx) await destroySession(pool, reply, req.ctx.sessionId);
    else reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/forgot', rl(5), async (req) => {
    const body = z.object({ email }).parse(req.body);
    const user = await one<{ id: string; name: string }>(pool, 'select id, name from users where email = $1 and not is_demo', [body.email]);
    if (user) {
      await withTx(async (db) => {
        const token = newToken();
        await db.query(
          `insert into email_tokens (token_hash, user_id, purpose, expires_at) values ($1, $2, 'reset_password', now() + interval '1 hour')`,
          [sha256(token), user.id],
        );
        await queueEmail(db, {
          to: body.email,
          subject: 'Reset your SiteGuard password',
          lines: [
            `Hi ${user.name},`,
            'Someone asked to reset the password for this SiteGuard account. If that was you, use the link below — it expires in 1 hour and works once.',
            "If it wasn't you, ignore this email; your password hasn't changed.",
          ],
          action: { label: 'Choose a new password', url: appUrl(`/reset-password?token=${token}`) },
        });
      });
    }
    // Same response either way, so this can't be used to discover accounts.
    return { ok: true };
  });

  app.post('/api/auth/reset', rl(10), async (req, reply) => {
    const body = z.object({ token: z.string().max(100), password }).parse(req.body);
    const problem = passwordProblem(body.password);
    if (problem) throw badRequest(problem, 'weak_password');
    await withTx(async (db) => {
      const row = await one<{ user_id: string }>(
        db,
        `update email_tokens set used_at = now()
          where token_hash = $1 and purpose = 'reset_password' and used_at is null and expires_at > now()
          returning user_id`,
        [sha256(body.token)],
      );
      if (!row) throw badRequest('That reset link has expired or was already used. Request a new one.', 'invalid_token');
      await db.query(
        `update users set password_hash = $2, failed_login_count = 0, locked_until = null,
                email_verified_at = coalesce(email_verified_at, now()) where id = $1`,
        [row.user_id, await hashPassword(body.password)],
      );
      // A reset signs out every existing session.
      await db.query('delete from sessions where user_id = $1', [row.user_id]);
      const u = await one<{ last_active_org_id: string | null }>(db, 'select last_active_org_id from users where id = $1', [row.user_id]);
      const m = await one<{ org_id: string }>(db, 'select org_id from memberships where user_id = $1 order by (org_id = $2) desc limit 1', [row.user_id, u?.last_active_org_id]);
      await createSession(db, reply, req, row.user_id, m?.org_id ?? null);
    });
    return { ok: true };
  });

  app.post('/api/auth/verify-email', rl(20), async (req) => {
    const body = z.object({ token: z.string().max(100) }).parse(req.body);
    const row = await one<{ user_id: string }>(
      pool,
      `update email_tokens set used_at = now()
        where token_hash = $1 and purpose = 'verify_email' and used_at is null and expires_at > now()
        returning user_id`,
      [sha256(body.token)],
    );
    if (!row) throw badRequest('That confirmation link has expired or was already used.', 'invalid_token');
    await pool.query('update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1', [row.user_id]);
    return { ok: true };
  });

  app.post('/api/auth/resend-verification', rl(3), async (req) => {
    const ctx = requireUser(req.ctx);
    if (ctx.user.email_verified_at) return { ok: true };
    await withTx((db) => sendVerification(db, ctx.user.id, ctx.user.email, ctx.user.name));
    return { ok: true };
  });

  // ---- Team invitations (join an organisation as a user) ----
  app.get('/api/auth/invite/:token', rl(30), async (req) => {
    const { token } = req.params as { token: string };
    const inv = await one<{ email: string; role: string; org_name: string; org_kind: string; has_account: boolean }>(
      pool,
      `select i.email, i.role, o.name as org_name, o.kind as org_kind,
              exists(select 1 from users u where u.email = i.email) as has_account
         from user_invites i join organisations o on o.id = i.org_id
        where i.token_hash = $1 and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()`,
      [sha256(token)],
    );
    if (!inv) throw notFound('This invitation has expired or was already used.');
    return inv;
  });

  app.post('/api/auth/invite/:token/accept', async (req) => {
    const ctx = requireUser(req.ctx);
    const { token } = req.params as { token: string };
    await withTx(async (db) => {
      const inv = await one<{ id: string; org_id: string; email: string; role: Role }>(
        db,
        `select id, org_id, email, role from user_invites
          where token_hash = $1 and accepted_at is null and revoked_at is null and expires_at > now() for update`,
        [sha256(token)],
      );
      if (!inv) throw notFound('This invitation has expired or was already used.');
      if (inv.email.toLowerCase() !== ctx.user.email.toLowerCase()) {
        throw forbidden(`This invitation was sent to ${inv.email}. Sign in with that account to accept it.`);
      }
      await db.query('update user_invites set accepted_at = now() where id = $1', [inv.id]);
      await db.query(
        'insert into memberships (org_id, user_id, role) values ($1, $2, $3) on conflict (org_id, user_id) do nothing',
        [inv.org_id, ctx.user.id, inv.role],
      );
      await db.query('update users set email_verified_at = coalesce(email_verified_at, now()) where id = $1', [ctx.user.id]);
      await db.query('update sessions set org_id = $2 where id = $1', [ctx.sessionId, inv.org_id]);
      await db.query('update users set last_active_org_id = $2 where id = $1', [ctx.user.id, inv.org_id]);
      const org = (await one(db, 'select * from organisations where id = $1', [inv.org_id]))!;
      await audit(db, { ...ctx, org, role: inv.role } as OrgCtx, 'Joined organisation', org.name);
      await publishChange(db, [inv.org_id]);
    });
    return { ok: true };
  });

  // ---- Site invitations (a contractor company invited onto a site) ----
  app.get('/api/auth/site-invite/:token', rl(30), async (req) => {
    const { token } = req.params as { token: string };
    const inv = await one(
      pool,
      `select i.status, s.name as site_name, s.location, o.name as host_name, c.name as contractor_name, i.email
         from site_invitations i join sites s on s.id = i.site_id join organisations o on o.id = i.org_id
         join contractors c on c.id = i.contractor_id
        where i.token_hash = $1`,
      [sha256(token)],
    );
    if (!inv) throw notFound('This invitation link is not valid.');
    return inv;
  });

  app.post('/api/auth/site-invite/:token/:decision', async (req) => {
    const ctx = requireOrg(req.ctx);
    const { token, decision } = req.params as { token: string; decision: string };
    if (decision !== 'accept' && decision !== 'decline') throw notFound();
    return withTx(async (db) => {
      const inv = await one<{ id: string }>(db, 'select id from site_invitations where token_hash = $1', [sha256(token)]);
      if (!inv) throw notFound('This invitation link is not valid.');
      if (decision === 'accept') return acceptSiteInvitation(db, ctx, inv.id);
      const { declineSiteInvitation } = await import('./sites.js');
      await declineSiteInvitation(db, ctx, inv.id, true);
      return { ok: true };
    });
  });

  // ---- Session context ----
  app.post('/api/auth/switch-org', async (req) => {
    const ctx = requireUser(req.ctx);
    const { orgId } = z.object({ orgId: z.string().uuid() }).parse(req.body);
    const m = await one(pool, 'select 1 from memberships where org_id = $1 and user_id = $2', [orgId, ctx.user.id]);
    if (!m) throw notFound();
    await pool.query('update sessions set org_id = $2 where id = $1', [ctx.sessionId, orgId]);
    await pool.query('update users set last_active_org_id = $2 where id = $1', [ctx.user.id, orgId]);
    return { ok: true };
  });

  app.post('/api/orgs', rl(10), async (req) => {
    const ctx = requireUser(req.ctx);
    if (ctx.user.is_demo) throw forbidden('Demo accounts cannot create organisations.');
    const body = z.object({ name: z.string().trim().min(1).max(200), kind: z.enum(['host', 'contractor']) }).parse(req.body);
    return withTx(async (db) => {
      const org = await createOrganisation(db, body.name, body.kind);
      await db.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'owner')`, [org.id, ctx.user.id]);
      await db.query('update sessions set org_id = $2 where id = $1', [ctx.sessionId, org.id]);
      await db.query('update users set last_active_org_id = $2 where id = $1', [ctx.user.id, org.id]);
      const orgRow = (await one(db, 'select * from organisations where id = $1', [org.id]))!;
      await audit(db, { ...ctx, org: orgRow, role: 'owner' } as OrgCtx, 'Organisation created', body.name);
      return { id: org.id };
    });
  });

  app.patch('/api/me', async (req) => {
    const ctx = requireUser(req.ctx);
    const body = z
      .object({ name: name.optional(), title: z.string().trim().max(120).optional(), phone: z.string().trim().max(60).optional() })
      .parse(req.body);
    await pool.query(
      `update users set name = coalesce($2, name), title = coalesce($3, title), phone = coalesce($4, phone) where id = $1`,
      [ctx.user.id, body.name ?? null, body.title ?? null, body.phone ?? null],
    );
    if (ctx.org) await withTx((db) => publishChange(db, [ctx.org!.id]));
    return { ok: true };
  });

  app.post('/api/me/password', rl(10), async (req) => {
    const ctx = requireUser(req.ctx);
    const body = z.object({ current: password, next: password }).parse(req.body);
    const row = await one<{ password_hash: string | null }>(pool, 'select password_hash from users where id = $1', [ctx.user.id]);
    if (!(await verifyPassword(body.current, row?.password_hash ?? null))) throw badRequest('Current password is incorrect.', 'wrong_password');
    const problem = passwordProblem(body.next);
    if (problem) throw badRequest(problem, 'weak_password');
    await pool.query('update users set password_hash = $2 where id = $1', [ctx.user.id, await hashPassword(body.next)]);
    // Sign out everywhere else.
    await pool.query('delete from sessions where user_id = $1 and id <> $2', [ctx.user.id, ctx.sessionId]);
    return { ok: true };
  });

  app.post('/api/me/sign-out-everywhere', async (req) => {
    const ctx = requireUser(req.ctx);
    await pool.query('delete from sessions where user_id = $1 and id <> $2', [ctx.user.id, ctx.sessionId]);
    return { ok: true };
  });
}
