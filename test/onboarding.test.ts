/**
 * Email confirmation, guided set-up and the document store. Every gate is tried through the API directly,
 * not just the page, and every document is tried from another organisation.
 */
import './support/verify-env.js';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, PASSWORD, PDF, lastEmailToken, pool, setup, signup, teardown, uniqueEmail } from './helpers.js';

let app: FastifyInstance;
const upload = (a: Agent, url: string, meta: Record<string, unknown>, filename = 'policy.pdf', content: Buffer = PDF, type = 'application/pdf') => {
  const b = '----ob' + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(meta)}\r\n`),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`), content, Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  return a.req('POST', url, payload, { 'content-type': `multipart/form-data; boundary=${b}` });
};

before(async () => { app = await setup(); });
after(teardown);

describe('email confirmation', () => {
  it('an unconfirmed person sees only the check-your-inbox page, and nothing else works until they confirm', async () => {
    const email = uniqueEmail('unconfirmed');
    const a = new Agent(app);
    assert.equal((await a.post('/api/auth/signup', { name: 'Nomsa K', email, password: PASSWORD, orgName: 'Unconfirmed Mining', orgKind: 'host' })).status, 200);
    const st = await a.state();
    assert.equal(st.verifyRequired, true);
    assert.equal(st.state, undefined, 'no workspace data');
    for (const [m, u] of [['GET', '/api/onboarding'], ['POST', '/api/workplaces'], ['GET', '/api/org-docs'], ['GET', '/api/studio/documents']] as const) {
      const r = m === 'GET' ? await a.get(u) : await a.post(u, { name: 'x' });
      assert.equal(r.status, 403, u); assert.equal(r.body.error, 'email_unverified', u);
    }
    assert.equal((await a.post('/api/auth/resend-verification')).status, 200, 'can ask for the link again');
    assert.equal((await a.post('/api/auth/verify-email', { token: await lastEmailToken(email, '/verify-email') })).status, 200);
    const after = await a.state();
    assert.equal(after.verifyRequired, undefined);
    assert.equal(after.onboardingRequired, true, 'then set-up');
  });
});

describe('guided set-up', () => {
  let host: Agent, hostEmail = '', wpId = '';
  before(async () => { ({ agent: host, email: hostEmail } = await signup(app, { orgName: 'Setup Mining', orgKind: 'host', keepOnboarding: true })); });

  it('the app stays closed on the server until the required steps are done', async () => {
    const st = await host.state();
    assert.equal(st.onboardingRequired, true);
    assert.equal(st.canSetUp, true);
    assert.equal(st.state, undefined);
    const blocked = await host.post('/api/exchanges/request', { recipientEmail: 'x@example.com', items: [{ documentType: 'COID' }] });
    assert.equal(blocked.status, 403); assert.equal(blocked.body.error, 'onboarding_required');
    const early = await host.post('/api/onboarding/complete');
    assert.equal(early.status, 409);
    assert.match(early.body.message, /Your organisation.*Safety contact.*Your first site.*Your site documents/);
    const s = (await host.get('/api/onboarding')).body;
    assert.deepEqual(s.steps.filter((x: { need: string }) => x.need === 'required').map((x: { id: string }) => x.id), ['organisation', 'contact', 'site', 'documents']);
    assert.equal(s.steps.find((x: { id: string }) => x.id === 'areas').need, 'optional');
  });

  it('saves each step, checks answers, and opens the app when the required ones are done', async () => {
    assert.equal((await host.put('/api/onboarding/organisation', { name: 'Setup Mining', phone: '12' })).status, 400, 'phone checked');
    assert.equal((await host.put('/api/onboarding/organisation', { name: 'Setup Mining (Pty) Ltd', regNumber: '2020/123456/07', address: 'Kathu', phone: '053 723 0000' })).status, 200);
    assert.equal((await host.put('/api/onboarding/contact', { name: 'Pieter van Wyk', role: 'SHE Manager' })).status, 400, 'needs a phone or email');
    assert.equal((await host.put('/api/onboarding/contact', { name: 'Pieter van Wyk', role: 'SHE Manager', email: 'pieter@example.com' })).status, 200);
    const w = await host.post('/api/workplaces', { name: 'Kathu North', location: 'Kathu', packIds: [] });
    assert.equal(w.status, 200, JSON.stringify(w.body)); wpId = w.body.id;
    assert.equal((await host.post(`/api/workplaces/${wpId}/areas`, { name: 'Plant', kind: 'department' })).status, 200);
    assert.equal((await host.post(`/api/workplaces/${wpId}/areas`, { name: 'Plant', kind: 'department' })).status, 409, 'no duplicates');
    assert.equal((await host.put('/api/onboarding/documents', { answer: 'yes' })).status, 200);
    const up = await upload(host, '/api/org-docs', { name: 'Site Safety Policy', docType: 'policy', scope: 'site', workplaceId: wpId, requirement: 'mandatory', visibility: 'contractors' });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    const s = (await host.get('/api/onboarding')).body;
    assert.equal(s.canComplete, true);
    assert.equal(s.workplaces[0].areas[0].name, 'Plant');
    assert.equal((await host.post('/api/onboarding/complete')).status, 200);
    const st = await host.state();
    assert.equal(st.onboardingRequired, undefined);
    assert.ok(st.state, 'the workspace opens');
    assert.equal((await host.get('/api/onboarding')).status, 200, 'and set-up can be revisited');
    void hostEmail;
  });

  it('a person invited before set-up is finished waits for an admin and cannot change set-up', async () => {
    const { agent: owner } = await signup(app, { orgName: 'Waiting Mining', orgKind: 'host', keepOnboarding: true });
    const email = uniqueEmail('waiting');
    assert.equal((await owner.post('/api/org/invites', { email, role: 'member' })).status, 200);
    const member = (await signup(app, { orgName: '', orgKind: 'host', email, inviteToken: await lastEmailToken(email, '/invite'), keepOnboarding: true })).agent;
    const st = await member.state();
    assert.equal(st.onboardingRequired, true);
    assert.equal(st.canSetUp, false);
    assert.equal((await member.put('/api/onboarding/contact', { name: 'Someone Else', phone: '0820000000' })).status, 403);
    assert.equal((await member.post('/api/onboarding/complete')).status, 403);
  });

  it('a contractor’s set-up asks what the company does', async () => {
    const { agent: c } = await signup(app, { orgName: 'Setup Scaffolding', orgKind: 'contractor', keepOnboarding: true });
    const s = (await c.get('/api/onboarding')).body;
    assert.deepEqual(s.steps.filter((x: { need: string }) => x.need === 'required').map((x: { id: string }) => x.id), ['organisation', 'services', 'contact', 'documents']);
    await c.put('/api/onboarding/organisation', { name: 'Setup Scaffolding', phone: '0110000000' });
    await c.put('/api/onboarding/contact', { name: 'Lerato D', phone: '0820000000' });
    await c.put('/api/onboarding/documents', { answer: 'later' });
    assert.equal((await c.post('/api/onboarding/complete')).status, 409);
    assert.equal((await c.put('/api/onboarding/services', { trade: 'Scaffolding and access', industries: ['Mining'] })).status, 200);
    assert.equal((await c.post('/api/onboarding/complete')).status, 200);
  });
});

