/**
 * Platform-owner account control: status, flags, test classification, protected deletion.
 * Real separate organisations; every owner action is also tried as an ordinary customer and as a stranger.
 */
import './support/platform-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, PASSWORD, PDF, lastEmailToken, pool, setup, signup, teardown, uniqueEmail } from './helpers.js';
import { codeAt, currentStep } from '../src/lib/totp.js';
import { cleanupExpired } from '../src/jobs/reminders.js';
import { storage } from '../src/lib/storage.js';

let app: FastifyInstance;
let ops: Agent, acme: Agent, member: Agent, bright: Agent, cee: Agent;
let acmeId = '', brightId = '', ceeId = '', memberId = '', acmeEmail = '', memberEmail = '', brightEmail = '';
let recovery: string[] = [];
let next = 0;
/** Proof that will be accepted (spends one recovery code). */
const stepUp = (extra: Record<string, unknown> = {}) => ({ password: PASSWORD, code: recovery[next++], ...extra });
/** For requests the server refuses before it ever checks the proof. */
const pre = (extra: Record<string, unknown> = {}) => ({ password: PASSWORD, code: '000000', ...extra });
const login = (email: string) => new Agent(app).post('/api/auth/login', { email, password: PASSWORD });
const uid = async (email: string) => (await pool.query('select id from users where email = $1', [email])).rows[0].id as string;

before(async () => {
  app = await setup();
  ops = (await signup(app, { orgName: 'COMVERA Ops', orgKind: 'host', email: 'ops@comvera.test' })).agent;
  const s = await ops.post('/api/manager/mfa/setup');
  recovery = (await ops.post('/api/manager/mfa/enable', { code: codeAt(s.body.secret, currentStep()) })).body.recoveryCodes;

  ({ agent: acme, email: acmeEmail } = await signup(app, { orgName: 'Acme Mining', orgKind: 'host' }));
  acmeId = (await acme.state()).org.id;
  const inv = await acme.post('/api/org/invites', { email: (memberEmail = uniqueEmail('member')), role: 'reviewer' });
  assert.equal(inv.status, 200);
  member = (await signup(app, { orgName: '', orgKind: 'host', email: memberEmail, inviteToken: await lastEmailToken(memberEmail, '/invite') })).agent;
  memberId = await uid(memberEmail);

  // Acme invites a contractor to a site; the contractor joins and files a company document.
  brightEmail = uniqueEmail('bright');
  const site = await acme.post('/api/sites', { name: 'Shaft 4', location: 'Kathu', newContractor: { name: 'Brightside Contractors', email: brightEmail }, templatePackIds: ['baseline'] });
  assert.equal(site.status, 200, JSON.stringify(site.body));
  ({ agent: bright } = await signup(app, { orgName: 'Brightside Contractors', orgKind: 'contractor', email: brightEmail, siteInviteToken: await lastEmailToken(brightEmail, '/site-invite') }));
  brightId = (await bright.state()).org.id;
  const lib = `lib:${brightId}:good-standing`;
  assert.equal((await bright.upload(`/api/documents/${encodeURIComponent(lib)}/file`, 'coid.pdf', PDF)).status, 200);

  ({ agent: cee } = await signup(app, { orgName: 'Cee Quarries', orgKind: 'host' }));
  ceeId = (await cee.state()).org.id;
});
after(teardown);

describe('who can use the account controls', () => {
  it('every endpoint is invisible to customers and strangers, even with a valid id and payload', async () => {
    const calls: Array<[string, string, unknown?]> = [
      ['GET', '/api/manager/orgs'], ['GET', `/api/manager/orgs/${acmeId}`], ['GET', '/api/manager/users'], ['GET', `/api/manager/users/${memberId}`],
      ['GET', '/api/manager/review'], ['GET', `/api/manager/orgs/${acmeId}/deletion-preview`],
      ['POST', `/api/manager/orgs/${ceeId}/status`, { status: 'deactivated', reason: 'x y z', confirmName: 'Cee Quarries' }],
      ['POST', `/api/manager/orgs/${ceeId}/flag`, { kind: 'spam', reason: 'because' }],
      ['POST', `/api/manager/orgs/${ceeId}/class`, { class: 'internal_test' }],
      ['POST', `/api/manager/users/${memberId}/status`, { status: 'deactivated', reason: 'x y z', confirmEmail: memberEmail }],
      ['POST', `/api/manager/orgs/${ceeId}/deletion/schedule`, { reason: 'abc', confirmName: 'Cee Quarries', password: PASSWORD, code: '123456' }],
      ['POST', '/api/manager/setup/legal', { done: true }],
    ];
    for (const who of [acme, cee, new Agent(app)]) {
      for (const [m, u, body] of calls) {
        const r = m === 'GET' ? await who.get(u) : await who.post(u, body);
        assert.ok([401, 404].includes(r.status), `${m} ${u} gave ${r.status}`);
      }
    }
    assert.equal((await cee.state()).org.id, ceeId, 'and nothing changed');
  });
});

