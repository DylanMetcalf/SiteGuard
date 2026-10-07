/**
 * Who pays: a contractor's own plan or trial covers every safety file; a mine's
 * sponsorship covers only the contractor's file on that mine's site.
 */
import './billing-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, PDF, pool, setup, signup, teardown } from './helpers.js';

let app: FastifyInstance;
let mine: Agent, con: Agent, conOrg: string, mineOrg: string;
let fileId: string, projectId: string;

const endTrial = (orgId: string) => pool.query(`update organisations set trial_ends_at = now() - interval '1 day' where id = $1`, [orgId]);
const req = async (a: Agent, siteId: string, name: string) =>
  ((await a.state()).state.requirements[siteId] as { id: string; name: string }[]).find((r) => r.name === name)!;

before(async () => {
  app = await setup();
  mine = (await signup(app, { orgName: 'Sigma Mining', orgKind: 'host' })).agent;
  con = (await signup(app, { orgName: 'Tau Scaffolding', orgKind: 'contractor' })).agent;
  mineOrg = (await mine.state()).org.id;
  conOrg = (await con.state()).org.id;
  const w = await mine.post('/api/workplaces', { name: 'Sigma North', requirements: [{ category: 'Company Documents', name: 'Letter of Good Standing (COID)', source: 'legal' }] });
  fileId = (await con.post('/api/sites/join', { code: w.body.code })).body.siteId;
  projectId = (await con.post('/api/projects', { clientName: 'Upsilon Retail', name: 'Mall refit', requirements: [{ category: 'Client', name: 'Client induction', source: 'client' }] })).body.id;
});
after(teardown);

describe('contractor trial and site sponsorship', () => {
  it('a new contractor has the full product on trial, and the mine sponsors its file', async () => {
    const s = await con.state();
    assert.equal(s.org.ownAccess, true);
    assert.equal(s.state.sites[fileId].sponsored, true);
    assert.equal(s.state.sites[projectId].sponsored, false);
    assert.equal(s.org.entitlements.CONTRACTOR_PROJECTS, true);
  });

  it('after the trial, the sponsored file keeps working but own projects need a plan', async () => {
    await endTrial(conOrg);
    const s = await con.state();
    assert.equal(s.org.ownAccess, false);
    assert.equal(s.org.sponsored, true);
    assert.equal(s.org.standing, 'ok');
    assert.equal(s.org.entitlements.CONTRACTOR_PROJECTS, false);
    // The mine's file: upload and submit still work.
    const coid = await req(con, fileId, 'Letter of Good Standing (COID)');
    assert.equal((await con.upload(`/api/documents/${coid.id}/file`, 'coid.pdf', PDF)).status, 200);
    assert.equal((await con.post(`/api/documents/${coid.id}/submit`, { expiryDate: '2035-01-31' })).status, 200);
    // Its own project: readable and downloadable, but not changeable.
    const induction = await req(con, projectId, 'Client induction');
    const blocked = await con.upload(`/api/documents/${induction.id}/file`, 'induction.pdf', PDF);
    assert.equal(blocked.status, 402);
    assert.match(blocked.body.message, /own projects need a contractor plan/);
    assert.equal((await con.req('GET', `/api/sites/${projectId}/safety-file.pdf`)).status, 200);
    // A new project for another client needs its own plan.
    const p = await con.post('/api/projects', { clientName: 'Phi Construction', name: 'Warehouse' });
    assert.equal(p.status, 402);
    assert.match(p.body.message, /own contractor plan/);
  });

  it('stops covering the file when the mine itself lapses, or ends it', async () => {
    await endTrial(mineOrg);
    let s = await con.state();
    assert.equal(s.state.sites[fileId].sponsored, false);
    assert.equal(s.org.standing, 'lapsed');
    const coid = await req(con, fileId, 'Letter of Good Standing (COID)');
    const r = await con.upload(`/api/documents/${coid.id}/file`, 'coid.pdf', PDF);
    assert.equal(r.status, 402);
    assert.match(r.body.message, /no site is sponsoring you|isn't sponsoring this safety file/);
    // The mine pays again: the file is covered again.
    await pool.query(`update organisations set subscription_status = 'active' where id = $1`, [mineOrg]);
    s = await con.state();
    assert.equal(s.state.sites[fileId].sponsored, true);
  });

  it('a grant (promo or enterprise) gives a contractor its own access without a subscription', async () => {
    await pool.query(`update organisations set grant_plan = 'contractor_pro', grant_until = null, grant_source = 'test' where id = $1`, [conOrg]);
    const s = await con.state();
    assert.equal(s.org.ownAccess, true);
    assert.equal(s.org.grant.planName, 'Contractor Pro');
    const induction = await req(con, projectId, 'Client induction');
    assert.equal((await con.upload(`/api/documents/${induction.id}/file`, 'induction.pdf', PDF)).status, 200);
    await pool.query(`update organisations set grant_plan = null where id = $1`, [conOrg]);
  });

  it('lets only the mine end or resume sponsoring a file', async () => {
    assert.equal((await con.post(`/api/sites/${fileId}/sponsorship/end`, {})).status, 403);
    const other = (await signup(app, { orgName: 'Chi Mining', orgKind: 'host' })).agent;
    assert.equal((await other.post(`/api/sites/${fileId}/sponsorship/end`, {})).status, 404);
    assert.equal((await mine.post(`/api/sites/${fileId}/sponsorship/end`, { reason: 'Contract finished' })).status, 200);
    assert.equal((await con.state()).state.sites[fileId].sponsored, false);
    assert.equal((await mine.post(`/api/sites/${fileId}/sponsorship/end`, {})).status, 409);
    assert.equal((await mine.post(`/api/sites/${fileId}/sponsorship/resume`)).status, 200);
    assert.equal((await con.state()).state.sites[fileId].sponsored, true);
  });
});
