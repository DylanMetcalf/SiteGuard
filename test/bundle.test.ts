/** Bound safety file: one PDF of everything submitted, for both sides and safety-file share links only. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { PDFDocument } from 'pdf-lib';
import { Agent, PDF, lastEmailToken, setup, signup, teardown, uniqueEmail } from './helpers.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let app: FastifyInstance;
let host: Agent;
let contractor: Agent;
let stranger: Agent;
let siteId: string;

before(async () => {
  app = await setup();
  host = (await signup(app, { orgName: 'Omega Mines', orgKind: 'host' })).agent;
  contractor = (await signup(app, { orgName: 'Sigma Electrical', orgKind: 'contractor' })).agent;
  stranger = (await signup(app, { orgName: 'Other Mine', orgKind: 'host' })).agent;
  const email = uniqueEmail('sigma');
  siteId = (await host.post('/api/sites', { name: 'Shaft 4 Substation', location: 'Kathu', newContractor: { name: 'Sigma Electrical', email }, templatePackIds: ['baseline'] })).body.id;
  assert.equal((await contractor.post(`/api/auth/site-invite/${await lastEmailToken(email, '/site-invite')}/accept`)).status, 200);
  const reqs = (await contractor.state()).state.requirements[siteId] as { id: string; name: string }[];
  // A damaged PDF, a photo, and a Studio document.
  assert.equal((await contractor.upload(`/api/documents/${reqs[0].id}/file`, 'coid.pdf', PDF)).status, 200);
  assert.equal((await contractor.post(`/api/documents/${reqs[0].id}/submit`, { expiryDate: '2040-12-31' })).status, 200);
  assert.equal((await contractor.upload(`/api/documents/${reqs[1].id}/file`, 'cipc.png', PNG, 'image/png')).status, 200);
  assert.equal((await contractor.post(`/api/documents/${reqs[1].id}/submit`, { expiryDate: '2040-12-31' })).status, 200);
  const ra = reqs.find((r) => r.name === 'Baseline risk assessment')!;
  const g = await contractor.post('/api/studio/documents', { blueprintId: 'risk-assessment', siteId, requirementId: ra.id, values: { scope: 'Replacing MV switchgear in the Shaft 4 substation' } });
  assert.equal(g.status, 200);
  const a = await contractor.post(`/api/documents/${ra.id}/attach-generated`, { generatedId: g.body.id });
  assert.equal((await contractor.post(`/api/documents/${ra.id}/submit`, { note: a.body.note, expiryDate: a.body.reviewDue })).status, 200);
});
after(teardown);

async function pages(buf: Buffer) {
  assert.equal(buf.subarray(0, 4).toString(), '%PDF');
  return (await PDFDocument.load(buf)).getPageCount();
}

describe('document pack', () => {
  it('merges the selected documents into one PDF, and refuses other companies\' documents', async () => {
    const reqs = (await contractor.state()).state.requirements[siteId] as { id: string }[];
    const r = await contractor.req('POST', '/api/documents/pack', { slots: [reqs[0].id, reqs[1].id] });
    assert.equal(r.status, 200);
    assert.match(String(r.raw.headers['content-disposition']), /Document-pack-Sigma-Electrical\.pdf/);
    assert.ok((await pages(r.raw.rawPayload)) >= 4, 'cover + contents + 2 documents');
    assert.equal((await stranger.post('/api/documents/pack', { slots: [reqs[0].id] })).status, 404);
    assert.equal((await contractor.post('/api/documents/pack', { slots: [] })).status, 400);
  });
});

describe('bound safety file', () => {
  it('merges every submitted document behind a cover and contents, for both sides', async () => {
    const c = await contractor.req('GET', `/api/sites/${siteId}/safety-file.pdf`);
    assert.equal(c.status, 200);
    assert.match(String(c.raw.headers['content-disposition']), /Safety-file-Shaft-4-Substation\.pdf/);
    const n = await pages(c.raw.rawPayload);
    // cover + contents (≥2) + registers (1) + damaged-PDF notice (1) + photo page (1) + Studio document (≥3)
    assert.ok(n >= 8, `expected at least 8 pages, got ${n}`);
    const h = await host.req('GET', `/api/sites/${siteId}/safety-file.pdf`);
    assert.equal(h.status, 200);
    assert.equal(await pages(h.raw.rawPayload), n);
  });

  it('is hidden from other tenants', async () => {
    assert.equal((await stranger.get(`/api/sites/${siteId}/safety-file.pdf`)).status, 404);
    assert.equal((await stranger.get('/api/sites/not-a-uuid/safety-file.pdf')).status, 404);
    assert.equal((await new Agent(app).get(`/api/sites/${siteId}/safety-file.pdf`)).status, 401);
  });

  it('is available through a safety-file share link only', async () => {
    const full = await contractor.post('/api/share-links', { siteId, kind: 'safety_file', days: 7, label: 'Auditor' });
    const token = full.body.url.split('/share/')[1];
    const guest = new Agent(app);
    const page = await guest.req('GET', `/share/${token}`);
    assert.match(page.raw.body, /safety-file\.pdf/);
    const g = await guest.req('GET', `/share/${token}/safety-file.pdf`);
    assert.equal(g.status, 200);
    assert.ok((await pages(g.raw.rawPayload)) >= 7);
    const status = await host.post('/api/share-links', { siteId, kind: 'site_readiness', days: 1 });
    assert.notEqual((await guest.req('GET', `/share/${status.body.url.split('/share/')[1]}/safety-file.pdf`)).status, 200);
    await contractor.post(`/api/share-links/${full.body.id}/revoke`);
    assert.notEqual((await guest.req('GET', `/share/${token}/safety-file.pdf`)).status, 200);
  });
});
