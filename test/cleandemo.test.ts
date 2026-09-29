/** Clean-start demo: empty mine and contractor, connected with a join code, kept for 30 days. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, pool, setup, teardown } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = await setup(); });
after(teardown);

describe('clean-start demo', () => {
  it('starts empty on both sides and connects them with a join code', async () => {
    const a = new Agent(app);
    const r = await a.post('/api/demo', { clean: true, hostName: 'Kathu Iron Ore', contractorName: 'Volt Electrical', yourName: 'Dylan Metcalf' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const host = await a.state();
    assert.equal(host.org.name, 'Kathu Iron Ore');
    assert.equal(host.org.kind, 'host');
    assert.equal(host.me.name, 'Dylan Metcalf');
    assert.equal(Object.keys(host.state.sites).length, 0);
    assert.equal(host.personas.length, 2);

    const s = await a.post('/api/sites', { name: 'Plant 2 Conveyor', location: 'Kathu', newContractor: { name: 'Volt Electrical', email: 'volt@example.com' }, templatePackIds: ['baseline'] });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    const code = (await a.post(`/api/sites/${s.body.id}/join-code`)).body.code;
    const contractorPersona = host.personas.find((p: { label: string }) => p.label.includes('Volt Electrical'));
    assert.equal((await a.post('/api/demo/switch', { userId: contractorPersona.userId })).status, 200);
    const c = await a.state();
    assert.equal(c.org.kind, 'contractor');
    assert.equal(Object.keys(c.state.sites).length, 0);
    assert.equal((await a.post('/api/sites/join', { code })).status, 200);
    assert.equal((await a.state()).state.sites[s.body.id].name, 'Plant 2 Conveyor');
  });

  it('is kept for 30 days, unlike the sample sandbox', async () => {
    const { purgeOldDemos } = await import('../src/routes/demo.js');
    const group = (await pool.query(`select demo_group from organisations where settings->>'cleanDemo' = 'true' order by created_at desc limit 1`)).rows[0].demo_group;
    await pool.query(`update organisations set created_at = now() - interval '10 days' where demo_group = $1`, [group]);
    await purgeOldDemos();
    assert.equal((await pool.query(`select count(*)::int as n from organisations where demo_group = $1`, [group])).rows[0].n, 2);
    await pool.query(`update organisations set created_at = now() - interval '31 days' where demo_group = $1`, [group]);
    await purgeOldDemos();
    assert.equal((await pool.query(`select count(*)::int as n from organisations where demo_group = $1`, [group])).rows[0].n, 0);
  });
});