describe('finding and inspecting accounts', () => {
  it('lists, searches and filters organisations and people', async () => {
    const all = (await ops.get('/api/manager/orgs')).body.orgs;
    assert.ok(['Acme Mining', 'Brightside Contractors', 'Cee Quarries'].every((n) => all.some((o: { name: string }) => o.name === n)));
    assert.deepEqual((await ops.get('/api/manager/orgs?kind=contractor')).body.orgs.map((o: { name: string }) => o.name), ['Brightside Contractors']);
    assert.equal((await ops.get('/api/manager/orgs?q=' + encodeURIComponent(memberEmail))).body.orgs[0].name, 'Acme Mining', 'found through a member’s email');
    const people = (await ops.get(`/api/manager/users?orgId=${acmeId}`)).body.users;
    assert.equal(people.length, 2);
    assert.equal((await ops.get(`/api/manager/users?orgId=${acmeId}&role=reviewer`)).body.users[0].email, memberEmail);
    assert.equal((await ops.get('/api/manager/users?q=' + encodeURIComponent(memberEmail.slice(0, 12)))).body.users.some((u: { id: string }) => u.id === memberId), true);
    const d = (await ops.get(`/api/manager/orgs/${acmeId}`)).body;
    assert.equal(d.sites.length, 0, 'workplaces only; contractor files are counted under contractors');
    assert.equal(d.contractors[0].name, 'Brightside Contractors');
    assert.equal(d.contractors[0].linkedName, 'Brightside Contractors');
    const u = (await ops.get(`/api/manager/users/${memberId}`)).body;
    assert.equal(u.orgs[0].name, 'Acme Mining');
    assert.equal(u.user.verifiedAt !== null, true);
  });
});

describe('flagging blocks nothing', () => {
  it('a flagged organisation and person keep working, and the flag can be cleared', async () => {
    assert.equal((await ops.post(`/api/manager/orgs/${acmeId}/flag`, { kind: 'suspicious', reason: 'Odd sign-up pattern' })).status, 200);
    assert.equal((await ops.post(`/api/manager/users/${memberId}/flag`, { kind: 'suspected_bot', reason: 'Checking' })).status, 200);
    assert.equal((await acme.state()).authenticated, true);
    assert.equal((await member.state()).authenticated, true);
    assert.equal((await ops.post(`/api/manager/orgs/${acmeId}/flag`, { kind: 'nonsense', reason: 'abc' })).status, 400);
    const q = (await ops.get('/api/manager/review')).body;
    assert.ok(q.flaggedOrgs.some((o: { id: string }) => o.id === acmeId));
    assert.ok(q.flaggedUsers.some((u: { id: string }) => u.id === memberId));
    assert.equal((await ops.get('/api/manager/orgs?flagged=1')).body.orgs.length, 1);
    await ops.post(`/api/manager/orgs/${acmeId}/unflag`);
    await ops.post(`/api/manager/users/${memberId}/unflag`);
    assert.equal((await ops.get('/api/manager/review')).body.flaggedOrgs.length, 0);
  });
});

describe('test accounts', () => {
  it('leave the customer counts but stay listed and manageable', async () => {
    const before = (await ops.get('/api/manager/overview')).body.accounts;
    assert.equal((await ops.post(`/api/manager/orgs/${ceeId}/class`, { class: 'internal_test' })).status, 200);
    const after = (await ops.get('/api/manager/overview')).body.accounts;
    assert.equal(after.orgs, before.orgs - 1);
    assert.equal(after.internalTest, before.internalTest + 1);
    assert.equal((await ops.get('/api/manager/orgs?cls=internal_test')).body.orgs[0].id, ceeId);
    assert.equal((await ops.get(`/api/manager/orgs/${ceeId}`)).status, 200);
    assert.equal((await ops.post(`/api/manager/orgs/${ceeId}/class`, { class: 'customer' })).status, 200);
  });
});

