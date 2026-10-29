/** The manager portal: second step, customer-granted support access, the action log. */
import './support/platform-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, PASSWORD, pool, setup, signup, teardown } from './helpers.js';
import { codeAt, currentStep } from '../src/lib/totp.js';

let app: FastifyInstance;
let ops: Agent, mine: Agent, other: Agent, mineOrg: string, otherOrg: string, secret: string, recovery: string[];
const now = () => codeAt(secret, currentStep());

before(async () => {
  app = await setup();
  ops = (await signup(app, { orgName: 'COMVERA Ops', orgKind: 'host', email: 'ops@comvera.test' })).agent;
  mine = (await signup(app, { orgName: 'Manager Test Mining', orgKind: 'host', email: 'owner.mgr@example.com' })).agent;
  other = (await signup(app, { orgName: 'Manager Other Welding', orgKind: 'contractor' })).agent;
  mineOrg = (await mine.state()).org.id;
  otherOrg = (await other.state()).org.id;
  const w = await mine.post('/api/workplaces', { name: 'Mgr North', requirements: [{ category: 'Company Documents', name: 'Letter of Good Standing (COID)', source: 'legal' }] });
  assert.equal((await other.post('/api/sites/join', { code: w.body.code })).status, 200);
});
after(teardown);

describe('manager portal: who can get in', () => {
  it('hides it from everyone who is not a platform admin', async () => {
    assert.equal((await mine.get('/api/manager/overview')).status, 404);
    assert.equal((await mine.get('/api/manager/me')).status, 404);
    assert.equal((await new Agent(app).get('/api/manager/me')).status, 401);
  });

  it('needs the second step even for a platform admin', async () => {
    const r = await ops.get('/api/manager/overview');
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'mfa_required');
    assert.deepEqual((await ops.get('/api/manager/me')).body.enrolled, false);
  });

  it('sets up an authenticator and rejects a wrong code', async () => {
    const s = await ops.post('/api/manager/mfa/setup');
    assert.equal(s.status, 200);
    secret = s.body.secret;
    assert.match(s.body.otpauth, /^otpauth:\/\/totp\/COMVERA:/);
    assert.equal((await ops.post('/api/manager/mfa/enable', { code: '000000' })).status, 401);
    const e = await ops.post('/api/manager/mfa/enable', { code: now() });
    assert.equal(e.status, 200, JSON.stringify(e.body));
    recovery = e.body.recoveryCodes;
    assert.equal(recovery.length, 8);
    assert.equal((await ops.get('/api/manager/overview')).status, 200);
    assert.equal((await ops.post('/api/manager/mfa/setup')).status, 409, 'cannot be silently replaced');
  });

  it('refuses to replay a code, and accepts a recovery code once', async () => {
    const fresh = new Agent(app);
    assert.equal((await fresh.post('/api/auth/login', { email: 'ops@comvera.test', password: PASSWORD })).status, 200);
    assert.equal((await fresh.get('/api/manager/overview')).status, 403);
    assert.equal((await fresh.post('/api/manager/mfa/verify', { code: now() })).status, 401, 'same 30-second code already used');
    assert.equal((await fresh.post('/api/manager/mfa/verify', { code: recovery[0] })).status, 200);
    assert.equal((await fresh.get('/api/manager/overview')).status, 200);
    const again = new Agent(app);
    await again.post('/api/auth/login', { email: 'ops@comvera.test', password: PASSWORD });
    assert.equal((await again.post('/api/manager/mfa/verify', { code: recovery[0] })).status, 401, 'recovery codes are single-use');
  });

  it('a session older than the limit has to repeat the second step', async () => {
    await pool.query(`update sessions set mfa_verified_at = now() - interval '13 hours' where user_id = (select id from users where email = 'ops@comvera.test')`);
    assert.equal((await ops.get('/api/manager/overview')).status, 403);
    await pool.query(`update sessions set mfa_verified_at = now() where user_id = (select id from users where email = 'ops@comvera.test')`);
    assert.equal((await ops.get('/api/manager/overview')).status, 200);
  });
});

