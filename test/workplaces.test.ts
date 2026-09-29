/** One site, many contractors: the mine shares a site code, each contractor gets its own safety file. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { setup, signup, teardown, type Agent } from './helpers.js';

let app: FastifyInstance;
let mine: Agent, other: Agent, volt: Agent, steel: Agent, late: Agent;
let wid: string, code: string;

before(async () => {
  app = await setup();
  mine = (await signup(app, { orgName: 'Sishen Iron Ore', orgKind: 'host' })).agent;
  other = (await signup(app, { orgName: 'Other Mine', orgKind: 'host' })).agent;
  volt = (await signup(app, { orgName: 'Volt Electrical', orgKind: 'contractor' })).agent;
  steel = (await signup(app, { orgName: 'SteelWorks', orgKind: 'contractor' })).agent;
  late = (await signup(app, { orgName: 'Late Civils', orgKind: 'contractor' })).agent;
});
after(teardown);

describe('sites contractors join with a site code', () => {
  it('lets the mine create a site with a general safety file and a code', async () => {
    assert.equal((await volt.post('/api/workplaces', { name: 'x' })).status, 403);
    const r = await mine.post('/api/workplaces', { name: 'Plant 2', location: 'Sishen', packIds: ['general-mine'], emergency: { musterPoint: 'Gate 3' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.ok(r.body.requirements >= 25);
    wid = r.body.id; code = r.body.code;
    const w = (await mine.state()).state.workplaces[wid];
    assert.equal(w.code, code);
    assert.equal((await other.state()).state.workplaces[wid], undefined, 'other mines never see it');
  });

  it('gives every contractor that joins its own safety file for the site', async () => {
    const a = await volt.post('/api/sites/join', { code: code.toLowerCase().replace('-', ' ') });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const b = await steel.post('/api/sites/join', { code });
    assert.equal(b.status, 200);
    assert.notEqual(a.body.siteId, b.body.siteId);
    const again = await volt.post('/api/sites/join', { code });
    assert.equal(again.body.siteId, a.body.siteId);
    assert.equal(again.body.already, true);
    const vs = await volt.state();
    assert.equal(vs.state.sites[a.body.siteId].name, 'Plant 2');
    assert.equal(vs.state.sites[a.body.siteId].emergency.musterPoint, 'Gate 3');
    assert.ok(vs.state.requirements[a.body.siteId].length >= 25);
    assert.equal(vs.state.sites[b.body.siteId], undefined, 'contractors never see each other\'s files');
    const ms = await mine.state();
    const files = Object.values(ms.state.sites).filter((s: any) => s.workplaceId === wid);
    assert.equal(files.length, 2);
    assert.ok(ms.inbox.items.some((n: { title: string }) => /Volt Electrical joined Plant 2/.test(n.title)));
    assert.equal((await other.post('/api/sites/join', { code })).status, 403, 'mines join nothing');
  });

  it('adds new requirements to every contractor\'s file', async () => {
    const r = await mine.post(`/api/workplaces/${wid}/requirements`, { requirements: [{ category: 'Site-Specific', name: 'Blasting exclusion zone acknowledgement', source: 'site', why: 'Blasting daily at 13:00.' }] });
    assert.equal(r.status, 200);
    assert.equal(r.body.contractorsUpdated, 2);
    const vs = await volt.state();
    const siteId = Object.keys(vs.state.sites)[0];
    assert.ok(vs.state.requirements[siteId].some((q: { name: string }) => q.name === 'Blasting exclusion zone acknowledgement'));
    assert.equal((await other.post(`/api/workplaces/${wid}/requirements`, { requirements: [] })).status, 404);
  });

  it('can close the site to new contractors and replace the code', async () => {
    assert.equal((await mine.patch(`/api/workplaces/${wid}`, { joinOpen: false })).status, 200);
    assert.equal((await late.post('/api/sites/join', { code })).status, 403);
    const n = await mine.post(`/api/workplaces/${wid}/code`);
    assert.equal(n.status, 200);
    assert.equal((await late.post('/api/sites/join', { code })).status, 404, 'old code stops working');
    assert.equal((await late.post('/api/sites/join', { code: n.body.code })).status, 403, 'a new code does not reopen a closed site');
    assert.equal((await mine.patch(`/api/workplaces/${wid}`, { joinOpen: true })).status, 200);
    assert.equal((await late.post('/api/sites/join', { code: n.body.code })).status, 200);
  });
});
