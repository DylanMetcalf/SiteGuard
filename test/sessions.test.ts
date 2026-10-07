/** Session types on one attendance register; a signed site induction counts at the gate. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, pool, setup, signup, teardown } from './helpers.js';

let app: FastifyInstance;
let mine: Agent, con: Agent;
let fileA: string, fileB: string, workerId: string;
const iso = (days: number) => new Date(Date.now() + days * 86400e3).toISOString().slice(0, 10);
const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

before(async () => {
  app = await setup();
  mine = (await signup(app, { orgName: 'Rho Mining', orgKind: 'host' })).agent;
  con = (await signup(app, { orgName: 'Sigma Rigging', orgKind: 'contractor' })).agent;
  const a = await mine.post('/api/workplaces', { name: 'Shaft A', requirements: [] });
  const b = await mine.post('/api/workplaces', { name: 'Shaft B', requirements: [] });
  fileA = (await con.post('/api/sites/join', { code: a.body.code })).body.siteId;
  fileB = (await con.post('/api/sites/join', { code: b.body.code })).body.siteId;
  workerId = (await con.post('/api/workers', { fullName: 'Tumi Dube', occupation: 'Rigger', idLast4: '5678' })).body.id;
  await con.post(`/api/workers/${workerId}/certificates`, { kind: 'medical_fitness', name: 'Certificate of fitness', issuedOn: iso(-20), expiresOn: iso(300) });
  for (const f of [fileA, fileB]) await con.post(`/api/sites/${f}/workers`, { workerId });
  await pool.query(`update sites set status = 'site_ready' where id = any($1::uuid[])`, [[fileA, fileB]]);
});
after(teardown);

const gate = async (siteId: string) => (await mine.get(`/api/sites/${siteId}/gate`)).body.workers[0];

describe('sessions and site inductions', () => {
  it('records sessions of each type with a duration', async () => {
    const t = await con.post(`/api/sites/${fileA}/toolbox-talks`, { topic: 'Working at heights', kind: 'awareness', durationMinutes: 30 });
    assert.equal(t.status, 200, JSON.stringify(t.body));
    const s = (await con.state()).state.toolboxTalks[fileA].find((x: { id: string }) => x.id === t.body.id);
    assert.equal(s.kind, 'awareness');
    assert.equal(s.durationMinutes, 30);
    assert.equal((await con.post(`/api/sites/${fileA}/toolbox-talks`, { topic: 'x', kind: 'party' })).status, 400);
  });

  it('clears the gate once the worker signs the site\'s induction, for that site only', async () => {
    assert.ok((await gate(fileA)).reasons.includes('No site induction on record'));
    const ind = await mine.post(`/api/sites/${fileA}/toolbox-talks`, { topic: 'Shaft A site induction', kind: 'induction' });
    assert.equal(ind.status, 200, JSON.stringify(ind.body));
    assert.equal((await mine.post(`/api/toolbox-talks/${ind.body.id}/attendance`, { attendeeName: 'Tumi Dube', workerId, signature: SIG })).status, 200);
    assert.equal((await gate(fileA)).cleared, true, JSON.stringify((await gate(fileA)).reasons));
    assert.equal((await gate(fileB)).cleared, false, 'an induction at Shaft A says nothing about Shaft B');
  });

  it('follows the mine\'s induction validity rule', async () => {
    await mine.req('PUT', '/api/org/validity-rules', { induction: 12 });
    await pool.query(`update toolbox_talks set held_on = current_date - 400 where site_id = $1 and kind = 'induction'`, [fileA]);
    const g = await gate(fileA);
    assert.equal(g.cleared, false);
    assert.ok(g.reasons.some((r: string) => /Induction expired/.test(r)), JSON.stringify(g.reasons));
  });
});

describe('session detail: time, work, tools, scheduling', () => {
  it('adds the hazards of the tools in use, and a scheduled session is signed on the day', async () => {
    const { agent: c } = await signup(app, { orgName: 'Lambda Electrical', orgKind: 'contractor' });
    const p = (await c.post('/api/projects', { clientName: 'Mu Retail', name: 'Shop wiring' })).body.id;
    const bad = await c.post(`/api/sites/${p}/toolbox-talks`, { topic: 'Grinding', tools: ['Lightsaber'] });
    assert.equal(bad.status, 400);
    const r = await c.post(`/api/sites/${p}/toolbox-talks`, { topic: 'Cutting conduit', startTime: '07:30', workType: 'Electrical work', tools: ['Angle grinder'] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const talk = ((await c.state()).state.toolboxTalks[p] as { id: string; content: string; startTime: string; tools: string[] }[]).find((t) => t.id === r.body.id)!;
    assert.equal(talk.startTime, '07:30');
    assert.deepEqual(talk.tools, ['Angle grinder']);
    assert.match(talk.content, /Disc shattering/);
    const later = await c.post(`/api/sites/${p}/toolbox-talks`, { topic: 'Site induction', kind: 'induction', heldOn: '2099-01-01' });
    const sig = 'data:image/png;base64,iVBORw0KGgo=';
    const signEarly = await c.post(`/api/toolbox-talks/${later.body.id}/attendance`, { attendeeName: 'Thabo', signature: sig });
    assert.equal(signEarly.status, 409);
  });
});
