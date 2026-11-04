/**
 * The second sign-in step for every user (authenticator app plus single-use recovery codes), and an
 * organisation's choice to require it of everyone in it. Turning it on or off is emailed to the person,
 * written to the organisation's audit trail, and logged as a security event.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { many, one, pool, withTx, type Db } from '../db/pool.js';
import { badRequest, conflict, HttpError, unauthorized } from '../lib/errors.js';
import { requireAdmin, requireOrg, requireUser, type Ctx } from '../lib/authz.js';
import { audit } from '../lib/audit.js';
import { publishChange } from '../lib/realtime.js';
import { queueEmail } from '../lib/email.js';
import { verifyPassword } from '../lib/security.js';
import { consumeMfaCode, finishEnrolment, lockedOut, mfaEnabled, recordMfaFailure, startEnrolment } from '../lib/mfa.js';
import { securityEvent } from '../lib/securityLog.js';
import { newRecoveryCodes } from '../lib/totp.js';
import { rl } from './auth.js';

/** Organisations this person belongs to that require the second step. */
export async function orgsRequiringMfa(db: Db, userId: string): Promise<string[]> {
  return (await many<{ name: string }>(db,
    `select o.name from memberships m join organisations o on o.id = m.org_id where m.user_id = $1 and coalesce((o.settings->>'requireMfa')::boolean, false)`, [userId])).map((r) => r.name);
}

/** Tells the person by email: security changes are never silent. */
export async function mfaNotice(db: Db, user: { email: string; name: string }, turnedOn: boolean, by = 'you') {
  await queueEmail(db, {
    to: user.email,
    subject: turnedOn ? 'Two-step sign-in is on for your COMVERA account' : 'Two-step sign-in was turned off for your COMVERA account',
    lines: [
      `Hi ${user.name},`,
      turnedOn
        ? 'Two-step sign-in is now on. You will be asked for a code from your authenticator app each time you sign in.'
        : `Two-step sign-in was turned off by ${by}. Your account is protected by your password only until you turn it on again.`,
      "If this wasn't you, reset your password straight away and contact COMVERA support.",
    ],
  });
}

async function auditIfOrg(db: Db, ctx: Ctx, action: string) {
  if (ctx.org && ctx.role) await audit(db, ctx as Parameters<typeof audit>[1], action, '');
}

const notLocked = async (userId: string) => {
  if (await lockedOut(pool, userId)) throw new HttpError(423, 'locked', 'Too many failed attempts. Try again in 15 minutes.');
};

/** Lockout first, then the password; a wrong password counts towards the same lockout as at sign-in. */
async function checkPassword(userId: string, password: string) {
  await notLocked(userId);
  const hash = (await one<{ password_hash: string | null }>(pool, 'select password_hash from users where id = $1', [userId]))?.password_hash ?? null;
  if (!(await verifyPassword(password, hash))) {
    await recordMfaFailure(pool, userId);
    throw badRequest('Your password is incorrect.', 'wrong_password');
  }
}

