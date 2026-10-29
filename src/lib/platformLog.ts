import type { Db } from '../db/pool.js';
import type { Ctx } from './authz.js';

/** Every platform-admin action goes into platform_actions (append-only), inside the action's transaction. */
export async function logPlatformAction(db: Db, ctx: Ctx, action: string, orgId: string | null, detail = '', ip: string | null = null) {
  await db.query(
    `insert into platform_actions (admin_user_id, admin_email, action, org_id, detail, ip) values ($1, $2, $3, $4, $5, $6)`,
    [ctx.user.id, ctx.user.email, action.slice(0, 120), orgId, detail.slice(0, 500), ip],
  );
}
