/** Each organisation's own reminder schedule. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, setup, signup, teardown } from './helpers.js';

let app: FastifyInstance;
let con: Agent;

before(async () => {
  app = await setup();
  con = (await signup(app, { orgName: 'Xi Plumbing', orgKind: 'contractor' })).agent;
});
after(teardown);

describe('reminder schedule', () => {
  it('buckets by the nearest reminder day not yet passed', async () => {
    const { bucket, reminderDaysOf, DEFAULT_REMINDER_DAYS } = await import('../src/jobs/reminders.js');
    const s = [60, 30, 14, 7, 1];
    assert.equal(bucket(45, s), '60d');
    assert.equal(bucket(12, s), '14d');
    assert.equal(bucket(1, s), '1d');
    assert.equal(bucket(0, s), '1d');
    assert.equal(bucket(-3, s), 'expired');
    assert.equal(bucket(90, s), null, 'further out than the first reminder: nothing yet');
    assert.equal(bucket(20), '30d', 'default schedule is 30 and 7 days');
    assert.deepEqual(reminderDaysOf({}), DEFAULT_REMINDER_DAYS);
    assert.deepEqual(reminderDaysOf({ reminderDays: [7, 60, 7, 999, 'x'] }), [60, 7]);
  });

  it('lets an admin set it, and shows it back', async () => {
    assert.deepEqual((await con.state()).state.settings.reminderDays, [30, 7]);
    assert.equal((await con.patch('/api/org/settings', { reminderDays: [1, 60, 14] })).status, 200);
    assert.deepEqual((await con.state()).state.settings.reminderDays, [60, 14, 1]);
    assert.equal((await con.patch('/api/org/settings', { reminderDays: [] })).status, 400);
    assert.equal((await con.patch('/api/org/settings', { reminderDays: [400] })).status, 400);
  });
});
