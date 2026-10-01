/** The operator's platform overview: hidden from everyone but confirmed platform admins. */
import './support/platform-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, lastEmailToken, pool, setup, signup, teardown } from './helpers.js';

let app: FastifyInstance;
let ops: Agent, customer: Agent;

before(async () => {
  app = await setup();
  ops = (await signup(app, { orgName: 'SiteGuard Ops', orgKind: 'contractor', email: 'ops@siteguard.test' })).agent;
  customer = (await signup(app, { orgName: 'Rho Mining', orgKind: 'host' })).agent;
  assert.equal((await customer.post('/api/feedback', { kind: 'idea', message: 'Please add a dark mode toggle' })).status, 200);
});
after(teardown);

describe('platform overview', () => {
  it('stays hidden until the admin address is confirmed', async () => {
    await pool.query(`update users set email_verified_at = null where email = 'ops@siteguard.test'`);
    assert.equal((await ops.req('GET', '/api/admin/overview')).status, 404);
    assert.equal((await ops.state()).me.platformAdmin, false);
    const token = await lastEmailToken('ops@siteguard.test', '/verify-email');
    assert.equal((await ops.post('/api/auth/verify-email', { token })).status, 200);
    assert.equal((await ops.state()).me.platformAdmin, true);
  });

  it('shows counts, sign-ups and feedback to a platform admin', async () => {
    const r = await ops.get('/api/admin/overview');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const host = r.body.organisations.find((o: { kind: string }) => o.kind === 'host');
    assert.ok(host.total >= 1);
    assert.ok(r.body.usage.users >= 2);
    assert.ok(r.body.recentSignups.some((o: { name: string }) => o.name === 'Rho Mining'));
    assert.ok(r.body.recentFeedback.some((f: { message: string; org: string }) => /dark mode/.test(f.message) && f.org === 'Rho Mining'));
    assert.equal(typeof r.body.health.emailFailed7d, 'number');
    assert.doesNotMatch(JSON.stringify(r.body), /password|token|@example\.com/i);
  });

  it('is a 404 for customers and a 401 when signed out', async () => {
    assert.equal((await customer.req('GET', '/api/admin/overview')).status, 404);
    assert.equal((await customer.state()).me.platformAdmin, false);
    assert.equal((await new Agent(app).req('GET', '/api/admin/overview')).status, 401);
  });
});
