/**
 * Paystack: payments count only after a signed webhook AND a matching verification from Paystack.
 * No network: a fake Paystack answers the API calls.
 */
import './paystack-env.js';
import { createHmac } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, pool, setup, signup, teardown } from './helpers.js';
import { setPaystackFetch } from '../src/lib/paystack.js';

let app: FastifyInstance;
let con: Agent, conOrg: string, host: Agent, hostOrg: string;
const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
// What the fake Paystack reports for each reference when asked to verify it.
const verified = new Map<string, { status: string; amount: number; currency: string }>();

const fake: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  calls.push({ method: init?.method ?? 'GET', path: url.pathname, body });
  const ok = (data: unknown) => new Response(JSON.stringify({ status: true, message: 'ok', data }), { status: 200 });
  if (url.pathname === '/plan') return ok({ plan_code: 'PLN_' + body.amount });
  if (url.pathname === '/transaction/initialize') return ok({ authorization_url: 'https://checkout.paystack.com/' + body.reference, reference: body.reference });
  if (url.pathname.startsWith('/transaction/verify/')) {
    const ref = decodeURIComponent(url.pathname.split('/').pop()!);
    const v = verified.get(ref) ?? { status: 'failed', amount: 0, currency: 'ZAR' };
    return ok({ reference: ref, ...v, paid_at: new Date().toISOString(), customer: { customer_code: 'CUS_' + ref.slice(-6) }, plan: null });
  }
  if (url.pathname === '/subscription/disable') return ok(null);
  if (url.pathname.endsWith('/manage/link')) return ok({ link: 'https://paystack.com/manage/xyz' });
  return new Response(JSON.stringify({ status: false, message: 'not found' }), { status: 404 });
};

function webhook(payload: object, secret = process.env.PAYSTACK_SECRET_KEY!) {
  const raw = JSON.stringify(payload);
  const sig = createHmac('sha512', secret).update(raw).digest('hex');
  return app.inject({ method: 'POST', url: '/api/billing/paystack/webhook', headers: { 'content-type': 'application/json', 'x-paystack-signature': sig }, payload: raw });
}
const org = async (id: string) => (await pool.query('select * from organisations where id = $1', [id])).rows[0];

before(async () => {
  setPaystackFetch(fake);
  app = await setup();
  con = (await signup(app, { orgName: 'Psi Electrical', orgKind: 'contractor' })).agent;
  conOrg = (await con.state()).org.id;
  host = (await signup(app, { orgName: 'Omega Platinum', orgKind: 'host' })).agent;
  hostOrg = (await host.state()).org.id;
});
after(async () => { setPaystackFetch(null); await teardown(); });

