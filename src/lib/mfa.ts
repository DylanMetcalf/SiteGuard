/**
 * The second sign-in step shared by customers and platform admins: an authenticator-app code
 * (lib/totp.ts) or a single-use recovery code. Codes can't be replayed within their 30 seconds.
 */
import type { Db } from '../db/pool.js';
import { one } from '../db/pool.js';
import { hashRecovery, matchStep, newRecoveryCodes, newSecret, openSecret, otpauthUrl, sealSecret } from './totp.js';

export async function mfaEnabled(db: Db, userId: string): Promise<boolean> {
  return !!(await one(db, 'select 1 from user_mfa where user_id = $1 and enabled_at is not null', [userId]));
}

/** Checks and consumes a code. Returns how the user proved it, or null. Call inside a transaction. */
export async function consumeMfaCode(db: Db, userId: string, code: string): Promise<'authenticator code' | 'recovery code' | null> {
  const row = await one<{ secret: string; enabled_at: Date | null; last_step: string; recovery_hashes: string[] }>(
    db, 'select secret, enabled_at, last_step, recovery_hashes from user_mfa where user_id = $1 for update', [userId]);
  if (!row?.enabled_at) return null;
  const clean = code.trim();
  if (/^\d{6}$/.test(clean)) {
    const secret = openSecret(row.secret);
    const step = secret ? matchStep(secret, clean) : null;
    if (step === null || step <= Number(row.last_step)) return null;
    await db.query('update user_mfa set last_step = $2 where user_id = $1', [userId, step]);
    return 'authenticator code';
  }
  const h = hashRecovery(clean);
  if (!row.recovery_hashes.includes(h)) return null;
  await db.query('update user_mfa set recovery_hashes = array_remove(recovery_hashes, $2) where user_id = $1', [userId, h]);
  return 'recovery code';
}

/** Failures count towards the same lockout as wrong passwords. */
export async function recordMfaFailure(db: Db, userId: string) {
  await db.query(
    `update users set failed_login_count = failed_login_count + 1,
            locked_until = case when failed_login_count + 1 >= 10 then now() + interval '15 minutes' else locked_until end where id = $1`, [userId]);
}

export async function lockedOut(db: Db, userId: string): Promise<boolean> {
  const u = await one<{ locked_until: Date | null }>(db, 'select locked_until from users where id = $1', [userId]);
  return !!u?.locked_until && new Date(u.locked_until) > new Date();
}

/** Starts (or restarts) set-up. Refuses when a second step is already on. Returns the key to show once. */
export async function startEnrolment(db: Db, userId: string, email: string): Promise<{ secret: string; otpauth: string } | null> {
  if (await mfaEnabled(db, userId)) return null;
  const secret = newSecret();
  const r = await db.query(
    `insert into user_mfa (user_id, secret) values ($1, $2)
     on conflict (user_id) do update set secret = excluded.secret, created_at = now(), recovery_hashes = '{}', last_step = 0
     where user_mfa.enabled_at is null`,
    [userId, sealSecret(secret)],
  );
  if (!r.rowCount) return null;
  return { secret, otpauth: otpauthUrl(email, secret) };
}

/** Finishes set-up with a first code. Returns the recovery codes (shown once), or null if the code is wrong. */
export async function finishEnrolment(db: Db, userId: string, code: string): Promise<string[] | null> {
  const row = await one<{ secret: string; enabled_at: Date | null }>(db, 'select secret, enabled_at from user_mfa where user_id = $1 for update', [userId]);
  if (!row || row.enabled_at) return null;
  const secret = openSecret(row.secret);
  const step = secret ? matchStep(secret, code.trim()) : null;
  if (step === null) return null;
  const { codes, hashes } = newRecoveryCodes();
  await db.query('update user_mfa set enabled_at = now(), last_step = $2, recovery_hashes = $3 where user_id = $1', [userId, step, hashes]);
  return codes;
}

/** The organisation requires the second step and this person has not set it up yet. */
export const mustSetUpMfa = (ctx: { org: { settings: unknown } | null; user: { mfa?: boolean; is_demo?: boolean } }) =>
  !!ctx.org && (ctx.org.settings as Record<string, unknown> | null)?.requireMfa === true && !ctx.user.mfa && !ctx.user.is_demo;
