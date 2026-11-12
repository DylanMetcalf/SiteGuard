/** Safety consultants: plans, client companies, the client limit and the rules that stop it being dodged. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, pool, setup, signup, teardown } from './helpers.js';
import { PLANS, plansFor, planAllowedFor } from '../src/lib/plans.js';
import { applyConsultantCover, registrationKey } from '../src/lib/consultants.js';

let app: FastifyInstance;
let cons: Agent, other: Agent, plainCon: Agent, host: Agent;
let consId: string, otherId: string, plainId: string;
const reg = (n: number) => `2015/${String(100000 + n)}/07`;
const orgIdOf = async (a: Agent) => (await a.state()).org.id as string;
const add = (a: Agent, name: string, n: number) => a.post('/api/consultant/clients', { name, registrationNumber: reg(n) });
const row = async (id: string) => (await pool.query('select * from organisations where id = $1', [id])).rows[0];

before(async () => {
  app = await setup();
  cons = (await signup(app, { orgName: 'Safety Partners', orgKind: 'contractor', consultant: true })).agent;
  other = (await signup(app, { orgName: 'Other Advisors', orgKind: 'contractor', consultant: true })).agent;
  plainCon = (await signup(app, { orgName: 'Plain Contractor', orgKind: 'contractor' })).agent;
  host = (await signup(app, { orgName: 'Some Mine', orgKind: 'host' })).agent;
  consId = await orgIdOf(cons); otherId = await orgIdOf(other); plainId = await orgIdOf(plainCon);
});
after(teardown);

describe('consultant signup and plans', () => {
  it('a consultant starts on the Practice plan, limited to 5 clients during the free trial; ordinary organisations are unaffected', async () => {
    const o = (await cons.state()).org;
    assert.equal(o.isConsultant, true); assert.equal(o.plan, 'consultant_practice'); assert.equal(o.clientLimit, 5, 'the trial allows 5 so it cannot be used to reserve many companies');
    const p = (await plainCon.state()).org;
    assert.equal(p.isConsultant, false); assert.equal(p.plan, 'contractor_pro'); assert.equal(p.clientLimit, null);
  });

  it('plans are offered and bought only by the right kind of organisation', () => {
    assert.deepEqual(plansFor('contractor', true).map((p) => p.id), ['consultant_solo', 'consultant_practice', 'consultant_firm']);
    assert.ok(!plansFor('contractor', false).some((p) => p.consultant));
    assert.ok(!plansFor('host').some((p) => p.consultant));
    assert.equal(planAllowedFor(PLANS.consultant_solo, { kind: 'contractor', is_consultant: false }), false, 'a normal contractor cannot take a consultant plan');
    assert.equal(planAllowedFor(PLANS.contractor_pro, { kind: 'contractor', is_consultant: true }), false, 'a consultant cannot take a contractor plan');
    assert.equal(planAllowedFor(PLANS.consultant_solo, { kind: 'contractor', is_consultant: true }), true);
    assert.equal(planAllowedFor(PLANS.consultant_solo, { kind: 'host', is_consultant: false }), false);
    assert.deepEqual([5, 15, 40], ['consultant_solo', 'consultant_practice', 'consultant_firm'].map((id) => PLANS[id].clientLimit));
  });

  it('the billing page lists only consultant plans for a consultant', async () => {
    const b = await cons.get('/api/billing');
    assert.equal(b.status, 200);
    assert.deepEqual(b.body.plans.map((p: { id: string }) => p.id), ['consultant_solo', 'consultant_practice', 'consultant_firm']);
  });
});

describe('client companies', () => {
  it('registration numbers are read the same however they are typed', () => {
    assert.equal(registrationKey('2015/123456/07'), '201512345607');
    assert.equal(registrationKey(' 2015 123456 07 '), '201512345607');
    assert.equal(registrationKey('abc'), null);
    assert.equal(registrationKey('2015/12345/07'), null);
  });

  it('adds a client company with its own organisation, and the consultant owns it', async () => {
    assert.equal((await cons.post('/api/consultant/clients', { name: 'Bad Reg', registrationNumber: 'nope' })).status, 400);
    const r = await add(cons, 'Alpha Scaffolding', 1);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const c = await row(r.body.id);
    assert.equal(c.kind, 'contractor'); assert.equal(c.billing_parent_id, consId); assert.equal(c.registration_key, '201510000107'); assert.ok(c.onboarding_completed_at);
    assert.equal((await pool.query(`select role from memberships where org_id = $1`, [c.id])).rows[0].role, 'owner');
    const list = (await cons.get('/api/consultant/clients')).body;
    assert.equal(list.used, 1); assert.equal(list.limit, 5); assert.equal(list.trial, true); assert.equal(list.clients[0].name, 'Alpha Scaffolding');
    assert.equal(list.clients[0].registrationNumber, '2015/100001/07', 'shows the locked, formatted number');
    assert.equal((await pool.query(`select count(*)::int as n from product_events where org_id = $1 and event = 'client_company_added'`, [consId])).rows[0].n, 1);
  });

  it('refuses a company that is already a client, however its number is typed, or already on COMVERA, or the consultant itself', async () => {
    assert.equal((await add(cons, 'Alpha again', 1)).status, 409);
    assert.equal((await cons.post('/api/consultant/clients', { name: 'Alpha spaced', registrationNumber: '2015 100001 07' })).status, 409);
    assert.equal((await add(other, 'Alpha stolen by another consultant', 1)).status, 409, 'one company cannot be moved between consultants');
    await pool.query(`update organisations set reg_number = '2012/222222/07' where id = $1`, [plainId]);
    assert.equal((await cons.post('/api/consultant/clients', { name: 'Plain clone', registrationNumber: '2012/222222/07' })).status, 409, 'an independent company on COMVERA cannot be added as a client');
    await pool.query(`update organisations set reg_number = '2010/000001/07' where id = $1`, [consId]);
    assert.equal((await cons.post('/api/consultant/clients', { name: 'Self', registrationNumber: '2010/000001/07' })).status, 409, 'not the consultant’s own company');
  });

  it('only the name can be corrected; the registration number is locked', async () => {
    const id = (await cons.get('/api/consultant/clients')).body.clients[0].id;
    assert.equal((await cons.patch(`/api/consultant/clients/${id}`, { name: 'Alpha Scaffolding (Pty) Ltd' })).status, 200);
    assert.equal((await cons.patch(`/api/consultant/clients/${id}`, { name: 'x1', registrationNumber: '2015/999999/07' })).status, 400, 'registration number cannot be sent');
    assert.equal((await row(id)).registration_key, '201510000107');
    assert.equal((await row(id)).name, 'Alpha Scaffolding (Pty) Ltd');
  });

  it('opens a client: the consultant switches into it and sees who manages it', async () => {
    const id = (await cons.get('/api/consultant/clients')).body.clients[0].id;
    const a = await cons.post(`/api/consultant/clients/${id}/access`, {});
    assert.equal(a.status, 200);
    assert.equal((await cons.post('/api/auth/switch-org', { orgId: id })).status, 200);
    const o = (await cons.state()).org;
    assert.equal(o.id, id); assert.equal(o.managedBy.id, consId); assert.equal(o.managedBy.name, 'Safety Partners');
    assert.equal((await cons.get('/api/consultant/clients')).status, 404, 'a client company is not itself a consultant');
    assert.equal((await cons.post('/api/auth/switch-org', { orgId: consId })).status, 200, 'and the way back works');
  });
});

describe('the client limit', () => {
  it('stops adding at the plan limit, and an archived unused client frees its slot', async () => {
    await pool.query(`update organisations set plan = 'consultant_solo', subscription_status = 'active' where id = $1`, [consId]);
    assert.equal((await cons.state()).org.clientLimit, 5);
    for (let i = 2; i <= 5; i++) assert.equal((await add(cons, `Client ${i}`, i)).status, 200);
    const over = await add(cons, 'Client 6', 6);
    assert.equal(over.status, 402, JSON.stringify(over.body)); assert.equal(over.body.error, 'client_limit');
    const unused = (await cons.get('/api/consultant/clients')).body.clients.find((c: { name: string }) => c.name === 'Client 5');
    assert.equal(unused.canArchive, true, 'a client made in the last day and never used is a mistake that can be undone');
    assert.equal((await cons.post(`/api/consultant/clients/${unused.id}/archive`, {})).status, 200);
    assert.equal((await cons.get('/api/consultant/clients')).body.used, 4);
    assert.equal((await add(cons, 'Client 6', 6)).status, 200, 'the freed slot can be used');
    assert.equal((await add(cons, 'Client 5 again', 5)).status, 402, 'the plan is full again');
    assert.equal((await add(other, 'Client 5 elsewhere', 5)).status, 200, 'a never-used client gave its registration number back, so the real consultant is not blocked');
  });

  it('a client that has been used cannot be archived until it has been quiet for 90 days', async () => {
    const id = (await cons.get('/api/consultant/clients')).body.clients.find((c: { name: string }) => c.name === 'Client 2').id;
    await pool.query(`insert into files (org_id, storage_key, filename, content_type, size_bytes, sha256) values ($1, 'consultant-test-1', 'a.pdf', 'application/pdf', 1, 'x')`, [id]);
    const blocked = await cons.post(`/api/consultant/clients/${id}/archive`, {});
    assert.equal(blocked.status, 409); assert.match(blocked.body.message, /90 days/);
    await pool.query(`update files set created_at = now() - interval '100 days' where org_id = $1`, [id]);
    await pool.query(`update organisations set created_at = now() - interval '120 days' where id = $1`, [id]);
    assert.equal((await cons.post(`/api/consultant/clients/${id}/archive`, {})).status, 200, 'after 90 quiet days it can go');
    assert.equal((await cons.post(`/api/consultant/clients/${id}/archive`, {})).status, 409, 'and only once');
    assert.equal((await add(other, 'Client 2 elsewhere', 2)).status, 409, 'a company that was used stays reserved, so slots cannot be cycled');
  });

  it('cover is given to the oldest clients up to the limit, computed live, and never written', async () => {
    const ids = (await pool.query(`select id from organisations where billing_parent_id = $1 and client_archived_at is null order by created_at, id`, [consId])).rows.map((r: { id: string }) => r.id);
    assert.equal(ids.length, 4);
    await pool.query(`update organisations set plan = 'consultant_solo' where id = $1`, [consId]);
    // two more live clients inserted directly (the API would refuse them) so there are 6 against a limit of 5
    for (let i = 0; i < 2; i++) await pool.query(`insert into organisations (name, kind, plan, subscription_status, billing_parent_id, registration_key, created_at) values ($1, 'contractor', 'contractor_free', 'free', $2, $3, now() + ($4 * interval '1 minute'))`, [`Extra ${i}`, consId, `2099000000${i}0`, i + 1]);
    const all = (await pool.query(`select id from organisations where billing_parent_id = $1 and client_archived_at is null order by created_at, id`, [consId])).rows.map((r: { id: string }) => r.id);
    assert.equal(all.length, 6);
    const covered: boolean[] = [];
    for (const id of all) { const o = await row(id); await applyConsultantCover(pool, o); covered.push(o.grant_plan === 'contractor_pro'); }
    assert.deepEqual(covered, [true, true, true, true, true, false], 'the sixth is past the limit');
    assert.equal((await row(all[0])).grant_plan, null, 'nothing is stored on the organisation');
  });

  it('cover stops when the consultant’s plan lapses, and nothing is deleted', async () => {
    const { features } = await import('../src/config.js');
    const was = features.billing;
    (features as { billing: boolean }).billing = true;
    try {
      const id = (await pool.query(`select id from organisations where billing_parent_id = $1 and client_archived_at is null order by created_at, id limit 1`, [consId])).rows[0].id;
      await pool.query(`update organisations set subscription_status = 'canceled' where id = $1`, [consId]);
      const o = await row(id); await applyConsultantCover(pool, o);
      assert.equal(o.grant_plan, null, 'a lapsed consultant covers nobody');
      await pool.query(`update organisations set subscription_status = 'active' where id = $1`, [consId]);
      const o2 = await row(id); await applyConsultantCover(pool, o2);
      assert.equal(o2.grant_plan, 'contractor_pro', 'and cover returns when it pays again');
    } finally { (features as { billing: boolean }).billing = was; }
  });
});

describe('tenant isolation', () => {
  it('another consultant, a contractor or a mine cannot see or change a consultant’s clients', async () => {
    const mine = (await cons.get('/api/consultant/clients')).body.clients.find((c: { archived: boolean }) => !c.archived);
    assert.ok(!(await other.get('/api/consultant/clients')).body.clients.some((c: { id: string }) => c.id === mine.id), 'another consultant’s list never includes these clients');
    for (const a of [other]) {
      assert.equal((await a.patch(`/api/consultant/clients/${mine.id}`, { name: 'Hijacked' })).status, 404);
      assert.equal((await a.post(`/api/consultant/clients/${mine.id}/archive`, {})).status, 404);
      assert.equal((await a.post(`/api/consultant/clients/${mine.id}/access`, {})).status, 404);
    }
    for (const a of [plainCon, host]) {
      assert.equal((await a.get('/api/consultant/clients')).status, 404);
      assert.equal((await a.post('/api/consultant/clients', { name: 'Nope', registrationNumber: reg(77) })).status, 404);
    }
    assert.equal((await row(mine.id)).name, mine.name, 'nothing changed');
    assert.equal((await pool.query(`select 1 from memberships where org_id = $1 and user_id = (select user_id from memberships where org_id = $2 limit 1)`, [mine.id, otherId])).rowCount, 0, 'the other consultant was not given membership');
  });
});

describe('trial limit, staff access and seats', () => {
  it('a consultant on the free trial can add 5 clients, not 15', async () => {
    const t = (await signup(app, { orgName: 'Trial Advisors', orgKind: 'contractor', consultant: true })).agent;
    for (let i = 0; i < 5; i++) assert.equal((await add(t, `Trial client ${i}`, 200 + i)).status, 200);
    const sixth = await add(t, 'Trial client 6', 206);
    assert.equal(sixth.status, 402); assert.match(sixth.body.message, /covers 5 client companies/);
  });

  it('staff who leave or lose admin rights lose access to the clients they opened, and do not use client seats', async () => {
    const { sha256 } = await import('../src/lib/security.js');
    const { seatsUsed } = await import('../src/routes/org.js');
    const clientId = (await cons.get('/api/consultant/clients')).body.clients.find((c: { archived: boolean }) => !c.archived).id;
    const invite = async (email: string, token: string) => pool.query(`insert into user_invites (org_id, email, role, token_hash, invited_by, expires_at) values ($1, $2, 'admin', $3, (select user_id from memberships where org_id = $1 limit 1), now() + interval '1 day')`, [consId, email, sha256(token)]);
    const staff = async (email: string, token: string) => { await invite(email, token); return (await signup(app, { orgName: 'x', orgKind: 'contractor', email, inviteToken: token })).agent; };
    const userId = async (email: string) => (await pool.query('select id from users where email = $1', [email])).rows[0].id as string;
    const has = async (email: string) => (await pool.query('select via_consultant from memberships where org_id = $1 and user_id = $2', [clientId, await userId(email)])).rows[0];

    const bob = await staff('bob.staff@example.com', 'tok-bob');
    assert.equal((await bob.post(`/api/consultant/clients/${clientId}/access`, {})).status, 200);
    assert.equal((await has('bob.staff@example.com'))?.via_consultant, true, 'access is recorded as coming from the consultant');
    const viaAudit = (await pool.query(`select count(*)::int as n from audit_events where org_id = $1 and action = 'Opened client company'`, [consId])).rows[0].n;
    assert.ok(viaAudit >= 1, 'opening a client is on the audit trail');
    assert.equal(await seatsUsed(pool, clientId), 0, 'consultant staff do not take the client\'s seats');

    assert.equal((await cons.del(`/api/org/members/${await userId('bob.staff@example.com')}`)).status, 200);
    assert.equal(await has('bob.staff@example.com'), undefined, 'removed from the consultant, removed from its clients');

    const amy = await staff('amy.staff@example.com', 'tok-amy');
    await amy.post(`/api/consultant/clients/${clientId}/access`, {});
    assert.ok(await has('amy.staff@example.com'));
    assert.equal((await cons.patch(`/api/org/members/${await userId('amy.staff@example.com')}`, { role: 'member' })).status, 200);
    assert.equal(await has('amy.staff@example.com'), undefined, 'demoted below admin: no longer opens clients');
  });
});
