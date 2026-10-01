/** Privacy notice, terms, and an organisation's own data export. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, lastEmailToken, setup, signup, teardown, uniqueEmail } from './helpers.js';

let app: FastifyInstance;
let host: Agent, other: Agent;

before(async () => {
  app = await setup();
  host = (await signup(app, { orgName: 'Omicron Mining', orgKind: 'host' })).agent;
  other = (await signup(app, { orgName: 'Pi Platinum', orgKind: 'host' })).agent;
  await host.post('/api/workplaces', { name: 'Omicron North Shaft', requirements: [] });
  await other.post('/api/workplaces', { name: 'Pi Secret Pit', requirements: [] });
});
after(teardown);

describe('privacy and terms pages', () => {
  it('are public, marked as drafts, and claim no certification', async () => {
    for (const path of ['/privacy', '/terms']) {
      const r = await app.inject({ method: 'GET', url: path });
      assert.equal(r.statusCode, 200, path);
      assert.match(r.body, /Draft — awaiting legal review/);
      assert.match(r.body, /does not certify legal compliance|not legal advice/);
    }
    assert.match((await app.inject({ method: 'GET', url: '/privacy' })).body, /last four digits/);
  });
});

describe('organisation data export', () => {
  it('gives an admin their own organisation only, without secrets, and records it', async () => {
    const r = await host.req('GET', '/api/org/export');
    assert.equal(r.status, 200);
    assert.match(String(r.raw.headers['content-disposition']), /siteguard-export-\d{4}-\d{2}-\d{2}\.json/);
    const text = r.raw.body;
    const data = JSON.parse(text);
    assert.equal(data.organisation.name, 'Omicron Mining');
    assert.ok(data.members.length >= 1);
    assert.match(text, /Omicron North Shaft/);
    assert.doesNotMatch(text, /Pi Secret Pit|Pi Platinum/);
    assert.doesNotMatch(text, /password_hash|token_hash|stripe_customer|csrf/i);
    assert.ok(Array.isArray(data.auditTrail) && data.auditTrail.length > 0, 'audit trail included');
    const again = JSON.parse((await host.req('GET', '/api/org/export')).raw.body);
    assert.ok(again.auditTrail.some((e: { action: string }) => e.action === 'Exported organisation data'));
  });

  it('is for organisation admins only', async () => {
    const email = uniqueEmail();
    assert.equal((await host.post('/api/org/invites', { email, role: 'member' })).status, 200);
    const token = await lastEmailToken(email, '/invite');
    const member = (await signup(app, { orgName: '', orgKind: 'host', email, inviteToken: token })).agent;
    assert.equal((await member.req('GET', '/api/org/export')).status, 403);
    assert.equal((await new Agent(app).req('GET', '/api/org/export')).status, 401);
  });
});
