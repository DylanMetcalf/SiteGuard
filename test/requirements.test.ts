/** Required vs optional requirements, and choosing which documents go into a copy of the safety file. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, PDF, pool, setup, signup, teardown } from './helpers.js';

let app: FastifyInstance;
let mine: Agent, other: Agent, con: Agent;
let wid: string, fileId: string;

before(async () => {
  app = await setup();
  mine = (await signup(app, { orgName: 'Iota Mining', orgKind: 'host' })).agent;
  other = (await signup(app, { orgName: 'Kappa Mining', orgKind: 'host' })).agent;
  con = (await signup(app, { orgName: 'Mu Electrical', orgKind: 'contractor' })).agent;
  const w = await mine.post('/api/workplaces', {
    name: 'Pit 3',
    requirements: [
      { category: 'Company Documents', name: 'Letter of Good Standing (COID)', source: 'legal' },
      { category: 'Plans', name: 'Traffic management plan', source: 'site', optional: true },
    ],
  });
  wid = w.body.id;
  fileId = (await con.post('/api/sites/join', { code: w.body.code })).body.siteId;
});
after(teardown);

const reqs = async () => (await con.state()).state.requirements[fileId] as { id: string; name: string; optional: boolean }[];
const byName = async (n: string) => (await reqs()).find((r) => r.name === n)!;

describe('optional requirements', () => {
  it('carries the optional flag from the site into the contractor\'s file', async () => {
    assert.equal((await byName('Traffic management plan')).optional, true);
    assert.equal((await byName('Letter of Good Standing (COID)')).optional, false);
  });

  it('lets Site Ready happen without the optional document', async () => {
    const coid = await byName('Letter of Good Standing (COID)');
    await con.upload(`/api/documents/${coid.id}/file`, 'coid.pdf', PDF);
    await con.post(`/api/documents/${coid.id}/submit`, { expiryDate: '2035-01-31' });
    assert.equal((await mine.post(`/api/documents/${coid.id}/approve`)).status, 200);
    const r = await mine.get(`/api/sites/${fileId}/readiness`);
    assert.equal(r.body.percent, 100, JSON.stringify(r.body));
    assert.equal((await mine.post(`/api/sites/${fileId}/approve`)).status, 200);
  });

  it('withdraws Site Ready when the site makes it required again, for every file', async () => {
    assert.equal((await con.post(`/api/workplaces/${wid}/requirements/optional`, { name: 'Traffic management plan', optional: false })).status, 403);
    assert.equal((await other.post(`/api/workplaces/${wid}/requirements/optional`, { name: 'Traffic management plan', optional: false })).status, 404);
    const r = await mine.post(`/api/workplaces/${wid}/requirements/optional`, { name: 'traffic management plan', optional: false });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await byName('Traffic management plan')).optional, false);
    assert.equal((await mine.state()).state.sites[fileId].status, 'in_progress');
    assert.equal((await mine.state()).state.workplaces[wid].requirements.find((x: { name: string }) => x.name === 'Traffic management plan').optional, false);
  });

  it('switches one requirement on one file, for the mine only', async () => {
    const tmp = await byName('Traffic management plan');
    assert.equal((await con.post(`/api/requirements/${tmp.id}/optional`, { optional: true })).status, 403);
    assert.equal((await other.post(`/api/requirements/${tmp.id}/optional`, { optional: true })).status, 404);
    assert.equal((await mine.post(`/api/requirements/${tmp.id}/optional`, { optional: true })).status, 200);
    assert.equal((await byName('Traffic management plan')).optional, true);
  });

  it('makes a contractor\'s own extra documents optional, so they never lower its readiness', async () => {
    const before = (await mine.get(`/api/sites/${fileId}/readiness`)).body.percent;
    assert.equal((await con.post(`/api/sites/${fileId}/my-documents`, { name: 'Lift plan' })).status, 200);
    assert.equal((await byName('Lift plan')).optional, true);
    assert.equal((await mine.get(`/api/sites/${fileId}/readiness`)).body.percent, before);
  });

  it('lets a contractor set optional items on its own project', async () => {
    const p = (await con.post('/api/projects', { clientName: 'Nu Retail', name: 'Shop refit', requirements: [{ category: 'Client', name: 'Client induction', source: 'client' }] })).body.id;
    const r = ((await con.state()).state.requirements[p] as { id: string }[])[0];
    assert.equal((await con.post(`/api/requirements/${r.id}/optional`, { optional: true })).status, 200);
  });
});

describe('choosing documents for the safety file PDF', () => {
  it('builds a labelled selection that records no revision, and a full file that does', async () => {
    const coid = await byName('Letter of Good Standing (COID)');
    const partial = await con.req('GET', `/api/sites/${fileId}/safety-file.pdf?only=&certificates=0`);
    assert.equal(partial.status, 200);
    assert.match(String(partial.raw.headers['content-disposition']), /selection\.pdf/);
    let revs = await pool.query('select count(*)::int as n from safety_file_versions where site_id = $1', [fileId]);
    assert.equal(revs.rows[0].n, 0, 'a selection is not a revision');
    const only = await con.req('GET', `/api/sites/${fileId}/safety-file.pdf?only=${coid.id}`);
    assert.equal(only.status, 200);
    const full = await con.req('GET', `/api/sites/${fileId}/safety-file.pdf`);
    assert.match(String(full.raw.headers['content-disposition']), /rev1\.pdf/);
    revs = await pool.query('select count(*)::int as n from safety_file_versions where site_id = $1', [fileId]);
    assert.equal(revs.rows[0].n, 1);
    assert.equal((await con.req('GET', `/api/sites/${fileId}/safety-file.pdf?only=not-an-id`)).status, 404);
    const a = await pool.query(`select 1 from audit_events where site_id = $1 and action = 'Compiled safety file (selected documents)'`, [fileId]);
    assert.ok(a.rows.length >= 1);
  });
});

describe('tools and equipment in risk assessments and method statements', () => {
  it('adds each ticked tool\'s hazards, checks and PPE, and refuses unknown tools', async () => {
    const { blueprintById } = await import('../src/lib/studio/blueprints.js');
    for (const id of ['risk-assessment', 'method-statement']) {
      const bp = blueprintById(id)!;
      const out = JSON.stringify(bp.build({ values: { scope: 'Replace roof sheeting', tools: 'Angle grinder; Ladder' }, company: { name: 'Mu' }, preparer: { name: 'T' } }));
      assert.match(out, /Disc shattering/, id);
      assert.match(out, /Falling from the ladder/, id);
      assert.match(out, /Guard fitted, disc rated/, id);
      assert.match(out, /Face shield over safety glasses/, id);
    }
    const bad = await con.post('/api/studio/documents', { blueprintId: 'risk-assessment', values: { scope: 'Roof', tools: 'Lightsaber' } });
    assert.equal(bad.status, 400);
    const ok = await con.post('/api/studio/documents', { blueprintId: 'risk-assessment', values: { scope: 'Roof', tools: 'Angle grinder; Scaffold / mobile scaffold tower' } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
  });
});

describe('safety file preview and arranging a project file', () => {
  it('previews without recording a revision, and lets the contractor reorder its own project', async () => {
    const before = (await pool.query('select count(*)::int as n from safety_file_versions where site_id = $1', [fileId])).rows[0].n;
    const pv = await con.req('GET', `/api/sites/${fileId}/safety-file.pdf?preview=1`);
    assert.equal(pv.status, 200);
    assert.match(String(pv.raw.headers['content-disposition']), /^inline;.*preview\.pdf/);
    assert.equal((await pool.query('select count(*)::int as n from safety_file_versions where site_id = $1', [fileId])).rows[0].n, before);

    const p = (await con.post('/api/projects', { clientName: 'Xi Retail', name: 'Store fit-out', requirements: [
      { category: 'Client', name: 'First', source: 'client' }, { category: 'Client', name: 'Second', source: 'client' },
    ] })).body.id;
    const ids = ((await con.state()).state.requirements[p] as { id: string }[]).map((r) => r.id);
    assert.equal((await con.post(`/api/projects/${p}/requirements/order`, { ids: [ids[0]] })).status, 400);
    assert.equal((await mine.post(`/api/projects/${p}/requirements/order`, { ids: [...ids].reverse() })).status, 403);
    assert.equal((await con.post(`/api/projects/${p}/requirements/order`, { ids: [...ids].reverse() })).status, 200);
    assert.deepEqual(((await con.state()).state.requirements[p] as { name: string }[]).map((r) => r.name), ['Second', 'First']);
  });
});
