/** Document Studio: every blueprint renders, numbering and revisions, branding, attaching to a safety file, and tenant isolation. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, lastEmailToken, pool, setup, signup, teardown, uniqueEmail } from './helpers.js';
import { BLUEPRINTS, blueprintForRequirement } from '../src/lib/studio/blueprints.js';
import { renderPdf } from '../src/lib/studio/render-pdf.js';
import { renderDocx } from '../src/lib/studio/render-docx.js';
import { initials } from '../src/lib/studio/generate.js';
import { runAgentForOrg } from '../src/lib/agent.js';

let app: FastifyInstance;
let host: Agent;
let contractor: Agent;
let other: Agent;
let siteId: string;
let raReqId: string;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

before(async () => {
  app = await setup();
  host = (await signup(app, { orgName: 'Omega Coal', orgKind: 'host' })).agent;
  contractor = (await signup(app, { orgName: 'Volt Masters (Pty) Ltd', orgKind: 'contractor' })).agent;
  other = (await signup(app, { orgName: 'Stranger Co', orgKind: 'contractor' })).agent;
  const email = uniqueEmail('volt');
  siteId = (await host.post('/api/sites', { name: 'Plant 2 Substation', location: 'Witbank', newContractor: { name: 'Volt Masters', email }, templatePackIds: ['baseline'] })).body.id;
  const token = await lastEmailToken(email, '/site-invite');
  assert.equal((await contractor.post(`/api/auth/site-invite/${token}/accept`)).status, 200);
  const state = await contractor.state();
  raReqId = state.state.requirements[siteId].find((r: { name: string }) => r.name === 'Baseline risk assessment').id;
});
after(teardown);

describe('blueprints', () => {
  it('every blueprint builds and renders to PDF and Word, even with no answers', async () => {
    const meta = { docNumber: 'T-1', revision: 0, issueDate: '2026-01-01', reviewDate: '2027-01-01', companyName: 'Test Co', preparedBy: 'Tester', brandColor: '#16325C', blueprintName: 'x', revisions: [{ revision: 0, date: '2026-01-01', description: 'First issue', by: 'Tester' }] };
    for (const bp of BLUEPRINTS) {
      const content = bp.build({ values: {}, company: { name: 'Test Co' }, preparer: { name: 'Tester' } });
      assert.ok(content.sections.length >= 3, `${bp.id} has sections`);
      const pdf = await renderPdf(content, { ...meta, blueprintName: bp.name, logo: { data: PNG, type: 'image/png' } });
      assert.equal(pdf.subarray(0, 4).toString(), '%PDF', `${bp.id} pdf`);
      const docx = await renderDocx(content, { ...meta, blueprintName: bp.name, logo: { data: PNG, type: 'image/png' } });
      assert.equal(docx.subarray(0, 2).toString(), 'PK', `${bp.id} docx`);
    }
  });

  it('maps starter-pack requirements to the right document type', () => {
    assert.equal(blueprintForRequirement('Baseline risk assessment')?.id, 'risk-assessment');
    assert.equal(blueprintForRequirement('Contractor SHE plan')?.id, 'she-plan');
    assert.equal(blueprintForRequirement('Health & Safety policy')?.id, 'hse-policy');
    assert.equal(blueprintForRequirement('Method statement / safe work procedure')?.id, 'method-statement');
    assert.equal(blueprintForRequirement('Lock-out / isolation procedure')?.id, 'isolation');
    assert.equal(blueprintForRequirement('Switching and isolation authorisations'), undefined);
    assert.equal(blueprintForRequirement('Letter of Good Standing (COID)'), undefined);
    assert.equal(initials('Volt Masters (Pty) Ltd'), 'VM');
    assert.equal(initials('ABC Electrical Pty Ltd'), 'ABC');
  });
});

describe('generating documents', () => {
  let docId: string;

  it('exposes blueprint hints on requirements and the catalogue', async () => {
    const s = await contractor.state();
    assert.equal(s.state.requirements[siteId].find((r: { id: string }) => r.id === raReqId).blueprint, 'risk-assessment');
    const cat = await contractor.get('/api/studio/blueprints');
    assert.equal(cat.body.blueprints.length, BLUEPRINTS.length);
    assert.ok(cat.body.categories.includes('Procedures'));
  });

  it('creates a numbered, branded document for a site requirement', async () => {
    const r = await contractor.post('/api/studio/documents', { blueprintId: 'risk-assessment', siteId, requirementId: raReqId, values: { scope: 'Replace the MCC in the Plant 2 substation, live electrical isolation and welding of brackets' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.docNumber, 'VM-RA-001');
    assert.equal(r.body.revision, 0);
    assert.equal(r.body.ai, false);
    docId = r.body.id;
    const d = (await contractor.get(`/api/studio/documents/${docId}`)).body;
    assert.match(JSON.stringify(d.content), /Electric shock/);
    assert.match(JSON.stringify(d.content), /Omega Coal/);
    const pdf = await contractor.req('GET', `/api/files/${d.pdfFileId}`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.raw.rawPayload.subarray(0, 4).toString(), '%PDF');
    const docx = await contractor.req('GET', `/api/files/${d.docxFileId}?download=1`);
    assert.equal(docx.raw.rawPayload.subarray(0, 2).toString(), 'PK');
  });

  it('validates required answers and document types', async () => {
    assert.equal((await contractor.post('/api/studio/documents', { blueprintId: 'risk-assessment', values: {} })).status, 400);
    assert.equal((await contractor.post('/api/studio/documents', { blueprintId: 'nope', values: {} })).status, 400);
    assert.equal((await contractor.post('/api/studio/documents', { blueprintId: 'appointment', values: { appointmentType: 'King', appointee: 'A', appointedBy: 'B' } })).status, 400);
  });

  it('revises under the same number and supersedes the old revision', async () => {
    const r = await contractor.post('/api/studio/documents', { blueprintId: 'risk-assessment', reviseOf: docId, revisionNote: 'Added brackets', values: { scope: 'Replace the MCC and weld brackets' } });
    assert.equal(r.body.docNumber, 'VM-RA-001');
    assert.equal(r.body.revision, 1);
    const list = (await contractor.get('/api/studio/documents')).body.documents;
    assert.deepEqual(list.filter((d: { docNumber: string }) => d.docNumber === 'VM-RA-001').map((d: { revision: number }) => d.revision), [1]);
    const d = (await contractor.get(`/api/studio/documents/${r.body.id}`)).body;
    assert.deepEqual(d.history.map((h: { revision: number }) => h.revision), [1, 0]);
    docId = r.body.id;
  });

  it('attaches to the requirement and submits it for review, visible to the host', async () => {
    const a = await contractor.post(`/api/documents/${raReqId}/attach-generated`, { generatedId: docId });
    assert.equal(a.status, 200);
    const s = await contractor.post(`/api/documents/${raReqId}/submit`, { note: a.body.note, expiryDate: a.body.reviewDue });
    assert.equal(s.status, 200);
    const hs = await host.state();
    const doc = hs.state.documents[raReqId];
    assert.equal(doc.status, 'awaiting_review');
    assert.equal(doc.expiryDate, a.body.reviewDue);
    const file = await host.req('GET', doc.assetUrl);
    assert.equal(file.status, 200);
  });

  it('keeps documents inside their organisation', async () => {
    assert.equal((await other.get(`/api/studio/documents/${docId}`)).status, 404);
    assert.ok(!(await other.get('/api/studio/documents')).body.documents.length);
    assert.equal((await other.post('/api/studio/documents', { blueprintId: 'risk-assessment', siteId, values: { scope: 'x' } })).status, 404);
    const lib = `lib:${(await other.state()).org.id}:she-policy`;
    assert.equal((await other.post(`/api/documents/${encodeURIComponent(lib)}/attach-generated`, { generatedId: docId })).status, 404);
  });

  it('applies branding and validates it', async () => {
    assert.equal((await contractor.req('PATCH', '/api/org/branding', { brandColor: 'red' })).status, 400);
    assert.equal((await contractor.req('PATCH', '/api/org/branding', { brandColor: '#B8430F', docPrefix: 'vmx' })).status, 200);
    const logo = await contractor.upload('/api/org/logo', 'logo.png', PNG, 'image/png');
    assert.equal(logo.status, 200);
    assert.equal((await contractor.upload('/api/org/logo', 'logo.txt', Buffer.from('not an image'), 'text/plain')).status, 400);
    const b = (await contractor.state()).org.branding;
    assert.equal(b.docPrefix, 'VMX');
    assert.equal(b.logoFileId, logo.body.fileId);
    const r = await contractor.post('/api/studio/documents', { blueprintId: 'hse-policy', values: { ceo: 'T. Mokoena' } });
    assert.equal(r.body.docNumber, 'VMX-HSP-001');
  });

  it('flags documents due for review through the compliance agent', async () => {
    const org = (await contractor.state()).org;
    await pool.query(`update generated_documents set review_due = current_date - 1 where org_id = $1 and superseded_at is null`, [org.id]);
    await runAgentForOrg(pool, { id: org.id, kind: 'contractor' });
    const f = (await contractor.get('/api/agent/findings')).body.findings;
    assert.ok(f.some((x: { title: string; severity: string }) => /past its review date/.test(x.title) && x.severity === 'high'));
  });
});
