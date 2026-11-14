/** GET /api/billing: the usage, workers, sponsored sites, plan features and VAT note the Plans & billing page shows. */
import './billing-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, setup, signup, teardown } from './helpers.js';

let app: FastifyInstance;
let mine: Agent, con: Agent, other: Agent, member: Agent;

before(async () => {
  app = await setup();
  mine = (await signup(app, { orgName: 'Billing UI Mining', orgKind: 'host' })).agent;
  con = (await signup(app, { orgName: 'Billing UI Scaffolding', orgKind: 'contractor' })).agent;
  other = (await signup(app, { orgName: 'Billing UI Other Contractor', orgKind: 'contractor' })).agent;
  const w = await mine.post('/api/workplaces', { name: 'North Pit', requirements: [{ category: 'Company Documents', name: 'Letter of Good Standing (COID)', source: 'legal' }] });
  await con.post('/api/sites/join', { code: w.body.code });
  await con.post('/api/projects', { clientName: 'Private Client', name: 'Warehouse', requirements: [{ category: 'Client', name: 'Induction', source: 'client' }] });
  await con.post('/api/workers', { fullName: 'Sipho Nkosi', occupation: 'Rigger', idLast4: '1234' });
  await con.post('/api/workers', { fullName: 'Tumi Dube', occupation: 'Welder', idLast4: '5678' });
  await other.post('/api/workers', { fullName: 'Other Worker', occupation: 'Fitter', idLast4: '9999' });
  member = (await signup(app, { orgName: 'Billing UI Member Org', orgKind: 'contractor' })).agent;
});
after(teardown);

describe('GET /api/billing usage for the billing page', () => {
  it('separates team logins (seats) from worker records', async () => {
    const b = (await con.get('/api/billing')).body;
    assert.equal(b.seatsUsed, 1);
    assert.equal(b.workers, 2);
    assert.equal((await other.get('/api/billing')).body.workers, 1);
    assert.equal((await mine.get('/api/billing')).body.workers, 0);
  });

  it('counts a sponsored file as free and not as a connected site', async () => {
    const b = (await con.get('/api/billing')).body;
    assert.equal(b.sponsoredSites, 1);
    assert.equal(b.connectedSites, 1, 'only the own project is paid for');
    assert.equal((await other.get('/api/billing')).body.sponsoredSites, 0);
    const h = (await mine.get('/api/billing')).body;
    assert.equal(h.sponsoredSites, null);
    assert.equal(typeof h.activeSites, 'number');
    assert.equal(h.connectedSites, null);
  });

  it('never includes another organisation\'s numbers', async () => {
    const o = (await other.get('/api/billing')).body;
    assert.equal(o.connectedSites, 0);
    assert.equal(o.sponsoredSites, 0);
    assert.equal(o.workers, 1);
    assert.equal((await member.get('/api/billing')).body.workers, 0);
  });

  it('lists what each plan includes, and says nothing invented about VAT', async () => {
    const b = (await con.get('/api/billing')).body;
    const pro = b.plans.find((p: { id: string }) => p.id === 'contractor_pro');
    assert.ok(pro.features.includes('Document Studio'));
    assert.ok(pro.features.includes('External share links'));
    const starter = b.plans.find((p: { id: string }) => p.id === 'contractor_starter');
    assert.ok(!starter.features.includes('External share links'));
    assert.match(b.vatNote, /Confirm VAT on your invoice/);
    assert.doesNotMatch(b.vatNote, /incl|excl|15%/i);
    assert.equal(b.pendingPayment, false);
    assert.equal(b.isConsultant, false);
  });

  it('needs a signed-in organisation', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/billing' })).statusCode, 401);
  });
});
