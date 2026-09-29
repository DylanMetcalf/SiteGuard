/** Fixes from the independent audit: live Site Ready, review scoping, removal, stale approvals, demo isolation, permits. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, PDF, pool, setup, signup, teardown } from './helpers.js';

let app: FastifyInstance;
let mine: Agent, otherMine: Agent, con: Agent;
let wid: string, code: string, fileId: string;

before(async () => {
  app = await setup();
  mine = (await signup(app, { orgName: 'Chi Mining', orgKind: 'host' })).agent;
  otherMine = (await signup(app, { orgName: 'Psi Mining', orgKind: 'host' })).agent;
  con = (await signup(app, { orgName: 'Tau Electrical', orgKind: 'contractor' })).agent;
  const w = await mine.post('/api/workplaces', { name: 'Pit 7', requirements: [{ category: 'Company Documents', name: 'Letter of Good Standing (COID)', source: 'legal', why: '' }] });
  wid = w.body.id; code = w.body.code;
  fileId = (await con.post('/api/sites/join', { code })).body.siteId;
});
after(teardown);

const reqOf = async () => (await con.state()).state.requirements[fileId][0].id as string;

describe('audit fixes', () => {
  it('refuses to approve a version the reviewer did not read', async () => {
    const r = await reqOf();
    await con.upload(`/api/documents/${r}/file`, 'coid.pdf', PDF);
    assert.equal((await con.post(`/api/documents/${r}/submit`, {})).status, 400, 'COID letter needs an expiry date');
    assert.equal((await con.post(`/api/documents/${r}/submit`, { expiryDate: '2035-01-31' })).status, 200);
    const stale = await mine.post(`/api/documents/${r}/approve`, { version: 'v0.9' });
    assert.equal(stale.status, 409);
    assert.match(stale.body.message, /newer version/);
    assert.equal((await mine.post(`/api/documents/${r}/approve`, { version: 'v1.0' })).status, 200);
  });

  it('withdraws Site Ready as soon as the file stops qualifying', async () => {
    assert.equal((await mine.post(`/api/sites/${fileId}/approve`)).status, 200);
    assert.equal((await mine.state()).state.sites[fileId].status, 'site_ready');
    const r = await reqOf();
    assert.equal((await mine.post(`/api/documents/${r}/correction`, { text: 'Letter is for the wrong company' })).status, 200);
    assert.equal((await mine.state()).state.sites[fileId].status, 'in_progress');
    assert.ok((await con.state()).inbox.items.some((n: { title: string }) => /Site Ready withdrawn: Pit 7/.test(n.title)));
    const a = await pool.query(`select detail from audit_events where site_id = $1 and action = 'Site Ready withdrawn'`, [fileId]);
    assert.match(a.rows[0].detail, /sent back/);
  });

  it('lapses Site Ready in the background check when a document expires', async () => {
    const r = await reqOf();
    await con.upload(`/api/documents/${r}/file`, 'coid2.pdf', PDF);
    await con.post(`/api/documents/${r}/submit`, { expiryDate: '2035-01-31' });
    await mine.post(`/api/documents/${r}/approve`);
    assert.equal((await mine.post(`/api/sites/${fileId}/approve`)).status, 200);
    await pool.query(`update documents set expiry_date = current_date - 1 where requirement_id = $1`, [r]);
    const { recheckAllSiteReady } = await import('../src/lib/siteready.js');
    const { withTx } = await import('../src/db/pool.js');
    assert.equal(await withTx((db) => recheckAllSiteReady(db)), 1);
    assert.equal((await mine.state()).state.sites[fileId].status, 'in_progress');
  });

  it('lets the mine remove and restore a contractor; a removed contractor cannot rejoin', async () => {
    assert.equal((await otherMine.post(`/api/workplaces/files/${fileId}/remove`, { reason: 'nope' })).status, 404);
    assert.equal((await mine.post(`/api/workplaces/files/${fileId}/remove`, {})).status, 400, 'a reason is required');
    assert.equal((await mine.post(`/api/workplaces/files/${fileId}/remove`, { reason: 'Contract ended' })).status, 200);
    assert.equal((await con.state()).state.sites[fileId], undefined);
    assert.equal((await con.get(`/api/sites/${fileId}/safety-file.pdf`)).status, 404);
    const again = await con.post('/api/sites/join', { code });
    assert.equal(again.status, 403);
    assert.match(again.body.message, /removed your company/);
    assert.equal((await mine.post(`/api/workplaces/files/${fileId}/restore`)).status, 200);
    assert.ok((await con.state()).state.sites[fileId]);
  });

  it('keeps other mines out of the site entirely', async () => {
    assert.equal((await otherMine.patch(`/api/workplaces/${wid}`, { joinOpen: false })).status, 404);
    assert.equal((await otherMine.post(`/api/workplaces/${wid}/code`)).status, 404);
    assert.equal((await otherMine.post(`/api/workplaces/${wid}/requirements/remove`, { name: 'Letter of Good Standing (COID)' })).status, 404);
    assert.equal((await otherMine.state()).state.workplaces[wid], undefined);
  });

  it('never lets a practice-space company join a real site', async () => {
    const demo = new Agent(app);
    await demo.post('/api/demo', { clean: true, hostName: 'Demo Mine', contractorName: 'Demo Contractor', yourName: 'Tester' });
    const st = await demo.state();
    const c = st.personas.find((p: { label: string }) => p.label.includes('Demo Contractor'));
    await demo.post('/api/demo/switch', { userId: c.userId });
    assert.equal((await demo.post('/api/sites/join', { code })).status, 404);
  });

  it('only counts the mine\'s own section decisions in the review workspace', async () => {
    const st = await con.state();
    const ra = await mine.post(`/api/workplaces/${wid}/requirements`, { requirements: [{ category: 'Plans & Procedures', name: 'Baseline risk assessment', source: 'legal', why: '' }] });
    assert.equal(ra.status, 200);
    const raReq = (await con.state()).state.requirements[fileId].find((q: { name: string }) => q.name === 'Baseline risk assessment').id;
    const g = await con.post('/api/studio/documents', { blueprintId: 'risk-assessment', siteId: fileId, requirementId: raReq, values: { scope: 'Cable pulling in Pit 7' } });
    const link = await con.post(`/api/review/${g.body.id}/links`, { label: 'self', days: 1 });
    const token = link.body.url.split('/review/')[1];
    const guest = new Agent(app);
    const view = (await guest.get(`/api/review-links/${token}`)).body;
    for (const s of view.sections) await guest.post(`/api/review-links/${token}/decision`, { sectionHash: s.hash, decision: 'approved', name: 'Totally the mine' });
    await guest.post(`/api/review-links/${token}/comments`, { body: 'All good', name: 'Totally the mine' });
    const a = await con.post(`/api/documents/${raReq}/attach-generated`, { generatedId: g.body.id });
    await con.post(`/api/documents/${raReq}/submit`, { note: a.body.note, expiryDate: a.body.reviewDue });
    const h = (await mine.get(`/api/review/${g.body.id}?req=${raReq}`)).body;
    assert.equal(h.summary.approved, 0, 'guest approvals do not count for the mine');
    assert.ok(!h.comments.some((x: { authorName: string }) => x.authorName === 'Totally the mine'));
    assert.equal(h.target.requirementId, raReq);
    assert.ok(st);
  });

  it('requires an end time when the mine issues a permit directly', async () => {
    const p = await mine.post(`/api/sites/${fileId}/permits`, { type: 'hot_work', location: 'Pit 7 workshop' });
    assert.equal(p.status, 400);
    assert.equal((await mine.post(`/api/sites/${fileId}/permits`, { type: 'hot_work', location: 'Pit 7 workshop', validTo: new Date(Date.now() + 8 * 3600e3).toISOString() })).status, 200);
  });
});
