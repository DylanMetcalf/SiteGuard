/** End-to-end compliance workflow and the rules the server enforces along the way. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, lastEmailToken, PASSWORD, PDF, pool, setup, signup, teardown, uniqueEmail } from './helpers.js';

let app: FastifyInstance;
let host: Agent;
let contractor: Agent;
let siteId: string;
let reqIds: string[];

before(async () => {
  app = await setup();
  host = (await signup(app, { orgName: 'Gamma Mining', orgKind: 'host' })).agent;
  contractor = (await signup(app, { orgName: 'Steel Co', orgKind: 'contractor' })).agent;
});
after(teardown);

describe('site lifecycle', () => {
  it('in-app invitation to an existing contractor org', async () => {
    // First site links the contractor via the emailed token…
    const email = uniqueEmail('steel');
    const r1 = await host.post('/api/sites', {
      name: 'Perimeter Upgrade',
      newContractor: { name: 'Steel Co', email },
      requirements: [
        { category: 'Company', name: 'COID letter', source: 'legal' },
        { category: 'Site', name: 'Risk assessment', source: 'site' },
      ],
    });
    siteId = r1.body.id;
    const token = await lastEmailToken(email, '/site-invite');
    assert.equal((await contractor.post(`/api/auth/site-invite/${token}/accept`)).status, 200);

    // …later sites for the same contractor appear in-app as pending invitations.
    const hostState = await host.state();
    const contractorId = hostState.state.sites[siteId].contractorId;
    const r2 = await host.post('/api/sites', { name: 'Smelter Reline', contractorId, templateSiteId: siteId });
    const cState = await contractor.state();
    const inv = Object.values(cState.state.invitations).find((i: any) => i.siteId === r2.body.id) as any;
    assert.ok(inv, 'pending invitation is visible in-app');
    assert.deepEqual(cState.state.requirements[r2.body.id], [], 'requirements hidden until accepted');
    assert.equal((await contractor.post(`/api/invitations/${inv.id}/decline`)).status, 200);
    const hs = await host.state();
    assert.equal(hs.state.sites[r2.body.id].status, 'declined');
    reqIds = hs.state.requirements[siteId].map((x: any) => x.id);
  });

  it('document review loop with versioning', async () => {
    await contractor.upload(`/api/documents/${reqIds[0]}/file`, 'coid.pdf', PDF);
    assert.equal((await contractor.post(`/api/documents/${reqIds[0]}/submit`, { expiryDate: '2099-12-31' })).status, 200);
    assert.equal((await host.post(`/api/documents/${reqIds[0]}/correction`, { text: 'Wrong entity name' })).status, 200);
    let st = await contractor.state();
    assert.equal(st.state.documents[reqIds[0]].status, 'correction_required');
    assert.equal(st.state.reviews[reqIds[0]][0].text, 'Wrong entity name');

    await contractor.upload(`/api/documents/${reqIds[0]}/file`, 'coid-v2.pdf', PDF);
    const r = await contractor.post(`/api/documents/${reqIds[0]}/submit`, { expiryDate: '2099-12-31' });
    assert.equal(r.body.version, 'v1.1');
    assert.equal((await host.post(`/api/documents/${reqIds[0]}/approve`)).status, 200);
    st = await host.state();
    assert.equal(st.state.documents[reqIds[0]].status, 'complete');
    assert.equal(st.state.documents[reqIds[0]].history.length, 1);
    // Correction emailed to the contractor.
    const mail = await pool.query(`select 1 from email_outbox where subject like 'Correction requested%'`);
    assert.ok(mail.rowCount);
  });

  it('cannot approve a site until every requirement is complete', async () => {
    const r = await host.post(`/api/sites/${siteId}/approve`);
    assert.equal(r.status, 409);
    await contractor.upload(`/api/documents/${reqIds[1]}/file`, 'ra.pdf', PDF);
    await contractor.post(`/api/documents/${reqIds[1]}/submit`, {});
    await host.post(`/api/documents/${reqIds[1]}/approve`);
  });

  it('an open lost-time injury blocks Site Ready until closed', async () => {
    const inc = await contractor.post(`/api/sites/${siteId}/incidents`, { type: 'lost_time', description: 'Hand injury at the fence line' });
    assert.equal(inc.status, 200);
    assert.equal((await host.post(`/api/sites/${siteId}/approve`)).status, 409);
    // Closing requires root cause and corrective actions.
    assert.equal((await host.patch(`/api/incidents/${inc.body.id}`, { close: true })).status, 400);
    assert.equal((await contractor.patch(`/api/incidents/${inc.body.id}`, { rootCause: 'x', correctiveActions: 'y', close: true })).status, 403);
    assert.equal((await host.patch(`/api/incidents/${inc.body.id}`, { rootCause: 'Unguarded post driver', correctiveActions: 'Guard fitted', close: true })).status, 200);
    const ok = await host.post(`/api/sites/${siteId}/approve`);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const verify = await app.inject({ method: 'GET', url: `/verify/${ok.body.verificationId}` });
    assert.equal(verify.statusCode, 200);
    assert.match(verify.body, /VERIFIED/);
  });

  it('permit to work: contractor requests, host issues, either closes', async () => {
    const p = await contractor.post(`/api/sites/${siteId}/permits`, { type: 'hot_work', location: 'Gate 2', description: 'Welding' });
    assert.equal(p.status, 200);
    assert.equal((await contractor.post(`/api/permits/${p.body.id}/issue`, { validTo: '2099-01-01T10:00' })).status, 403);
    assert.equal((await host.post(`/api/permits/${p.body.id}/issue`, {})).status, 400, 'must set an expiry');
    assert.equal((await host.post(`/api/permits/${p.body.id}/issue`, { validFrom: '2099-01-01T08:00', validTo: '2099-01-01T16:00' })).status, 200);
    assert.equal((await contractor.post(`/api/permits/${p.body.id}/close`, { notes: 'Done' })).status, 200);
  });

  it('defects: site logs, contractor resolves, site verifies', async () => {
    const i = await host.post(`/api/sites/${siteId}/inspections`, { title: 'Weekly walk' });
    const d = await host.post(`/api/inspections/${i.body.id}/defects`, { description: 'Missing guardrail', severity: 'high' });
    assert.equal((await host.post(`/api/defects/${d.body.id}/resolve`)).status, 403);
    assert.equal((await contractor.post(`/api/defects/${d.body.id}/resolve`)).status, 200);
    assert.equal((await contractor.post(`/api/defects/${d.body.id}/verify`)).status, 403);
    assert.equal((await host.post(`/api/defects/${d.body.id}/verify`)).status, 200);
    const st = await host.state();
    assert.equal(st.state.inspections[siteId][0].status, 'closed');
  });

  it('requests tied to a requirement are answered by submitting it', async () => {
    const r = await host.post(`/api/sites/${siteId}/requests`, { type: 'document', title: 'Renewed COID', linkedReqId: reqIds[0] });
    assert.equal(r.status, 200);
    await contractor.upload(`/api/documents/${reqIds[0]}/file`, 'coid-2.pdf', PDF);
    await contractor.post(`/api/documents/${reqIds[0]}/submit`, {});
    const st = await host.state();
    assert.equal(st.state.requests[r.body.id].status, 'submitted');
  });
});

describe('workforce', () => {
  it('host sees workers and certificates the contractor assigns to its site', async () => {
    const w = await contractor.post('/api/workers', { fullName: 'Themba Dlamini', occupation: 'Welder', idLast4: '4021' });
    assert.equal(w.status, 200);
    const up = await contractor.upload('/api/uploads', 'medical.pdf', PDF);
    await contractor.post(`/api/workers/${w.body.id}/certificates`, { kind: 'medical_fitness', name: 'Certificate of fitness', expiresOn: '2099-01-01', fileId: up.body.fileId });
    let hs = await host.state();
    assert.equal(hs.state.workers[w.body.id], undefined, 'not visible before assignment');
    assert.equal((await host.get(`/api/files/${up.body.fileId}`)).status, 404);
    await contractor.post(`/api/sites/${siteId}/workers`, { workerId: w.body.id });
    hs = await host.state();
    assert.equal(hs.state.workers[w.body.id].certificates[0].kind, 'medical_fitness');
    assert.equal((await host.get(`/api/files/${up.body.fileId}`)).status, 200);
    assert.equal((await host.post(`/api/sites/${siteId}/workers`, { workerId: w.body.id })).status, 403);
    assert.equal((await contractor.post('/api/workers', { fullName: 'X', idLast4: '8001015009087' })).status, 400, 'full ID numbers are not stored');
  });

  it('toolbox talk attendance with signatures', async () => {
    const t = await contractor.post(`/api/sites/${siteId}/toolbox-talks`, { topic: 'Hot work fire watch' });
    const sig = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
    assert.equal((await contractor.post(`/api/toolbox-talks/${t.body.id}/attendance`, { attendeeName: 'Themba', signature: sig })).status, 200);
    assert.equal((await contractor.post(`/api/toolbox-talks/${t.body.id}/attendance`, { attendeeName: 'X', signature: '<svg onload=alert(1)>' })).status, 400);
    const hs = await host.state();
    const talk = hs.state.toolboxTalks[siteId][0];
    assert.equal(talk.attendance.length, 1);
    const img = await host.get(talk.attendance[0].signatureUrl);
    assert.equal(img.raw.headers['content-type'], 'image/png');
  });

  it('appointments register is admin-only', async () => {
    const r = await contractor.post('/api/appointments', { siteId, appointeeName: 'Nomsa Zulu', appointmentType: 'Construction supervisor', legalReference: 'CR 8(7)', startDate: '2026-01-01' });
    assert.equal(r.status, 200);
    const hs = await host.state();
    assert.ok(hs.state.appointments.some((a: any) => a.id === r.body.id), 'site-linked appointment visible to host');
  });
});

describe('auth', () => {
  it('password reset signs out other sessions and logs in', async () => {
    const { agent, email } = await signup(app, { orgName: 'Delta', orgKind: 'host' });
    const other = new Agent(app);
    assert.equal((await other.post('/api/auth/login', { email, password: PASSWORD })).status, 200);
    assert.equal((await new Agent(app).post('/api/auth/forgot', { email })).status, 200);
    assert.equal((await new Agent(app).post('/api/auth/forgot', { email: 'nobody@example.com' })).status, 200, 'no account enumeration');
    const token = await lastEmailToken(email, '/reset-password');
    const fresh = new Agent(app);
    assert.equal((await fresh.post('/api/auth/reset', { token, password: 'a brand new passphrase' })).status, 200);
    assert.equal((await fresh.state()).authenticated, true);
    assert.equal((await agent.state()).authenticated, false, 'old sessions revoked');
    assert.equal((await fresh.post('/api/auth/reset', { token, password: 'another passphrase!' })).status, 400, 'single use');
  });

  it('wrong passwords are rejected and eventually lock the account', async () => {
    const { email } = await signup(app, { orgName: 'Epsilon', orgKind: 'host' });
    const a = new Agent(app);
    for (let i = 0; i < 10; i++) assert.equal((await a.post('/api/auth/login', { email, password: 'nope nope nope' })).status, 401);
    assert.equal((await a.post('/api/auth/login', { email, password: PASSWORD })).status, 423);
  });

  it('demo users cannot sign in with a password, and personas cannot reach real accounts', async () => {
    const demo = new Agent(app);
    assert.equal((await demo.post('/api/demo')).status, 200);
    const st = await demo.state();
    assert.equal(st.org.isDemo, true);
    assert.ok(st.personas.length >= 5);
    const contractorPersona = st.personas.find((p: any) => p.label.includes('ABC'));
    assert.equal((await demo.post('/api/demo/switch', { userId: contractorPersona.userId })).status, 200);
    assert.equal((await demo.state()).org.kind, 'contractor');
    const real = await host.state();
    assert.equal((await demo.post('/api/demo/switch', { userId: real.me.id })).status, 404);
    assert.equal((await new Agent(app).post('/api/auth/login', { email: st.me.email, password: PASSWORD })).status, 401);
    // Demo tenants are isolated from real ones.
    assert.ok(!Object.values(st.state.sites).some((s: any) => s.name === 'Perimeter Upgrade'));
  });
});

describe('audit trail and housekeeping', () => {
  it('audit events cannot be edited or deleted', async () => {
    await assert.rejects(pool.query(`update audit_events set detail = 'tampered'`), /append-only/);
    await assert.rejects(pool.query(`delete from audit_events`), /append-only/);
  });

  it('expired demo sandboxes are purged completely', async () => {
    const { purgeOldDemos } = await import('../src/routes/demo.js');
    const demo = new Agent(app);
    await demo.post('/api/demo');
    const group = (await pool.query(`select demo_group from organisations where is_demo order by created_at desc limit 1`)).rows[0].demo_group;
    await pool.query(`update organisations set created_at = now() - interval '10 days' where demo_group = $1`, [group]);
    assert.ok((await purgeOldDemos()) >= 1);
    assert.equal((await pool.query(`select count(*)::int as n from organisations where demo_group = $1`, [group])).rows[0].n, 0);
    assert.equal((await demo.state()).authenticated, false);
    const realAudit = (await pool.query(`select count(*)::int as n from audit_events a join organisations o on o.id = a.org_id where not o.is_demo`)).rows[0].n;
    assert.ok(realAudit > 0, 'real tenants keep their history');
  });
});

describe('requirement starter packs', () => {
  it('creates a site from packs without duplicate requirements', async () => {
    const packs = (await host.get('/api/requirement-templates')).body.packs;
    assert.ok(packs.find((p: any) => p.id === 'baseline'));
    const r = await host.post('/api/sites', { name: 'Pack Site', newContractor: { name: 'Pack Co' }, templatePackIds: ['baseline', 'electrical'] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const reqs = (await host.state()).state.requirements[r.body.id];
    const names = reqs.map((x: any) => x.name);
    assert.equal(new Set(names.map((n: string) => n.toLowerCase())).size, names.length, 'no duplicates');
    const expected = packs.filter((p: any) => ['baseline', 'electrical'].includes(p.id)).reduce((n: number, p: any) => n + p.items.length, 0);
    assert.equal(names.length, expected);
  });

  it('applies packs to an existing site, skipping what it already has', async () => {
    const r = await host.post('/api/sites', { name: 'Apply Site', newContractor: { name: 'Apply Co' }, requirements: [{ category: 'Company Documents', name: 'Letter of Good Standing (COID)', source: 'legal' }] });
    const first = await host.post(`/api/sites/${r.body.id}/requirements/apply-packs`, { packIds: ['baseline'] });
    assert.equal(first.status, 200);
    const again = await host.post(`/api/sites/${r.body.id}/requirements/apply-packs`, { packIds: ['baseline'] });
    assert.equal(again.body.added, 0, 'second apply adds nothing');
    const names = (await host.state()).state.requirements[r.body.id].map((x: any) => x.name);
    assert.equal(names.filter((n: string) => n === 'Letter of Good Standing (COID)').length, 1);
    assert.equal(first.body.added, names.length - 1);
  });

  it('only host admins can apply packs, and unknown packs are rejected', async () => {
    assert.equal((await contractor.post(`/api/sites/${siteId}/requirements/apply-packs`, { packIds: ['baseline'] })).status, 403);
    assert.equal((await host.post(`/api/sites/${siteId}/requirements/apply-packs`, { packIds: ['nope'] })).status, 400);
    assert.equal((await host.post(`/api/sites/${siteId}/requirements/apply-packs`, { packIds: [] })).status, 400);
  });
});
