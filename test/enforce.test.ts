/** A beta without a payment provider: trials and codes are enforced, card payments are not offered. */
import './support/enforce-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { pool, setup, signup, teardown } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = await setup(); });
after(teardown);

describe('plans enforced without payments', () => {
  it('runs a real 14-day trial, refuses card checkout politely, and keeps data readable afterwards', async () => {
    const { agent } = await signup(app, { orgName: 'Beta Electrical', orgKind: 'contractor' });
    let s = await agent.state();
    assert.equal(s.features.billing, true);
    assert.equal(s.features.payments, false);
    assert.equal(s.org.subscriptionStatus, 'trialing');
    const b = await agent.get('/api/billing');
    assert.equal(b.body.payments, false);
    assert.ok(b.body.plans.every((p: { paid: boolean; purchasable: boolean }) => !p.paid || !p.purchasable));
    const co = await agent.post('/api/billing/checkout', { plan: 'contractor_pro', seats: 1 });
    assert.equal(co.status, 503);
    assert.match(co.body.message, /contact us|promo code/i);
    await pool.query(`update organisations set trial_ends_at = now() - interval '1 day' where id = $1`, [s.org.id]);
    s = await agent.state();
    assert.equal(s.org.standing, 'lapsed');
    assert.equal((await agent.post('/api/projects', { clientName: 'X', name: 'Y' })).status, 402);
    assert.equal((await agent.get('/api/org/export')).status, 200, 'data stays readable and exportable');
  });
});
