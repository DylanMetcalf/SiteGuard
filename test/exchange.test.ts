/** COMVERA Exchange: scoped document requests and shares with people who have no workspace. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, lastEmailToken, PDF, pool, setup, signup, teardown, uniqueEmail } from './helpers.js';

let app: FastifyInstance;
let mine: Agent, otherMine: Agent, con: Agent, mineStaff: Agent;
let mineOrgId: string, conOrgId: string;
let contractorId: string, otherContractorId: string;
const outsider = 'sipho@ndlovu-rigging.example';

/** The recipient's browser: only ever holds the short exchange session cookie. */
class Portal {
  cookie = '';
  csrf = '';
  constructor(public token: string) {}
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await app.inject({
      method: method as 'GET', url,
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.csrf && method !== 'GET' ? { 'x-exchange-csrf': this.csrf } : {}),
        ...(body !== undefined && !(body instanceof Buffer) ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      payload: body === undefined ? undefined : body instanceof Buffer ? body : JSON.stringify(body),
    });
    const set = res.headers['set-cookie'];
    for (const c of Array.isArray(set) ? set : set ? [set] : []) {
      const [pair] = c.split(';');
      if (pair.startsWith('cx=')) this.cookie = pair.endsWith('=') ? '' : pair;
    }
    let json: any = null;
    try { json = res.json(); } catch { /* not json */ }
    return { status: res.statusCode, body: json, raw: res };
  }
  open = () => this.req('POST', '/api/x/open', { token: this.token });
  code = (email: string) => this.req('POST', '/api/x/code', { token: this.token, email });
  verify = (email: string, code: string) => this.req('POST', '/api/x/verify', { token: this.token, email, code });
  async signIn(email: string) {
    await this.open();
    assert.equal((await this.code(email)).status, 200);
    const r = await this.verify(email, await lastCode(email));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    this.csrf = r.body.csrf;
  }
  upload(itemId: string, name = 'cert.pdf', content = PDF) {
    const boundary = '----x' + Math.random().toString(16).slice(2);
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/pdf\r\n\r\n`),
      content, Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return this.req('POST', `/api/x/items/${itemId}/upload`, payload, { 'content-type': `multipart/form-data; boundary=${boundary}` });
  }
}

async function lastCode(to: string): Promise<string> {
  const r = await pool.query(`select subject from email_outbox where to_email = $1 and subject like 'Your COMVERA code:%' order by id desc limit 1`, [to]);
  return r.rows[0].subject.match(/(\d{6})/)[1];
}
async function lastLink(to: string): Promise<string> {
  const r = await pool.query(`select text_body from email_outbox where to_email = $1 and text_body like '%/x/%' order by id desc limit 1`, [to]);
  return r.rows[0].text_body.match(/\/x\/([A-Za-z0-9_-]+)/)[1];
}
const counts = async () => (await pool.query(`select (select count(*) from users)::int as users, (select count(*) from organisations)::int as orgs, (select count(*) from memberships)::int as members`)).rows[0];

before(async () => {
  app = await setup();
  mine = (await signup(app, { orgName: 'Kappa Platinum', orgKind: 'host' })).agent;
  otherMine = (await signup(app, { orgName: 'Lambda Coal', orgKind: 'host' })).agent;
  con = (await signup(app, { orgName: 'Mu Scaffolding', orgKind: 'contractor' })).agent;
  mineOrgId = (await mine.state()).org.id;
  conOrgId = (await con.state()).org.id;
  assert.equal((await mine.post('/api/sites', { name: 'Shaft 2', newContractor: { name: 'Ndlovu Rigging (Pty) Ltd', contact: 'Sipho Ndlovu', email: outsider } })).status, 200);
  contractorId = (await pool.query(`select id from contractors where org_id = $1 and name = 'Ndlovu Rigging (Pty) Ltd'`, [mineOrgId])).rows[0].id;
  assert.equal((await otherMine.post('/api/sites', { name: 'Pit 1', newContractor: { name: 'Other Co', contact: 'X', email: 'x@other.example' } })).status, 200);
  otherContractorId = (await pool.query(`select c.id from contractors c join organisations o on o.id = c.org_id where o.name = 'Lambda Coal'`)).rows[0].id;
  // A staff member (not a reviewer) of the mine.
  const staffEmail = uniqueEmail('staff');
  assert.equal((await mine.post('/api/org/invites', { email: staffEmail, role: 'member' })).status, 200);
  mineStaff = (await signup(app, { orgName: '', orgKind: 'host', email: staffEmail, inviteToken: await lastEmailToken(staffEmail, '/invite') })).agent;
});
after(teardown);

describe('mine → contractor request (no account needed)', () => {
  let exchangeId: string;
  let portal: Portal;
  let items: any[];

  it('sends a branded email with a secure link, never an attachment, and records the relationship and contact', async () => {
    const before = await counts();
    const r = await mine.post('/api/exchanges/request', {
      contractorId, contactName: 'Sipho Ndlovu', email: outsider, phone: '082 000 0000', deadline: '2099-01-31',
      message: 'Please send these before induction.',
      items: [{ documentType: 'Medical certificate', personName: 'Thabo Mokoena' }, { documentType: 'Working at Heights certificate', personName: 'Thabo Mokoena' }],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    exchangeId = r.body.id;
    assert.match(r.body.ref, /^EX-\d+$/);
    const mail = (await pool.query(`select subject, text_body, html_body from email_outbox where to_email = $1 order by id desc limit 1`, [outsider])).rows[0];
    assert.match(mail.subject, /Kappa Platinum has requested documents/);
    assert.match(mail.text_body, /Medical certificate — Thabo Mokoena/);
    assert.match(mail.text_body, /no account or password is needed/);
    assert.match(mail.text_body, /\/x\/[A-Za-z0-9_-]{30,}/);
    assert.deepEqual(await counts(), before, 'no user, organisation or membership is created for the recipient');
    const rel = await mine.get('/api/relationships');
    const entry = rel.body.relationships.find((x: any) => x.contractorId === contractorId);
    assert.equal(entry.exchanges, 1);
    assert.equal(entry.conversion, 'exchange_only');
    // The token itself is stored only as a hash.
    const token = await lastLink(outsider);
    assert.equal((await pool.query('select 1 from exchanges where link_token_hash = $1', [token])).rows.length, 0);
    portal = new Portal(token);
  });

  it('opening the link shows only a cover page with a masked email, and marks it opened', async () => {
    const r = await portal.open();
    assert.equal(r.status, 200);
    assert.equal(r.body.maskedEmail.startsWith('s'), true);
    assert.ok(!r.body.maskedEmail.includes('sipho@'));
    assert.equal(r.body.senderName, 'Kappa Platinum');
    assert.equal(r.body.signedIn, false);
    assert.equal((await portal.req('GET', '/api/x/exchange')).status, 401, 'the link alone gives no access');
    const dd = await mine.get(`/api/exchanges/${exchangeId}`); assert.equal(dd.body.exchange?.status, 'opened', JSON.stringify(dd.body));
  });

  it('a wrong email gets the same answer but no code; a wrong code is counted and capped', async () => {
    const wrong = await portal.code('someone@else.example');
    const right = await portal.code(outsider);
    assert.equal(wrong.status, 200);
    assert.deepEqual(wrong.body, right.body, 'no hint whether the address matched');
    assert.equal((await pool.query(`select 1 from email_outbox where to_email = 'someone@else.example'`)).rows.length, 0);
    const code = await lastCode(outsider);
    const bad = code === '000000' ? '111111' : '000000';
    const r1 = await portal.verify(outsider, bad);
    assert.equal(r1.status, 400);
    assert.match(r1.body.message, /4 attempts left/);
    assert.equal((await portal.verify('someone@else.example', code)).status, 400, 'right code, wrong email still fails');
    for (let i = 0; i < 3; i++) await portal.verify(outsider, bad);
    const locked = await portal.verify(outsider, code);
    assert.equal(locked.status, 429, 'even the right code is refused after five wrong attempts');
    const audit = await pool.query(`select action from audit_events where org_id = $1 and action like 'Verification%'`, [mineOrgId]);
    assert.ok(audit.rows.filter((a) => a.action === 'Verification failed').length >= 5);
    assert.ok(audit.rows.some((a) => a.action === 'Verification attempted'));
  });

  it('an expired code is refused, and a used code cannot be reused', async () => {
    await portal.code(outsider);
    const code = await lastCode(outsider);
    await pool.query(`update exchange_codes set expires_at = now() - interval '1 minute' where used_at is null`);
    assert.equal((await portal.verify(outsider, code)).status, 400);
    await portal.code(outsider);
    const fresh = await lastCode(outsider);
    const ok = await portal.verify(outsider, fresh);
    assert.equal(ok.status, 200);
    portal.csrf = ok.body.csrf;
    assert.ok(portal.cookie.startsWith('cx='));
    const replay = new Portal(portal.token);
    assert.equal((await replay.verify(outsider, fresh)).status, 400, 'a code works once');
  });

  it('the session shows this exchange only — nothing from any workspace', async () => {
    const r = await portal.req('GET', '/api/x/exchange');
    assert.equal(r.status, 200);
    items = r.body.items;
    assert.equal(items.length, 2);
    assert.equal(r.body.exchange.senderName, 'Kappa Platinum');
    const text = JSON.stringify(r.body);
    assert.ok(!text.includes(mineOrgId) && !text.includes(contractorId), 'no internal ids of the workspace');
    // The exchange cookie is not a workspace session.
    const boot = await portal.req('GET', '/api/bootstrap');
    assert.ok(!boot.body?.user && !boot.body?.org, 'no workspace user or organisation');
    assert.equal((await portal.req('GET', '/api/exchanges')).status, 401);
  });

  it('uploads need the session CSRF header; drafts are submitted together; the mine is notified', async () => {
    const noCsrf = new Portal(portal.token);
    noCsrf.cookie = portal.cookie;
    assert.equal((await noCsrf.upload(items[0].id)).status, 403);
    assert.equal((await portal.upload(items[0].id, 'medical.pdf')).status, 200);
    assert.equal((await portal.upload(items[0].id, 'medical-v2.pdf')).status, 200, 'a draft can be replaced before submitting');
    assert.equal((await portal.req('POST', '/api/x/submit', {})).status, 200);
    const d = await mine.get(`/api/exchanges/${exchangeId}`);
    assert.equal(d.body.exchange.status, 'submitted');
    const it0 = d.body.items.find((i: any) => i.id === items[0].id);
    assert.equal(it0.status, 'submitted');
    assert.equal(it0.submissions[0].filename, 'medical-v2.pdf');
    // The mine stores its own copy: the file belongs to the mine and opens through the normal file route.
    const f = await pool.query('select org_id, uploaded_by from files where id = $1', [it0.fileId]);
    assert.equal(f.rows[0].org_id, mineOrgId);
    assert.equal(f.rows[0].uploaded_by, null);
    assert.equal((await mine.get(`/api/files/${it0.fileId}`)).status, 200);
    assert.equal((await otherMine.get(`/api/files/${it0.fileId}`)).status, 404);
    assert.ok((await mine.state()).inbox.items.some((n: any) => /submitted 1 document/.test(n.title)));
    assert.equal((await portal.upload(items[0].id)).status, 409, 'a submitted document waits for review');
  });

  it('the mine rejects with a reason; the recipient gets a new link and replaces it; old links stop working', async () => {
    const d = await mine.get(`/api/exchanges/${exchangeId}`);
    const it0 = d.body.items.find((i: any) => i.status === 'submitted');
    assert.equal((await mine.post(`/api/exchanges/${exchangeId}/review`, { decisions: [{ itemId: it0.id, decision: 'reject', note: '' }] })).status, 400, 'a reason is required');
    assert.equal((await mine.post(`/api/exchanges/${exchangeId}/review`, { decisions: [{ itemId: it0.id, decision: 'reject', note: 'Certificate has expired' }] })).status, 200);
    assert.equal((await mine.get(`/api/exchanges/${exchangeId}`)).body.exchange.status, 'changes_requested');
    const mail = (await pool.query(`select text_body from email_outbox where to_email = $1 order by id desc limit 1`, [outsider])).rows[0].text_body;
    assert.match(mail, /Certificate has expired/);
    const newToken = await lastLink(outsider);
    assert.notEqual(newToken, portal.token);
    assert.equal((await new Portal(portal.token).open()).status, 404, 'the old link is replaced');
    // The existing session keeps working (it belongs to the exchange, not the link).
    const v = await portal.req('GET', '/api/x/exchange');
    assert.equal(v.body.items.find((i: any) => i.id === it0.id).reviewNote, 'Certificate has expired');
    assert.equal((await portal.upload(it0.id, 'medical-new.pdf')).status, 200);
    assert.equal((await portal.upload(items[1].id, 'wah.pdf')).status, 200);
    assert.equal((await portal.req('POST', '/api/x/submit', { message: 'Updated medical attached' })).status, 200);
    const after = await mine.get(`/api/exchanges/${exchangeId}`);
    assert.equal(after.body.exchange.recipientResponse, 'Updated medical attached');
    assert.equal(after.body.exchange.counts.resubmitted, 1);
    assert.equal(after.body.items.find((i: any) => i.id === it0.id).submissions.length, 2, 'every version is kept');
    assert.ok(after.body.history.some((h: any) => h.action === 'Exchange resubmitted'));
  });

  it('approving everything completes the request', async () => {
    const d = await mine.get(`/api/exchanges/${exchangeId}`);
    const decisions = d.body.items.map((i: any) => ({ itemId: i.id, decision: 'approve' }));
    assert.equal((await mine.post(`/api/exchanges/${exchangeId}/review`, { decisions })).status, 200);
    const done = await mine.get(`/api/exchanges/${exchangeId}`);
    assert.equal(done.body.exchange.status, 'approved');
    assert.ok(done.body.exchange.completedAt);
    assert.equal((await portal.upload(items[0].id)).status, 409);
    const actions = done.body.history.map((h: any) => h.action);
    for (const a of ['Exchange request created', 'Exchange email sent', 'Exchange opened', 'Verification completed', 'Exchange document uploaded',
      'Exchange document replaced', 'Exchange submitted', 'Exchange document rejected', 'Exchange document approved', 'Exchange completed']) {
      assert.ok(actions.includes(a), `audit has ${a}`);
    }
  });

  it('other organisations and staff without the right role cannot see or act on it', async () => {
    assert.equal((await otherMine.get(`/api/exchanges/${exchangeId}`)).status, 404);
    assert.equal((await con.get(`/api/exchanges/${exchangeId}`)).status, 404);
    assert.equal((await otherMine.post(`/api/exchanges/${exchangeId}/revoke`)).status, 404);
    assert.equal((await otherMine.post('/api/exchanges/request', { contractorId, email: 'a@b.example', items: [{ documentType: 'X' }] })).status, 404);
    assert.equal((await otherMine.get(`/api/exchanges/contacts?contractorId=${contractorId}`)).status, 404);
    assert.ok(!(await otherMine.get('/api/exchanges')).body.sent.length);
    assert.equal((await mineStaff.post('/api/exchanges/request', { contractorId, email: outsider, items: [{ documentType: 'X' }] })).status, 403);
  });
});

describe('expiry, revocation and sessions', () => {
  it('an expired exchange keeps its record but its link and sessions stop working', async () => {
    const email = 'expiring@example.org';
    const r = await mine.post('/api/exchanges/request', { company: 'Expiry Co', contactName: 'E', email, items: [{ documentType: 'COID letter' }] });
    assert.equal(r.status, 200);
    const p = new Portal(await lastLink(email));
    await p.signIn(email);
    await pool.query(`update exchanges set access_expires_at = now() - interval '1 minute' where id = $1`, [r.body.id]);
    assert.equal((await p.req('GET', '/api/x/exchange')).status, 410);
    assert.equal((await p.open()).status, 410);
    const d = await mine.get(`/api/exchanges/${r.body.id}`);
    assert.equal(d.status, 200);
    assert.equal(d.body.exchange.access, 'expired', 'record exists; access is not active');
    // Resending extends access with a new link.
    assert.equal((await mine.post(`/api/exchanges/${r.body.id}/resend`, {})).status, 200);
    const p2 = new Portal(await lastLink(email));
    assert.equal((await p2.open()).status, 200);
  });

  it('a session ends when its time is up', async () => {
    const email = 'session@example.org';
    const r = await mine.post('/api/exchanges/request', { company: 'Session Co', email, items: [{ documentType: 'Tax PIN' }] });
    const p = new Portal(await lastLink(email));
    await p.signIn(email);
    await pool.query(`update exchange_sessions set expires_at = now() - interval '1 second' where exchange_id = $1`, [r.body.id]);
    assert.equal((await p.req('GET', '/api/x/exchange')).status, 401);
  });

  it('a session for one exchange cannot reach another exchange', async () => {
    const email = 'two@example.org';
    const a = await mine.post('/api/exchanges/request', { company: 'Two Co', email, items: [{ documentType: 'A' }] });
    const pa = new Portal(await lastLink(email));
    await pa.signIn(email);
    const b = await mine.post('/api/exchanges/request', { company: 'Two Co', email, items: [{ documentType: 'B' }] });
    const bItem = (await mine.get(`/api/exchanges/${b.body.id}`)).body.items[0].id;
    assert.equal((await pa.upload(bItem)).status, 404, "an item from another exchange is not found");
    assert.equal((await pa.req('GET', '/api/x/exchange')).body.items[0].documentType, 'A');
    assert.ok(a.body.id);
  });

  it('unknown or malformed tokens give the same answer', async () => {
    assert.equal((await new Portal('A'.repeat(43)).open()).status, 404);
    assert.equal((await new Portal('short').open()).status, 404);
    const r = await app.inject({ method: 'POST', url: '/api/x/open', payload: 'token=abc', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(r.statusCode, 415, 'cross-site forms cannot post to the portal');
  });

  it('serves the portal page without caching or referrer', async () => {
    const r = await app.inject({ method: 'GET', url: '/x/sometoken' });
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
  });
});

describe('contractor → mine secure share', () => {
  let shareId: string, portal: Portal, docId: string;
  const mineEmail = 'she.manager@kappa.example';

  before(async () => {
    const slot = encodeURIComponent(`lib:${conOrgId}:insurance`);
    assert.equal((await con.upload(`/api/documents/${slot}/file`, 'insurance.pdf', PDF)).status, 200);
    assert.equal((await con.post(`/api/documents/${slot}/submit`, { expiryDate: `${new Date().getFullYear() + 2}-01-01` })).status, 200);
  });

  it('searches only its own documents', async () => {
    const r = await con.get('/api/exchanges/documents?q=insurance');
    assert.equal(r.status, 200);
    assert.equal(r.body.documents.length, 1);
    assert.equal(r.body.documents[0].name, 'Public liability insurance');
    docId = r.body.documents[0].id;
    assert.equal((await mine.get('/api/exchanges/documents?q=insurance')).body.documents.length, 0);
  });

  it("refuses to share another organisation's document", async () => {
    const r = await otherMine.post('/api/exchanges/share', { company: 'X', email: 'x@y.example', documents: [{ source: 'document', id: docId }] });
    assert.equal(r.status, 404);
  });

  it('shares with expiry and view-only access, and records opens and views', async () => {
    const r = await con.post('/api/exchanges/share', {
      company: 'Kappa Platinum', contactName: 'SHE Manager', email: mineEmail, days: 7, allowDownload: false, documents: [{ source: 'document', id: docId }],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    shareId = r.body.id;
    const mail = (await pool.query(`select subject, text_body from email_outbox where to_email = $1 order by id desc limit 1`, [mineEmail])).rows[0];
    assert.match(mail.subject, /Mu Scaffolding has shared a document with you/);
    portal = new Portal(await lastLink(mineEmail));
    await portal.signIn(mineEmail);
    const v = await portal.req('GET', '/api/x/exchange');
    const item = v.body.items[0];
    assert.equal(item.filename, 'insurance.pdf');
    assert.equal((await portal.req('GET', `/api/x/items/${item.id}/file?download=1`)).status, 403, 'view-only');
    const view = await portal.req('GET', `/api/x/items/${item.id}/file`);
    assert.equal(view.status, 200);
    assert.match(String(view.raw.headers['content-security-policy']), /sandbox/);
    const d = await con.get(`/api/exchanges/${shareId}`);
    assert.ok(d.body.history.some((h: any) => h.action === 'Exchange document viewed'));
    // The mine's workspace gains nothing from the contractor's library.
    assert.equal((await mine.get('/api/exchanges/documents?q=')).body.documents.length, 0);
  });

  it('revoking ends access immediately and leaves the original untouched', async () => {
    const before = await pool.query('select d.current_file_id, d.status from documents d where d.id = $1', [docId]);
    assert.equal((await con.post(`/api/exchanges/${shareId}/revoke`)).status, 200);
    assert.equal((await portal.req('GET', '/api/x/exchange')).status, 401, 'sessions are ended');
    assert.equal((await portal.open()).status, 410);
    const after = await pool.query('select d.current_file_id, d.status from documents d where d.id = $1', [docId]);
    assert.deepEqual(after.rows, before.rows);
    const d = await con.get(`/api/exchanges/${shareId}`);
    assert.equal(d.body.exchange.access, 'revoked');
    assert.ok(d.body.history.some((h: any) => h.action === 'Share revoked'));
  });

  it('with download allowed, a download is recorded', async () => {
    const r = await con.post('/api/exchanges/share', { company: 'Kappa Platinum', email: mineEmail, documents: [{ source: 'document', id: docId }] });
    const p = new Portal(await lastLink(mineEmail));
    await p.signIn(mineEmail);
    const item = (await p.req('GET', '/api/x/exchange')).body.items[0];
    const dl = await p.req('GET', `/api/x/items/${item.id}/file?download=1`);
    assert.equal(dl.status, 200);
    assert.match(String(dl.raw.headers['content-disposition']), /attachment/);
    const d = await con.get(`/api/exchanges/${r.body.id}`);
    assert.equal(d.body.exchange.status, 'downloaded');
    assert.ok(d.body.items[0].downloadedAt);
  });
});

describe('bulk request', () => {
  before(async () => {
    // A worker of a linked contractor on one of the mine's sites, with a Working at Heights certificate.
    const w = await pool.query(`insert into workers (org_id, full_name) values ($1, 'Lerato Dlamini') returning id`, [conOrgId]);
    await pool.query(`insert into worker_certificates (worker_id, kind, name, created_by_name) values ($1, 'training', 'Working at Heights', 'x')`, [w.rows[0].id]);
    const site = await pool.query(`select id from sites where contractor_id = $1`, [contractorId]);
    await pool.query(`insert into site_workers (site_id, worker_id) values ($1, $2)`, [site.rows[0].id, w.rows[0].id]);
    // A second directory contractor with no contact email.
    await mine.post('/api/sites', { name: 'Shaft 3', newContractor: { name: 'No Contact Welding' } });
    const nc = (await pool.query(`select id from contractors where name = 'No Contact Welding'`)).rows[0].id;
    const w2 = await pool.query(`insert into workers (org_id, full_name) values ($1, 'Pieter Botha') returning id`, [conOrgId]);
    await pool.query(`insert into worker_certificates (worker_id, kind, name, created_by_name) values ($1, 'training', 'Working at Heights', 'x')`, [w2.rows[0].id]);
    const s2 = await pool.query(`select id from sites where contractor_id = $1`, [nc]);
    await pool.query(`insert into site_workers (site_id, worker_id) values ($1, $2)`, [s2.rows[0].id, w2.rows[0].id]);
  });

  it('finds records across sites, shows missing contacts, then groups one exchange per company', async () => {
    const s = await mine.get('/api/exchanges/records?q=heights');
    assert.equal(s.status, 200);
    const rows = s.body.records.filter((r: any) => r.source === 'certificate');
    assert.equal(rows.length, 2);
    assert.equal((await otherMine.get('/api/exchanges/records?q=heights')).body.records.length, 0, 'another mine sees none of it');
    const items = rows.map((r: any) => ({ contractorId: r.contractorId, documentType: r.documentType, personName: r.personName, workerId: r.workerId }));
    const dry = await mine.post('/api/exchanges/bulk-request', { items, dryRun: true });
    assert.equal(dry.status, 200);
    assert.equal(dry.body.groups.length, 2);
    assert.equal(dry.body.problems.length, 1);
    assert.equal(dry.body.problems[0].contractorName, 'No Contact Welding');
    assert.equal((await mine.post('/api/exchanges/bulk-request', { items })).status, 400, 'nothing is sent while a contact is missing');
    const nc = dry.body.problems[0].contractorId;
    const sent = await mine.post('/api/exchanges/bulk-request', { items: [...items, items[0]], contacts: { [nc]: { name: 'Welding Office', email: 'office@welding.example' } } });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.created.length, 2);
    assert.ok(sent.body.created.every((c: any) => c.count === 1), 'duplicates are merged');
    assert.ok((await pool.query(`select 1 from email_outbox where to_email = 'office@welding.example'`)).rows.length);
  });

  it("refuses records naming another mine's contractor", async () => {
    const r = await mine.post('/api/exchanges/bulk-request', { items: [{ contractorId: otherContractorId, documentType: 'X' }], dryRun: true });
    assert.equal(r.status, 404);
  });
});

describe('claiming history after creating a workspace', () => {
  it('needs a verified email, an admin, explicit confirmation, and a second confirmation for a different company name', async () => {
    // The outsider from the first request now signs up — nothing is linked automatically.
    const { agent: sipho } = await signup(app, { orgName: 'Sipho Holdings', orgKind: 'contractor', email: outsider });
    const st = await sipho.get('/api/exchanges');
    assert.equal(st.body.received.length, 0, 'never auto-linked');
    await pool.query('update users set email_verified_at = null where email = $1', [outsider]);
    await sipho.refresh();
    const unverified = await sipho.get('/api/exchanges/claimable');
    assert.equal(unverified.body.verified, false);
    assert.equal(unverified.body.exchanges.length, 0);
    await pool.query('update users set email_verified_at = now() where email = $1', [outsider]);
    await sipho.refresh();
    const c = await sipho.get('/api/exchanges/claimable');
    assert.ok(c.body.exchanges.length >= 1);
    assert.equal(c.body.exchanges[0].sameCompany, false, '"Ndlovu Rigging" is not "Sipho Holdings"');
    const ids = c.body.exchanges.map((x: any) => x.id);
    assert.equal((await sipho.post('/api/exchanges/claim', { ids })).status, 400, 'explicit confirmation needed');
    const r = await sipho.post('/api/exchanges/claim', { ids, confirm: true });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'confirm_company');
    assert.equal((await sipho.post('/api/exchanges/claim', { ids, confirm: true, confirmDifferentCompany: true })).status, 200);
    const after = await sipho.get('/api/exchanges');
    assert.equal(after.body.received.length, ids.length);
    const d = await sipho.get(`/api/exchanges/${ids[0]}`);
    assert.equal(d.status, 200);
    assert.equal(d.body.exchange.mine, false);
    assert.ok(d.body.items.every((i: any) => i.fileId === null), "the mine's copies are not exposed");
    assert.equal(d.body.history.length, 0, "the sender's audit trail stays with the sender");
    assert.equal((await sipho.post(`/api/exchanges/${ids[0]}/revoke`)).status, 404, 'read-only for the recipient');
    assert.equal((await sipho.post('/api/exchanges/claim', { ids, confirm: true, confirmDifferentCompany: true })).status, 404, 'cannot be claimed twice');
    // The mine's relationship now shows a workspace, without merging anything.
    const rel = (await mine.get('/api/relationships')).body.relationships.find((x: any) => x.contractorId === contractorId);
    assert.equal(rel.conversion, 'workspace');
    const memberships = await pool.query(`select count(*)::int as n from memberships m join users u on u.id = m.user_id where u.email = $1`, [outsider]);
    assert.equal(memberships.rows[0].n, 1, 'only the workspace they created themselves');
  });

  it("someone else's email cannot claim, even with the exchange id", async () => {
    const id = (await pool.query(`select id from exchanges where recipient_email = 'two@example.org' limit 1`)).rows[0].id;
    const { agent } = await signup(app, { orgName: 'Two Co', orgKind: 'contractor' });
    assert.equal((await agent.post('/api/exchanges/claim', { ids: [id], confirm: true, confirmDifferentCompany: true })).status, 404);
    assert.equal((await agent.get(`/api/exchanges/${id}`)).status, 404);
  });
});

describe('consent and conversion', () => {
  it('records marketing consent only when given, and never creates an account', async () => {
    const email = 'consent@example.org';
    await mine.post('/api/exchanges/request', { company: 'Consent Co', email, items: [{ documentType: 'A' }] });
    const p = new Portal(await lastLink(email));
    await p.signIn(email);
    assert.equal((await pool.query('select 1 from marketing_consents where email = $1', [email])).rows.length, 0, 'never assumed');
    assert.equal((await p.req('POST', '/api/x/consent', { consented: true })).status, 200);
    assert.equal((await pool.query('select consented from marketing_consents where email = $1', [email])).rows[0].consented, true);
    assert.equal((await pool.query('select 1 from users where email = $1', [email])).rows.length, 0);
    assert.equal((await p.req('POST', '/api/x/signout', {})).status, 200);
    assert.equal((await p.req('GET', '/api/x/exchange')).status, 401);
  });

  it("submitting never depends on the requester's plan", async () => {
    const email = 'lapsed@example.org';
    const r = await mine.post('/api/exchanges/request', { company: 'Lapsed Co', email, items: [{ documentType: 'A' }] });
    const p = new Portal(await lastLink(email));
    await p.signIn(email);
    await pool.query(`update organisations set subscription_status = 'canceled', trial_ends_at = now() - interval '1 day' where id = $1`, [mineOrgId]);
    const item = (await p.req('GET', '/api/x/exchange')).body.items[0];
    assert.equal((await p.upload(item.id)).status, 200);
    assert.equal((await p.req('POST', '/api/x/submit', {})).status, 200);
    await pool.query(`update organisations set subscription_status = 'trialing', trial_ends_at = now() + interval '14 days' where id = $1`, [mineOrgId]);
    assert.ok(r.body.id);
  });
});
