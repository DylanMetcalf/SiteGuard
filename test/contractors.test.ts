/** Contractor details: the mine can correct an invitation, but a joined contractor owns its own details. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { PDF, lastEmailToken, setup, signup, teardown, uniqueEmail, type Agent } from './helpers.js';

let app: FastifyInstance;
let host: Agent;
let contractor: Agent;

before(async () => {
  app = await setup();
  host = (await signup(app, { orgName: 'Upsilon Mining', orgKind: 'host' })).agent;
  contractor = (await signup(app, { orgName: 'Omicron Scaffolding', orgKind: 'contractor' })).agent;
});
after(teardown);

describe('contractor directory', () => {
  it('shows the contractor\'s own details once joined, and refuses edits by the mine', async () => {
    const email = uniqueEmail('omicron');
    const siteId = (await host.post('/api/sites', { name: 'Stockpile 2', location: 'Postmasburg', newContractor: { name: 'Omicron Scaffolding', email }, templatePackIds: ['baseline'] })).body.id;
    const id = (await host.state()).state.sites[siteId].contractorId;
    assert.equal((await host.patch(`/api/contractors/${id}`, { trade: 'Scaffolding' })).status, 200, 'before joining, the invitation can be corrected');
    assert.equal((await contractor.post(`/api/auth/site-invite/${await lastEmailToken(email, '/site-invite')}/accept`)).status, 200);
    assert.equal((await contractor.patch('/api/org', { trade: 'Scaffolding & access', reg_number: '2019/555111/07' })).status, 200);
    const c = (await host.state()).state.contractors[id];
    assert.equal(c.linked, true);
    assert.equal(c.trade, 'Scaffolding & access');
    assert.equal(c.reg, '2019/555111/07');
    const r = await host.patch(`/api/contractors/${id}`, { trade: 'Plumbing' });
    assert.equal(r.status, 409);
    assert.match(r.body.message, /keeps its own company details/);
  });

  it('lets a contractor submit its company copy (e.g. the COID letter) to a site in one step', async () => {
    const email = uniqueEmail('omicron2');
    const siteId = (await host.post('/api/sites', { name: 'Crusher 5', location: 'Postmasburg', newContractor: { name: 'Omicron Scaffolding', email }, templatePackIds: ['baseline'] })).body.id;
    assert.equal((await contractor.post(`/api/auth/site-invite/${await lastEmailToken(email, '/site-invite')}/accept`)).status, 200);
    const st = await contractor.state();
    const coid = st.state.requirements[siteId].find((r: { library: string | null }) => r.library === 'good-standing');
    assert.ok(coid, 'the COID requirement is matched to the company document');
    const none = await contractor.post(`/api/documents/${coid.id}/use-library`);
    assert.equal(none.status, 400);
    assert.match(none.body.message, /isn't in your company documents yet/);
    const lib = `lib:${st.org.id}:good-standing`;
    assert.equal((await contractor.upload(`/api/documents/${encodeURIComponent(lib)}/file`, 'coid.pdf', PDF)).status, 200);
    assert.equal((await contractor.post(`/api/documents/${encodeURIComponent(lib)}/submit`, { expiryDate: '2030-03-31' })).status, 200);
    const a = await contractor.post(`/api/documents/${coid.id}/use-library`);
    assert.equal(a.status, 200);
    assert.equal(a.body.expiryDate, '2030-03-31');
    assert.equal((await contractor.post(`/api/documents/${coid.id}/submit`, { note: a.body.note, expiryDate: a.body.expiryDate })).status, 200);
    assert.equal((await host.state()).state.documents[coid.id].status, 'awaiting_review');
    assert.equal((await host.post(`/api/documents/${coid.id}/use-library`)).status, 403, 'only the contractor submits');
  });
});
