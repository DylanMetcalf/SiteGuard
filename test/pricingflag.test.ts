/** Prices are not final: with PUBLIC_PRICING_ENABLED off (the default) no price is disclosed publicly or to customers, while plans keep working. */
import './support/enforce-env.js'; // plans enforced, no card payments: the live set-up
import './support/platform-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, setup, signup, teardown } from './helpers.js';

let app: FastifyInstance;
let con: Agent, ops: Agent;
before(async () => {
  app = await setup();
  con = (await signup(app, { orgName: 'Flag Contractor', orgKind: 'contractor' })).agent;
  ops = (await signup(app, { orgName: 'Flag Ops', orgKind: 'host', email: 'ops@comvera.test' })).agent;
});
after(teardown);

describe('public pricing switched off', () => {
  it('the public pricing API discloses nothing', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/pricing' });
    assert.equal(r.statusCode, 404);
    assert.ok(!/priceCents|R\s?\d/.test(r.body));
  });

  it('the public app is told pricing is off, so it hides pricing links', async () => {
    const r = (await app.inject({ method: 'GET', url: '/api/bootstrap' })).json();
    assert.equal(r.features.publicPricing, false);
  });

  it('a signed-in customer sees plans and limits but no prices, and the plans still exist', async () => {
    const b = (await con.get('/api/billing')).body;
    assert.equal(b.pricesHidden, true);
    assert.ok(b.plans.length >= 3, 'plans and their features are still there');
    assert.ok(b.plans.every((p: any) => p.priceCents === null));
    assert.ok(b.plans.some((p: any) => p.features.length > 0));
    assert.equal((await con.get('/api/pricing')).status, 404);
  });

  it('a platform admin can still preview prices', async () => {
    assert.equal((await ops.get('/api/pricing')).status, 200);
    const b = (await ops.get('/api/billing')).body;
    assert.equal(b.pricesHidden, false);
  });
});