describe('suspending and deactivating', () => {
  it('needs a reason and the typed name, and refuses to lock out the platform owner', async () => {
    assert.equal((await ops.post(`/api/manager/orgs/${acmeId}/status`, { status: 'suspended', reason: 'ok' })).status, 400, 'reason too short');
    const wrong = await ops.post(`/api/manager/orgs/${acmeId}/status`, { status: 'suspended', reason: 'Payment dispute', confirmName: 'acme' });
    assert.equal(wrong.status, 409);
    const opsOrg = (await ops.state()).org.id;
    const self = await ops.post(`/api/manager/orgs/${opsOrg}/status`, { status: 'deactivated', reason: 'Testing it', confirmName: 'COMVERA Ops' });
    assert.equal(self.status, 409);
    assert.match(self.body.message, /platform owner/);
    assert.equal((await ops.post(`/api/manager/users/${await uid('ops@comvera.test')}/status`, { status: 'deactivated', reason: 'Testing it', confirmEmail: 'ops@comvera.test' })).status, 409);
  });

  it('suspension ends sessions at once, blocks sign-in on the server, and reactivation restores it', async () => {
    const r = await ops.post(`/api/manager/orgs/${acmeId}/status`, { status: 'suspended', reason: 'Payment dispute', confirmName: 'Acme Mining' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.sessionsEnded >= 2);
    assert.notEqual((await acme.state()).authenticated, true, 'existing session is gone');
    assert.notEqual((await member.state()).authenticated, true);
    const blocked = await login(acmeEmail);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error, 'account_inactive');
    assert.equal((await login(acmeEmail.replace('@', 'x@'))).status, 401, 'unknown addresses still look the same as wrong passwords');
    // the contractor linked to it is unaffected
    assert.equal((await bright.state()).authenticated, true);
    // a direct API call with the old cookie, bypassing the page, is refused too
    assert.equal((await acme.get('/api/me/mfa')).status, 401);
    const audit = (await pool.query(`select action from audit_events where org_id = $1 order by id desc limit 1`, [acmeId])).rows[0].action;
    assert.equal(audit, 'Suspended the account');
    assert.equal((await ops.post(`/api/manager/orgs/${acmeId}/status`, { status: 'active', reason: 'Resolved' })).status, 200);
    assert.equal((await login(acmeEmail)).body.ok, true);
    acme = new Agent(app);
    await acme.post('/api/auth/login', { email: acmeEmail, password: PASSWORD });
    member = new Agent(app);
    await member.post('/api/auth/login', { email: memberEmail, password: PASSWORD });
  });

  it('a person can be deactivated on their own without closing the organisation', async () => {
    assert.equal((await ops.post(`/api/manager/users/${memberId}/status`, { status: 'deactivated', reason: 'Left the company', confirmEmail: 'wrong@x.com' })).status, 409);
    const r = await ops.post(`/api/manager/users/${memberId}/status`, { status: 'deactivated', reason: 'Left the company', confirmEmail: memberEmail });
    assert.equal(r.status, 200);
    assert.notEqual((await member.state()).authenticated, true);
    assert.equal((await login(memberEmail)).body.error, 'account_inactive');
    assert.equal((await acme.state()).authenticated, true, 'the rest of the organisation carries on');
    // a password reset must not sign a deactivated person in either
    await new Agent(app).post('/api/auth/forgot', { email: memberEmail });
    const token = await lastEmailToken(memberEmail, '/reset-password');
    const a = new Agent(app);
    assert.equal((await a.post('/api/auth/reset', { token, password: PASSWORD })).body.signIn, true);
    assert.notEqual((await a.state()).authenticated, true);
  });
});

describe('permanent deletion of a person', () => {
  it('waits out the grace period and needs the password, a fresh code and the typed address', async () => {
    const url = `/api/manager/users/${memberId}/delete`;
    assert.equal((await ops.post(url, pre({ confirmEmail: memberEmail }))).status, 409, 'too soon');
    await pool.query(`update users set status_changed_at = now() - interval '15 days' where id = $1`, [memberId]);
    assert.equal((await ops.post(url, pre({ confirmEmail: 'nope@x.com' }))).status, 409);
    assert.equal((await ops.post(url, { password: 'wrong password here', code: recovery[next], confirmEmail: memberEmail })).status, 401);
    assert.equal((await ops.post(url, { password: PASSWORD, code: '000000', confirmEmail: memberEmail })).status, 401);
    assert.equal((await pool.query('select 1 from users where id = $1', [memberId])).rowCount, 1, 'still there after every refusal');
    assert.equal((await ops.post(url, stepUp({ confirmEmail: memberEmail }))).status, 200);
    assert.equal((await pool.query('select 1 from users where id = $1', [memberId])).rowCount, 0);
    assert.equal((await pool.query(`select 1 from memberships where org_id = $1`, [acmeId])).rowCount, 1, 'the organisation remains');
    await pool.query(`update users set failed_login_count = 0, locked_until = null where email = 'ops@comvera.test'`);
  });
});