export default async function mfaRoutes(app: FastifyInstance) {
  app.get('/api/me/mfa', async (req) => {
    const ctx = requireUser(req.ctx);
    const row = await one<{ enabled_at: Date | null; n: number }>(pool,
      `select enabled_at, coalesce(array_length(recovery_hashes, 1), 0)::int as n from user_mfa where user_id = $1`, [ctx.user.id]);
    return { enabled: !!row?.enabled_at, recoveryCodesLeft: row?.enabled_at ? row.n : 0, requiredBy: await orgsRequiringMfa(pool, ctx.user.id) };
  });

  app.post('/api/me/mfa/setup', rl(5), async (req) => {
    const ctx = requireUser(req.ctx);
    if (ctx.user.is_demo) throw badRequest('Demo personas cannot turn on two-step sign-in.');
    const r = await withTx((db) => startEnrolment(db, ctx.user.id, ctx.user.email));
    if (!r) throw conflict('Two-step sign-in is already on.');
    return r;
  });

  app.post('/api/me/mfa/enable', rl(10), async (req) => {
    const ctx = requireUser(req.ctx);
    const { code, password } = z.object({ code: z.string().trim().min(6).max(10), password: z.string().min(1).max(200) }).parse(req.body);
    await checkPassword(ctx.user.id, password);
    const codes = await withTx(async (db) => {
      const c = await finishEnrolment(db, ctx.user.id, code);
      if (!c) { await recordMfaFailure(db, ctx.user.id); return null; }
      // This device counts as verified; every other session must sign in again with the code.
      await db.query('update sessions set mfa_verified_at = now() where id = $1', [ctx.sessionId]);
      await db.query('delete from sessions where user_id = $1 and id <> $2', [ctx.user.id, ctx.sessionId]);
      await mfaNotice(db, ctx.user, true);
      await auditIfOrg(db, ctx, 'Turned on two-step sign-in');
      return c;
    });
    if (!codes) throw unauthorized('That code is not right. Check the time on your phone and try the newest code.');
    securityEvent(req, 'mfa_enrolled');
    return { ok: true, recoveryCodes: codes };
  });

  /** New recovery codes replace the old ones; needs a current code. */
  app.post('/api/me/mfa/recovery-codes', rl(5), async (req) => {
    const ctx = requireUser(req.ctx);
    const { code } = z.object({ code: z.string().trim().min(6).max(20) }).parse(req.body);
    await notLocked(ctx.user.id);
    const codes = await withTx(async (db) => {
      if (!(await consumeMfaCode(db, ctx.user.id, code))) { await recordMfaFailure(db, ctx.user.id); return null; }
      const { codes: c, hashes } = newRecoveryCodes();
      await db.query('update user_mfa set recovery_hashes = $2 where user_id = $1', [ctx.user.id, hashes]);
      await auditIfOrg(db, ctx, 'Made new two-step recovery codes');
      return c;
    });
    if (!codes) throw unauthorized('That code is not right.');
    return { recoveryCodes: codes };
  });

  /** Turning it off needs the password and a current code, and is refused while an organisation requires it. */
  app.post('/api/me/mfa/disable', rl(5), async (req: FastifyRequest) => {
    const ctx = requireUser(req.ctx);
    const b = z.object({ password: z.string().min(1).max(200), code: z.string().trim().min(6).max(20) }).parse(req.body);
    const required = await orgsRequiringMfa(pool, ctx.user.id);
    if (required.length) throw conflict(`${required.join(', ')} requires two-step sign-in, so it can't be turned off.`);
    await checkPassword(ctx.user.id, b.password);
    const ok = await withTx(async (db) => {
      if (!(await consumeMfaCode(db, ctx.user.id, b.code))) { await recordMfaFailure(db, ctx.user.id); return false; }
      await db.query('delete from user_mfa where user_id = $1', [ctx.user.id]);
      await mfaNotice(db, ctx.user, false);
      await auditIfOrg(db, ctx, 'Turned off two-step sign-in');
      return true;
    });
    if (!ok) throw unauthorized('That code is not right.');
    securityEvent(req, 'mfa_disabled');
    return { ok: true };
  });

  /** An organisation's owner or admin can require the second step of everyone in it. */
  app.post('/api/org/require-mfa', rl(10), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    const { on } = z.object({ on: z.boolean() }).parse(req.body);
    if (on && !(await mfaEnabled(pool, ctx.user.id))) throw conflict('Turn on two-step sign-in for your own account first (Profile → Security), so you are not locked out.');
    await withTx(async (db) => {
      await db.query(`update organisations set settings = settings || jsonb_build_object('requireMfa', $2::boolean) where id = $1`, [ctx.org.id, on]);
      await audit(db, ctx, on ? 'Required two-step sign-in for everyone' : 'Stopped requiring two-step sign-in', '');
      await publishChange(db, [ctx.org.id]);
    });
    return { ok: true };
  });
}
