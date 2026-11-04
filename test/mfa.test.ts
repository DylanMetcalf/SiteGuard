/** The second sign-in step for customers: set-up, sign-in challenge, recovery, organisation requirement, no bypasses. */
import './support/platform-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, PASSWORD, lastEmailToken, pool, setup, signup, teardown } from './helpers.js';
import { codeAt, currentStep } from '../src/lib/totp.js';

let app: FastifyInstance;
let owner: Agent, ownerEmail: string, secret = '', recovery: string[] = [];
let member: Agent, memberEmail: string;
const code = (offset = 0) => codeAt(secret, currentStep() + offset);
const login = (email: string) => new Agent(app).post('/api/auth/login', { email, password: PASSWORD });

before(async () => {
  app = await setup();
  ({ agent: owner, email: ownerEmail } = await signup(app, { orgName: 'Two Step Mining', orgKind: 'host' }));
  const inv = await owner.post('/api/org/invites', { email: 'member.mfa@example.com', role: 'reviewer' });
  assert.equal(inv.status, 200, JSON.stringify(inv.body));
  const token = await lastEmailToken('member.mfa@example.com', '/invite');
  member = (await signup(app, { orgName: '', orgKind: 'host', email: 'member.mfa@example.com', inviteToken: token })).agent;
  memberEmail = 'member.mfa@example.com';
});
after(teardown);

describe('turning it on', () => {
  it('is off by default and sign-in works as before', async () => {
    assert.equal((await owner.get('/api/me/mfa')).body.enabled, false);
    assert.equal((await login(ownerEmail)).body.ok, true);
  });

  it('needs a correct code to finish set-up, then gives recovery codes once and signs out other devices', async () => {
    const other = new Agent(app);
    await other.post('/api/auth/login', { email: ownerEmail, password: PASSWORD });
    const s = await owner.post('/api/me/mfa/setup');
    assert.equal(s.status, 200);
    secret = s.body.secret;
    assert.equal((await owner.post('/api/me/mfa/enable', { code: '000000' })).status, 401);
    const e = await owner.post('/api/me/mfa/enable', { code: code() });
    assert.equal(e.status, 200, JSON.stringify(e.body));
    recovery = e.body.recoveryCodes;
    assert.equal(recovery.length, 8);
    assert.notEqual((await other.state()).authenticated, true, 'other sessions ended');
    assert.equal((await owner.state()).authenticated, true, 'this device stays signed in');
    assert.equal((await owner.post('/api/me/mfa/setup')).status, 409, 'cannot silently replace the key');
    const mail = (await pool.query(`select subject from email_outbox where to_email = $1 order by id desc limit 1`, [ownerEmail])).rows[0].subject;
    assert.match(mail, /Two-step sign-in is on/);
  });
});

describe('signing in', () => {
  it('a correct password alone gives no session, only a ticket', async () => {
    const a = new Agent(app);
    const r = await a.post('/api/auth/login', { email: ownerEmail, password: PASSWORD });
    assert.equal(r.body.mfaRequired, true);
    assert.ok(r.body.ticket);
    assert.notEqual((await a.state()).authenticated, true);
  });

  it('refuses a wrong code, a replayed code and a used ticket', async () => {
    const a = new Agent(app);
    const t = (await a.post('/api/auth/login', { email: ownerEmail, password: PASSWORD })).body.ticket;
    assert.equal((await a.post('/api/auth/login/mfa', { ticket: t, code: '123456' })).status, 401);
    const c = code(1);
    const ok = await a.post('/api/auth/login/mfa', { ticket: t, code: c });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await a.state()).authenticated, true);
    assert.equal((await a.post('/api/auth/login/mfa', { ticket: t, code: c })).status, 401, 'ticket is single-use');
    const b = new Agent(app);
    const t2 = (await b.post('/api/auth/login', { email: ownerEmail, password: PASSWORD })).body.ticket;
    assert.equal((await b.post('/api/auth/login/mfa', { ticket: t2, code: c })).status, 401, 'the same code cannot be used twice');
    await pool.query(`update users set failed_login_count = 0, locked_until = null where email = $1`, [ownerEmail]);
  });

  it('a ticket dies after five wrong codes, and expires', async () => {
    const a = new Agent(app);
    const t = (await a.post('/api/auth/login', { email: ownerEmail, password: PASSWORD })).body.ticket;
    for (let i = 0; i < 5; i++) await a.post('/api/auth/login/mfa', { ticket: t, code: '111111' });
    assert.equal((await pool.query(`select count(*)::int as n from login_challenges l join users u on u.id = l.user_id where u.email = $1`, [ownerEmail])).rows[0].n, 0);
    await pool.query(`update users set failed_login_count = 0, locked_until = null where email = $1`, [ownerEmail]);
    const t2 = (await a.post('/api/auth/login', { email: ownerEmail, password: PASSWORD })).body.ticket;
    await pool.query(`update login_challenges set expires_at = now() - interval '1 second'`);
    assert.equal((await a.post('/api/auth/login/mfa', { ticket: t2, code: code() })).status, 401);
  });

  it('a recovery code works once', async () => {
    const a = new Agent(app);
    const t = (await a.post('/api/auth/login', { email: ownerEmail, password: PASSWORD })).body.ticket;
    const r = await a.post('/api/auth/login/mfa', { ticket: t, code: recovery[0] });
    assert.equal(r.status, 200);
    assert.equal(r.body.usedRecoveryCode, true);
    const b = new Agent(app);
    const t2 = (await b.post('/api/auth/login', { email: ownerEmail, password: PASSWORD })).body.ticket;
    assert.equal((await b.post('/api/auth/login/mfa', { ticket: t2, code: recovery[0] })).status, 401);
    await pool.query(`update users set failed_login_count = 0, locked_until = null where email = $1`, [ownerEmail]);
  });

  it('a password reset does not get around the second step', async () => {
    await new Agent(app).post('/api/auth/forgot', { email: ownerEmail });
    const token = await lastEmailToken(ownerEmail, '/reset-password');
    const a = new Agent(app);
    const r = await a.post('/api/auth/reset', { token, password: PASSWORD });
    assert.equal(r.status, 200);
    assert.equal(r.body.signIn, true);
    assert.notEqual((await a.state()).authenticated, true, 'no session from the reset alone');
  });
});