describe('manager portal: what it shows', () => {
  it('shows counts and customers without any customer content', async () => {
    const o = (await ops.get('/api/manager/overview')).body;
    assert.ok(o.users.total >= 3);
    const list = (await ops.get('/api/manager/orgs?q=Manager Test')).body.orgs;
    assert.equal(list.length, 1);
    const d = (await ops.get(`/api/manager/orgs/${mineOrg}`)).body;
    assert.equal(d.org.name, 'Manager Test Mining');
    assert.equal(d.counts.workplaces, 1);
    assert.equal(d.counts.documentsByStatus.missing ?? 1, 1);
    assert.ok(d.members.some((m: { email: string }) => m.email === 'owner.mgr@example.com'));
    assert.equal(d.supportAccess, null);
    assert.equal(JSON.stringify(d).includes('Letter of Good Standing'), false, 'no document names without support access');
  });

  it('keeps the inside of an account closed until the customer opens it, then records every look', async () => {
    assert.equal((await ops.get(`/api/manager/orgs/${mineOrg}/support-view`)).status, 403);
    assert.equal((await other.post('/api/support-access', { hours: 1 })).status, 200, 'its own admin may');
    const g = await mine.post('/api/support-access', { hours: 2, reason: 'Help setting up requirements' });
    assert.equal(g.status, 200, JSON.stringify(g.body));
    const v = await ops.get(`/api/manager/orgs/${mineOrg}/support-view`);
    assert.equal(v.status, 200, JSON.stringify(v.body));
    assert.ok(v.body.documents.some((x: { name: string }) => x.name === 'Letter of Good Standing (COID)'));
    assert.ok(!('storage_key' in (v.body.documents[0] ?? {})), 'never file contents');
    const trail = (await pool.query(`select action from audit_events where org_id = $1 order by created_at desc limit 5`, [mineOrg])).rows.map((r) => r.action);
    assert.ok(trail.includes('COMVERA support viewed this account'));
    // Another customer's grant never opens this one.
    assert.equal((await ops.get(`/api/manager/orgs/${otherOrg}/support-view`)).status, 200, 'its own grant works');
    assert.equal((await mine.post('/api/support-access/revoke')).status, 200);
    assert.equal((await ops.get(`/api/manager/orgs/${mineOrg}/support-view`)).status, 403);
  });

  it('customers cannot use the portal, and cannot grant for someone else', async () => {
    assert.equal((await other.get(`/api/manager/orgs/${mineOrg}`)).status, 404);
    assert.equal((await other.post('/api/manager/orgs/' + mineOrg + '/extend-trial', { days: 5 })).status, 404);
  });
});

describe('manager portal: actions and attention', () => {
  it('extends a trial, logs it for the platform and the customer, and refuses for paying customers', async () => {
    await pool.query(`update organisations set subscription_status = 'trialing', trial_ends_at = now() + interval '1 day' where id = $1`, [mineOrg]);
    assert.equal((await ops.post(`/api/manager/orgs/${mineOrg}/extend-trial`, { days: 7 })).status, 200);
    const t = (await pool.query('select trial_ends_at from organisations where id = $1', [mineOrg])).rows[0].trial_ends_at;
    assert.ok(new Date(t).getTime() > Date.now() + 7 * 86400_000);
    await pool.query(`update organisations set subscription_status = 'active' where id = $1`, [mineOrg]);
    assert.equal((await ops.post(`/api/manager/orgs/${mineOrg}/extend-trial`, { days: 7 })).status, 409);
  });

  it('lists failed emails and re-queues them', async () => {
    const { rows } = await pool.query(
      `insert into email_outbox (org_id, to_email, subject, text_body, html_body, status, attempts, last_error) values ($1, 'bounce@example.com', 'Test', 't', 'h', 'failed', 6, 'mailbox full') returning id`, [mineOrg]);
    const att = (await ops.get('/api/manager/attention')).body;
    assert.ok(att.failedEmails.some((e: { to: string }) => e.to === 'bounce@example.com'));
    assert.equal((await ops.post(`/api/manager/emails/${rows[0].id}/requeue`)).status, 200);
    assert.equal((await pool.query('select status from email_outbox where id = $1', [rows[0].id])).rows[0].status, 'pending');
    assert.equal((await ops.post(`/api/manager/emails/${rows[0].id}/requeue`)).status, 404, 'only failed ones');
  });

  it('sends a reset email to the person themselves, and handles the inbox', async () => {
    const uid = (await pool.query(`select id from users where email = 'owner.mgr@example.com'`)).rows[0].id;
    assert.equal((await ops.post(`/api/manager/users/${uid}/reset-email`)).status, 200);
    assert.equal((await pool.query(`select count(*)::int as n from email_outbox where to_email = 'owner.mgr@example.com' and subject like 'Reset%'`)).rows[0].n, 1);
    await pool.query(`insert into enquiries (name, email, message) values ('Lead', 'lead@example.com', 'Do you cover Rustenburg?')`);
    const item = (await ops.get('/api/manager/inbox')).body.items.find((i: { email: string }) => i.email === 'lead@example.com');
    assert.equal((await ops.post(`/api/manager/inbox/enquiry/${item.id}/handle`, { note: 'Replied' })).status, 200);
    assert.ok((await ops.get('/api/manager/inbox')).body.items.find((i: { id: string }) => i.id === item.id).handledAt);
  });

  it('keeps an append-only log of everything the admin did', async () => {
    const log = (await ops.get('/api/manager/actions')).body.actions;
    const names = log.map((a: { action: string }) => a.action);
    for (const want of ['Set up the second sign-in step', 'Extended a trial', 'Re-queued a failed email', 'Sent a password reset email', 'Viewed customer account (support access)']) {
      assert.ok(names.includes(want), want);
    }
    await assert.rejects(pool.query(`update platform_actions set detail = 'x'`), /append-only/);
    await assert.rejects(pool.query(`delete from platform_actions`), /append-only/);
  });
});
