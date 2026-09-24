/**
 * Billing with Stripe: per-seat subscriptions, a 14-day trial for site owners
 * (no card needed), a free tier for contractors, self-serve upgrade/downgrade
 * and seat changes, and the Stripe customer portal for cards and invoices.
 * Stripe is the source of truth; the webhook mirrors it onto the organisation.
 */
import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { z } from 'zod';
import { one, pool, withTx } from '../db/pool.js';
import { config, features } from '../config.js';
import { badRequest, conflict, unavailable } from '../lib/errors.js';
import { requireAdmin, requireOrg, type OrgCtx } from '../lib/authz.js';
import { PLANS, planOf, plansFor, standing } from '../lib/plans.js';
import { audit } from '../lib/audit.js';
import { publishChange } from '../lib/realtime.js';
import { appUrl } from '../lib/email.js';
import { seatsUsed } from './org.js';

let stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!features.billing) throw unavailable('Billing is not configured on this server.');
  stripe ??= new Stripe(config.STRIPE_SECRET_KEY!);
  return stripe;
}

function planForPrice(priceId: string | undefined) {
  return Object.values(PLANS).find((p) => p.stripePrice && p.stripePrice === priceId) ?? null;
}

async function ensureCustomer(ctx: OrgCtx): Promise<string> {
  if (ctx.org.stripe_customer_id) return ctx.org.stripe_customer_id;
  const customer = await getStripe().customers.create({
    name: ctx.org.name,
    email: ctx.user.email,
    metadata: { org_id: ctx.org.id },
  });
  await pool.query('update organisations set stripe_customer_id = $2 where id = $1', [ctx.org.id, customer.id]);
  return customer.id;
}

async function activeSites(orgId: string): Promise<number> {
  return Number((await one<{ n: number }>(pool, `select count(*) as n from sites where org_id = $1 and status <> 'declined'`, [orgId]))!.n);
}

const STATUS_MAP: Record<string, string> = {
  active: 'active',
  trialing: 'active',
  past_due: 'past_due',
  unpaid: 'past_due',
  canceled: 'canceled',
  incomplete: 'incomplete',
  incomplete_expired: 'canceled',
  paused: 'canceled',
};

/** Mirrors a Stripe subscription onto the organisation that owns it. */
async function syncSubscription(sub: Stripe.Subscription) {
  const orgId = sub.metadata?.org_id;
  const item = sub.items.data[0];
  const plan = planForPrice(item?.price?.id);
  const periodEnd = (item as { current_period_end?: number } | undefined)?.current_period_end
    ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  const status = STATUS_MAP[sub.status] ?? 'incomplete';
  await withTx(async (db) => {
    const org = await one<{ id: string; kind: string }>(
      db,
      `select id, kind from organisations where ${orgId ? 'id = $1' : 'stripe_subscription_id = $1 or stripe_customer_id = $2'} for update`,
      orgId ? [orgId] : [sub.id, typeof sub.customer === 'string' ? sub.customer : sub.customer.id],
    );
    if (!org) return;
    const deleted = sub.status === 'canceled' || sub.status === 'incomplete_expired';
    await db.query(
      `update organisations set
          stripe_subscription_id = $2,
          subscription_status = $3,
          plan = coalesce($4, plan),
          seat_limit = greatest(1, coalesce($5, seat_limit)),
          current_period_end = $6
        where id = $1`,
      [
        org.id,
        deleted ? null : sub.id,
        // A cancelled paid contractor plan drops back to the free tier rather than locking the account.
        deleted && org.kind === 'contractor' ? 'free' : status,
        deleted && org.kind === 'contractor' ? PLANS.contractor_free.id : plan?.kind === org.kind ? plan.id : null,
        deleted && org.kind === 'contractor' ? PLANS.contractor_free.defaultSeats : item?.quantity ?? null,
        periodEnd ? new Date(periodEnd * 1000) : null,
      ],
    );
    await publishChange(db, [org.id]);
  });
}