describe('the document store', () => {
  let mine: Agent, mineId = '', wp = '', otherWp = '', reviewer: Agent, contractor: Agent, stranger: Agent, docId = '', internalId = '', restrictedId = '';
  before(async () => {
    ({ agent: mine } = await signup(app, { orgName: 'Docs Mining', orgKind: 'host' }));
    mineId = (await mine.state()).org.id;
    wp = (await mine.post('/api/workplaces', { name: 'Docs Shaft', packIds: [] })).body.id;
    otherWp = (await mine.post('/api/workplaces', { name: 'Docs Plant', packIds: [] })).body.id;
    const email = uniqueEmail('docreviewer');
    await mine.post('/api/org/invites', { email, role: 'reviewer' });
    reviewer = (await signup(app, { orgName: '', orgKind: 'host', email, inviteToken: await lastEmailToken(email, '/invite') })).agent;
    ({ agent: contractor } = await signup(app, { orgName: 'Docs Welding', orgKind: 'contractor' }));
    const code = (await mine.state()).state.workplaces[wp].code;
    assert.equal((await contractor.post('/api/sites/join', { code })).status, 200);
    ({ agent: stranger } = await signup(app, { orgName: 'Docs Stranger', orgKind: 'contractor' }));
  });

  it('uploads with details, lists, versions and serves the file to the owner', async () => {
    const r = await upload(mine, '/api/org-docs', { name: 'Shaft Induction Pack', docType: 'induction', scope: 'site', workplaceId: wp, visibility: 'contractors', expiryDate: '2027-01-31' });
    assert.equal(r.status, 200, JSON.stringify(r.body)); docId = r.body.id;
    internalId = (await upload(mine, '/api/org-docs', { name: 'Board Risk Register', docType: 'report' })).body.id;
    restrictedId = (await upload(mine, '/api/org-docs', { name: 'Medical Surveillance Records', docType: 'report', visibility: 'restricted' })).body.id;
    const list = (await mine.get('/api/org-docs')).body.documents;
    const d = list.find((x: { id: string }) => x.id === docId);
    assert.equal(d.workplaceName, 'Docs Shaft'); assert.equal(d.expiryDate, '2027-01-31'); assert.equal(d.version, 1);
    const v = await mine.upload(`/api/org-docs/${docId}/version`, 'induction-v2.pdf', PDF);
    assert.equal(v.status, 200, JSON.stringify(v.body)); assert.equal(v.body.version, 2);
    const detail = (await mine.get(`/api/org-docs/${docId}`)).body;
    assert.equal(detail.versions.length, 2, 'earlier version kept');
    assert.equal((await mine.get(`/api/org-docs/${docId}/file`)).status, 200);
    assert.equal((await mine.get(`/api/org-docs/${docId}/file?v=1`)).status, 200);
  });

  it('refuses unsupported files and links to another organisation’s site', async () => {
    const bad = await upload(mine, '/api/org-docs', { name: 'Script' }, 'run.exe', Buffer.from('MZ\x90\x00binary'), 'application/octet-stream');
    assert.equal(bad.status, 400);
    const strangerWp = (await signup(app, { orgName: 'Other Mine', orgKind: 'host' }));
    const theirWp = (await strangerWp.agent.post('/api/workplaces', { name: 'Theirs', packIds: [] })).body.id;
    assert.equal((await upload(mine, '/api/org-docs', { name: 'Linked elsewhere', workplaceId: theirWp })).status, 404);
    assert.equal((await strangerWp.agent.post(`/api/workplaces/${wp}/areas`, { name: 'Hijack' })).status, 404);
  });

  it('restricted documents are for owners and admins only', async () => {
    assert.ok(!(await reviewer.get('/api/org-docs')).body.documents.some((x: { id: string }) => x.id === restrictedId));
    assert.equal((await reviewer.get(`/api/org-docs/${restrictedId}`)).status, 404);
    assert.equal((await reviewer.get(`/api/org-docs/${restrictedId}/file`)).status, 404);
    assert.equal((await upload(reviewer, '/api/org-docs', { name: 'Sneaky', visibility: 'restricted' })).status, 403);
    assert.ok((await reviewer.get('/api/org-docs')).body.documents.some((x: { id: string }) => x.id === internalId), 'internal ones are fine');
  });

  it('a contractor sees only what the mine shared with contractors on its site, read-only', async () => {
    const shared = (await contractor.get('/api/org-docs/shared')).body.documents.map((x: { id: string }) => x.id);
    assert.deepEqual(shared, [docId]);
    assert.equal((await contractor.get(`/api/org-docs/${docId}/file`)).status, 200);
    assert.equal((await contractor.get(`/api/org-docs/${docId}`)).body.versions.length, 0, 'no version history for outsiders');
    assert.equal((await contractor.get(`/api/org-docs/${docId}/file?v=1`)).status, 200, 'an old version number still only gives the current file');
    assert.equal((await contractor.get(`/api/org-docs/${internalId}`)).status, 404);
    assert.equal((await contractor.get(`/api/org-docs/${internalId}/file`)).status, 404);
    for (const [m, u, b] of [['PATCH', `/api/org-docs/${docId}`, { name: 'Changed' }], ['POST', `/api/org-docs/${docId}/archive`, { archived: true }]] as const) {
      assert.equal((await contractor.req(m, u, b)).status, 404, u);
    }
    assert.equal((await contractor.upload(`/api/org-docs/${docId}/version`, 'x.pdf', PDF)).status, 404);
    // shared with one site only: a document for another site of the same mine stays hidden
    const plantDoc = (await upload(mine, '/api/org-docs', { name: 'Plant Rules', workplaceId: otherWp, visibility: 'contractors' })).body.id;
    assert.equal((await contractor.get(`/api/org-docs/${plantDoc}`)).status, 404);
  });

  it('a company with no connection sees nothing', async () => {
    assert.deepEqual((await stranger.get('/api/org-docs/shared')).body.documents, []);
    assert.equal((await stranger.get(`/api/org-docs/${docId}`)).status, 404);
    assert.equal((await stranger.get(`/api/org-docs/${docId}/file`)).status, 404);
    assert.ok(!(await stranger.get('/api/org-docs')).body.documents.some((x: { id: string }) => x.id === docId));
  });

  it('Oscar finds documents only within what the person may see', async () => {
    const ask = (a: Agent, q: string) => a.post('/api/assistant', { messages: [{ role: 'user', content: q }] });
    const m = await ask(mine, 'Which of my documents expire in the next 400 days?');
    assert.equal(m.status, 200, JSON.stringify(m.body));
    assert.match(m.body.reply, /Shaft Induction Pack/);
    const c = await ask(contractor, 'Where is the induction document?');
    assert.match(c.body.reply, /Shaft Induction Pack/);
    assert.doesNotMatch(c.body.reply, /Board Risk Register|Medical Surveillance/);
    const r = await ask(reviewer, 'Find the medical report');
    assert.doesNotMatch(r.body.reply, /Medical Surveillance/, 'restricted stays hidden from non-admins');
    const x = await ask(stranger, 'Where is the induction document?');
    assert.doesNotMatch(x.body.reply, /Shaft Induction Pack/);
  });

  it('archiving hides a document from the list and from contractors, and can be undone', async () => {
    assert.equal((await mine.post(`/api/org-docs/${docId}/archive`, { archived: true })).status, 200);
    assert.ok(!(await mine.get('/api/org-docs')).body.documents.some((x: { id: string }) => x.id === docId));
    assert.ok((await mine.get('/api/org-docs?archived=1')).body.documents.some((x: { id: string }) => x.id === docId));
    assert.deepEqual((await contractor.get('/api/org-docs/shared')).body.documents, []);
    assert.equal((await mine.post(`/api/org-docs/${docId}/archive`, { archived: false })).status, 200);
    void mineId;
  });
});
