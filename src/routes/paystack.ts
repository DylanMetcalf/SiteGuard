/**
 * Paystack billing: monthly plans as Paystack subscriptions, and the once-off safety file as a
 * single charge. The flow:
 *  1. checkout records a pending payment with the price we expect and sends the customer to
 *     Paystack's hosted page (the return to /?billing=success proves nothing on its own);
 *  2. Paystack's signed webhook arrives; we re-fetch the transaction from Paystack and act only if
 *     it succeeded for exactly the amount, currency and reference we recorded;
 *  3. subscription, invoice and cancellation events keep the organisation's status in step.
 * A failed renewal never deletes anything: the account goes into grace (past_due), then read-only.
 */
import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { many, one, pool, withTx, type Db } from '../db/pool.js';
import { config, features } from '../config.js';
import { badRequest, conflict, notFound, unavailable } from '../lib/errors.js';
import { requireAdmin, requireOrg } from '../lib/authz.js';
import { PLANS, grantActive, type Plan } from '../lib/plans.js';
import { pricingTable } from '../lib/pricing.js';
import { audit } from '../lib/audit.js';
import { publishChange } from '../lib/realtime.js';
import { trackFirst } from '../lib/events.js';
import { appUrl } from '../lib/email.js';
import { contractorSitesInUse, hostSitesInUse } from '../lib/limits.js';
import { seatsUsed } from './org.js';
import { paystack, validSignature, verifyTransaction, type PaystackTransaction } from '../lib/paystack.js';

const requirePaystack = () => {
  if (features.paymentProvider !== 'paystack') throw unavailable('Online payments aren\'t switched on yet. Contact us to subscribe, or use a promo code.');
};

/** Paystack plan code for a COMVERA plan at a price, created on first use. */
async function planCodeFor(plan: Plan, amountCents: number): Promise<string> {
  const cached = await one<{ plan_code: string }>(pool, `select plan_code from paystack_plans where plan_id = $1 and amount_cents = $2 and interval = 'monthly'`, [plan.id, amountCents]);
  if (cached) return cached.plan_code;
  const created = await paystack<{ plan_code: string }>('POST', '/plan', {
    name: `COMVERA ${plan.name} (R${(amountCents / 100).toFixed(2)} monthly)`,
    interval: 'monthly',
    amount: amountCents,
    currency: 'ZAR',
  });
  await pool.query(`insert into paystack_plans (plan_id, amount_cents, plan_code) values ($1, $2, $3) on conflict do nothing`, [plan.id, amountCents, created.plan_code]);
  return (await one<{ plan_code: string }>(pool, `select plan_code from paystack_plans where plan_id = $1 and amount_cents = $2 and interval = 'monthly'`, [plan.id, amountCents]))!.plan_code;
}

/** Billing events go into the organisation's own audit trail, by "Paystack" rather than a person. */
async function billingAudit(db: Db, orgId: string, action: string, detail: string) {
  await db.query(
    `insert into audit_events (org_id, actor_name, actor_role, action, detail) values ($1, 'Paystack', 'Payment provider', $2, $3)`,
    [orgId, action, detail.slice(0, 500)],
  );
}

const rands = (cents: number) => `R${(cents / 100).toFixed(2)}`;
const plusDays = (days: number) => new Date(Date.now() + days * 86400_000);

interface PaymentRow { id: string; org_id: string; reference: string; kind: string; plan_id: string; amount_cents: number; currency: string; status: string }
interface OrgRow { id: string; kind: string; paystack_subscription_code: string | null; paystack_email_token: string | null; grant_plan: string | null; grant_until: Date | null }

async function disableSubscription(code: string, token: string | null) {
  if (!token) return;
  await paystack('POST', '/subscription/disable', { code, token });
}

/** A verified, successful first charge: turn on what was bought. */
async function applyPayment(db: Db, p: PaymentRow, tx: PaystackTransaction) {
  const plan = PLANS[p.plan_id];
  await db.query(`update payments set status = 'success', paid_at = coalesce($2, now()) where id = $1`, [p.id, tx.paid_at ?? null]);
  if (p.kind === 'once_off') {
    const until = plusDays(config.ONCE_OFF_DAYS);
    await db.query(
      `update organisations set grant_plan = $2, grant_until = greatest(coalesce(grant_until, now()), now()) + ($3 || ' days')::interval, grant_source = $4,
              billing_provider = 'paystack', paystack_customer_code = coalesce($5, paystack_customer_code) where id = $1`,
      [p.org_id, plan.id, String(config.ONCE_OFF_DAYS), `Once-off payment ${p.reference}`, tx.customer?.customer_code ?? null],
    );
    await billingAudit(db, p.org_id, 'Paid once-off safety file', `${rands(p.amount_cents)} — open until ${until.toISOString().slice(0, 10)} (ref ${p.reference})`);
  } else {
    await db.query(
      `update organisations set plan = $2, subscription_status = 'active', billing_provider = 'paystack', seat_limit = greatest(seat_limit, $3),
              paystack_customer_code = coalesce($4, paystack_customer_code), current_period_end = coalesce(current_period_end, now() + interval '1 month') where id = $1`,
      [p.org_id, plan.id, plan.maxSeats, tx.customer?.customer_code ?? null],
    );
    await billingAudit(db, p.org_id, 'Subscription paid', `${plan.name}, ${rands(p.amount_cents)} (ref ${p.reference})`);
    await trackFirst(db, p.org_id, 'subscription_started');
  }
}

