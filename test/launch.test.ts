/** Launch readiness: promo codes at sign-up (lifetime access), trial notices, sign-in audit, product statistics. */
import './billing-env.js';
import './support/platform-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, PASSWORD, pool, setup, signup, teardown, uniqueEmail } from './helpers.js';
import { runTrialNotices } from '../src/jobs/trials.js';

let app: FastifyInstance;
let ops: Agent;

before(async () => {
  app = await setup();
  ops = (await signup(app, { orgName: 'COMVERA Ops', orgKind: 'host', email: 'ops@comvera.test' })).agent;
  assert.equal((await ops.post('/api/admin/promos', { code: 'COMVERA-LIFETIME', description: 'Family', plan: 'contractor_pro', maxRedemptions: 3 })).status, 200);
});
after(teardown);

const rawSignup = (body: Record<string, unknown>) => app.inject({ method: 'POST', url: '/api/auth/signup', payload: { name: 'Mom', password: PASSWORD, orgKind: 'contractor', ...body } });

describe('lifetime access with a promo code at sign-up', () => {
  it('gives the new company the plan with no end date, and it survives the trial ending', async () => {
    const email = uniqueEmail('mom');
    const r = await rawSignup({ email, orgName: 'Mom Consulting', promoCode: 'comvera-lifetime' });
    assert.equal(r.statusCode, 200, r.body);
    const org = (await pool.query(`select o.id, o.grant_plan, o.grant_until from organisations o where o.name = 'Mom Consulting'`)).rows[0];
    assert.equal(org.grant_plan, 'contractor_pro');
    assert.equal(org.grant_until, null);
    await pool.query(`update organisations set trial_ends_at = now() - interval '30 days' where id = $1`, [org.id]);
    const a = new Agent(app);
    await a.post('/api/auth/login', { email, password: PASSWORD });
    const s = await a.state();
    assert.equal(s.org.ownAccess, true);
    assert.equal(s.org.standing, 'ok');
    assert.equal(s.org.grant.until, null);
    const audit = await pool.query(`select detail from audit_events where org_id = $1 and action = 'Redeemed promo code'`, [org.id]);
    assert.match(audit.rows[0].detail, /no end date/);
  });

  it('refuses a wrong code without creating an account, and the platform owner can switch the code off', async () => {
    const email = uniqueEmail('friend');
    const bad = await rawSignup({ email, orgName: 'Friend Electrical', promoCode: 'NOT-A-CODE' });
    assert.equal(bad.statusCode, 404);
    assert.equal((await pool.query('select 1 from users where email = $1', [email])).rows.length, 0);
    const id = (await pool.query(`select id from promo_codes where code = 'COMVERA-LIFETIME'`)).rows[0].id;
    assert.equal((await ops.post(`/api/admin/promos/${id}/active`, { active: false })).status, 200);
    assert.equal((await rawSignup({ email, orgName: 'Friend Electrical', promoCode: 'COMVERA-LIFETIME' })).statusCode, 404);
  });
});

describe('trial notices', () => {
  it('emails and notifies admins once before the trial ends and once after', async () => {
    const { email } = await signup(app, { orgName: 'Trial Welding', orgKind: 'contractor' });
    const orgId = (await pool.query(`select id from organisations where name = 'Trial Welding'`)).rows[0].id;
    await pool.query(`update organisations set trial_ends_at = now() + interval '2 days' where id = $1`, [orgId]);
    assert.ok((await runTrialNotices()) >= 1);
    assert.equal(await runTrialNotices(), 0, 'sent once');
    await pool.query(`update organisations set trial_ends_at = now() - interval '1 hour' where id = $1`, [orgId]);
    assert.ok((await runTrialNotices()) >= 1);
    const mails = (await pool.query(`select subject from email_outbox where to_email = $1 order by id`, [email])).rows.map((r: { subject: string }) => r.subject);
    assert.ok(mails.includes('Your COMVERA trial ends in 3 days'));
    assert.ok(mails.includes('Your COMVERA trial has ended'));
    const notes = await pool.query(`select title from notifications where org_id = $1 and title like 'Your trial%'`, [orgId]);
    assert.equal(notes.rows.length, 2);
  });
});

describe('audit trail and statistics', () => {
  it('records sign-in and sign-out, and counts milestones without personal details', async () => {
    const email = uniqueEmail('audit');
    await rawSignup({ email, orgName: 'Audit Scaffolds' });
    const orgId = (await pool.query(`select id from organisations where name = 'Audit Scaffolds'`)).rows[0].id;
    const a = new Agent(app);
    await a.post('/api/auth/login', { email, password: PASSWORD });
    await a.post('/api/auth/logout');
    const acts = (await pool.query(`select action, detail from audit_events where org_id = $1 and action in ('Signed in', 'Signed out')`, [orgId])).rows;
    assert.deepEqual(acts.map((x: { action: string }) => x.action).sort(), ['Signed in', 'Signed out']);
    const ov = await ops.get('/api/admin/overview');
    const signups = ov.body.productEvents.find((e: { event: string }) => e.event === 'signup');
    assert.ok(signups.total >= 3);
    assert.doesNotMatch(JSON.stringify(ov.body.productEvents), /@/);
  });
});
