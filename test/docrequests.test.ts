/**
 * Document requests on COMVERA Exchange: replacement, signed copy, general and other requests.
 * One secure recipient model; the document and its review history stay the source of truth.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, lastEmailToken, PDF, pool, setup, signup, teardown, uniqueEmail } from './helpers.js';
import { features } from '../src/config.js'; // after helpers: it sets the test environment first

let app: FastifyInstance;
let mine: Agent, otherMine: Agent, mineStaff: Agent;
let mineOrgId: string, siteId: string, contractorId: string, reqId: string, reqName: string, coidReqId: string;
const recipient = 'sipho@docreq.example';
const MARK = /good\s*standing|\bcoid\b|insurance|tax\s+(compliance|clearance)|sars\s+pin|medical|fitness|licen[cs]e|load\s+test/i;

class Portal {
  cookie = ''; csrf = '';
  constructor(public token: string) {}
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await app.inject({
      method: method as 'GET', url,
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(this.csrf && method !== 'GET' ? { 'x-exchange-csrf': this.csrf } : {}), ...(body !== undefined && !(body instanceof Buffer) ? { 'content-type': 'application/json' } : {}), ...headers },
      payload: body === undefined ? undefined : body instanceof Buffer ? body : JSON.stringify(body),
    });
    const set = res.headers['set-cookie'];
    for (const c of Array.isArray(set) ? set : set ? [set] : []) { const [pair] = c.split(';'); if (pair.startsWith('cx=')) this.cookie = pair.endsWith('=') ? '' : pair; }
    let json: any = null; try { json = res.json(); } catch { /* not json */ }
    return { status: res.statusCode, body: json, raw: res };
  }
  async signIn(email: string) {
    await this.req('POST', '/api/x/open', { token: this.token });
    assert.equal((await this.req('POST', '/api/x/code', { token: this.token, email })).status, 200);
    const code = (await pool.query(`select subject from email_outbox where to_email = $1 and subject like 'Your COMVERA code:%' order by id desc limit 1`, [email])).rows[0].subject.match(/(\d{6})/)[1];
    const r = await this.req('POST', '/api/x/verify', { token: this.token, email, code });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    this.csrf = r.body.csrf;
  }
  upload(itemId: string, name = 'doc.pdf', content: Buffer = PDF) {
    const b = '----x' + Math.random().toString(16).slice(2);
    const payload = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/pdf\r\n\r\n`), content, Buffer.from(`\r\n--${b}--\r\n`)]);
    return this.req('POST', `/api/x/items/${itemId}/upload`, payload, { 'content-type': `multipart/form-data; boundary=${b}` });
  }
  get = (u: string) => this.req('GET', u);
  post = (u: string, b: unknown = {}) => this.req('POST', u, b);
}
const link = async (to: string) => (await pool.query(`select text_body from email_outbox where to_email = $1 and text_body like '%/x/%' order by id desc limit 1`, [to])).rows[0].text_body.match(/\/x\/([A-Za-z0-9_-]+)/)[1] as string;
const mail = async (to: string) => (await pool.query(`select subject, text_body, html_body from email_outbox where to_email = $1 and text_body like '%/x/%' order by id desc limit 1`, [to])).rows[0];
const doc = async () => (await pool.query(`select * from documents where requirement_id = $1`, [reqId])).rows[0];
const versions = async () => (await pool.query(`select version, file_id from document_versions where document_id = $1 order by submitted_at`, [(await doc()).id])).rows;

before(async () => {
  app = await setup();
  mine = (await signup(app, { orgName: 'Docreq Mine', orgKind: 'host' })).agent;
  otherMine = (await signup(app, { orgName: 'Docreq Other Mine', orgKind: 'host' })).agent;
  mineOrgId = (await mine.state()).org.id;
  const s = await mine.post('/api/sites', { name: 'Shaft 9', newContractor: { name: 'Docreq Rigging', contact: 'Sipho', email: recipient } });
  assert.equal(s.status, 200, JSON.stringify(s.body));
  const st = await mine.state();
  siteId = Object.keys(st.state.sites)[0];
  contractorId = (await pool.query(`select id from contractors where org_id = $1`, [mineOrgId])).rows[0].id;
  for (const name of ['Baseline risk assessment', 'Letter of Good Standing (COID)']) {
    const a = await mine.post(`/api/sites/${siteId}/requirements`, { category: 'Company Documents', name, source: 'client' });
    assert.equal(a.status, 200, JSON.stringify(a.body));
  }
  const reqs = (await mine.state()).state.requirements[siteId] as { id: string; name: string }[];
  const plain = reqs.find((r) => r.name === 'Baseline risk assessment')!;
  reqId = plain.id; reqName = plain.name;
  coidReqId = reqs.find((r) => MARK.test(r.name))!.id;
  const staffEmail = uniqueEmail('staff');
  assert.equal((await mine.post('/api/org/invites', { email: staffEmail, role: 'member' })).status, 200);
  mineStaff = (await signup(app, { orgName: '', orgKind: 'host', email: staffEmail, inviteToken: await lastEmailToken(staffEmail, '/invite') })).agent;
});
after(teardown);

describe('replacement documents', () => {
  let exchangeId: string, itemId: string, portal: Portal;

  it('a first copy comes in through the secure link and is approved on the requirement', async () => {
    const r = await mine.post('/api/exchanges/request', { contractorId, contactName: 'Sipho', email: recipient, items: [{ requirementId: reqId }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const p = new Portal(await link(recipient)); await p.signIn(recipient);
    const view = (await p.get('/api/x/exchange')).body;
    assert.equal(view.items[0].kind, 'document');
    assert.equal(view.items[0].needsExpiry, true);
    assert.equal((await p.upload(view.items[0].id)).status, 200);
    assert.equal((await p.post('/api/x/submit', {})).status, 200);
    let d = await doc();
    assert.equal(d.status, 'awaiting_review', 'a returned document waits for review; it is never approved by uploading');
    assert.equal((await versions()).length, 1);
    const ex = (await mine.get(`/api/exchanges/${r.body.id}`)).body;
    assert.equal((await mine.post(`/api/exchanges/${r.body.id}/review`, { decisions: [{ itemId: ex.items[0].id, decision: 'approve' }] })).status, 200);
    d = await doc();
    assert.equal(d.status, 'complete');
  });

  it('prefills from the document and suggests a replacement once it has expired', async () => {
    let pre = (await mine.get(`/api/exchanges/prefill?requirementId=${reqId}`)).body;
    assert.equal(pre.documentType, reqName);
    assert.equal(pre.siteName, 'Shaft 9');
    assert.equal(pre.contractor.name, 'Docreq Rigging');
    assert.equal(pre.contact.email, recipient);
    assert.equal(pre.allowed.replacement, true);
    assert.equal(pre.suggestion, null);
    await pool.query(`update documents set expiry_date = current_date - 3 where requirement_id = $1`, [reqId]);
    pre = (await mine.get(`/api/exchanges/prefill?requirementId=${reqId}`)).body;
    assert.equal(pre.suggestion, 'replacement');
    assert.match(pre.suggestedReason, /^Expired on /);
    // Expiry only suggests it: a replacement is allowed for any good reason, expired or not.
    await pool.query(`update documents set expiry_date = current_date + 400 where requirement_id = $1`, [reqId]);
    assert.equal((await mine.get(`/api/exchanges/prefill?requirementId=${reqId}`)).body.allowed.replacement, true);
  });

  it('needs a reason, a reviewer, and a requirement inside the caller\'s own tenant', async () => {
    const base = { contractorId, contactName: 'Sipho', email: recipient, items: [{ kind: 'replacement', requirementId: reqId, reason: '' }] };
    assert.equal((await mine.post('/api/exchanges/request', base)).status, 400);
    const ok = { ...base, items: [{ kind: 'replacement', requirementId: reqId, reason: 'Unreadable scan' }] };
    assert.equal((await mineStaff.post('/api/exchanges/request', ok)).status, 403, 'staff who cannot review cannot request');
    assert.equal((await otherMine.post('/api/exchanges/request', { ...ok, contractorId: undefined, company: 'X' })).status, 404, "another mine cannot name this mine's requirement");
    assert.equal((await otherMine.get(`/api/exchanges/prefill?requirementId=${reqId}`)).status, 404);
    assert.equal((await mine.post('/api/exchanges/request', { ...ok, items: [{ kind: 'replacement', requirementId: reqId, reason: 'x'.repeat(1001) }] })).status, 400);
  });

  it('sends a short email with the request details and one button, and says honestly what happened to it', async () => {
    const r = await mine.post('/api/exchanges/request', {
      contractorId, contactName: 'Sipho', email: recipient, deadline: '2099-02-01',
      items: [{ kind: 'replacement', requirementId: reqId, reason: 'The scan is unreadable', dueDate: '2099-01-15' }],
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    exchangeId = r.body.id;
    assert.equal(r.body.email.state, 'not_configured', 'without a mail server nothing was sent, and the answer says so');
    const m = await mail(recipient);
    assert.match(m.subject, new RegExp(`^Replacement needed: ${reqName.replace(/[()]/g, '.')}`));
    assert.match(m.text_body, /Docreq Mine has requested a document from Docreq Rigging through COMVERA for Shaft 9/);
    assert.match(m.text_body, /Replacement needed: .* — The scan is unreadable — due 2099-01-15/);
    assert.match(m.html_body, /Upload replacement/);
    assert.equal((m.html_body.match(/<a href=/g) ?? []).length, 1, 'one button');
    assert.ok(!/Sipho Ndlovu/.test(m.subject));
    portal = new Portal(await link(recipient));
    const ex = (await mine.get(`/api/exchanges/${exchangeId}`)).body;
    itemId = ex.items[0].id;
    assert.equal(ex.items[0].kind, 'replacement');
    assert.equal(ex.items[0].requirementName, reqName);
    assert.ok(ex.history.some((h: any) => h.action === 'Exchange request created'));
    assert.ok(ex.history.some((h: any) => h.action === 'Exchange email queued'));
  });

  it('shows the request where the document is, and will not create the same open request twice', async () => {
    const open = (await mine.get(`/api/exchanges/outstanding?requirementId=${reqId}`)).body.open;
    assert.equal(open.length, 1);
    assert.equal(open[0].kind, 'replacement');
    assert.equal((await otherMine.get(`/api/exchanges/outstanding?requirementId=${reqId}`)).body.open.length, 0, 'another tenant sees nothing');
    const again = await mine.post('/api/exchanges/request', { contractorId, contactName: 'Sipho', email: recipient, items: [{ kind: 'replacement', requirementId: reqId, reason: 'Again' }] });
    assert.equal(again.status, 200);
    assert.equal(again.body.duplicate.id, exchangeId);
    assert.equal(again.body.id, undefined);
    const n = (await pool.query(`select count(*)::int as n from exchanges where sender_org_id = $1`, [mineOrgId])).rows[0].n;
    // Two double clicks at once still make one request.
    const [a, b] = await Promise.all([1, 2].map(() => mine.post('/api/exchanges/request', { contractorId, contactName: 'Sipho', email: recipient, items: [{ kind: 'replacement', requirementId: reqId, reason: 'Race' }] })));
    assert.ok(a.body.duplicate && b.body.duplicate);
    assert.equal((await pool.query(`select count(*)::int as n from exchanges where sender_org_id = $1`, [mineOrgId])).rows[0].n, n);
  });

  it('the recipient opens the request, uploads a replacement, and it waits for review with the old version kept', async () => {
    await portal.signIn(recipient);
    const v = (await portal.get('/api/x/exchange')).body;
    const it = v.items[0];
    assert.equal(it.kind, 'replacement');
    assert.equal(it.reason, 'The scan is unreadable');
    assert.equal(v.exchange.siteName, 'Shaft 9');
    assert.equal(it.hasSource, false, 'a replacement does not hand the old document back');
    const before = await versions();
    assert.equal((await portal.upload(it.id, 'new.pdf', Buffer.concat([PDF, Buffer.from('%new\n')]))).status, 200);
    assert.equal((await portal.post('/api/x/submit', { message: 'Rescanned' })).status, 200);
    const d = await doc();
    assert.equal(d.status, 'awaiting_review', 'the new upload is not approved and nobody turns Site Ready by uploading');
    const after = await versions();
    assert.equal(after.length, before.length + 1, 'the previous version stays in the history');
    assert.equal(after[0].file_id, before[0].file_id);
    assert.equal(d.version, after[after.length - 1].version);
    const ex = (await mine.get(`/api/exchanges/${exchangeId}`)).body;
    assert.equal(ex.items[0].status, 'submitted', 'submitted by the recipient is not accepted by the reviewer');
    assert.equal(ex.exchange.status, 'submitted');
  });

  it('a reviewer sends it back with a reason, the recipient replaces it, and the review history is kept', async () => {
    assert.equal((await mine.post(`/api/exchanges/${exchangeId}/review`, { decisions: [{ itemId, decision: 'reject', note: '' }] })).status, 400, 'a reason is required');
    assert.equal((await mine.post(`/api/exchanges/${exchangeId}/review`, { decisions: [{ itemId, decision: 'reject', note: 'Still unreadable' }] })).status, 200);
    assert.equal((await doc()).status, 'correction_required');
    const p2 = new Portal(await link(recipient)); await p2.signIn(recipient);
    const it = (await p2.get('/api/x/exchange')).body.items[0];
    assert.equal(it.status, 'rejected');
    assert.equal(it.reviewNote, 'Still unreadable');
    assert.equal((await p2.upload(it.id, 'third.pdf', Buffer.concat([PDF, Buffer.from('%third\n')]))).status, 200);
    assert.equal((await p2.post('/api/x/submit', {})).status, 200);
    assert.equal((await mine.post(`/api/exchanges/${exchangeId}/review`, { decisions: [{ itemId, decision: 'approve' }] })).status, 200);
    assert.equal((await doc()).status, 'complete');
    const reviews = (await pool.query(`select kind, text from reviews where document_id = $1 order by created_at`, [(await doc()).id])).rows;
    assert.ok(reviews.some((r) => r.kind === 'correction' && /Still unreadable/.test(r.text)));
    assert.ok(reviews.filter((r) => r.kind === 'approval').length >= 2);
    assert.equal((await versions()).length, 3);
    const ex = (await mine.get(`/api/exchanges/${exchangeId}`)).body;
    assert.equal(ex.exchange.status, 'approved');
    assert.ok(ex.history.some((h: any) => h.action === 'Exchange document filed for review'));
  });

  it('a lapsing document type needs its valid-until date before it can be sent', async () => {
    const r = await mine.post('/api/exchanges/request', { contractorId, contactName: 'Sipho', email: 'second@docreq.example', items: [{ requirementId: coidReqId }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const p = new Portal(await link('second@docreq.example')); await p.signIn('second@docreq.example');
    const it = (await p.get('/api/x/exchange')).body.items[0];
    assert.equal(it.expiryRequired, true);
    await p.upload(it.id);
    const blocked = await p.post('/api/x/submit', {});
    assert.equal(blocked.status, 400);
    assert.equal(blocked.body.error, 'expiry_required');
    assert.equal((await p.post(`/api/x/items/${it.id}/expiry`, { expiryDate: '2001-01-01' })).status, 400);
    assert.equal((await p.post(`/api/x/items/${it.id}/expiry`, { expiryDate: '2040-01-01' })).status, 200);
    assert.equal((await p.post('/api/x/submit', {})).status, 200);
    assert.equal((await pool.query(`select to_char(expiry_date, 'YYYY-MM-DD') as e from documents where requirement_id = $1`, [coidReqId])).rows[0].e, '2040-01-01');
  });
});

describe('reminders, cancelling and links', () => {
  let exchangeId: string, token: string;
  it('reminds once, not repeatedly, then cancels; the old link stops working', async () => {
    const r = await mine.post('/api/exchanges/request', { contractorId, contactName: 'Sipho', email: 'third@docreq.example', items: [{ kind: 'other', documentType: 'Site access letter' }] });
    assert.equal(r.status, 200);
    exchangeId = r.body.id; token = await link('third@docreq.example');
    const first = await mine.post(`/api/exchanges/${exchangeId}/resend`, {});
    assert.equal(first.status, 200);
    assert.equal(first.body.email.state, 'not_configured');
    assert.equal((await mine.post(`/api/exchanges/${exchangeId}/resend`, {})).status, 409, 'no second reminder within the hour');
    assert.equal((await new Portal(token).req('POST', '/api/x/open', { token })).status, 404, 'a reminder replaces the old link');
    const fresh = await link('third@docreq.example');
    assert.equal((await mine.post(`/api/exchanges/${exchangeId}/revoke`, {})).status, 200);
    const gone = await new Portal(fresh).req('POST', '/api/x/open', { token: fresh });
    assert.equal(gone.status, 410);
    assert.match(gone.body.message, /withdrawn/);
    const ex = (await mine.get(`/api/exchanges/${exchangeId}`)).body;
    assert.ok(ex.history.some((h: any) => h.action === 'Request cancelled'));
    assert.equal(ex.exchange.remindCount, 1);
    assert.equal((await new Portal('x'.repeat(43)).req('POST', '/api/x/open', { token: 'x'.repeat(43) })).status, 404, 'an invalid link is just invalid');
  });

  it('a link opened by the wrong person gets no code, and an expired request is refused', async () => {
    const r = await mine.post('/api/exchanges/request', { contractorId, contactName: 'Sipho', email: 'fourth@docreq.example', items: [{ documentType: 'Anything' }] });
    const t = await link('fourth@docreq.example');
    const p = new Portal(t); await p.req('POST', '/api/x/open', { token: t });
    const wrong = await p.req('POST', '/api/x/code', { token: t, email: 'attacker@evil.example' });
    assert.equal(wrong.status, 200);
    assert.equal((await pool.query(`select count(*)::int as n from email_outbox where to_email = 'attacker@evil.example'`)).rows[0].n, 0, 'no code is sent to a stranger');
    await pool.query(`update exchanges set access_expires_at = now() - interval '1 hour' where id = $1`, [r.body.id]);
    assert.equal((await new Portal(t).req('POST', '/api/x/open', { token: t })).status, 410);
  });

  it('reports a failed email as failed, not as sent', async () => {
    const r = await mine.post('/api/exchanges/request', { contractorId, contactName: 'Sipho', email: 'fifth@docreq.example', items: [{ documentType: 'Anything else' }] });
    features.email = true;
    try {
      let ex = (await mine.get(`/api/exchanges/${r.body.id}`)).body;
      assert.equal(ex.exchange.email.state, 'queued');
      await pool.query(`update email_outbox set status = 'failed', attempts = 6 where to_email = 'fifth@docreq.example'`);
      ex = (await mine.get(`/api/exchanges/${r.body.id}`)).body;
      assert.equal(ex.exchange.email.state, 'failed');
      await pool.query(`update email_outbox set status = 'sent' where to_email = 'fifth@docreq.example'`);
      assert.equal((await mine.get(`/api/exchanges/${r.body.id}`)).body.exchange.email.state, 'sent');
    } finally { features.email = false; }
  });
});

describe('signed copies', () => {
  let docId: string, exchangeId: string, itemId: string;
  it('a signature request carries the exact document and version, and no unrelated paid workspace is needed', async () => {
    const up = await mine.upload('/api/org-docs', 'Contract of employment.pdf', PDF);
    assert.equal(up.status, 200, JSON.stringify(up.body));
    docId = up.body.id ?? up.body.document?.id;
    assert.ok(docId, JSON.stringify(up.body));
    const pre = (await mine.get(`/api/exchanges/prefill?sourceKind=org_document&sourceId=${docId}`)).body;
    assert.equal(pre.suggestion, 'signature');
    assert.equal(pre.allowed.signature, true);
    assert.equal(pre.allowed.replacement, false);
    const r = await mine.post('/api/exchanges/request', { company: 'Thabo Mokoena', contactName: 'Thabo', email: 'thabo@docreq.example', items: [{ kind: 'signature', source: { kind: 'org_document', id: docId }, personName: 'Thabo Mokoena', reason: 'Please sign and return', dueDate: '2099-03-01' }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    exchangeId = r.body.id;
    const m = await mail('thabo@docreq.example');
    assert.match(m.subject, /^Signed copy needed: /);
    assert.ok(!/Thabo/.test(m.subject), 'no person in the subject');
    assert.match(m.html_body, /Open and return signed copy/);
    const ex = (await mine.get(`/api/exchanges/${exchangeId}`)).body;
    itemId = ex.items[0].id;
    assert.equal(ex.items[0].source.version, '1');
    assert.equal(ex.items[0].source.revised, false);
    assert.equal(ex.items[0].requirementId, null);
  });

  it('only the intended recipient can fetch the document to sign, and only through this request', async () => {
    const p = new Portal(await link('thabo@docreq.example'));
    assert.equal((await p.get(`/api/x/items/${itemId}/source`)).status, 401, 'no session, no document');
    await p.signIn('thabo@docreq.example');
    const view = (await p.get('/api/x/exchange')).body;
    assert.equal(view.items[0].hasSource, true);
    const got = await p.get(`/api/x/items/${itemId}/source?download=1`);
    assert.equal(got.status, 200);
    assert.match(String(got.raw.headers['content-type']), /pdf/);
    // Another recipient's session cannot reach it by item id.
    const other = await mine.post('/api/exchanges/request', { contractorId, contactName: 'Sipho', email: 'stranger@docreq.example', items: [{ documentType: 'Whatever' }] });
    assert.equal(other.status, 200);
    const sp = new Portal(await link('stranger@docreq.example')); await sp.signIn('stranger@docreq.example');
    assert.equal((await sp.get(`/api/x/items/${itemId}/source`)).status, 404);
    // Nor can another tenant request it as its own source.
    assert.equal((await otherMine.post('/api/exchanges/request', { company: 'X', email: 'x@docreq.example', items: [{ kind: 'signature', source: { kind: 'org_document', id: docId } }] })).status, 404);
  });

  it('the signed copy comes back as a version-bound return, reviewed and recorded without claiming a verified signature', async () => {
    const p = new Portal(await link('thabo@docreq.example')); await p.signIn('thabo@docreq.example');
    const it = (await p.get('/api/x/exchange')).body.items[0];
    const dvBefore = (await pool.query(`select count(*)::int as n from document_versions`)).rows[0].n;
    assert.equal((await p.upload(it.id, 'signed.pdf', Buffer.concat([PDF, Buffer.from('%signed\n')]))).status, 200);
    assert.equal((await p.post('/api/x/submit', {})).status, 200);
    // The company document is revised after the request: the signature still refers to the version it was sent with.
    const rev = (await pool.query(`insert into files (org_id, storage_key, filename, content_type, size_bytes, sha256) values ($1, 'x/rev', 'rev.pdf', 'application/pdf', 10, 'abc') returning id`, [mineOrgId])).rows[0].id;
    await pool.query(`update org_documents set version = version + 1, current_file_id = $2 where id = $1`, [docId, rev]);
    let ex = (await mine.get(`/api/exchanges/${exchangeId}`)).body;
    assert.equal(ex.items[0].status, 'submitted');
    assert.equal(ex.items[0].source.version, '1');
    assert.equal(ex.items[0].source.revised, true, 'a later revision never silently inherits the signature');
    assert.equal((await mine.post(`/api/exchanges/${exchangeId}/review`, { decisions: [{ itemId, decision: 'approve' }] })).status, 200);
    ex = (await mine.get(`/api/exchanges/${exchangeId}`)).body;
    const h = ex.history.find((x: any) => x.action === 'Signed copy accepted');
    assert.ok(h && /does not verify signatures/.test(h.detail));
    assert.equal(ex.items[0].submissions.length, 1);
    assert.equal((await pool.query(`select count(*)::int as n from document_versions`)).rows[0].n, dvBefore, 'a signed copy never becomes a requirement document');
  });
});

describe('other documents', () => {
  it('a custom request needs a name, stays out of the mandatory requirements, and is fulfilled in its own context', async () => {
    const noName = await mine.post('/api/exchanges/request', { contractorId, contactName: 'Sipho', email: 'other@docreq.example', items: [{ kind: 'other', documentType: '' }] });
    assert.equal(noName.status, 400);
    assert.match(noName.body.message, /name of the document/);
    const before = (await mine.state()).state.requirements[siteId].length;
    const r = await mine.post('/api/exchanges/request', { contractorId, siteId, contactName: 'Sipho', email: 'other@docreq.example', items: [{ kind: 'other', documentType: 'Site access letter', reason: 'For the gate office' }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const p = new Portal(await link('other@docreq.example')); await p.signIn('other@docreq.example');
    const it = (await p.get('/api/x/exchange')).body.items[0];
    assert.equal(it.needsExpiry, false);
    await p.upload(it.id); assert.equal((await p.post('/api/x/submit', {})).status, 200);
    assert.equal((await mine.state()).state.requirements[siteId].length, before, 'an ad hoc request never silently changes readiness rules');
    assert.equal((await mine.get(`/api/exchanges/outstanding?siteId=${siteId}`)).body.open.some((o: any) => o.documentType === 'Site access letter'), true);
  });
});
