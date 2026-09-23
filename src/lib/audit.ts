import type { Db } from '../db/pool.js';
import { actorRole, type OrgCtx } from './authz.js';

/** Appends to the tamper-evident (append-only) audit trail. */
export async function audit(db: Db, ctx: OrgCtx, action: string, detail: string, siteId: string | null = null) {
  await db.query(
    `insert into audit_events (org_id, site_id, actor_id, actor_name, actor_role, action, detail)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [ctx.org.id, siteId, ctx.user.id, ctx.user.name, actorRole(ctx), action, detail.slice(0, 500)],
  );
}

export function clip(text: string, n = 60): string {
  return text.length > n ? text.slice(0, n) + '…' : text;
}
