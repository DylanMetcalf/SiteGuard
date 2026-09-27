/** Site join codes: a contractor connects to a site by typing a short code. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, pool, setup, signup, teardown, uniqueEmail } from './helpers.js';

let app: FastifyInstance;
let host: Agent;
let otherHost: Agent;
let contractor: Agent;
let siteId: string;

before(async () => {
  app = await setup();
  host = (await signup(app, { orgName: 'Lambda Gold', orgKind: 'host' })).agent;
  otherHost = (await signup(app, { orgName: 'Other Gold', orgKind: 'host' })).agent;
  contractor = (await signup(app, { orgName: 'Quick Scaffolds', orgKind: 'contractor' })).agent;
  siteId = (await host.post('/api/sites', { name: 'Plant Shutdown', newContractor: { name: 'Quick Scaffolds', email: uniqueEmail('qs') }, templatePackIds: ['baseline'] })).body.id;
});
after(teardown);

describe('join codes', () => {
  it('only the site owner can create one, and a new code replaces the old', async () => {
    assert.equal((await otherHost.post(`/api/sites/${siteId}/join-code`)).status, 404);
    assert.equal((await contractor.post(`/api/sites/${siteId}/join-code`)).status, 403);
    const first = (await host.post(`/api/sites/${siteId}/join-code`)).body.code;
    assert.match(first, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const second = (await host.post(`/api/sites/${siteId}/join-code`)).body.code;
    assert.notEqual(first, second);
    assert.equal((await contractor.post('/api/sites/join', { code: first })).status, 404, 'old code no longer works');
    (globalThis as { code?: string }).code = second;
  });

  it('refuses hosts, expired codes and typos', async () => {
    const code = (globalThis as { code?: string }).code!;
    assert.equal((await otherHost.post('/api/sites/join', { code })).status, 403);
    assert.equal((await contractor.post('/api/sites/join', { code: 'ZZZZ-ZZZZ' })).status, 404);
    await pool.query(`update site_invitations set join_code_expires_at = now() - interval '1 minute' where site_id = $1`, [siteId]);
    const expired = await contractor.post('/api/sites/join', { code });
    assert.equal(expired.status, 404);
    assert.match(expired.body.message, /isn't valid or has expired/);
    await pool.query(`update site_invitations set join_code_expires_at = now() + interval '1 day' where site_id = $1`, [siteId]);
  });

  it('connects the contractor, forgiving case and spacing, and only once', async () => {
    const code = (globalThis as { code?: string }).code!;
    const messy = ` ${code.toLowerCase().replace('-', ' ')} `;
    const r = await contractor.post('/api/sites/join', { code: messy });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.siteId, siteId);
    const s = await contractor.state();
    assert.equal(s.state.sites[siteId].status, 'in_progress');
    assert.equal((await contractor.post('/api/sites/join', { code })).status, 404, 'a used code stops working');
    assert.ok((await host.state()).inbox.items.some((n: { title: string }) => /Quick Scaffolds joined Plant Shutdown/.test(n.title)));
    assert.equal((await host.post(`/api/sites/${siteId}/join-code`)).status, 409, 'no code once joined');
  });
});