async function orgBy(db: Db, data: Record<string, unknown>): Promise<OrgRow | null> {
  const sub = (data.subscription_code as string) ?? ((data.subscription as Record<string, unknown> | undefined)?.subscription_code as string | undefined);
  const customer = (data.customer as Record<string, unknown> | undefined)?.customer_code as string | undefined;
  if (!sub && !customer) return null;
  return one<OrgRow>(
    db,
    `select id, kind, paystack_subscription_code, paystack_email_token, grant_plan, grant_until from organisations
      where ($1::text is not null and paystack_subscription_code = $1) or ($2::text is not null and paystack_customer_code = $2)
      order by (paystack_subscription_code = $1) desc nulls last limit 1 for update`,
    [sub ?? null, customer ?? null],
  );
}

async function handleEvent(event: string, data: Record<string, unknown>) {
  switch (event) {
    case 'charge.success': {
      const reference = String(data.reference ?? '');
      if (!reference) return;
      // Never trust the webhook body for money: ask Paystack what actually happened.
      const tx = await verifyTransaction(reference);
      await withTx(async (db) => {
        const p = await one<PaymentRow>(db, 'select * from payments where reference = $1 for update', [reference]);
        if (p) {
          if (p.status === 'success') return;
          if (tx.status !== 'success' || tx.amount !== p.amount_cents || tx.currency !== p.currency) {
            await db.query(`update payments set status = 'failed', failure_reason = $2 where id = $1`, [p.id, `Verification mismatch: ${tx.status} ${tx.amount} ${tx.currency}`.slice(0, 300)]);
            await billingAudit(db, p.org_id, 'Payment not accepted', `ref ${reference}: Paystack reported ${tx.status}, ${tx.amount} ${tx.currency}; expected ${p.amount_cents} ${p.currency}`);
            await publishChange(db, [p.org_id]);
            return;
          }
          await applyPayment(db, p, tx);
          await publishChange(db, [p.org_id]);
          return;
        }
        // A renewal: Paystack made the charge itself, so there is no pending row of ours.
        if (tx.status !== 'success') return;
        const org = await orgBy(db, data);
        if (!org || !org.paystack_subscription_code) return;
        const planCode = typeof tx.plan === 'object' && tx.plan ? tx.plan.plan_code : typeof tx.plan === 'string' ? tx.plan : null;
        const known = planCode ? await one<{ plan_id: string }>(db, 'select plan_id from paystack_plans where plan_code = $1', [planCode]) : null;
        if (!known) return;
        await db.query(
          `insert into payments (org_id, provider, reference, kind, plan_id, amount_cents, currency, status, paid_at) values ($1, 'paystack', $2, 'renewal', $3, $4, $5, 'success', coalesce($6, now()))
           on conflict (reference) do nothing`,
          [org.id, reference, known.plan_id, tx.amount, tx.currency, tx.paid_at ?? null],
        );
        await db.query(`update organisations set subscription_status = 'active' where id = $1`, [org.id]);
        await billingAudit(db, org.id, 'Subscription renewed', `${PLANS[known.plan_id]?.name ?? known.plan_id}, ${rands(tx.amount)} (ref ${reference})`);
        await publishChange(db, [org.id]);
      });
      return;
    }
    case 'subscription.create': {
      const code = String(data.subscription_code ?? '');
      const old: { code?: string; token?: string | null } = {};
      await withTx(async (db) => {
        const org = await orgBy(db, { customer: data.customer });
        if (!org || !code) return;
        if (org.paystack_subscription_code && org.paystack_subscription_code !== code) Object.assign(old, { code: org.paystack_subscription_code, token: org.paystack_email_token });
        await db.query(
          `update organisations set paystack_subscription_code = $2, paystack_email_token = $3, current_period_end = coalesce($4, current_period_end) where id = $1`,
          [org.id, code, (data.email_token as string) ?? null, (data.next_payment_date as string) ?? null],
        );
        await publishChange(db, [org.id]);
      });
      // A plan change is a new subscription: stop the old one so nobody is charged twice.
      if (old.code) await disableSubscription(old.code, old.token ?? null);
      return;
    }
    case 'invoice.update':
    case 'invoice.create': {
      if (!data.paid) return;
      await withTx(async (db) => {
        const org = await orgBy(db, data);
        if (!org) return;
        const next = (data.subscription as Record<string, unknown> | undefined)?.next_payment_date as string | undefined;
        await db.query(`update organisations set subscription_status = 'active', current_period_end = coalesce($2, current_period_end) where id = $1`, [org.id, next ?? null]);
        await publishChange(db, [org.id]);
      });
      return;
    }
    case 'invoice.payment_failed': {
      await withTx(async (db) => {
        const org = await orgBy(db, data);
        if (!org) return;
        // Grace: everything keeps working while the customer fixes their card. Nothing is deleted.
        await db.query(`update organisations set subscription_status = 'past_due' where id = $1`, [org.id]);
        await billingAudit(db, org.id, 'Renewal payment failed', 'The account is in grace until the payment is made. Update the card under Plan & billing.');
        await publishChange(db, [org.id]);
      });
      return;
    }
    case 'subscription.not_renew': {
      await withTx(async (db) => {
        const org = await orgBy(db, data);
        if (org) await billingAudit(db, org.id, 'Subscription set not to renew', 'It stays active until the end of the paid period.');
      });
      return;
    }
    case 'subscription.disable': {
      const code = String(data.subscription_code ?? '');
      await withTx(async (db) => {
        const org = await one<OrgRow & { plan: string; current_period_end: Date | null }>(
          db, 'select id, kind, plan, current_period_end, paystack_subscription_code, grant_plan, grant_until from organisations where paystack_subscription_code = $1 for update', [code],
        );
        if (!org) return; // an old subscription we already replaced
        // Paid time is honoured: the plan continues as a grant until the period it covers ends,
        // unless a grant from COMVERA already lasts longer.
        const paidUntil = org.current_period_end && new Date(org.current_period_end).getTime() > Date.now() ? new Date(org.current_period_end) : null;
        const longerGrant = grantActive({ plan: org.plan, subscription_status: 'canceled', trial_ends_at: null, grant_plan: org.grant_plan, grant_until: org.grant_until })
          && (!org.grant_until || !paidUntil || new Date(org.grant_until) >= paidUntil);
        await db.query(
          `update organisations set paystack_subscription_code = null, paystack_email_token = null,
                  subscription_status = case when kind = 'contractor' then 'free' else 'canceled' end,
                  plan = case when kind = 'contractor' then 'contractor_free' else plan end where id = $1`,
          [org.id],
        );
        if (paidUntil && !longerGrant) {
          await db.query(`update organisations set grant_plan = $2, grant_until = $3, grant_source = 'Paid period after cancelling' where id = $1`, [org.id, org.plan, paidUntil]);
        }
        await billingAudit(db, org.id, 'Subscription cancelled', paidUntil ? `Paid access continues until ${new Date(paidUntil).toISOString().slice(0, 10)}; data stays readable after that.` : 'Data stays readable.');
        await publishChange(db, [org.id]);
      });
      return;
    }
    default:
      return;
  }
}

