/** The mine's oversight tools: gate clearance, monthly audits and findings, validity rules, suspension. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, PDF, pool, setup, signup, teardown } from './helpers.js';

let app: FastifyInstance;
let mine: Agent, otherMine: Agent, con: Agent, otherCon: Agent;
let wid: string, fileId: string, contractorId: string, workerId: string, token: string;
const iso = (days: number) => new Date(Date.now() + days * 86400e3).toISOString().slice(0, 10);

before(async () => {
  app = await setup();
  mine = (await signup(app, { orgName: 'Omega Mining', orgKind: 'host' })).agent;
  otherMine = (await signup(app, { orgName: 'Sigma Mining', orgKind: 'host' })).agent;
  con = (await signup(app, { orgName: 'Kappa Civils', orgKind: 'contractor' })).agent;
  otherCon = (await signup(app, { orgName: 'Lambda Rigging', orgKind: 'contractor' })).agent;
  const w = await mine.post('/api/workplaces', { name: 'Shaft 4', requirements: [{ category: 'Company Documents', name: 'Letter of Good Standing (COID)', source: 'legal', why: '' }] });
  wid = w.body.id;
  fileId = (await con.post('/api/sites/join', { code: w.body.code })).body.siteId;
  contractorId = (await pool.query('select contractor_id from sites where id = $1', [fileId])).rows[0].contractor_id;
  workerId = (await con.post('/api/workers', { fullName: 'Sipho Nkosi', occupation: 'Rigger', idLast4: '1234' })).body.id;
  await con.post(`/api/sites/${fileId}/workers`, { workerId });
});
after(teardown);

const gateOf = async (agent: Agent = mine) => (await agent.get(`/api/sites/${fileId}/gate`)).body.workers.find((x: { workerId: string }) => x.workerId === workerId);

describe('validity rules', () => {
  it('only the mine sets them, and they cap a COID letter at submission', async () => {
    assert.equal((await con.req('PUT', '/api/org/validity-rules', { goodStanding: 3 })).status, 403);
    const r = await mine.req('PUT', '/api/org/validity-rules', { medical: 12, induction: 12, goodStanding: 3, insurance: null });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.rules, { medical: 12, induction: 12, goodStanding: 3 });
    assert.equal((await mine.req('PUT', '/api/org/validity-rules', { medical: 99 })).status, 400);
    assert.deepEqual((await mine.state()).org.validityRules, { medical: 12, induction: 12, goodStanding: 3 });

    const reqId = (await con.state()).state.requirements[fileId][0].id;
    await con.upload(`/api/documents/${reqId}/file`, 'coid.pdf', PDF);
    const s = await con.post(`/api/documents/${reqId}/submit`, { expiryDate: '2035-01-31' });
    assert.equal(s.status, 200, JSON.stringify(s.body));
    assert.ok(s.body.expiryDate <= iso(93) && s.body.expiryDate >= iso(88), `capped to about 3 months, got ${s.body.expiryDate}`);
    assert.match(s.body.ruleNote, /3-month rule/);
  });
});

describe('gate clearance', () => {
  it('explains why a worker is not cleared', async () => {
    const g = await gateOf();
    assert.equal(g.cleared, false);
    assert.ok(g.reasons.some((r: string) => /isn't approved yet/.test(r)));
    assert.ok(g.reasons.some((r: string) => /No certificate of fitness/.test(r)));
    assert.ok(g.reasons.includes('Not inducted'));
    assert.match(g.token, /^[A-Za-z0-9_-]{24}$/);
    token = g.token;
  });

  it('clears the worker once the file is Site Ready and medical and induction are valid under the mine\'s rules', async () => {
    const reqId = (await con.state()).state.requirements[fileId][0].id;
    assert.equal((await mine.post(`/api/documents/${reqId}/approve`)).status, 200);
    assert.equal((await mine.post(`/api/sites/${fileId}/approve`)).status, 200);
    // Medical issued 13 months ago with a long printed expiry: the mine's 12-month rule wins.
    await con.post(`/api/workers/${workerId}/certificates`, { kind: 'medical_fitness', name: 'Certificate of fitness', issuedOn: iso(-400), expiresOn: iso(700) });
    await con.post(`/api/workers/${workerId}/certificates`, { kind: 'induction', name: 'Shaft 4 induction', issuedOn: iso(-10) });
    let g = await gateOf();
    assert.equal(g.cleared, false);
    assert.ok(g.reasons.some((r: string) => /Medical expired/.test(r)), JSON.stringify(g.reasons));
    await con.post(`/api/workers/${workerId}/certificates`, { kind: 'medical_fitness', name: 'Certificate of fitness', issuedOn: iso(-30), expiresOn: iso(700) });
    g = await gateOf();
    assert.equal(g.cleared, true, JSON.stringify(g.reasons));
    assert.ok(g.until <= iso(340), `medical lapses 12 months from issue, got ${g.until}`);
    assert.equal((await gateOf(con)).cleared, true, 'the contractor sees the same answer');
  });

  it('shows a public gate page for the QR, without login', async () => {
    const page = await new Agent(app).req('GET', `/gate/${token}`);
    assert.equal(page.status, 200);
    assert.match(page.raw.body, /CLEARED/);
    assert.match(page.raw.body, /Sipho Nkosi/);
    assert.doesNotMatch(page.raw.body, /1234/, 'no ID digits on the public page');
    assert.equal((await new Agent(app).req('GET', '/gate/not-a-real-token-at-all-xx')).status, 404);
    const qr = await mine.req('GET', `/api/sites/${fileId}/gate/${workerId}/qr.svg`);
    assert.equal(qr.status, 200);
    assert.match(qr.raw.body, /^<svg/);
    const wg = await mine.get(`/api/workplaces/${wid}/gate`);
    assert.equal(wg.status, 200);
    assert.equal(wg.body.workers.length, 1);
  });

  it('keeps gate lists inside the tenant', async () => {
    assert.equal((await otherMine.get(`/api/sites/${fileId}/gate`)).status, 404);
    assert.equal((await otherCon.get(`/api/sites/${fileId}/gate`)).status, 404);
    assert.equal((await otherMine.get(`/api/workplaces/${wid}/gate`)).status, 404);
    assert.equal((await con.get(`/api/workplaces/${wid}/gate`)).status, 404);
    assert.equal((await otherMine.req('GET', `/api/sites/${fileId}/gate/${workerId}/qr.svg`)).status, 404);
  });
});

describe('monthly audits', () => {
  let findingId: string;
  it('scores the checklist and turns every "no" into a finding the contractor must answer', async () => {
    const items = [
      { text: 'Correct PPE worn by everyone', result: 'yes' },
      { text: 'Fire extinguishers present and in date', result: 'no', note: 'Extinguisher at the workshop expired in May' },
      { text: 'Permits to work displayed', result: 'na' },
      { text: 'Competent supervisor present', result: 'yes' },
    ];
    assert.equal((await con.post(`/api/sites/${fileId}/audits`, { items })).status, 403, 'contractors do not audit themselves');
    assert.equal((await otherMine.post(`/api/sites/${fileId}/audits`, { items })).status, 404);
    assert.equal((await mine.post(`/api/sites/${fileId}/audits`, { items: [{ text: 'PPE', result: 'no' }] })).status, 400, 'a "no" needs a note');
    const a = await mine.post(`/api/sites/${fileId}/audits`, { items, summary: 'Good crew, one fire safety gap.' });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(a.body.score, 67);
    assert.equal(a.body.findings, 1);
    const cs = await con.state();
    const audit = cs.state.audits[fileId][0];
    assert.equal(audit.score, 67);
    findingId = audit.findings[0].id;
    assert.equal(audit.findings[0].status, 'open');
    assert.equal(audit.findings[0].dueOn, iso(7));
    assert.ok(cs.inbox.items.some((n: { title: string }) => /Site audit: 67% at Shaft 4/.test(n.title)));
    assert.ok((await con.post('/api/agent/run')).body.findings.some((f: { title: string }) => /audit finding to fix on Shaft 4/.test(f.title)), 'the contractor\'s to-do list shows it');
    assert.equal((await otherCon.state()).state.audits?.[fileId], undefined);
  });

  it('runs the finding to closure: respond, reopen, respond, close', async () => {
    assert.equal((await mine.post(`/api/findings/${findingId}/respond`, { note: 'x' })).status, 403);
    assert.equal((await mine.post(`/api/findings/${findingId}/reopen`, { note: 'Not fixed' })).status, 409, 'only a responded finding reopens');
    assert.equal((await con.post(`/api/findings/${findingId}/respond`, { note: 'Replaced, see photo' })).status, 200);
    assert.ok((await mine.state()).inbox.items.some((n: { title: string }) => /Finding fixed\? Kappa Civils/.test(n.title)));
    assert.equal((await mine.post(`/api/findings/${findingId}/reopen`, { note: 'Tag not signed' })).status, 200);
    assert.equal((await con.post(`/api/findings/${findingId}/respond`, { note: 'Tag signed by service provider' })).status, 200);
    assert.equal((await con.post(`/api/findings/${findingId}/close`)).status, 403);
    assert.equal((await otherMine.post(`/api/findings/${findingId}/close`)).status, 404);
    assert.equal((await mine.post(`/api/findings/${findingId}/close`)).status, 200);
    const f = (await mine.state()).state.audits[fileId][0].findings[0];
    assert.equal(f.status, 'closed');
    assert.match(f.response, /Reopened by .*Tag not signed/);
  });

  it('reminds the mine when an audit is overdue', async () => {
    await pool.query(`update contractor_audits set audited_on = current_date - 40 where site_id = $1`, [fileId]);
    const items = (await mine.post('/api/agent/run')).body.findings as { siteId: string; title: string }[];
    assert.ok(items.some((f) => f.siteId === fileId && /due a site audit/.test(f.title)));
  });
});

describe('suspension', () => {
  it('needs a reason and only a mine admin can do it', async () => {
    assert.equal((await con.post(`/api/contractors/${contractorId}/suspend`, { reason: 'Unsafe' })).status, 403);
    assert.equal((await otherMine.post(`/api/contractors/${contractorId}/suspend`, { reason: 'Unsafe' })).status, 404);
    assert.equal((await mine.post(`/api/contractors/${contractorId}/suspend`, {})).status, 400);
  });

  it('withdraws Site Ready, blocks the gate, permits and approval, and tells the contractor', async () => {
    const r = await mine.post(`/api/contractors/${contractorId}/suspend`, { reason: 'Fatality investigation at Shaft 4' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const ms = await mine.state();
    assert.equal(ms.state.sites[fileId].status, 'in_progress');
    assert.match(ms.state.sites[fileId].suspended.reason, /Fatality/);
    const g = await gateOf();
    assert.equal(g.cleared, false);
    assert.ok(g.reasons.some((x: string) => /Company suspended by the site: Fatality/.test(x)));
    assert.match((await new Agent(app).req('GET', `/gate/${token}`)).raw.body, /NOT CLEARED/);
    assert.equal((await mine.post(`/api/sites/${fileId}/approve`)).status, 409);
    assert.equal((await con.post(`/api/sites/${fileId}/permits`, { type: 'hot_work', location: 'Workshop' })).status, 409);
    const cs = await con.state();
    assert.ok(cs.inbox.items.some((n: { title: string }) => /Suspended by Omega Mining/.test(n.title)));
    assert.ok((await con.post('/api/agent/run')).body.findings.some((f: { title: string }) => /Suspended by Omega Mining/.test(f.title)));
    assert.equal((await mine.post(`/api/contractors/${contractorId}/suspend`, { reason: 'Again' })).status, 409);
  });

  it('can be lifted; Site Ready then needs approving again', async () => {
    assert.equal((await mine.post(`/api/contractors/${contractorId}/unsuspend`)).status, 200);
    assert.equal((await mine.state()).state.sites[fileId].suspended, null);
    assert.equal((await mine.post(`/api/sites/${fileId}/approve`)).status, 200);
    assert.equal((await gateOf()).cleared, true);
    assert.equal((await mine.post(`/api/contractors/${contractorId}/unsuspend`)).status, 409);
  });
});
