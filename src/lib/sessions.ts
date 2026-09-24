import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/pool.js';
import { one, pool } from '../db/pool.js';
import { config, isProd } from '../config.js';
import type { Ctx, OrgRow, Role, UserRow } from './authz.js';
import { newToken, sha256 } from './security.js';

export const SESSION_COOKIE = 'sg_session';

export async function createSession(
  db: Db,
  reply: FastifyReply,
  req: FastifyRequest,
  userId: string,
  orgId: string | null,
): Promise<void> {
  const token = newToken();
  const expires = new Date(Date.now() + config.SESSION_TTL_DAYS * 86400_000);
  await db.query(
    `insert into sessions (id, user_id, org_id, csrf_token, ip, user_agent, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [sha256(token), userId, orgId, newToken(), req.ip, String(req.headers['user-agent'] ?? '').slice(0, 300), expires],
  );
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    expires,
  });
}

export function renewCookie(reply: FastifyReply, token: string, expires: Date): void {
  reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: isProd, expires });
}

export async function destroySession(db: Db, reply: FastifyReply, sessionId: string): Promise<void> {
  await db.query('delete from sessions where id = $1', [sessionId]);
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Resolves the cookie to a user, their active organisation and their role in it. */
export async function resolveSession(token: string | undefined, _req: FastifyRequest): Promise<Ctx | null> {
  if (!token || token.length > 100) return null;
  const id = sha256(token);
  const row = await one<{
    id: string;
    csrf_token: string;
    org_id: string | null;
    last_seen_at: Date;
    user: UserRow;
  }>(
    pool,
    `select s.id, s.csrf_token, s.org_id, s.last_seen_at,
            json_build_object('id', u.id, 'email', u.email, 'name', u.name, 'title', u.title, 'phone', u.phone,
                              'email_verified_at', u.email_verified_at, 'is_demo', u.is_demo) as user
       from sessions s join users u on u.id = s.user_id
      where s.id = $1 and s.expires_at > now()`,
    [id],
  );
  if (!row) return null;

  let org: OrgRow | null = null;
  let role: Role | null = null;
  if (row.org_id) {
    const m = await one<{ role: Role; org: OrgRow }>(
      pool,
      `select m.role, row_to_json(o) as org from memberships m join organisations o on o.id = m.org_id
        where m.org_id = $1 and m.user_id = $2`,
      [row.org_id, row.user.id],
    );
    if (m) {
      org = m.org;
      role = m.role;
    }
  }

  // Sliding expiry, written at most every 10 minutes.
  let renewedUntil: Date | undefined;
  if (Date.now() - new Date(row.last_seen_at).getTime() > 10 * 60_000) {
    renewedUntil = new Date(Date.now() + config.SESSION_TTL_DAYS * 86400_000);
    await pool.query(`update sessions set last_seen_at = now(), expires_at = $2 where id = $1`, [row.id, renewedUntil]);
  }

  return { user: row.user, sessionId: row.id, csrfToken: row.csrf_token, org, role, renewedUntil };
}
