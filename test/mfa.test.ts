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
    assert.equal((await owner.post('/api/me/mfa/enable', { code: '000000', password: PASSWORD })).status, 401);
    const e = await owner.post('/api/me/mfa/enable', { code: code(), password: PASSWORD });
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
    assert.equal((await member.post('/api/me/mfa/enable', { code: memberCode, password: PASSWORD })).status, 200);
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

describe('review fixes (no ways around the lockout or the password)', () => {
  let solo: Agent, soloEmail = '', soloSecret = '', soloRecovery: string[] = [];
  const soloCode = (o = 0) => codeAt(soloSecret, currentStep() + o);
  const lock = (on: boolean) => pool.query(
    `update users set failed_login_count = $2, locked_until = $3 where email = $1`, [soloEmail, on ? 10 : 0, on ? new Date(Date.now() + 900_000) : null]);

  before(async () => {
    ({ agent: solo, email: soloEmail } = await signup(app, { orgName: 'Solo Contractors', orgKind: 'contractor' }));
  });

  it('turning it on needs the account password', async () => {
    const s = await solo.post('/api/me/mfa/setup');
    soloSecret = s.body.secret;
    assert.equal((await solo.post('/api/me/mfa/enable', { code: soloCode() })).status, 400, 'no password');
    assert.equal((await solo.post('/api/me/mfa/enable', { code: soloCode(), password: 'wrong-password-1' })).body.error, 'wrong_password');
    const e = await solo.post('/api/me/mfa/enable', { code: soloCode(), password: PASSWORD });
    assert.equal(e.status, 200);
    soloRecovery = e.body.recoveryCodes;
    await lock(false);
  });

  it('ten wrong codes lock the account, and a password reset does not unlock it or keep old tickets', async () => {
    const t = (await login(soloEmail)).body.ticket;
    for (let i = 0; i < 2; i++) {
      const tk = (await login(soloEmail)).body.ticket;
      for (let j = 0; j < 5; j++) await new Agent(app).post('/api/auth/login/mfa', { ticket: tk, code: '000001' });
    }
    assert.equal((await login(soloEmail)).status, 423, 'locked: not even a new ticket');
    assert.equal((await new Agent(app).post('/api/auth/login/mfa', { ticket: t, code: soloCode(1) })).status, 401, 'an older ticket was replaced');
    await new Agent(app).post('/api/auth/forgot', { email: soloEmail });
    const token = await lastEmailToken(soloEmail, '/reset-password');
    assert.equal((await new Agent(app).post('/api/auth/reset', { token, password: PASSWORD })).status, 200);
    const u = (await pool.query(`select locked_until from users where email = $1`, [soloEmail])).rows[0];
    assert.ok(u.locked_until && new Date(u.locked_until) > new Date(), 'reset keeps the lock');
    assert.equal((await pool.query(`select count(*)::int as n from login_challenges l join users u on u.id = l.user_id where u.email = $1`, [soloEmail])).rows[0].n, 0, 'tickets cancelled');
    // the reset ended every session; sign back in with a recovery code once the lock has passed
    await lock(false);
    solo = new Agent(app);
    const tk = (await solo.post('/api/auth/login', { email: soloEmail, password: PASSWORD })).body.ticket;
    assert.equal((await solo.post('/api/auth/login/mfa', { ticket: tk, code: soloRecovery[0] })).status, 200);
  });

  it('the signed-in routes respect the lockout too', async () => {
    await lock(true);
    assert.equal((await solo.post('/api/me/mfa/recovery-codes', { code: soloCode(1) })).status, 423);
    assert.equal((await solo.post('/api/me/mfa/disable', { password: PASSWORD, code: soloCode(1) })).status, 423);
    await lock(false);
  });

  it('a wrong password when turning it off counts towards the lockout', async () => {
    const before = (await pool.query(`select failed_login_count as n from users where email = $1`, [soloEmail])).rows[0].n;
    const r = await solo.post('/api/me/mfa/disable', { password: 'wrong-password-1', code: soloCode(2) });
    assert.equal(r.body.error, 'wrong_password');
    const afterN = (await pool.query(`select failed_login_count as n from users where email = $1`, [soloEmail])).rows[0].n;
    assert.equal(afterN, before + 1);
    await lock(false);
  });

  it('new recovery codes replace the old ones, and turning it off works with password and code', async () => {
    const r = await solo.post('/api/me/mfa/recovery-codes', { code: soloCode(1) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.recoveryCodes.length, 8);
    const off = await solo.post('/api/me/mfa/disable', { password: PASSWORD, code: r.body.recoveryCodes[0] });
    assert.equal(off.status, 200, JSON.stringify(off.body));
    assert.equal((await solo.get('/api/me/mfa')).body.enabled, false);
    assert.equal((await login(soloEmail)).body.ok, true, 'password-only again');
  });

  it('a gated session never blocks the Exchange portal', async () => {
    // member's organisation requires it and the platform reset just removed theirs: sign in fresh (gated)
    const m = new Agent(app);
    assert.equal((await m.post('/api/auth/login', { email: memberEmail, password: PASSWORD })).body.ok, true);
    assert.equal((await m.state()).mfaSetupRequired, true);
    const x = await m.get('/api/x/state');
    assert.notEqual(x.body?.error, 'mfa_setup_required');
  });
});