export default async function billingRoutes(app: FastifyInstance) {
  app.get('/api/billing', async (req) => {
    const ctx = requireOrg(req.ctx);
    const plan = planOf(ctx.org);
    return {
      enabled: features.billing,
      plan: plan.id,
      status: ctx.org.subscription_status,
      standing: standing(ctx.org),
      trialEndsAt: ctx.org.trial_ends_at,
      currentPeriodEnd: ctx.org.current_period_end,
      seatLimit: ctx.org.seat_limit,
      seatsUsed: await seatsUsed(pool, ctx.org.id),
      activeSites: ctx.org.kind === 'host' ? await activeSites(ctx.org.id) : null,
      hasSubscription: !!ctx.org.stripe_subscription_id,
      hasCustomer: !!ctx.org.stripe_customer_id,
      plans: plansFor(ctx.org.kind).map((p) => ({
        id: p.id, name: p.name, blurb: p.blurb, siteLimit: p.siteLimit, maxSeats: p.maxSeats, ai: p.ai, paid: p.paid,
        purchasable: !p.paid || !!p.stripePrice,
      })),
    };
  });

  app.post('/api/billing/checkout', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    const b = z.object({ plan: z.string(), seats: z.coerce.number().int().min(1).max(500) }).parse(req.body);
    const plan = PLANS[b.plan];
    if (!plan || plan.kind !== ctx.org.kind || !plan.paid || !plan.stripePrice) throw badRequest('That plan is not available.');
    if (ctx.org.stripe_subscription_id) throw conflict('You already have a subscription — change plan or seats instead.');
    if (b.seats > plan.maxSeats) throw badRequest(`${plan.name} allows up to ${plan.maxSeats} seats.`);
    const used = await seatsUsed(pool, ctx.org.id);
    if (b.seats < used) throw badRequest(`You have ${used} people (including pending invitations). Choose at least ${used} seats.`);
    const customer = await ensureCustomer(ctx);
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      customer,
      client_reference_id: ctx.org.id,
      line_items: [{ price: plan.stripePrice, quantity: b.seats }],
      subscription_data: { metadata: { org_id: ctx.org.id } },
      allow_promotion_codes: true,
      success_url: appUrl('/?billing=success'),
      cancel_url: appUrl('/?billing=cancelled'),
    });
    return { url: session.url };
  });

  app.post('/api/billing/change', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    const b = z.object({ plan: z.string().optional(), seats: z.coerce.number().int().min(1).max(500).optional() }).parse(req.body);
    if (!ctx.org.stripe_subscription_id) throw conflict('There is no active subscription to change. Choose a plan first.');
    const plan = b.plan ? PLANS[b.plan] : planOf(ctx.org);
    if (!plan || plan.kind !== ctx.org.kind || !plan.paid || !plan.stripePrice) throw badRequest('That plan is not available.');
    const seats = b.seats ?? ctx.org.seat_limit;
    if (seats > plan.maxSeats) throw badRequest(`${plan.name} allows up to ${plan.maxSeats} seats.`);
    const used = await seatsUsed(pool, ctx.org.id);
    if (seats < used) throw badRequest(`You have ${used} people (including pending invitations). Remove people before dropping below ${used} seats.`);
    if (plan.siteLimit !== null && (await activeSites(ctx.org.id)) > plan.siteLimit) {
      throw badRequest(`${plan.name} includes ${plan.siteLimit} active sites and you have more. Close sites before downgrading.`);
    }
    const s = getStripe();
    const sub = await s.subscriptions.retrieve(ctx.org.stripe_subscription_id);
    const updated = await s.subscriptions.update(sub.id, {
      items: [{ id: sub.items.data[0].id, price: plan.stripePrice, quantity: seats }],
      proration_behavior: 'create_prorations',
      metadata: { org_id: ctx.org.id },
    });
    await syncSubscription(updated);
    await withTx((db) => audit(db, ctx, 'Changed subscription', `${plan.name}, ${seats} seats`));
    return { ok: true };
  });

  app.post('/api/billing/portal', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    const customer = await ensureCustomer(ctx);
    const session = await getStripe().billingPortal.sessions.create({ customer, return_url: appUrl('/') });
    return { url: session.url };
  });

  // Stripe needs the exact raw body to verify its signature, so this route gets its own parser.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    scope.post('/api/billing/webhook', async (req, reply) => {
      if (!features.billing || !config.STRIPE_WEBHOOK_SECRET) return reply.status(404).send();
      let event: Stripe.Event;
      try {
        event = getStripe().webhooks.constructEvent(req.body as Buffer, String(req.headers['stripe-signature'] ?? ''), config.STRIPE_WEBHOOK_SECRET);
      } catch {
        return reply.status(400).send({ error: 'bad_signature' });
      }
      const fresh = await one(pool, 'insert into stripe_events (id, type) values ($1, $2) on conflict do nothing returning id', [event.id, event.type]);
      if (!fresh) return { received: true, duplicate: true };
      try {
        switch (event.type) {
          case 'checkout.session.completed': {
            const session = event.data.object as Stripe.Checkout.Session;
            if (session.subscription) {
              const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
              await syncSubscription(await getStripe().subscriptions.retrieve(subId));
            }
            break;
          }
          case 'customer.subscription.created':
          case 'customer.subscription.updated':
          case 'customer.subscription.deleted':
            await syncSubscription(event.data.object as Stripe.Subscription);
            break;
          default:
            break;
        }
      } catch (err) {
        // Let Stripe retry: forget that we saw it.
        await pool.query('delete from stripe_events where id = $1', [event.id]);
        throw err;
      }
      return { received: true };
    });
  });
}
