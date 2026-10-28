/** Site templates: the mine's own forms, downloadable only by contractors with a file in that scope. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, PDF, setup, signup, teardown } from './helpers.js';

let app: FastifyInstance;
let mine: Agent, con: Agent, outsider: Agent, otherMine: Agent;
let wpId: string, fileId: string, t1: string;
const REQ = 'Site induction questionnaire';

before(async () => {
  app = await setup();
  mine = (await signup(app, { orgName: 'Alpha Chrome', orgKind: 'host' })).agent;
  con = (await signup(app, { orgName: 'Beta Welding', orgKind: 'contractor' })).agent;
  outsider = (await signup(app, { orgName: 'Gamma Haulage', orgKind: 'contractor' })).agent;
  otherMine = (await signup(app, { orgName: 'Delta Coal', orgKind: 'host' })).agent;
  const w = await mine.post('/api/workplaces', { name: 'Alpha East', requirements: [{ category: 'Site', name: REQ, source: 'site' }] });
  wpId = w.body.id;
  fileId = (await con.post('/api/sites/join', { code: w.body.code })).body.siteId;
});
after(teardown);

describe('site templates', () => {
  it('lets the mine attach its own form to a requirement for every contractor at the workplace', async () => {
    const r = await mine.upload(`/api/templates?workplaceId=${wpId}&requirement=${encodeURIComponent(REQ)}`, 'induction-form.pdf', PDF);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.version, 1);
    t1 = r.body.id;
    const s = await con.state();
    const t = s.state.templates[fileId].find((x: { requirementName: string }) => x.requirementName === REQ);
    assert.equal(t.filename, 'induction-form.pdf');
    assert.equal((await mine.state()).state.workplaces[wpId].templates.length, 1);
  });

  it('lets the contractor download it, and nobody outside the site', async () => {
    assert.equal((await con.req('GET', `/api/templates/${t1}/file`)).status, 200);
    assert.equal((await outsider.req('GET', `/api/templates/${t1}/file`)).status, 404);
    assert.equal((await otherMine.req('GET', `/api/templates/${t1}/file`)).status, 404);
  });

  it('only the mine\'s admins add templates, and only to their own workplaces', async () => {
    assert.equal((await con.upload(`/api/templates?workplaceId=${wpId}&requirement=x`, 'a.pdf', PDF)).status, 403);
    assert.equal((await otherMine.upload(`/api/templates?workplaceId=${wpId}&requirement=x`, 'a.pdf', PDF)).status, 404);
    assert.equal((await otherMine.req('GET', `/api/templates?workplaceId=${wpId}`)).body.templates?.length ?? 0, 0);
  });

  it('keeps earlier versions for the mine when a template is replaced', async () => {
    const r = await mine.upload(`/api/templates?workplaceId=${wpId}&requirement=${encodeURIComponent(REQ)}`, 'induction-form-v2.pdf', PDF);
    assert.equal(r.body.version, 2);
    const all = (await mine.get(`/api/templates?workplaceId=${wpId}`)).body.templates;
    assert.equal(all.length, 2);
    assert.equal(all.filter((t: { current: boolean }) => t.current).length, 1);
    // The contractor gets the current version only.
    assert.equal((await con.req('GET', `/api/templates/${t1}/file`)).status, 404);
    assert.equal((await con.req('GET', `/api/templates/${r.body.id}/file`)).status, 200);
    assert.equal((await mine.req('GET', `/api/templates/${t1}/file`)).status, 200);
  });

  it('removing a template hides it from contractors', async () => {
    const cur = (await mine.get(`/api/templates?workplaceId=${wpId}`)).body.templates.find((t: { current: boolean }) => t.current);
    assert.equal((await con.post(`/api/templates/${cur.id}/archive`)).status, 403);
    assert.equal((await mine.post(`/api/templates/${cur.id}/archive`)).status, 200);
    assert.equal((await con.state()).state.templates[fileId].length, 0);
  });
});
