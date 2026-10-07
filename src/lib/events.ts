/**
 * Privacy-respecting product statistics: the organisation and the name of a
 * milestone, nothing else (no user, page, IP or content). Shown to the platform
 * owner as counts. A tracking failure never breaks the action being tracked.
 */
import type { Db } from '../db/pool.js';

export type ProductEvent =
  | 'signup' | 'trial_started' | 'first_safety_file' | 'safety_file_export' | 'document_upload'
  | 'ai_generation' | 'invitation_sent' | 'site_joined' | 'subscription_started' | 'promo_redeemed'
  | 'exchange_request_sent' | 'exchange_share_sent' | 'exchange_submitted' | 'exchange_completed' | 'exchange_claimed';

export async function track(db: Db, orgId: string | null, event: ProductEvent): Promise<void> {
  try {
    await db.query('insert into product_events (org_id, event) values ($1, $2)', [orgId, event]);
  } catch { /* statistics are never worth failing a request for */ }
}

/** Only the first time an organisation reaches a milestone. */
export async function trackFirst(db: Db, orgId: string, event: ProductEvent): Promise<void> {
  try {
    await db.query(
      'insert into product_events (org_id, event) select $1, $2 where not exists (select 1 from product_events where org_id = $1 and event = $2)',
      [orgId, event],
    );
  } catch { /* see track() */ }
}