describe('an organisation requiring it', () => {
  it('only an admin with it on can require it', async () => {
    assert.equal((await member.post('/api/org/require-mfa', { on: true })).status, 403);
    const signedIn = new Agent(app);
    const t = (await signedIn.post('/api/auth/login', { email: ownerEmail, password: PASSWORD })).body.ticket;
    await signedIn.post('/api/auth/login/mfa', { ticket: t, code: recovery[1] });
    owner = signedIn;
    assert.equal((await owner.post('/api/org/require-mfa', { on: true })).status, 200);
  });

  it('a member without it sees nothing and can do nothing except set it up', async () => {
    const st = await member.state();
    assert.equal(st.mfaSetupRequired, true);
    assert.equal(st.state, undefined, 'no workspace data');
    const blocked = await member.get('/api/manager/overview');
    assert.ok([403, 404].includes(blocked.status));
    const w = await member.post('/api/workplaces', { name: 'Sneaky' });
    assert.equal(w.status, 403);
    assert.equal(w.body.error, 'mfa_setup_required');
    assert.equal((await member.get('/api/me/mfa')).status, 200);
  });

  it('once the member sets it up, the workspace opens; they cannot turn it off while required', async () => {
    const s = await member.post('/api/me/mfa/setup');
    const memberCode = codeAt(s.body.secret, currentStep());
    assert.equal((await member.post('/api/me/mfa/enable', { code: memberCode })).status, 200);
    const st = await member.state();
    assert.ok(st.state, 'workspace loads');
    const off = await member.post('/api/me/mfa/disable', { password: PASSWORD, code: codeAt(s.body.secret, currentStep() + 1) });
    assert.equal(off.status, 409);
  });
});

describe('platform reset', () => {
  it('needs the manager portal, ends sessions and tells the person', async () => {
    const memberId = (await pool.query(`select id from users where email = $1`, [memberEmail])).rows[0].id;
    assert.equal((await owner.post(`/api/manager/users/${memberId}/reset-mfa`, { reason: 'lost phone' })).status, 404, 'a customer admin cannot');
    // ops admin with the second step (enrolled the same way)
    const ops = (await signup(app, { orgName: 'Ops', orgKind: 'host', email: 'ops@comvera.test' })).agent;
    const s = await ops.post('/api/manager/mfa/setup');
    await ops.post('/api/manager/mfa/enable', { code: codeAt(s.body.secret, currentStep()) });
    const r = await ops.post(`/api/manager/users/${memberId}/reset-mfa`, { reason: 'Lost phone, identity checked by call' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.notEqual((await member.state()).authenticated, true);
    assert.equal((await pool.query(`select count(*)::int as n from user_mfa where user_id = $1`, [memberId])).rows[0].n, 0);
    const log = (await pool.query(`select action from platform_actions order by id desc limit 1`)).rows[0].action;
    assert.equal(log, 'Reset two-step sign-in');
  });
});