describe('permanent deletion of an organisation', () => {
  it('shows exactly what it affects and refuses until the account is closed', async () => {
    const p = await ops.get(`/api/manager/orgs/${acmeId}/deletion-preview`);
    assert.equal(p.status, 200);
    assert.ok(p.body.blockers.length >= 1);
    assert.match(p.body.blockers[0], /Deactivate/);
    assert.equal(p.body.impact.reversible, false);
    assert.equal(p.body.impact.relationships.contractorsLinkedFromThisOrganisation, 1);
    assert.equal(p.body.impact.removed.contractorFiles, 1);
    const early = await ops.post(`/api/manager/orgs/${acmeId}/deletion/schedule`, pre({ reason: 'Customer request', confirmName: 'Acme Mining' }));
    assert.equal(early.status, 409);
  });

  it('is scheduled with step-up proof, can be cancelled, and cannot run early', async () => {
    assert.equal((await ops.post(`/api/manager/orgs/${acmeId}/status`, { status: 'deactivated', reason: 'Customer asked to close', confirmName: 'Acme Mining' })).status, 200);
    const url = `/api/manager/orgs/${acmeId}/deletion/schedule`;
    assert.equal((await ops.post(url, { reason: 'Customer request', confirmName: 'Acme', password: PASSWORD, code: recovery[next] })).status, 409, 'typed name must match');
    assert.equal((await ops.post(url, { reason: 'Customer request', confirmName: 'Acme Mining', password: 'wrong password here', code: recovery[next] })).status, 401);
    assert.equal((await ops.post(url, { reason: 'Customer request', confirmName: 'Acme Mining', password: PASSWORD, code: '123456' })).status, 401);
    const ok = await ops.post(url, stepUp({ reason: 'Customer request', confirmName: 'Acme Mining' }));
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await ops.post(url, pre({ reason: 'Again', confirmName: 'Acme Mining' }))).status, 409, 'only one open request');
    assert.equal((await ops.post(`/api/manager/orgs/${acmeId}/status`, { status: 'active', reason: 'Changed mind' })).status, 409, 'cancel the request before reactivating');
    const exec = `/api/manager/orgs/${acmeId}/deletion/execute`;
    const tooSoon = await ops.post(exec, pre({ confirmName: 'Acme Mining' }));
    assert.equal(tooSoon.status, 409);
    assert.match(tooSoon.body.message, /waiting period/);
    assert.equal((await ops.post(`/api/manager/orgs/${acmeId}/deletion/cancel`)).status, 200);
    assert.equal((await ops.post(exec, pre({ confirmName: 'Acme Mining' }))).status, 409, 'nothing scheduled any more');
    assert.equal((await ops.post(`/api/manager/orgs/${acmeId}/status`, { status: 'active', reason: 'Changed mind' })).status, 200, 'and now it can be reactivated');
    await pool.query(`update users set failed_login_count = 0, locked_until = null where email = 'ops@comvera.test'`);
  });

  it('removes the organisation, its files and its people, keeps what must be kept, and leaves everyone else alone', async () => {
    // Give Acme a stored file of its own so we can prove files are erased.
    assert.equal((await ops.post(`/api/manager/orgs/${acmeId}/status`, { status: 'deactivated', reason: 'Customer asked to close', confirmName: 'Acme Mining' })).status, 200);
    await pool.query(`insert into payments (org_id, provider, reference, kind, plan_id, amount_cents, status, paid_at) values ($1, 'manual', 'ref-acme-1', 'subscription', 'host_pro', 150000, 'success', now())`, [acmeId]);
    // A stored file that belongs to Acme: the row and the object itself.
    await storage.put('acct-test/acme-policy.pdf', PDF, 'application/pdf');
    await pool.query(`insert into files (org_id, storage_key, filename, content_type, size_bytes, sha256) values ($1, 'acct-test/acme-policy.pdf', 'policy.pdf', 'application/pdf', $2, 'abc')`, [acmeId, PDF.length]);
    const filesBefore = (await pool.query(`select count(*)::int as n from files where org_id = $1`, [brightId])).rows[0].n;
    assert.ok(filesBefore >= 1, 'the contractor has a stored company document');
    assert.equal((await ops.post(`/api/manager/orgs/${acmeId}/deletion/schedule`, stepUp({ reason: 'Customer request', confirmName: 'Acme Mining' }))).status, 200);
    await pool.query(`update deletion_requests set scheduled_for = now() - interval '1 minute' where org_id = $1`, [acmeId]);
    const exec = `/api/manager/orgs/${acmeId}/deletion/execute`;
    assert.equal((await ops.post(exec, { confirmName: 'Acme Mining', password: PASSWORD, code: '000000' })).status, 401);
    assert.equal((await pool.query('select 1 from organisations where id = $1', [acmeId])).rowCount, 1, 'refused attempts delete nothing');
    const r = await ops.post(exec, stepUp({ confirmName: 'Acme Mining' }));
    assert.equal(r.status, 200, JSON.stringify(r.body));

    assert.equal((await pool.query('select 1 from organisations where id = $1', [acmeId])).rowCount, 0);
    await assert.rejects(storage.read('acct-test/acme-policy.pdf'), undefined, 'the stored object was erased');
    assert.equal((await pool.query('select 1 from users where email = $1', [acmeEmail])).rowCount, 0, 'its only person is deleted');
    assert.equal((await pool.query('select 1 from sites where org_id = $1', [acmeId])).rowCount, 0);
    assert.equal((await ops.get(`/api/manager/orgs/${acmeId}`)).status, 404);
    // kept: the ledger (with the payment record), and the log of what the owner did
    const ledger = (await pool.query('select * from deletion_ledger where org_id = $1', [acmeId])).rows[0];
    assert.equal(ledger.org_name, 'Acme Mining');
    assert.equal(ledger.deleted_by, 'ops@comvera.test');
    assert.equal(ledger.payments.length, 1);
    assert.equal(ledger.payments[0].reference, 'ref-acme-1');
    assert.equal((await pool.query(`select 1 from platform_actions where action = 'Permanently deleted an organisation' and detail like 'Acme Mining%'`)).rowCount, 1);
    await assert.rejects(pool.query(`delete from deletion_ledger where org_id = $1`, [acmeId]), /append-only/);
    // untouched: the contractor, its person, its own files, and the unrelated mine
    assert.equal((await bright.state()).authenticated, true);
    assert.equal((await pool.query(`select count(*)::int as n from files where org_id = $1`, [brightId])).rows[0].n, filesBefore, 'the contractor’s own files remain');
    assert.equal((await cee.state()).org.id, ceeId);
    assert.equal((await ops.get('/api/manager/orgs')).body.orgs.some((o: { id: string }) => o.id === ceeId), true);
    assert.equal((await pool.query(`select count(*)::int as n from contractors where linked_org_id is null and name = 'Brightside Contractors'`)).rows[0].n, 0, 'the deleted mine’s directory went with it');
  });
});