export default async function paystackRoutes(app: FastifyInstance) {
  app.post('/api/billing/paystack/checkout', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    requirePaystack();
    const { plan: planId } = z.object({ plan: z.string().max(60) }).parse(req.body);
    const plan = PLANS[planId];
    if (!plan || plan.kind !== ctx.org.kind || !plan.paid || plan.id === 'host_enterprise') throw badRequest('That plan is not available.');
    const price = (await pricingTable(pool)).find((p) => p.planId === plan.id);
    if (!price || price.priceCents === null || price.priceCents < 100 || price.currency !== 'ZAR') throw badRequest('That plan has no online price yet. Contact us to arrange it.');
    if (plan.once) {
      if (ctx.org.paystack_subscription_code || ctx.org.stripe_subscription_id) throw conflict('Your subscription already covers your safety files.');
      if (grantActive(ctx.org) && ctx.org.grant_plan !== plan.id) throw conflict('Your current plan from COMVERA already covers your safety files.');
    } else {
      if (ctx.org.paystack_subscription_code && ctx.org.plan === plan.id && ctx.org.subscription_status === 'active') throw conflict(`You are already on ${plan.name}.`);
      if (plan.siteLimit !== null && (await hostSitesInUse(pool, ctx.org.id)) > plan.siteLimit) throw badRequest(`${plan.name} covers ${plan.siteLimit} site${plan.siteLimit === 1 ? '' : 's'} and you have more. Archive sites first, or contact us about Enterprise.`);
      if (plan.connectedSiteLimit !== null && (await contractorSitesInUse(pool, ctx.org.id)) > plan.connectedSiteLimit) throw badRequest(`${plan.name} covers ${plan.connectedSiteLimit} connected sites and you have more. Choose a bigger plan or archive projects.`);
      if ((await seatsUsed(pool, ctx.org.id)) > plan.maxSeats) throw badRequest(`${plan.name} allows up to ${plan.maxSeats} people. Remove people first.`);
    }
    const reference = `cmv_${randomUUID().replace(/-/g, '')}`;
    const planCode = plan.once ? undefined : await planCodeFor(plan, price.priceCents);
    await withTx(async (db) => {
      await db.query(
        `insert into payments (org_id, provider, reference, kind, plan_id, amount_cents, currency, created_by) values ($1, 'paystack', $2, $3, $4, $5, 'ZAR', $6)`,
        [ctx.org.id, reference, plan.once ? 'once_off' : 'subscription', plan.id, price.priceCents, ctx.user.id],
      );
      await audit(db, ctx, 'Started checkout', `${plan.name}, ${rands(price.priceCents!)} (ref ${reference})`);
    });
    const data = await paystack<{ authorization_url: string }>('POST', '/transaction/initialize', {
      email: ctx.user.email,
      amount: price.priceCents,
      currency: 'ZAR',
      reference,
      ...(planCode ? { plan: planCode } : {}),
      callback_url: appUrl('/?billing=success'),
      metadata: { org_id: ctx.org.id, plan_id: plan.id, kind: plan.once ? 'once_off' : 'subscription' },
    });
    return { url: data.authorization_url, reference };
  });

  /** Paystack's own page to update the card on a subscription (link expires quickly, so fetched on demand). */
  app.post('/api/billing/paystack/manage', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    requirePaystack();
    if (!ctx.org.paystack_subscription_code) throw notFound();
    const data = await paystack<{ link: string }>('GET', `/subscription/${encodeURIComponent(ctx.org.paystack_subscription_code)}/manage/link`);
    return { url: data.link };
  });

  app.post('/api/billing/paystack/cancel', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    requirePaystack();
    if (!ctx.org.paystack_subscription_code) throw conflict('There is no subscription to cancel.');
    await disableSubscription(ctx.org.paystack_subscription_code, ctx.org.paystack_email_token ?? null);
    await withTx((db) => audit(db, ctx, 'Asked to cancel subscription', 'Paystack confirms the cancellation; paid time continues to the end of the period.'));
    // The subscription.disable webhook makes the change, so a cancel and Paystack never disagree.
    return { ok: true };
  });

  /** The organisation's payment history (admins), for its own records and reconciliation. */
  app.get('/api/billing/payments', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireAdmin(ctx);
    const rows = await many<{ reference: string; kind: string; plan_id: string; amount_cents: number; currency: string; status: string; created_at: Date; paid_at: Date | null }>(
      pool, `select reference, kind, plan_id, amount_cents, currency, status, created_at, paid_at from payments where org_id = $1 order by created_at desc limit 100`, [ctx.org.id],
    );
    return { payments: rows.map((r) => ({ ...r, planName: PLANS[r.plan_id]?.name ?? r.plan_id })) };
  });

  // The signature covers the exact raw body, so this route gets its own parser.
  await app.register(async (scope) => {
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    scope.post('/api/billing/paystack/webhook', async (req, reply) => {
      if (features.paymentProvider !== 'paystack') return reply.status(404).send();
      const raw = req.body as Buffer;
      if (!Buffer.isBuffer(raw) || !validSignature(raw, req.headers['x-paystack-signature'] as string | undefined)) return reply.status(400).send({ error: 'bad_signature' });
      let body: { event?: string; data?: Record<string, unknown> };
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        return reply.status(400).send({ error: 'bad_body' });
      }
      const id = createHash('sha256').update(raw).digest('hex');
      const fresh = await one(pool, 'insert into paystack_events (id, event) values ($1, $2) on conflict do nothing returning id', [id, String(body.event ?? '').slice(0, 80)]);
      if (!fresh) return { received: true, duplicate: true };
      try {
        await handleEvent(String(body.event ?? ''), body.data ?? {});
      } catch (err) {
        // Let Paystack retry (it does for up to 72 hours): forget that we saw it.
        await pool.query('delete from paystack_events where id = $1', [id]);
        throw err;
      }
      return { received: true };
    });
  });
}