describe('Paystack billing', () => {
  it('starts a checkout at the price on the pricing page, creating the Paystack plan once', async () => {
    const b = (await host.get('/api/billing')).body;
    assert.equal(b.provider, 'paystack');
    assert.ok(b.plans.find((p: { id: string; purchasable: boolean }) => p.id === 'host_starter').purchasable);
    const r = await host.post('/api/billing/paystack/checkout', { plan: 'host_starter' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.url, /^https:\/\/checkout\.paystack\.com\//);
    const init = calls.find((c) => c.path === '/transaction/initialize')!;
    assert.equal(init.body.amount, 249900);
    assert.equal(init.body.plan, 'PLN_249900');
    assert.equal(init.body.currency, 'ZAR');
    await host.post('/api/billing/paystack/checkout', { plan: 'host_starter' });
    assert.equal(calls.filter((c) => c.path === '/plan').length, 1, 'plan code cached');
    // Only admins, and only plans of your own kind.
    assert.equal((await host.post('/api/billing/paystack/checkout', { plan: 'contractor_pro' })).status, 400);
  });

  it('ignores the browser coming back: nothing changes until Paystack confirms', async () => {
    assert.notEqual((await org(hostOrg)).subscription_status, 'active');
  });

  it('rejects webhooks with a bad signature', async () => {
    const r = await webhook({ event: 'charge.success', data: { reference: 'x' } }, 'wrong-secret');
    assert.equal(r.statusCode, 400);
  });

  it('does not activate when Paystack reports a different amount', async () => {
    const ref = (await pool.query(`select reference from payments where org_id = $1 order by created_at limit 1`, [hostOrg])).rows[0].reference;
    verified.set(ref, { status: 'success', amount: 100, currency: 'ZAR' });
    assert.equal((await webhook({ event: 'charge.success', data: { reference: ref } })).statusCode, 200);
    const p = (await pool.query('select status from payments where reference = $1', [ref])).rows[0];
    assert.equal(p.status, 'failed');
    assert.notEqual((await org(hostOrg)).subscription_status, 'active');
  });

  it('activates on a verified charge, once, and links the Paystack subscription', async () => {
    const ref = (await pool.query(`select reference from payments where org_id = $1 and status = 'pending' order by created_at limit 1`, [hostOrg])).rows[0].reference;
    verified.set(ref, { status: 'success', amount: 249900, currency: 'ZAR' });
    const ev = { event: 'charge.success', data: { reference: ref } };
    assert.equal((await webhook(ev)).statusCode, 200);
    assert.equal((await webhook(ev)).body.includes('duplicate'), true, 'a retried delivery is processed once');
    let o = await org(hostOrg);
    assert.equal(o.subscription_status, 'active');
    assert.equal(o.plan, 'host_starter');
    assert.equal(o.billing_provider, 'paystack');
    await webhook({ event: 'subscription.create', data: { subscription_code: 'SUB_1', email_token: 'tok1', next_payment_date: '2099-01-01T00:00:00Z', customer: { customer_code: o.paystack_customer_code } } });
    o = await org(hostOrg);
    assert.equal(o.paystack_subscription_code, 'SUB_1');
    const hist = (await host.get('/api/billing/payments')).body.payments;
    assert.ok(hist.some((p: { status: string }) => p.status === 'success'));
  });

  it('a failed renewal means grace (still working), never deleted data', async () => {
    await webhook({ event: 'invoice.payment_failed', data: { subscription: { subscription_code: 'SUB_1' }, paid: false } });
    assert.equal((await org(hostOrg)).subscription_status, 'past_due');
    assert.equal((await host.state()).org.standing, 'grace');
    await webhook({ event: 'invoice.update', data: { subscription: { subscription_code: 'SUB_1', next_payment_date: '2099-02-01T00:00:00Z' }, paid: true } });
    assert.equal((await org(hostOrg)).subscription_status, 'active');
  });

  it('cancelling asks Paystack, and keeps paid time until the period ends', async () => {
    assert.equal((await host.post('/api/billing/paystack/cancel')).status, 200);
    assert.ok(calls.some((c) => c.path === '/subscription/disable' && c.body.code === 'SUB_1' && c.body.token === 'tok1'));
    await webhook({ event: 'subscription.disable', data: { subscription_code: 'SUB_1' } });
    const o = await org(hostOrg);
    assert.equal(o.subscription_status, 'canceled');
    assert.equal(o.paystack_subscription_code, null);
    assert.equal(o.grant_plan, 'host_starter', 'paid period honoured');
    assert.equal((await host.state()).org.standing, 'ok');
  });

  it('a once-off safety file opens the workspace for a set time, with no subscription', async () => {
    const r = await con.post('/api/billing/paystack/checkout', { plan: 'contractor_once' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const init = calls.filter((c) => c.path === '/transaction/initialize').pop()!;
    assert.equal(init.body.plan, undefined, 'no Paystack plan: a single charge');
    assert.equal(init.body.amount, 129900);
    verified.set(r.body.reference, { status: 'success', amount: 129900, currency: 'ZAR' });
    await webhook({ event: 'charge.success', data: { reference: r.body.reference } });
    const o = await org(conOrg);
    assert.equal(o.grant_plan, 'contractor_once');
    assert.ok(new Date(o.grant_until).getTime() > Date.now() + 50 * 86400_000);
    assert.equal(o.paystack_subscription_code, null);
    // One file: a second project is over the once-off's capacity.
    assert.equal((await con.post('/api/projects', { clientName: 'Rho Client', name: 'Job A' })).status, 200);
    const over = await con.post('/api/projects', { clientName: 'Sigma Client', name: 'Job B' });
    assert.equal(over.status, 402);
  });

  it('keeps payment history inside the organisation', async () => {
    const mine = (await con.get('/api/billing/payments')).body.payments;
    assert.ok(mine.length >= 1);
    assert.ok(mine.every((p: { planName: string }) => p.planName === 'Once-off safety file'));
  });
});
