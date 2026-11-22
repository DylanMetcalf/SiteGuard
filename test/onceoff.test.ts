/** The once-off safety file is offered to contractors where they are blocked, with its real price only when Paystack can take it. */
import './paystack-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, pool, setup, signup, teardown } from './helpers.js';

let app: FastifyInstance;
let con: Agent, mine: Agent, consultant: Agent;
before(async () => {
  app = await setup();
  con = (await signup(app, { orgName: 'Once Scaffolding', orgKind: 'contractor' })).agent;
  mine = (await signup(app, { orgName: 'Once Mining', orgKind: 'host' })).agent;
  consultant = (await signup(app, { orgName: 'Once Advisory', orgKind: 'contractor', consultant: true })).agent;
});
after(teardown);

describe('once-off offer', () => {
  it('a contractor is offered one safety file, payable now, at the price the pricing settings hold', async () => {
    const f = (await con.state()).features.onceOff;
    assert.equal(f.payable, true);
    const price = (await pool.query(`select coalesce((select price_cents from plan_settings where plan_id = 'contractor_once'), 129900) as p`)).rows[0].p;
    assert.equal(f.priceCents, Number(price));
    assert.ok(f.days >= 7);
  });
  it('mines and consultants are never offered it', async () => {
    assert.equal((await mine.state()).features.onceOff, null);
    assert.equal((await consultant.state()).features.onceOff, null);
  });
  it('the offer leads to a real once-off checkout, not a subscription', async () => {
    await pool.query(`update organisations set trial_ends_at = now() - interval '1 day' where id = $1`, [(await con.state()).org.id]);
    const r = await con.post('/api/billing/paystack/checkout', { plan: 'contractor_once' });
    // Paystack is not reachable from tests (the real call is covered with a stand-in in paystack.test.ts): the person is told
    // plainly that nothing was charged, and the started payment is closed so nothing waits for it.
    assert.equal(r.status, 502, JSON.stringify(r.body));
    assert.match(r.body.message, /Nothing was charged/);
    const p = (await pool.query(`select kind, plan_id, status from payments where org_id = $1 order by created_at desc limit 1`, [(await con.state()).org.id])).rows[0];
    assert.deepEqual([p?.kind, p?.plan_id, p?.status], ['once_off', 'contractor_once', 'failed']);
  });
});
