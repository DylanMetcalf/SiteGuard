/** Bulk invitations and the audit export for inspectors. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, pool, setup, signup, teardown } from './helpers.js';

let app: FastifyInstance;
let mine: Agent, staff: Agent;

before(async () => {
  app = await setup();
  mine = (await signup(app, { orgName: 'Bulk Mining', orgKind: 'host' })).agent;
  const inv = await mine.post('/api/org/invites', { email: 'staffer@example.com', role: 'member' });
  assert.equal(inv.status, 200);
});
after(teardown);

describe('bulk invitations', () => {
  it('each row succeeds or fails on its own, with a reason', async () => {
    const r = await mine.post('/api/org/invites/bulk', { rows: [
      { email: 'one@example.com', role: 'member' },
      { email: 'ONE@example.com', role: 'member' },
      { email: 'not-an-email', role: 'member' },
      { email: 'two@example.com', role: 'reviewer' },
      { email: 'three@example.com', role: 'owner' },
    ] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.results.map((x: { ok: boolean }) => x.ok), [true, false, false, true, true]);
    assert.match(r.body.results[1].message, /more than once/);
    assert.match(r.body.results[2].message, /valid email/);
    assert.equal(r.body.sent, 3);
    assert.equal((await pool.query(`select count(*)::int as n from user_invites where email in ('one@example.com','two@example.com','three@example.com') and accepted_at is null`)).rows[0].n, 3);
  });

  it('refuses an empty or oversized list, and is for admins only', async () => {
    assert.equal((await mine.post('/api/org/invites/bulk', { rows: [] })).status, 400);
    assert.equal((await mine.post('/api/org/invites/bulk', { rows: Array.from({ length: 101 }, (_, i) => ({ email: `p${i}@example.com`, role: 'member' })) })).status, 400);
    staff = (await signup(app, { orgName: 'Other Co', orgKind: 'host' })).agent;
    // another organisation's admin only ever invites into their own organisation
    const r = await staff.post('/api/org/invites/bulk', { rows: [{ email: 'cross@example.com', role: 'member' }] });
    assert.equal(r.status, 200);
    const org = (await pool.query(`select o.name from user_invites i join organisations o on o.id = i.org_id where i.email = 'cross@example.com'`)).rows[0].name;
    assert.equal(org, 'Other Co');
  });

  it('a read-only Site Staff member cannot send invitations', async () => {
    const { sha256 } = await import('../src/lib/security.js');
    const org = (await pool.query(`select id from organisations where name = 'Bulk Mining'`)).rows[0].id;
    const owner = (await pool.query(`select user_id from memberships where org_id = $1 limit 1`, [org])).rows[0].user_id;
    await pool.query(`insert into user_invites (org_id, email, role, token_hash, invited_by, expires_at) values ($1, 'ro@example.com', 'member', $2, $3, now() + interval '1 day')`, [org, sha256('ro-token'), owner]);
    const ro = new Agent(app);
    assert.equal((await ro.post('/api/auth/signup', { name: 'RO', email: 'ro@example.com', password: 'correct horse battery staple', inviteToken: 'ro-token' })).status, 200);
    await pool.query(`update users set email_verified_at = now() where email = 'ro@example.com'`);
    await ro.refresh();
    assert.equal((await ro.post('/api/org/invites/bulk', { rows: [{ email: 'x@example.com', role: 'member' }] })).status, 403);
  });
});

import { csvCell } from '../src/lib/csv.js';

describe('invitation cap', () => {
  it('an organisation cannot send more than 300 invitations a day (no mail relay)', async () => {
    const org = (await pool.query(`select id from organisations where name = 'Bulk Mining'`)).rows[0].id;
    const owner = (await pool.query(`select user_id from memberships where org_id = $1 and role = 'owner' limit 1`, [org])).rows[0].user_id;
    await pool.query(`insert into user_invites (org_id, email, role, token_hash, invited_by, expires_at) select $1, 'fill' || g || '@example.com', 'member', 'h' || g, $2, now() + interval '1 day' from generate_series(1, 300) g`, [org, owner]);
    const r = await mine.post('/api/org/invites', { email: 'onetoomany@example.com', role: 'member' });
    assert.equal(r.status, 429, JSON.stringify(r.body));
    const b = await mine.post('/api/org/invites/bulk', { rows: [{ email: 'bulktoomany@example.com', role: 'member' }] });
    assert.equal(b.status, 200); assert.equal(b.body.results[0].ok, false);
  });
});

describe('audit export', () => {
  it('neutralises formulas and doubles quotes', () => {
    assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
    for (const c of ['+1', '-1', '@x']) assert.ok(csvCell(c).startsWith('"\''));
    assert.equal(csvCell(null), '""');
  });
  it('downloads as a spreadsheet file, escaping formulas and quotes', async () => {
    const r = await mine.req('GET', '/api/audit?format=csv');
    assert.equal(r.status, 200);
    assert.match(String(r.raw.headers['content-type']), /text\/csv/);
    assert.match(String(r.raw.headers['content-disposition']), /attachment; filename="comvera-audit-\d{4}-\d{2}-\d{2}\.csv"/);
    const text = r.raw.body;
    assert.ok(text.includes('"When (UTC)"'));
    assert.ok(text.startsWith('\ufeff'), 'opens correctly in Excel');
    assert.ok(text.includes('Invited user'));
    assert.equal((await mine.get('/api/audit')).status, 200, 'the JSON form still works');
  });
});

import { projectCoverNote } from '../src/lib/bundle.js';

describe('PDF cover invitation for clients not on COMVERA', () => {
  it('appears only on files prepared for a client who is not on COMVERA, and makes no price claim', () => {
    const note = projectCoverNote(true, 'https://www.comvera.co.za');
    assert.match(String(note), /collect, review and approve contractor safety files online/);
    assert.match(String(note), /www\.comvera\.co\.za\/for-sites$/);
    assert.ok(!/free|R\d|price/i.test(String(note)), 'no claim about cost');
    assert.equal(projectCoverNote(false), undefined, 'nothing extra on files already reviewed in COMVERA');
  });
});
