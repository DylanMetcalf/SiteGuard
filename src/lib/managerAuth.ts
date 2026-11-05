/** Who may use the manager portal, and the extra proof sensitive actions need. */
import type { FastifyRequest } from 'fastify';
import { one, pool, withTx } from '../db/pool.js';
import { isPlatformAdmin } from '../config.js';
import { HttpError, notFound, unauthorized } from './errors.js';
import { requireUser, type Ctx } from './authz.js';
import { consumeMfaCode, lockedOut, recordMfaFailure } from './mfa.js';
import { verifyPassword } from './security.js';
import { securityEvent } from './securityLog.js';

const MFA_MAX_AGE_MS = 12 * 3600_000;
export const REAL_ORG = `not o.is_demo and o.managed_by_org is null and o.account_class = 'customer'`;
/** Every organisation the owner can open, including test and demo ones (never contractor client records). */
export const ANY_ORG = `o.managed_by_org is null`;

export function requireAdminUser(req: FastifyRequest): Ctx {
  const ctx = requireUser(req.ctx);
  if (!isPlatformAdmin(ctx.user)) throw notFound();
  return ctx;
}

/** A platform admin whose session has passed the second step recently. */
export async function requireManager(req: FastifyRequest): Promise<Ctx> {
  const ctx = requireAdminUser(req);
  const mfa = await one<{ enabled_at: Date | null }>(pool, 'select enabled_at from user_mfa where user_id = $1', [ctx.user.id]);
  const fresh = ctx.mfaVerifiedAt && Date.now() - new Date(ctx.mfaVerifiedAt).getTime() < MFA_MAX_AGE_MS;
  if (!mfa?.enabled_at || !fresh) throw new HttpError(403, 'mfa_required', 'Enter your authenticator code to continue.');
  return ctx;
}

/**
 * Extra proof for destructive actions: the account password and a code that has not been used yet
 * (so wait for the next one after signing in). Wrong attempts count towards the same lockout as sign-in.
 */
export async function stepUp(req: FastifyRequest, ctx: Ctx, password: string, code: string): Promise<void> {
  if (await lockedOut(pool, ctx.user.id)) throw new HttpError(423, 'locked', 'Too many failed attempts. Try again in 15 minutes.');
  const hash = (await one<{ password_hash: string | null }>(pool, 'select password_hash from users where id = $1', [ctx.user.id]))?.password_hash ?? null;
  const ok = (await verifyPassword(password, hash)) && !!(await withTx((db) => consumeMfaCode(db, ctx.user.id, code)));
  if (!ok) {
    await recordMfaFailure(pool, ctx.user.id);
    securityEvent(req, 'mfa_failed', { userId: ctx.user.id, stepUp: true });
    throw unauthorized('The password or code is not right. Use a code you have not used yet: wait for your app to show the next one.');
  }
}
