/** Document Studio list: where each document stands, and deleting only what was never submitted. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, lastEmailToken, setup, signup, teardown, uniqueEmail } from './helpers.js';

let app: FastifyInstance;
let host: Agent;
let contractor: Agent;
let other: Agent;
let siteId: string;
let raReq: string;

before(async () => {
  app = await setup();
  host = (await signup(app, { orgName: 'Tau Mines', orgKind: 'host' })).agent;
  contractor = (await signup(app, { orgName: 'Rho Civils', orgKind: 'contractor' })).agent;
  other = (await signup(app, { orgName: 'Phi Builders', orgKind: 'contractor' })).agent;
  const email = uniqueEmail('rho');
  siteId = (await host.post('/api/sites', { name: 'Haul Road 3', location: 'Sishen', newContractor: { name: 'Rho Civils', email }, templatePackIds: ['baseline'] })).body.id;
  assert.equal((await contractor.post(`/api/auth/site-invite/${await lastEmailToken(email, '/site-invite')}/accept`)).status, 200);
  raReq = (await contractor.state()).state.requirements[siteId].find((r: { name: string }) => r.name === 'Baseline risk assessment').id;
});
after(teardown);

const make = async () => (await contractor.post('/api/studio/documents', { blueprintId: 'risk-assessment', siteId, requirementId: raReq, values: { scope: 'Widening the haul road' } })).body;
const listed = async (id: string) => (await contractor.get('/api/studio/documents')).body.documents.find((d: { id: string }) => d.id === id);

describe('document studio list', () => {
  it('lets the creator delete a document that was never submitted', async () => {
    const d = await make();
    assert.equal((await listed(d.id)).everSubmitted, false);
    assert.equal((await other.del(`/api/studio/documents/${d.id}`)).status, 404);
    assert.equal((await contractor.del(`/api/studio/documents/${d.id}`)).status, 200);
    assert.equal(await listed(d.id), undefined);
  });

  it('reports the review status once submitted, and keeps submitted documents', async () => {
    const d = await make();
    const a = await contractor.post(`/api/documents/${raReq}/attach-generated`, { generatedId: d.id });
    assert.equal((await contractor.post(`/api/documents/${raReq}/submit`, { note: a.body.note, expiryDate: a.body.reviewDue })).status, 200);
    let row = await listed(d.id);
    assert.equal(row.everSubmitted, true);
    assert.equal(row.submittedStatus, 'awaiting_review');
    assert.equal(row.latestSubmitted, true);
    assert.equal((await contractor.del(`/api/studio/documents/${d.id}`)).status, 409);
    assert.equal((await host.post(`/api/documents/${raReq}/correction`, { text: 'Add the traffic plan' })).status, 200);
    row = await listed(d.id);
    assert.equal(row.submittedStatus, 'correction_required');
  });
});