describe('setup checklist', () => {
  it('shows what each item means, and manual items can be ticked and un-ticked', async () => {
    const items = (await ops.get('/api/manager/setup')).body.items;
    for (const i of items) { assert.ok(i.why.length > 10, i.id + ' says why'); assert.ok(i.how.length > 10, i.id + ' says how'); }
    assert.equal(items.find((i: { id: string }) => i.id === 'legal').status, 'manual');
    assert.equal((await ops.post('/api/manager/setup/legal', { done: true })).status, 200);
    const done = (await ops.get('/api/manager/setup')).body.items.find((i: { id: string }) => i.id === 'legal');
    assert.equal(done.status, 'done');
    assert.match(done.detail, /ops@comvera.test/);
    assert.equal((await ops.post('/api/manager/setup/domain', { done: true })).status, 400, 'automatic items are not tickable');
    await ops.post('/api/manager/setup/legal', { done: false });
    assert.equal((await ops.get('/api/manager/setup')).body.items.find((i: { id: string }) => i.id === 'legal').status, 'manual');
  });

  it('the dashboard only reports what the data supports', async () => {
    const o = (await ops.get('/api/manager/overview')).body;
    assert.equal(typeof o.accounts.orgs, 'number');
    assert.ok(Array.isArray(o.recentOrgs) && Array.isArray(o.recentActions));
    assert.ok(o.recentActions.some((a: { action: string }) => /deleted an organisation/.test(a.action)));
  });
});

describe('support access needs a reason', () => {
  it('refuses a look without one', async () => {
    assert.equal((await ops.get(`/api/manager/orgs/${ceeId}/support-view`)).status, 400);
  });
});

void cleanupExpired;
