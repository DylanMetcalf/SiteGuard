/** Promo codes, plans given by the platform admin, and the editable pricing page. */
import './billing-env.js';
import './support/platform-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, pool, setup, signup, teardown } from './helpers.js';

let app: FastifyInstance;
let ops: Agent, con: Agent, con2: Agent, mine: Agent, conOrg: string;

before(async () => {
  app = await setup();
  ops = (await signup(app, { orgName: 'COMVERA Ops', orgKind: 'host', email: 'ops@comvera.test' })).agent;
  con = (await signup(app, { orgName: 'Psi Electrical', orgKind: 'contractor' })).agent;
  con2 = (await signup(app, { orgName: 'Omega Welding', orgKind: 'contractor' })).agent;
  mine = (await signup(app, { orgName: 'Alpha Mining', orgKind: 'host' })).agent;
  conOrg = (await con.state()).org.id;
  await pool.query(`update organisations set trial_ends_at = now() - interval '1 day' where kind = 'contractor'`);
});
after(teardown);

describe('promo codes', () => {
  it('only a platform admin can create codes', async () => {
    assert.equal((await con.post('/api/admin/promos', { code: 'SNEAKY', plan: 'contractor_pro' })).status, 404);
    const r = await ops.post('/api/admin/promos', { code: 'FAMILYFREE', description: 'Family', plan: 'contractor_pro', maxRedemptions: 1 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await ops.post('/api/admin/promos', { code: 'familyfree', plan: 'contractor_pro' })).status, 409);
    assert.equal((await ops.post('/api/admin/promos', { code: 'HALF', plan: 'contractor_pro', percentOff: 50 })).status, 409, 'partial needs a Stripe coupon');
  });

  it('a 100% code gives the plan with no end date, once, and only to the right kind of company', async () => {
    assert.equal((await mine.post('/api/billing/redeem', { code: 'FAMILYFREE' })).status, 400);
    assert.equal((await con.state()).org.ownAccess, false);
    const r = await con.post('/api/billing/redeem', { code: 'familyfree' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const s = await con.state();
    assert.equal(s.org.ownAccess, true);
    assert.equal(s.org.grant.planName, 'Contractor Pro');
    assert.equal(s.org.grant.until, null);
    assert.equal((await con.post('/api/billing/redeem', { code: 'FAMILYFREE' })).status, 409);
    assert.equal((await con2.post('/api/billing/redeem', { code: 'FAMILYFREE' })).status, 404, 'usage limit reached');
    assert.equal((await con2.post('/api/billing/redeem', { code: 'NOPE-NOPE' })).status, 404);
    const a = await pool.query(`select 1 from audit_events where org_id = $1 and action = 'Redeemed promo code'`, [conOrg]);
    assert.equal(a.rows.length, 1);
  });

  it('a time-limited code ends, and an expired or switched-off code is refused', async () => {
    await ops.post('/api/admin/promos', { code: 'TESTER30', plan: 'contractor_starter', durationDays: 30 });
    const r = await con2.post('/api/billing/redeem', { code: 'TESTER30' });
    assert.equal(r.status, 200);
    const until = (await con2.state()).org.grant.until;
    assert.ok(until && new Date(until).getTime() > Date.now() + 29 * 86400_000);
    await ops.post('/api/admin/promos', { code: 'OLDCODE', plan: 'contractor_pro', expiresAt: '2020-01-01' });
    assert.equal((await con2.post('/api/billing/redeem', { code: 'OLDCODE' })).status, 404);
    const off = (await ops.post('/api/admin/promos', { code: 'PAUSED', plan: 'contractor_pro' })).body.id;
    assert.equal((await ops.post(`/api/admin/promos/${off}/active`, { active: false })).status, 200);
    assert.equal((await con2.post('/api/billing/redeem', { code: 'PAUSED' })).status, 404);
  });
});

describe('plans given by the platform admin', () => {
  it('gives a mining group Enterprise until a date, recorded in its own audit trail', async () => {
    const mineId = (await mine.state()).org.id;
    assert.equal((await con.post(`/api/admin/orgs/${mineId}/grant`, { plan: 'host_enterprise' })).status, 404);
    const found = (await ops.get('/api/admin/orgs?q=Alpha')).body.orgs;
    assert.equal(found[0].id, mineId);
    assert.equal((await ops.post(`/api/admin/orgs/${mineId}/grant`, { plan: 'contractor_pro' })).status, 409);
    assert.equal((await ops.post(`/api/admin/orgs/${mineId}/grant`, { plan: 'host_enterprise', until: '2030-12-31', note: 'Pilot' })).status, 200);
    const s = await mine.state();
    assert.equal(s.org.planName, 'Enterprise');
    const a = await pool.query(`select actor_role from audit_events where org_id = $1 and action = 'Plan given by COMVERA'`, [mineId]);
    assert.equal(a.rows[0].actor_role, 'COMVERA platform');
  });
});

describe('pricing page', () => {
  it('shows default prices, and the admin can change them', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/pricing' });
    const plans = r.json().plans as { planId: string; priceCents: number | null }[];
    assert.ok(plans.find((p) => p.planId === 'contractor_starter')!.priceCents! > 0);
    assert.equal(plans.find((p) => p.planId === 'host_enterprise')!.priceCents, null);
    assert.equal((await con.req('PUT', '/api/admin/pricing/contractor_pro', { priceCents: 1 })).status, 404);
    assert.equal((await ops.req('PUT', '/api/admin/pricing/contractor_pro', { priceCents: 79900, highlights: ['Everything'], visible: true })).status, 200);
    const after2 = (await app.inject({ method: 'GET', url: '/api/pricing' })).json().plans.find((p: { planId: string }) => p.planId === 'contractor_pro');
    assert.equal(after2.priceCents, 79900);
    assert.deepEqual(after2.highlights, ['Everything']);
  });
});
