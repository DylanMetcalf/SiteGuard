/** Found by the bot swarm (scripts/bots.mts): visitor-caused database errors must be 4xx, never 500. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, setup, signup, teardown } from './helpers.js';

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
});
