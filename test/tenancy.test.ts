/**
 * Tenant isolation and server-side permission checks. These are the
 * guarantees the client-only MVP could not make.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, lastEmailToken, PDF, pool, setup, signup, teardown, uniqueEmail } from './helpers.js';

let app: FastifyInstance;
let hostA: Agent;
let hostB: Agent;
let contractor: Agent;
let otherContractor: Agent;
let siteId: string;
let reqIds: string[];
let contractorOrgId: string;

before(async () => {
  app = await setup();
  hostA = (await signup(app, { orgName: 'Alpha Mining', orgKind: 'host' })).agent;
  hostB = (await signup(app, { orgName: 'Beta Mining', orgKind: 'host' })).agent;
  otherContractor = (await signup(app, { orgName: 'Other Contractor', orgKind: 'contractor' })).agent;

  const contactEmail = uniqueEmail('contact');
  const r = await hostA.post('/api/sites', {
    name: 'Shaft 3 Rewire',
    location: 'Alpha, Shaft 3',
    newContractor: { name: 'Sparks Electrical', trade: 'Electrical', contact: 'Sipho', email: contactEmail },
    requirements: [
      { category: 'Company', name: 'COID letter', source: 'legal', why: 'Required' },
      { category: 'Personnel', name: 'Medicals', source: 'legal', why: 'Required' },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  siteId = r.body.id;

  // The contractor follows the emailed link and signs up.
  const token = await lastEmailToken(contactEmail, '/site-invite');
  contractor = (await signup(app, { orgName: 'Sparks Electrical', orgKind: 'contractor', email: contactEmail, siteInviteToken: token })).agent;
  const st = await contractor.state();
  contractorOrgId = st.org.id;
  reqIds = st.state.requirements[siteId].map((x: any) => x.id);
});

after(teardown);

describe('tenant isolation', () => {
  it('contractor sees the site after accepting via the emailed link', async () => {
    const st = await contractor.state();
    assert.equal(st.org.kind, 'contractor');
    assert.equal(st.state.sites[siteId].status, 'in_progress');
    assert.equal(reqIds.length, 2);
  });

  it('another host sees nothing of host A', async () => {
    const st = await hostB.state();
    assert.deepEqual(Object.keys(st.state.sites), []);
    assert.deepEqual(Object.keys(st.state.contractors), []);
    assert.ok(st.state.audit.every((a: any) => !a.detail.includes('Shaft 3')));
    assert.equal((await hostB.get(`/api/sites/${siteId}/readiness`)).status, 404);
    assert.equal((await hostB.post(`/api/sites/${siteId}/approve`)).status, 404);
    assert.equal((await hostB.post(`/api/sites/${siteId}/incidents`, { type: 'near_miss', description: 'x' })).status, 404);
    assert.equal((await hostB.post(`/api/documents/${reqIds[0]}/correction`, { text: 'x' })).status, 404);
  });

  it('an unrelated contractor sees nothing and cannot act', async () => {
    const st = await otherContractor.state();
    assert.deepEqual(Object.keys(st.state.sites), []);
    assert.equal((await otherContractor.post(`/api/documents/${reqIds[0]}/submit`, {})).status, 404);
    assert.equal((await otherContractor.upload(`/api/documents/${reqIds[0]}/file`, 'coid.pdf', PDF)).status, 404);
  });

  it('library slots are private to their owner', async () => {
    const slot = encodeURIComponent(`lib:${contractorOrgId}:insurance`);
    assert.equal((await otherContractor.upload(`/api/documents/${slot}/file`, 'i.pdf', PDF)).status, 404);
    assert.equal((await hostA.upload(`/api/documents/${slot}/file`, 'i.pdf', PDF)).status, 404);
  });
});

describe('role enforcement', () => {
  it('host cannot submit documents; contractor cannot review or approve', async () => {
    assert.equal((await hostA.upload(`/api/documents/${reqIds[0]}/file`, 'coid.pdf', PDF)).status, 403);
    assert.equal((await contractor.post(`/api/documents/${reqIds[0]}/approve`)).status, 403);
    assert.equal((await contractor.post(`/api/sites/${siteId}/approve`)).status, 403);
    assert.equal((await contractor.post(`/api/sites/${siteId}/inspections`, { title: 'x' })).status, 403);
  });

  it('draft attachments stay private until submitted', async () => {
    const up = await contractor.upload(`/api/documents/${reqIds[0]}/file`, 'coid.pdf', PDF);
    assert.equal(up.status, 200, JSON.stringify(up.body));
    const fileId = up.body.fileId;
    assert.equal((await hostA.get(`/api/files/${fileId}`)).status, 404, 'host must not see an unsubmitted draft');
    assert.equal((await contractor.get(`/api/files/${fileId}`)).status, 200);

    const sub = await contractor.post(`/api/documents/${reqIds[0]}/submit`, { note: 'current letter', expiryDate: '2099-01-01' });
    assert.equal(sub.status, 200, JSON.stringify(sub.body));
    assert.equal((await hostA.get(`/api/files/${fileId}`)).status, 200, 'host sees the submitted version');
    assert.equal((await hostB.get(`/api/files/${fileId}`)).status, 404, 'other tenants never do');
    assert.equal((await otherContractor.get(`/api/files/${fileId}`)).status, 404);
  });

  it('rejects files that are not what they claim to be', async () => {
    const r = await contractor.upload(`/api/documents/${reqIds[1]}/file`, 'fake.pdf', Buffer.from('MZ\x90\x00 not a pdf'));
    assert.equal(r.status, 400);
  });

  it('a host "member" is view-only', async () => {
    const email = uniqueEmail('viewer');
    assert.equal((await hostA.post('/api/org/invites', { email, role: 'member' })).status, 200);
    const token = await lastEmailToken(email, '/invite');
    const viewer = (await signup(app, { orgName: '', orgKind: 'host', email, inviteToken: token })).agent;
    const st = await viewer.state();
    assert.equal(st.org.name, 'Alpha Mining');
    assert.equal(st.org.uiRole, 'viewer');
    assert.ok(st.state.sites[siteId]);
    assert.equal((await viewer.post(`/api/documents/${reqIds[0]}/approve`)).status, 403);
    assert.equal((await viewer.post('/api/sites', { name: 'x', newContractor: { name: 'y' } })).status, 403);
  });

  it('removing a member cuts off access immediately', async () => {
    const email = uniqueEmail('reviewer');
    await hostA.post('/api/org/invites', { email, role: 'reviewer' });
    const token = await lastEmailToken(email, '/invite');
    const reviewer = (await signup(app, { orgName: '', orgKind: 'host', email, inviteToken: token })).agent;
    const me = await reviewer.state();
    assert.equal(me.org.uiRole, 'reviewer');
    assert.equal((await hostA.del(`/api/org/members/${me.me.id}`)).status, 200);
    const after = await reviewer.state();
    assert.equal(after.org, null);
    assert.equal((await reviewer.get(`/api/sites/${siteId}/readiness`)).status, 403);
  });

  it('the last owner cannot be removed or demoted', async () => {
    const me = await hostA.state();
    assert.equal((await hostA.patch(`/api/org/members/${me.me.id}`, { role: 'admin' })).status, 409);
    assert.equal((await hostA.del(`/api/org/members/${me.me.id}`)).status, 409);
  });
});

describe('CSRF', () => {
  it('rejects a signed-in write without the CSRF header', async () => {
    const saved = hostA.csrf;
    hostA.csrf = '';
    const r = await hostA.post(`/api/sites/${siteId}/diary`, { summary: 'x' });
    hostA.csrf = saved;
    assert.equal(r.status, 403);
  });

  it('rejects anonymous form posts that are not JSON', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'email=a&password=b' });
    assert.equal(r.statusCode, 415);
  });
});

describe('external share links', () => {
  it('works until revoked, and exposes only the shared site', async () => {
    const r = await contractor.post('/api/share-links', { siteId, kind: 'safety_file', days: 7, label: 'Auditor' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const path = new URL(r.body.url).pathname;
    const page = await app.inject({ method: 'GET', url: path });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /Shaft 3 Rewire/);
    assert.match(page.body, /COID letter/);
    // A file from the shared site downloads through the link…
    const fileHref = page.body.match(/href="(\/share\/[^"]+\/files\/[^"]+)"/)?.[1];
    assert.ok(fileHref, 'safety file lists the submitted document');
    assert.equal((await app.inject({ method: 'GET', url: fileHref! })).statusCode, 200);
    // …but a file id from anywhere else does not.
    const other = await otherContractor.upload(`/api/documents/${encodeURIComponent(`lib:${(await otherContractor.state()).org.id}:insurance`)}/file`, 'x.pdf', PDF);
    assert.equal((await app.inject({ method: 'GET', url: path + '/files/' + other.body.fileId })).statusCode, 404);

    assert.equal((await contractor.post(`/api/share-links/${r.body.id}/revoke`)).status, 200);
    assert.equal((await app.inject({ method: 'GET', url: path })).statusCode, 410);
  });

  it('expired links stop working', async () => {
    const r = await hostA.post('/api/share-links', { siteId, kind: 'site_readiness', days: 1 });
    await pool.query(`update share_links set expires_at = now() - interval '1 minute' where id = $1`, [r.body.id]);
    assert.equal((await app.inject({ method: 'GET', url: new URL(r.body.url).pathname })).statusCode, 410);
  });

  it('another tenant cannot revoke or create links for this site', async () => {
    const r = await hostA.post('/api/share-links', { siteId, kind: 'site_readiness', days: 1 });
    assert.equal((await hostB.post(`/api/share-links/${r.body.id}/revoke`)).status, 404);
    assert.equal((await hostB.post('/api/share-links', { siteId, kind: 'site_readiness' })).status, 404);
  });
});
