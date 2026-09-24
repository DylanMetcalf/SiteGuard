/** Plans, trials, seats and the Stripe webhook — with billing switched on (no network calls). */
import './billing-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import type { FastifyInstance } from 'fastify';
import { Agent, pool, setup, signup, teardown, uniqueEmail } from './helpers.js';

let app: FastifyInstance;
let host: Agent;
let orgId: string;
const stripe = new Stripe('sk_test_offline');

function webhook(event: object) {
  const payload = JSON.stringify(event);
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });
  return app.inject({ method: 'POST', url: '/api/billing/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': header }, payload });
}
const subscription = (overrides: Record<string, unknown> = {}) => ({
  id: 'sub_123', object: 'subscription', customer: 'cus_123', status: 'active', metadata: { org_id: orgId },
  items: { data: [{ id: 'si_1', price: { id: 'price_starter' }, quantity: 7, current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400 }] },
  ...overrides,
});

before(async () => {
  app = await setup();
  host = (await signup(app, { orgName: 'Paying Mining', orgKind: 'host' })).agent;
  orgId = (await host.state()).org.id;
});
after(teardown);

describe('billing', () => {
  it('new site owners start on a 14-day trial; contractors on the free plan', async () => {
    const st = await host.state();
    assert.equal(st.org.subscriptionStatus, 'trialing');
    assert.equal(st.org.plan, 'host_pro');
    const c = (await signup(app, { orgName: 'Free Contractor', orgKind: 'contractor' })).agent;
    const cs = await c.state();
    assert.equal(cs.org.plan, 'contractor_free');
    assert.equal(cs.org.standing, 'ok');
  });

  it('rejects webhooks without a valid signature', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/billing/webhook', headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=bad' }, payload: '{}' });
    assert.equal(r.statusCode, 400);
  });

  it('a subscription webhook sets plan, seats and status (idempotently)', async () => {
    const event = { id: 'evt_1', object: 'event', type: 'customer.subscription.updated', data: { object: subscription() } };
    assert.equal((await webhook(event)).statusCode, 200);
    const dup = await webhook(event);
    assert.equal(dup.json().duplicate, true);
    const st = await host.state();
    assert.equal(st.org.plan, 'host_starter');
    assert.equal(st.org.subscriptionStatus, 'active');
    assert.equal(st.org.seatLimit, 7);
  });

  it('enforces the plan\'s site limit', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await host.post('/api/sites', { name: 'Site ' + i, newContractor: { name: 'C' + i } });
      assert.equal(r.status, 200, JSON.stringify(r.body));
    }
    const over = await host.post('/api/sites', { name: 'Sixth', newContractor: { name: 'C6' } });
    assert.equal(over.status, 402);
    assert.match(over.body.message, /5 active sites/);
  });

  it('enforces seats, counting pending invitations', async () => {
    for (let i = 0; i < 6; i++) assert.equal((await host.post('/api/org/invites', { email: uniqueEmail('seat'), role: 'reviewer' })).status, 200);
    const r = await host.post('/api/org/invites', { email: uniqueEmail('seat'), role: 'reviewer' });
    assert.equal(r.status, 402);
  });

  it('a cancelled subscription makes the organisation read-only, but still readable', async () => {
    await webhook({ id: 'evt_2', object: 'event', type: 'customer.subscription.deleted', data: { object: subscription({ status: 'canceled' }) } });
    const st = await host.state();
    assert.equal(st.org.standing, 'lapsed');
    assert.ok(Object.keys(st.state.sites).length >= 5, 'data still readable');
    const w = await host.post(`/api/sites/${Object.keys(st.state.sites)[0]}/diary`, { summary: 'x' });
    assert.equal(w.status, 402);
  });

  it('an expired trial is read-only too', async () => {
    const other = (await signup(app, { orgName: 'Lapsed Trial', orgKind: 'host' })).agent;
    const id = (await other.state()).org.id;
    await pool.query(`update organisations set trial_ends_at = now() - interval '1 day' where id = $1`, [id]);
    assert.equal((await other.state()).org.standing, 'lapsed');
    assert.equal((await other.post('/api/sites', { name: 'x', newContractor: { name: 'y' } })).status, 402);
  });
});
