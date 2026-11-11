/** Orphan-file hygiene, early-warning alerts and the sliding-window counter behind the per-email sign-in limit. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, PDF, pool, setup, signup, teardown } from './helpers.js';
import { findOrphans, removeOrphans } from '../src/lib/filehygiene.js';
import { storage } from '../src/lib/storage.js';
import { SlidingWindow } from '../src/lib/window.js';
import { THRESHOLDS, checkAlerts, noteSignal, resetAlerts } from '../src/lib/alerts.js';

let app: FastifyInstance;
let mine: Agent, orgId: string;

before(async () => {
  app = await setup();
  const s = await signup(app, { orgName: 'Hygiene Mining', orgKind: 'host' });
  mine = s.agent;
  orgId = (await pool.query(`select org_id from memberships m join users u on u.id = m.user_id where u.email = $1`, [s.email])).rows[0].org_id;
});
after(teardown);

const newFile = async (key: string, ageDays: number) => {
  await storage.put(key, Buffer.from('x'), 'application/pdf');
  return (await pool.query(
    `insert into files (org_id, storage_key, filename, content_type, size_bytes, sha256, created_at) values ($1, $2, 'f.pdf', 'application/pdf', 1, 'abc', now() - ($3::int * interval '1 day')) returning id`,
    [orgId, key, ageDays])).rows[0].id as string;
};

describe('orphan file hygiene', () => {
  it('finds only old, unreferenced files; keeps referenced, recent and logo files', async () => {
    const orphan = await newFile('t/orphan-' + Date.now(), 10);
    const recent = await newFile('t/recent-' + Date.now(), 1);
    const logo = await newFile('t/logo-' + Date.now(), 10);
    await pool.query(`update organisations set settings = settings || jsonb_build_object('logoFileId', $2::text) where id = $1`, [orgId, logo]);
    const up = await mine.upload('/api/org-docs', 'kept.pdf', PDF);
    assert.equal(up.status, 200, JSON.stringify(up.body));
    await pool.query(`update files set created_at = now() - interval '30 days'`); // age everything, including the real upload
    await pool.query(`update files set created_at = now() - interval '1 day' where id = $1`, [recent]);
    const ids = (await findOrphans(pool)).map((o) => o.id);
    assert.ok(ids.includes(orphan), 'the unreferenced old file is found');
    assert.ok(!ids.includes(recent), 'a recent file may still be in the middle of an upload');
    assert.ok(!ids.includes(logo), 'a logo is referenced from settings');
    const kept = (await pool.query(`select current_file_id from org_documents where id = $1`, [up.body.id])).rows[0].current_file_id;
    assert.ok(!ids.includes(kept), 'an uploaded document’s file is referenced');
  });

  it('removes the row and the stored object, and re-checks before deleting', async () => {
    const key = 't/remove-' + Date.now();
    const id = await newFile(key, 10);
    const found = (await findOrphans(pool)).filter((o) => o.id === id);
    assert.equal(found.length, 1);
    // Something attaches the file between the scan and the delete: it must survive.
    const doc = (await mine.upload('/api/org-docs', 'second.pdf', PDF)).body;
    await pool.query('update org_documents set current_file_id = $1 where id = $2', [id, doc.id]);
    assert.equal(await removeOrphans(found), 0, 'a file that gained a reference is left alone');
    await pool.query('update org_documents set current_file_id = null where id = $1', [doc.id]);
    assert.equal(await removeOrphans(found), 1);
    assert.equal((await pool.query('select 1 from files where id = $1', [id])).rowCount, 0);
    await assert.rejects(() => storage.read(key), 'the stored object is gone too');
  });
});

describe('sliding window', () => {
  it('counts inside the window only and bounds memory', () => {
    const w = new SlidingWindow(1000, 10);
    assert.equal(w.hit('a', 0), 1); assert.equal(w.hit('a', 500), 2); assert.equal(w.hit('a', 1200), 2);
    assert.equal(w.count('a', 5000), 0);
    for (let i = 0; i < 100; i++) w.hit('k' + i, 10_000 + i);
    assert.ok((w as unknown as { hits: Map<string, number[]> }).hits.size <= 11, 'distinct keys cannot grow without bound');
  });
});

describe('early-warning alerts', () => {
  it('emails the platform owner once when a threshold is crossed, with counts only', async () => {
    process.env.PLATFORM_ADMIN_EMAILS ??= '';
    const { config } = await import('../src/config.js');
    (config as { PLATFORM_ADMIN_EMAILS: string }).PLATFORM_ADMIN_EMAILS = 'owner@example.com';
    resetAlerts();
    const now = Date.now();
    for (let i = 0; i < THRESHOLDS.server_error - 1; i++) noteSignal('server_error', now);
    assert.deepEqual(await checkAlerts(pool, now), [], 'below the threshold nothing is sent');
    noteSignal('server_error', now);
    assert.deepEqual(await checkAlerts(pool, now), ['server_error']);
    assert.deepEqual(await checkAlerts(pool, now + 60_000), [], 'the same signal does not repeat within the hour');
    const mail = (await pool.query(`select subject, text_body from email_outbox where to_email = 'owner@example.com'`)).rows;
    assert.equal(mail.length, 1);
    assert.match(mail[0].subject, /Server errors are rising/);
    assert.ok(!/password|token|@/i.test(mail[0].text_body), 'an alert carries counts only, no personal details');
  });

  it('a 500 and failed logins are counted by the app', async () => {
    const { signalCount } = await import('../src/lib/alerts.js');
    const before = signalCount('login_failed');
    await new Agent(app).post('/api/auth/login', { email: 'nobody@example.com', password: 'wrong password here' });
    assert.equal(signalCount('login_failed'), before + 1);
  });
});
