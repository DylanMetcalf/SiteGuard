/** Contractor projects: safety files a contractor builds for clients that aren't on SiteGuard. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, PDF, pool, setup, signup, teardown } from './helpers.js';

let app: FastifyInstance;
let con: Agent, other: Agent, mine: Agent;
let pid: string;

before(async () => {
  app = await setup();
  con = (await signup(app, { orgName: 'Delta Scaffolding', orgKind: 'contractor' })).agent;
  other = (await signup(app, { orgName: 'Epsilon Civils', orgKind: 'contractor' })).agent;
  mine = (await signup(app, { orgName: 'Zeta Mining', orgKind: 'host' })).agent;
});
after(teardown);

describe('contractor projects', () => {
  it('lets a contractor start a project for a client with a starter list', async () => {
    assert.equal((await mine.post('/api/projects', { clientName: 'X', name: 'Y' })).status, 403, 'mines create sites, not projects');
    const r = await con.post('/api/projects', { clientName: 'Acme Construction', clientContact: 'Jane Dube, jane@acme.example', name: 'Warehouse roof, Midrand', location: 'Midrand', packIds: ['baseline'] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.requirements > 5);
    pid = r.body.id;
    const s = (await con.state()).state.sites[pid];
    assert.equal(s.project, true);
    assert.equal(s.hostName, 'Acme Construction');
    assert.equal(s.status, 'in_progress');
    assert.equal(s.clientContact, 'Jane Dube, jane@acme.example');
  });

  it('keeps projects private to the contractor that made them', async () => {
    assert.equal((await other.state()).state.sites[pid], undefined);
    assert.equal((await mine.state()).state.sites[pid], undefined);
    assert.equal((await other.req('GET', `/api/sites/${pid}/safety-file.pdf`)).status, 404);
    assert.equal((await other.patch(`/api/projects/${pid}`, { name: 'Hijack' })).status, 404);
    assert.equal((await other.post(`/api/projects/${pid}/requirements`, { requirements: [{ category: 'X', name: 'Y', source: 'project' }] })).status, 404);
    assert.equal((await other.post(`/api/projects/${pid}/archive`)).status, 404);
    const client = await pool.query('select managed_by_org from organisations where name = $1', ['Acme Construction']);
    assert.equal(client.rows.length, 1);
    const members = await pool.query('select count(*)::int as n from memberships m join organisations o on o.id = m.org_id where o.name = $1', ['Acme Construction']);
    assert.equal(members.rows[0].n, 0, 'nobody can sign in to a client record');
  });

  it('files documents straight away, since nobody reviews a project in SiteGuard', async () => {
    const reqs = (await con.state()).state.requirements[pid] as { id: string; name: string }[];
    const target = reqs[0];
    await con.upload(`/api/documents/${target.id}/file`, 'doc.pdf', PDF);
    const s = await con.post(`/api/documents/${target.id}/submit`, { expiryDate: '2030-01-31' });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.equal(s.body.status, 'complete');
    const pdf = await con.req('GET', `/api/sites/${pid}/safety-file.pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.raw.headers['content-type'], 'application/pdf');
  });

  it('lets the contractor shape the requirement list', async () => {
    const add = await con.post(`/api/projects/${pid}/requirements`, { packIds: ['heights-lifting'], requirements: [{ category: 'Client', name: 'Acme induction video certificate', source: 'client', why: 'Acme asks for it.' }] });
    assert.equal(add.status, 200, JSON.stringify(add.body));
    assert.ok(add.body.added >= 2);
    assert.equal((await con.post(`/api/projects/${pid}/requirements`, { requirements: [{ category: 'Client', name: 'acme induction video certificate', source: 'client' }] })).status, 400, 'no duplicates');
    const reqs = (await con.state()).state.requirements[pid] as { id: string; name: string }[];
    const video = reqs.find((r) => r.name === 'Acme induction video certificate')!;
    assert.equal((await con.post(`/api/projects/${pid}/requirements/${video.id}/remove`)).status, 200);
    assert.equal((await con.post(`/api/projects/${pid}/requirements/${reqs[0].id}/remove`)).status, 409, 'a filed requirement stays');
  });

  it('renames, moves to another client record, and reuses client records by name', async () => {
    assert.equal((await con.patch(`/api/projects/${pid}`, { name: 'Warehouse roof phase 1', clientName: 'Acme Construction (Pty) Ltd' })).status, 200);
    const s = (await con.state()).state.sites[pid];
    assert.equal(s.name, 'Warehouse roof phase 1');
    assert.equal(s.hostName, 'Acme Construction (Pty) Ltd');
    const old = await pool.query('select 1 from organisations where name = $1', ['Acme Construction']);
    assert.equal(old.rows.length, 0, 'an empty client record is tidied away');
    const second = await con.post('/api/projects', { clientName: 'acme construction (pty) ltd', name: 'Office fit-out' });
    assert.equal(second.status, 200);
    const n = await pool.query(`select count(*)::int as n from organisations where lower(name) = 'acme construction (pty) ltd'`);
    assert.equal(n.rows[0].n, 1);
  });

  it('copies a requirement list from another of the contractor\'s files, and can be shared with the client', async () => {
    const copy = await con.post('/api/projects', { clientName: 'Beta Holdings', name: 'Plant room', copyFromSiteId: pid });
    assert.equal(copy.status, 200);
    assert.ok(copy.body.requirements >= 5);
    assert.equal((await other.post('/api/projects', { clientName: 'Z', name: 'Steal', copyFromSiteId: pid })).status, 404);
    const link = await con.post('/api/share-links', { siteId: pid, kind: 'safety_file', days: 7, label: 'Acme SHE manager' });
    assert.equal(link.status, 200, JSON.stringify(link.body));
    const page = await new Agent(app).req('GET', `/share/${link.body.url.split('/share/')[1]}`);
    assert.equal(page.status, 200);
    assert.match(page.raw.body, /Warehouse roof phase 1/);
  });

  it('shows the file\'s timeline to its owner only', async () => {
    const t = await con.get(`/api/sites/${pid}/timeline`);
    assert.equal(t.status, 200);
    assert.ok(t.body.events.some((e: { action: string }) => e.action === 'Created project'));
    assert.equal((await other.get(`/api/sites/${pid}/timeline`)).status, 404);
    assert.equal((await mine.get(`/api/sites/${pid}/timeline`)).status, 404);
  });

  it('archives a project out of the lists but keeps its history', async () => {
    assert.equal((await con.post(`/api/projects/${pid}/archive`)).status, 200);
    assert.equal((await con.state()).state.sites[pid], undefined);
    const a = await pool.query(`select action from audit_events where site_id = $1 order by id`, [pid]);
    assert.ok(a.rows.some((r) => r.action === 'Created project'));
    assert.ok(a.rows.some((r) => r.action === 'Archived project'));
  });
});

describe('project details from the security review', () => {
  let p2: string;
  it('lets the contractor close out an incident on its own project', async () => {
    p2 = (await con.post('/api/projects', { clientName: 'Gamma Retail', name: 'Store refit' })).body.id;
    const inc = await con.post(`/api/sites/${p2}/incidents`, { type: 'first_aid', description: 'Cut finger on sheet metal' });
    assert.equal(inc.status, 200, JSON.stringify(inc.body));
    assert.equal((await other.patch(`/api/incidents/${inc.body.id}`, { rootCause: 'x', correctiveActions: 'y', close: true })).status, 404);
    const close = await con.patch(`/api/incidents/${inc.body.id}`, { rootCause: 'No cut-resistant gloves', correctiveActions: 'Gloves issued; toolbox talk held', close: true });
    assert.equal(close.status, 200, JSON.stringify(close.body));
  });

  it('corrects the spelling of a client name in place', async () => {
    assert.equal((await con.patch(`/api/projects/${p2}`, { clientName: 'GAMMA Retail' })).status, 200);
    assert.equal((await con.state()).state.sites[p2].hostName, 'GAMMA Retail');
  });

  it('revokes links to the client when a project is archived', async () => {
    const link = await con.post('/api/share-links', { siteId: p2, kind: 'safety_file', days: 7 });
    const url = `/share/${link.body.url.split('/share/')[1]}`;
    assert.equal((await new Agent(app).req('GET', url)).status, 200);
    await con.post(`/api/projects/${p2}/archive`);
    assert.notEqual((await new Agent(app).req('GET', url)).status, 200);
  });
});
