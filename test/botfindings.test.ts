/** Found by the bot swarm (scripts/bots.mts): visitor-caused database errors must be 4xx, never 500. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, setup, signup, teardown } from './helpers.js';
import { rlSignup } from '../src/routes/auth.js';

let app: FastifyInstance;
let mine: Agent;

before(async () => {
  app = await setup();
  mine = (await signup(app, { orgName: 'Bot Findings Mining', orgKind: 'host' })).agent;
});
after(teardown);

describe('bot findings', () => {
  it('six sign-ups for one address at once: one account, the rest told it exists, no 500', async () => {
    const email = 'race@example.com';
    const res = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      new Agent(app).post('/api/auth/signup', { name: 'Racer', email, password: 'correct horse battery staple', orgName: `Racer Co ${i}`, orgKind: 'host' })));
    assert.equal(res.filter((r) => r.status === 200).length, 1, JSON.stringify(res.map((r) => r.status)));
    assert.ok(res.every((r) => r.status === 200 || r.status === 409), JSON.stringify(res.map((r) => r.status)));
    assert.match(String(res.find((r) => r.status === 409)?.body.message), /already exists/);
  });

  it('a NUL character in text is a 400, not a 500', async () => {
    const f = await mine.post('/api/doc-folders', { name: 'bad\u0000name' });
    assert.equal(f.status, 400, JSON.stringify(f.body));
    const w = await mine.post('/api/workplaces', { name: 'pit\u0000', packIds: [] });
    assert.equal(w.status, 400, JSON.stringify(w.body));
  });

  it('plain company sign-up keeps the tight per-address limit; invited sign-up gets the roomier one (shared mine router)', () => {
    const max = rlSignup.config.rateLimit.max;
    const plain = max({ body: { email: 'a@example.com' } });
    assert.ok(max({ body: { inviteToken: 'x' } }) >= 6 * plain, 'invited sign-ups need room for a whole shift');
    assert.equal(max({ body: { siteInviteToken: 'x' } }), plain, 'a site invitation creates a company, so it keeps the tight limit');
    assert.ok(max({}) === plain, 'a missing body must not crash or loosen the limit');
  });

  it('a fake invitation token cannot be used to find out whether an email is registered', async () => {
    const known = (await signup(app, { orgName: 'Oracle Mining', orgKind: 'host' })).email;
    const a = await new Agent(app).post('/api/auth/signup', { name: 'X', email: known, password: 'correct horse battery staple', inviteToken: 'not-a-real-token' });
    const b = await new Agent(app).post('/api/auth/signup', { name: 'X', email: 'nobody-here@example.com', password: 'correct horse battery staple', inviteToken: 'not-a-real-token' });
    const c = await new Agent(app).post('/api/auth/signup', { name: 'X', email: known, password: 'correct horse battery staple', orgName: 'Y', orgKind: 'host', siteInviteToken: 'not-a-real-token' });
    assert.equal(a.status, 400); assert.equal(b.status, 400); assert.equal(c.status, 400);
    assert.deepEqual(a.body, b.body, 'registered and unregistered addresses must look identical');
  });
});
