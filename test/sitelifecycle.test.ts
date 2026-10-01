/** Mines can duplicate, archive, restore and (while unused) delete a site; contractors' files stay. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, setup, signup, teardown } from './helpers.js';

let app: FastifyInstance;
let mine: Agent, other: Agent, con: Agent;
let wid: string, code: string, fileId: string;

before(async () => {
  app = await setup();
  mine = (await signup(app, { orgName: 'Beta Mining', orgKind: 'host' })).agent;
  other = (await signup(app, { orgName: 'Gamma Mining', orgKind: 'host' })).agent;
  con = (await signup(app, { orgName: 'Delta Drilling', orgKind: 'contractor' })).agent;
  const w = await mine.post('/api/workplaces', { name: 'Beta East', location: 'Rustenburg', requirements: [{ category: 'Plans', name: 'Fall protection plan', source: 'site' }] });
  wid = w.body.id; code = w.body.code;
  fileId = (await con.post('/api/sites/join', { code })).body.siteId;
});
after(teardown);

describe('site lifecycle', () => {
  it('duplicates a site with its requirements and a new code', async () => {
    assert.equal((await other.post(`/api/workplaces/${wid}/duplicate`, { name: 'Copy' })).status, 404);
    assert.equal((await con.post(`/api/workplaces/${wid}/duplicate`, { name: 'Copy' })).status, 403);
    const r = await mine.post(`/api/workplaces/${wid}/duplicate`, { name: 'Beta West' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.notEqual(r.body.code, code);
    const copy = (await mine.state()).state.workplaces[r.body.id];
    assert.equal(copy.location, 'Rustenburg');
    assert.equal(copy.requirements[0].name, 'Fall protection plan');
  });

  it('won\'t delete a site contractors joined, but archives and restores it', async () => {
    assert.equal((await mine.post(`/api/workplaces/${wid}/delete`)).status, 409);
    assert.equal((await other.post(`/api/workplaces/${wid}/archive`)).status, 404);
    assert.equal((await mine.post(`/api/workplaces/${wid}/archive`)).status, 200);
    const w = (await mine.state()).state.workplaces[wid];
    assert.ok(w.archivedAt);
    assert.equal(w.joinOpen, false);
    // The contractor's file is still there, and new contractors can't join.
    assert.ok((await con.state()).state.sites[fileId]);
    const late = (await signup(app, { orgName: 'Epsilon Electrical', orgKind: 'contractor' })).agent;
    assert.equal((await late.post('/api/sites/join', { code })).status, 403);
    assert.equal((await mine.post(`/api/workplaces/${wid}/restore`)).status, 200);
    assert.equal((await mine.state()).state.workplaces[wid].archivedAt, null);
  });

  it('deletes a site nobody has joined', async () => {
    const w = await mine.post('/api/workplaces', { name: 'Mistake' });
    assert.equal((await mine.post(`/api/workplaces/${w.body.id}/delete`)).status, 200);
    assert.equal((await mine.state()).state.workplaces[w.body.id], undefined);
  });
});
