/**
 * The in-app inbox. Anything someone needs to act on gets a notification for
 * the right people in the right organisation, alongside (not instead of) email.
 * Callers publish the live-update event for the organisation themselves.
 */
import type { Db } from '../db/pool.js';

export interface NotificationLink {
  kind: 'req' | 'review' | 'site' | 'studio' | 'requests';
  id?: string;
  siteId?: string;
}

export async function notifyOrg(
  db: Db,
  orgId: string,
  roles: string[] | null,
  n: { kind: string; title: string; body?: string; link?: NotificationLink; exceptUserId?: string },
): Promise<void> {
  await db.query(
    `insert into notifications (user_id, org_id, kind, title, body, link)
     select m.user_id, m.org_id, $3, $4, $5, $6 from memberships m
      where m.org_id = $1 and ($2::text[] is null or m.role = any($2)) and ($7::uuid is null or m.user_id <> $7)`,
    [orgId, roles, n.kind, n.title.slice(0, 300), (n.body ?? '').slice(0, 1000), JSON.stringify(n.link ?? {}), n.exceptUserId ?? null],
  );
}

/** Reviewers of a host organisation (owners, admins, reviewers). */
export const REVIEWERS = ['owner', 'admin', 'reviewer'];
/** Everyone in a contractor organisation. */
export const EVERYONE = null;
