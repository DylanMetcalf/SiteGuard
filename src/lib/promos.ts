/**
 * Promo codes: the platform admin creates a code (e.g. for family, testers or a
 * partner) that gives a plan for a while, or with no end date, without changing
 * public prices. A 100% code becomes a grant on the organisation (no Stripe
 * subscription needed); a partial discount is applied at Stripe checkout through
 * the code's Stripe coupon.
 */
import type { Db } from '../db/pool.js';
import { one } from '../db/pool.js';
import { badRequest, conflict, notFound } from './errors.js';
import { PLANS } from './plans.js';
import type { OrgCtx } from './authz.js';

export interface PromoRow {
  id: string;
  code: string;
  description: string;
  plan: string;
  percent_off: number;
  duration_days: number | null;
  org_kind: string | null;
  org_id: string | null;
  expires_at: Date | null;
  max_redemptions: number | null;
  redemptions: number;
  stripe_coupon: string | null;
  active: boolean;
}

export const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/;

/** Redeems a code for the caller's organisation. Locks the code row so usage limits hold. */
export async function redeemPromo(db: Db, ctx: OrgCtx, code: string) {
  if (!CODE_RE.test(code)) throw notFound('That code is not valid.');
  const p = await one<PromoRow>(db, 'select * from promo_codes where code = $1 for update', [code]);
  // One message for every reason a code can't be used, so codes can't be probed.
  const invalid = () => notFound('That code is not valid or has expired.');
  if (!p || !p.active) throw invalid();
  if (p.expires_at && new Date(p.expires_at).getTime() <= Date.now()) throw invalid();
  if (p.org_id && p.org_id !== ctx.org.id) throw invalid();
  const plan = PLANS[p.plan];
  if (!plan || plan.kind !== ctx.org.kind || (p.org_kind && p.org_kind !== ctx.org.kind)) {
    throw badRequest(`That code is for ${plan?.kind === 'host' ? 'mines and sites' : 'contractor companies'}.`);
  }
  if (await one(db, 'select 1 from promo_redemptions where promo_id = $1 and org_id = $2', [p.id, ctx.org.id])) {
    throw conflict('Your organisation has already used this code.');
  }
  if (p.max_redemptions !== null && p.redemptions >= p.max_redemptions) throw invalid();
  const grantUntil = p.duration_days ? new Date(Date.now() + p.duration_days * 86400_000) : null;
  await db.query('update promo_codes set redemptions = redemptions + 1 where id = $1', [p.id]);
  await db.query('insert into promo_redemptions (promo_id, org_id, redeemed_by, grant_until) values ($1, $2, $3, $4)', [p.id, ctx.org.id, ctx.user.id, p.percent_off === 100 ? grantUntil : null]);
  if (p.percent_off === 100) {
    await db.query('update organisations set grant_plan = $2, grant_until = $3, grant_source = $4 where id = $1', [ctx.org.id, p.plan, grantUntil, `promo:${p.code}`]);
    return { kind: 'grant' as const, plan: plan.name, until: grantUntil };
  }
  if (!p.stripe_coupon) throw conflict('This code is not set up yet. Contact COMVERA.');
  await db.query(`update organisations set settings = settings || jsonb_build_object('checkoutCoupon', $2::text, 'checkoutCouponCode', $3::text) where id = $1`, [ctx.org.id, p.stripe_coupon, p.code]);
  return { kind: 'discount' as const, plan: plan.name, percentOff: p.percent_off };
}
