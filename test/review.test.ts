/** Review workspace: section decisions, carry-over approvals, editing and resubmitting, review links, notifications, isolation. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, lastEmailToken, pool, setup, signup, teardown, uniqueEmail } from './helpers.js';

let app: FastifyInstance;
let host: Agent;
let contractor: Agent;
let stranger: Agent;
let siteId: string;
let raReqId: string;
let docId: string;
let linkToken: string;

const unread = async (a: Agent) => (await a.state()).inbox;
async function submit(id: string) {
  const a = await contractor.post(`/api/documents/${raReqId}/attach-generated`, { generatedId: id });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  const s = await contractor.post(`/api/documents/${raReqId}/submit`, { note: a.body.note, expiryDate: a.body.reviewDue });
  assert.equal(s.status, 200, JSON.stringify(s.body));
}

before(async () => {
  app = await setup();
  host = (await signup(app, { orgName: 'Kappa Mining', orgKind: 'host' })).agent;
  contractor = (await signup(app, { orgName: 'Delta Welding', orgKind: 'contractor' })).agent;
  stranger = (await signup(app, { orgName: 'Nosy Mine', orgKind: 'host' })).agent;
  const email = uniqueEmail('delta');
  siteId = (await host.post('/api/sites', { name: 'Thickener 2', location: 'Rustenburg', newContractor: { name: 'Delta Welding', email }, templatePackIds: ['baseline'] })).body.id;
  const token = await lastEmailToken(email, '/site-invite');
  assert.equal((await contractor.post(`/api/auth/site-invite/${token}/accept`)).status, 200);
  raReqId = (await contractor.state()).state.requirements[siteId].find((r: { name: string }) => r.name === 'Baseline risk assessment').id;
  const g = await contractor.post('/api/studio/documents', { blueprintId: 'risk-assessment', siteId, requirementId: raReqId, values: { scope: 'Welding brackets on the thickener walkway at height' } });
  assert.equal(g.status, 200, JSON.stringify(g.body));
  docId = g.body.id;
});
after(teardown);

describe('review workspace', () => {
  it('hides the document from the site until it is submitted, and from everyone else always', async () => {
    assert.equal((await host.get(`/api/review/${docId}`)).status, 404);
    const own = await contractor.get(`/api/review/${docId}`);
    assert.equal(own.body.viewer.role, 'owner');
    assert.equal(own.body.viewer.canDecide, false);
    assert.equal(own.body.target.requirementId, raReqId);
    await submit(docId);
    const h = await host.get(`/api/review/${docId}`);
    assert.equal(h.body.viewer.role, 'host');
    assert.equal(h.body.viewer.canDecide, true);
    assert.equal(h.body.target.status, 'awaiting_review');
    assert.equal((await stranger.get(`/api/review/${docId}`)).status, 404);
    assert.equal((await stranger.post(`/api/review/${docId}/comments`, { body: 'hi' })).status, 404);
    const inbox = await unread(host);
    assert.ok(inbox.items.some((n: { title: string }) => /New for review: Baseline risk assessment/.test(n.title)));
  });

  it('records section decisions and comments, and notifies the author', async () => {
    const h = (await host.get(`/api/review/${docId}`)).body;
    const [s0, s1] = h.sections;
    assert.equal((await host.post(`/api/review/${docId}/decision`, { sectionHash: s0.hash, decision: 'approved' })).status, 200);
    const noNote = await host.post(`/api/review/${docId}/decision`, { sectionHash: s1.hash, decision: 'changes' });
    assert.equal(noNote.status, 400);
    assert.match(noNote.body.message, /Say what needs to change/);
    assert.equal((await host.post(`/api/review/${docId}/decision`, { sectionHash: s1.hash, decision: 'changes', note: 'Name the thickener walkway area' })).status, 200);
    assert.equal((await host.post(`/api/review/${docId}/comments`, { sectionIndex: 0, quote: h.sections[0].blocks[0].text.slice(0, 20), body: 'Good purpose statement' })).status, 200);
    assert.equal((await host.post(`/api/review/${docId}/decision`, { sectionHash: 'f'.repeat(20), decision: 'approved' })).status, 400);
    assert.equal((await contractor.post(`/api/review/${docId}/decision`, { sectionHash: s0.hash, decision: 'approved' })).status, 403);

    const c = (await contractor.get(`/api/review/${docId}`)).body;
    assert.equal(c.sections[0].status.decision, 'approved');
    assert.equal(c.sections[1].status.decision, 'changes');
    assert.equal(c.summary.approved, 1);
    assert.ok(c.comments.some((x: { quote: string }) => x.quote.length > 0));
    const inbox = await unread(contractor);
    assert.ok(inbox.unread >= 2);
    assert.ok(inbox.items.some((n: { title: string }) => /Changes requested/.test(n.title)));
    // One approved section is not worth a message on its own.
    assert.ok(!inbox.items.some((n: { title: string }) => /” approved$/.test(n.title)));
  });

  it('keeps approvals on unchanged sections when the author edits and resubmits', async () => {
    const c = (await contractor.get(`/api/review/${docId}`)).body;
    const sections = c.sections.map((s: { heading: string; blocks: unknown[]; index: number }) =>
      s.index === 1 ? { heading: s.heading, blocks: [{ type: 'paragraph', text: 'This document applies to welding on the Thickener 2 walkway at Rustenburg.' }] } : { heading: s.heading, blocks: s.blocks });
    assert.equal((await contractor.post(`/api/review/${docId}/save`, { sections: c.sections.map((s: { heading: string; blocks: unknown[] }) => ({ heading: s.heading, blocks: s.blocks })) })).status, 400, 'no changes');
    const saved = await contractor.post(`/api/review/${docId}/save`, { sections });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.revision, 1);
    assert.equal(saved.body.docNumber, c.doc.docNumber);
    // Before resubmitting, the host still sees Rev 0.
    assert.equal((await host.get(`/api/review/${docId}`)).body.doc.revision, 0);
    const own = (await contractor.get(`/api/review/${saved.body.id}`)).body;
    assert.equal(own.sections[0].status.decision, 'approved', 'unchanged section keeps its approval');
    assert.equal(own.sections[1].status, null, 'edited section needs review again');
    assert.equal(own.target.submittedRevision, 0);

    // The site asked for a correction; the contractor resubmits Rev 1.
    const cs = (await host.get(`/api/review/${docId}`)).body;
    assert.equal((await host.post(`/api/documents/${raReqId}/correction`, { text: 'See section 2' })).status, 200);
    await submit(saved.body.id);
    const h = (await host.get(`/api/review/${docId}`)).body;
    assert.equal(h.doc.revision, 1);
    for (const s of h.sections.filter((x: { status: { decision: string } | null }) => !x.status || x.status.decision !== 'approved')) {
      assert.equal((await host.post(`/api/review/${h.doc.id}/decision`, { sectionHash: s.hash, decision: 'approved' })).status, 200);
    }
    const done = (await host.get(`/api/review/${h.doc.id}`)).body;
    assert.equal(done.summary.approved, done.summary.total);
    assert.ok((await unread(contractor)).items.some((n: { title: string }) => /^All sections approved/.test(n.title)));
    assert.equal((await host.post(`/api/documents/${raReqId}/approve`)).status, 200);
    assert.equal((await host.state()).state.documents[raReqId].status, 'complete');
    assert.ok((await unread(contractor)).items.some((n: { title: string }) => /Approved: Baseline risk assessment/.test(n.title)));
    docId = saved.body.id;
    assert.ok(cs);
  });

  it('lets the author resolve comments; others cannot', async () => {
    const c = (await contractor.get(`/api/review/${docId}`)).body;
    const open = c.comments.find((x: { resolvedAt: string | null }) => !x.resolvedAt);
    assert.equal((await stranger.post(`/api/review/comments/${open.id}/resolve`)).status, 404);
    assert.equal((await contractor.post(`/api/review/comments/${open.id}/resolve`)).status, 200);
    const again = (await contractor.get(`/api/review/${docId}`)).body;
    assert.ok(again.comments.find((x: { id: string }) => x.id === open.id).resolvedAt);
  });
});

describe('review links', () => {
  it('lets a person without an account read, approve and comment until withdrawn', async () => {
    assert.equal((await host.post(`/api/review/${docId}/links`, { label: 'x' })).status, 403);
    const l = await contractor.post(`/api/review/${docId}/links`, { label: 'Client SHE manager', days: 7 });
    assert.equal(l.status, 200);
    linkToken = l.body.url.split('/review/')[1];
    const guest = new Agent(app);
    const view = await guest.get(`/api/review-links/${linkToken}`);
    assert.equal(view.status, 200);
    assert.equal(view.body.viewer.role, 'external');
    assert.equal(view.body.doc.pdfFileId, null, 'no direct file ids for guests');
    assert.equal(view.body.link.companyName, 'Delta Welding');
    const pdf = await guest.req('GET', `/api/review-links/${linkToken}/pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.raw.rawPayload.subarray(0, 4).toString(), '%PDF');
    assert.equal((await guest.post(`/api/review-links/${linkToken}/comments`, { body: 'Looks fine' })).status, 400, 'name required');
    assert.equal((await guest.post(`/api/review-links/${linkToken}/comments`, { body: 'Looks fine', name: 'Naledi, SHE' })).status, 200);
    assert.equal((await guest.post(`/api/review-links/${linkToken}/decision`, { sectionHash: view.body.sections[2].hash, decision: 'approved', name: 'Naledi, SHE' })).status, 200);
    assert.ok((await unread(contractor)).items.some((n: { title: string }) => /Naledi, SHE/.test(n.title)));
    assert.equal((await guest.get(`/api/review-links/${linkToken.slice(0, -2)}xx`)).status, 404);
    const links = (await contractor.get(`/api/review/${docId}`)).body.links;
    assert.equal((await contractor.del(`/api/review/links/${links[0].id}`)).status, 200);
    assert.equal((await guest.get(`/api/review-links/${linkToken}`)).status, 404);
  });

  it('marks notifications read', async () => {
    assert.ok((await unread(contractor)).unread > 0);
    assert.equal((await contractor.post('/api/notifications/read')).status, 200);
    assert.equal((await unread(contractor)).unread, 0);
    const r = await pool.query('select count(*)::int as n from notifications');
    assert.ok(r.rows[0].n > 0);
  });
});
