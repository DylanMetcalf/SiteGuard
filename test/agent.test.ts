/** The compliance agent: what it finds, that findings resolve themselves, and that they stay in their tenant. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, lastEmailToken, PDF, pool, setup, signup, teardown, uniqueEmail } from './helpers.js';
import { runAgent, sendWeeklySummaries } from '../src/lib/agent.js';

let app: FastifyInstance;
let host: Agent;
let contractor: Agent;
let bystander: Agent;
let siteId: string;
let reqIds: string[];

const findings = async (a: Agent) => (await a.post('/api/agent/run')).body.findings as { title: string; severity: string; siteId: string | null; action: any }[];
const has = (fs: { title: string }[], re: RegExp) => fs.some((f) => re.test(f.title));

before(async () => {
  app = await setup();
  host = (await signup(app, { orgName: 'Zeta Mining', orgKind: 'host' })).agent;
  contractor = (await signup(app, { orgName: 'Bolt Electrical', orgKind: 'contractor' })).agent;
  bystander = (await signup(app, { orgName: 'Other Mine', orgKind: 'host' })).agent;
});
after(teardown);

describe('compliance agent', () => {
  it('flags a site with no requirements, then clears it once packs are added', async () => {
    const email = uniqueEmail('bolt');
    siteId = (await host.post('/api/sites', { name: 'Vent Shaft 2', newContractor: { name: 'Bolt Electrical', email } })).body.id;
    assert.ok(has(await findings(host), /Vent Shaft 2 has no required documents/));
    await host.post(`/api/sites/${siteId}/requirements/apply-packs`, { packIds: ['baseline'] });
    assert.ok(!has(await findings(host), /no required documents/));

    const token = await lastEmailToken(email, '/site-invite');
    assert.equal((await contractor.post(`/api/auth/site-invite/${token}/accept`)).status, 200);
  });

  it('tells the contractor what is missing and the host what is waiting for review', async () => {
    const c = await findings(contractor);
    assert.ok(has(c, /14 documents still needed for Vent Shaft 2/), JSON.stringify(c));
    const f = c.find((x) => /still needed/.test(x.title))!;
    assert.deepEqual(f.action, { kind: 'site', siteId, tab: 'compliance' });

    const state = await host.state();
    reqIds = state.state.requirements[siteId].map((r: { id: string }) => r.id);
    await contractor.upload(`/api/documents/${reqIds[0]}/file`, 'coid.pdf', PDF);
    await contractor.post(`/api/documents/${reqIds[0]}/submit`, { expiryDate: '2099-12-31' });
    // Fresh submissions aren't nagged about; ones waiting more than two days are.
    assert.ok(!has(await findings(host), /waiting for your review/));
    await pool.query(`update documents set updated_at = now() - interval '6 days' where requirement_id = $1`, [reqIds[0]]);
    const h = await findings(host);
    const review = h.find((x) => /waiting for your review on Vent Shaft 2/.test(x.title));
    assert.equal(review?.severity, 'high');
  });

  it('flags expired documents on both sides and resolves once renewed', async () => {
    await host.post(`/api/documents/${reqIds[0]}/approve`, {});
    await pool.query(`update documents set expiry_date = current_date - 3 where requirement_id = $1`, [reqIds[0]]);
    assert.ok(has(await findings(host), /1 document expired on Vent Shaft 2/));
    assert.ok(has(await findings(contractor), /1 document expired on Vent Shaft 2/));
    await pool.query(`update documents set expiry_date = '2099-12-31' where requirement_id = $1`, [reqIds[0]]);
    assert.ok(!has(await findings(host), /expired on/));
  });

  it('flags a serious open incident for both parties', async () => {
    await contractor.post(`/api/sites/${siteId}/incidents`, { type: 'lost_time', date: new Date().toISOString().slice(0, 10), description: 'Hand injury', person: 'J. Doe' });
    const h = await findings(host);
    assert.equal(h.find((x) => /Serious incident/.test(x.title))?.severity, 'high');
    assert.ok(has(await findings(contractor), /Serious incident still open on Vent Shaft 2/));
  });

  it('keeps findings inside the tenant and exposes them in bootstrap', async () => {
    const other = await findings(bystander);
    assert.ok(!other.some((f) => f.siteId === siteId));
    const boot = await host.state();
    assert.ok(boot.agent.lastRunAt);
    assert.ok(boot.agent.findings.length > 0);
    assert.equal(boot.agent.findings[0].severity, 'high');
  });

  it('runs across every organisation from the background job', async () => {
    await pool.query('delete from agent_findings');
    const n = await runAgent();
    assert.ok(n >= 3);
    const r = await pool.query(`select count(*)::int as n from agent_findings where resolved_at is null`);
    assert.ok(r.rows[0].n > 0);
  });

  it('emails owners a Monday summary once a week, and respects the setting', async () => {
    const tuesday = new Date('2026-09-29T08:00:00Z');
    assert.equal(await sendWeeklySummaries(tuesday), 0);
    const monday = new Date('2026-09-28T06:30:00Z'); // 08:30 in South Africa
    assert.ok((await sendWeeklySummaries(monday)) >= 3);
    await sendWeeklySummaries(monday); // a second run in the same week sends nothing new
    const mails = await pool.query(`select subject from email_outbox where dedupe_key like 'weekly:%'`);
    const zeta = mails.rows.filter((m: { subject: string }) => /to action/.test(m.subject));
    assert.ok(zeta.length >= 1);
    const before = mails.rowCount;
    await bystander.req('PATCH', '/api/org/settings', { weeklySummary: false });
    await sendWeeklySummaries(new Date('2026-10-05T06:30:00Z'));
    const after = await pool.query(`select count(*)::int as n from email_outbox where dedupe_key like 'weekly:%'`);
    assert.equal(after.rows[0].n, (before ?? 0) + 2); // next week: Zeta and Bolt, not the opted-out bystander
  });
});
