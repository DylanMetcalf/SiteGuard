/** Session lifetime, sign-in hygiene, token reuse, revocation, headers and security logging. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, PASSWORD, lastEmailToken, pool, setup, signup, teardown } from './helpers.js';
import { emailRef, securityEvent } from '../src/lib/securityLog.js';

let app: FastifyInstance;
let email: string;
const sessionsOf = async (e: string) => Number((await pool.query(`select count(*)::int as n from sessions s join users u on u.id = s.user_id where u.email = $1`, [e])).rows[0].n);

before(async () => {
  app = await setup();
  email = (await signup(app, { orgName: 'Sec Test Mining', orgKind: 'host' })).email;
});
after(teardown);

describe('sessions', () => {
  it('signing in again from the same browser ends the earlier session (no session fixation)', async () => {
    const a = new Agent(app);
    assert.equal((await a.post('/api/auth/login', { email, password: PASSWORD })).status, 200);
    const n1 = await sessionsOf(email);
    assert.equal((await a.post('/api/auth/login', { email, password: PASSWORD })).status, 200);
    assert.equal(await sessionsOf(email), n1, 'the old session was replaced, not added to');
  });

  it('a session ends after the absolute lifetime however active it is', async () => {
    const a = new Agent(app);
    await a.post('/api/auth/login', { email, password: PASSWORD });
    assert.equal((await a.state()).authenticated, true);
    await pool.query(`update sessions set created_at = now() - interval '31 days' where user_id = (select id from users where email = $1)`, [email]);
    assert.notEqual((await a.state()).authenticated, true);
  });

  it('changing the password signs out every other session; sign-out-everywhere does too', async () => {
    const a = new Agent(app), b = new Agent(app), c = new Agent(app);
    for (const x of [a, b, c]) await x.post('/api/auth/login', { email, password: PASSWORD });
    assert.equal((await a.post('/api/me/password', { current: PASSWORD, next: 'another long passphrase 42' })).status, 200);
    assert.notEqual((await b.state()).authenticated, true);
    assert.equal((await a.state()).authenticated, true);
    await c.post('/api/auth/login', { email, password: 'another long passphrase 42' });
    assert.equal((await a.post('/api/me/sign-out-everywhere')).status, 200);
    assert.notEqual((await c.state()).authenticated, true);
    await a.post('/api/me/password', { current: 'another long passphrase 42', next: PASSWORD });
  });
});

describe('tokens', () => {
  it('a password reset link works once, then never again, and signs out every session', async () => {
    const other = new Agent(app);
    await other.post('/api/auth/login', { email, password: PASSWORD });
    assert.equal((await new Agent(app).post('/api/auth/forgot', { email })).status, 200);
    const token = await lastEmailToken(email, '/reset-password');
    const r1 = await new Agent(app).post('/api/auth/reset', { token, password: 'a brand new passphrase 7' });
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.notEqual((await other.state()).authenticated, true, 'existing sessions ended');
    assert.equal((await new Agent(app).post('/api/auth/reset', { token, password: 'yet another passphrase 8' })).status, 400);
    const back = await new Agent(app).post('/api/auth/reset', { token: 'x'.repeat(40), password: 'yet another passphrase 8' });
    assert.equal(back.status, 400);
  });

  it('asking for a reset says the same thing whether or not the account exists', async () => {
    const yes = await new Agent(app).post('/api/auth/forgot', { email });
    const no = await new Agent(app).post('/api/auth/forgot', { email: 'nobody-here@example.com' });
    assert.deepEqual(yes.body, no.body);
  });
});

describe('responses', () => {
  it('sends the security headers, including a restrictive Permissions-Policy', async () => {
    const r = await app.inject({ method: 'GET', url: '/' });
    assert.match(String(r.headers['content-security-policy']), /script-src 'self'/);
    assert.match(String(r.headers['permissions-policy']), /camera=\(\)/);
    assert.equal(r.headers['x-content-type-options'], 'nosniff');
    assert.equal(r.headers['x-frame-options'], 'SAMEORIGIN');
  });

  it('a malformed request gets a short error, never internals', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: '{not json' });
    assert.equal(r.statusCode, 400);
    assert.doesNotMatch(r.body, /\bat\s+\S+\s+\(|node_modules|stack/i);
  });
});

describe('security log', () => {
  it('writes structured events without email addresses or secrets', () => {
    const lines: unknown[] = [];
    const req = { ip: '203.0.113.9', ctx: null, log: { warn: (o: unknown) => lines.push(o) } } as never;
    securityEvent(req, 'login_failed', { emailRef: emailRef('Someone@Example.com') });
    const line = JSON.stringify(lines[0]);
    assert.match(line, /"security":"login_failed"/);
    assert.doesNotMatch(line, /example\.com/i);
    assert.equal(emailRef('Someone@Example.com'), emailRef(' someone@example.com '));
  });
});
