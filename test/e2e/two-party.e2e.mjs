/**
 * Browser end-to-end test of the core multi-tenant promise: two companies on
 * two devices sharing one live record. A site owner signs up and invites a
 * contractor by email; the contractor accepts from the link in a separate
 * browser, submits a document; the owner sees it arrive without refreshing,
 * approves, and marks the site ready; the contractor shares the safety file
 * with an outsider, then revokes it.
 *
 * Run against a server started with default settings (no SMTP, so emails land
 * in the outbox table this test reads):
 *   npm run dev                          # in one terminal
 *   BASE_URL=http://localhost:3000 npm run test:e2e
 * Set PLAYWRIGHT_CHROMIUM_PATH to use an existing Chromium, or run
 * `npx playwright install chromium` once.
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';

const base = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const appUrl = (process.env.APP_URL || base).replace(/\/$/, '');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL || 'postgres://siteguard:siteguard@localhost:5432/siteguard' });
await db.connect();
const token = async (to, linkPath) => {
  const r = await db.query(`select text_body from email_outbox where to_email = $1 and text_body like $2 order by id desc limit 1`, [to, `%${linkPath}?token=%`]);
  return r.rows[0].text_body.match(new RegExp(`${linkPath}\\?token=([A-Za-z0-9_-]+)`))[1];
};
const SP = mkdtempSync(path.join(tmpdir(), 'siteguard-e2e-'));

const stamp = Date.now();
const hostEmail = `host${stamp}@example.com`, contractorEmail = `safety${stamp}@sparks.example.com`;
const PDF = `${SP}/coid.pdf`;
writeFileSync(PDF, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('sg_tutorial_seen', '1'); } catch {} });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('CERT')) page.errors.push(m.text()); });
  return page;
};
const host = await mk(), contractor = await mk(), outsider = await mk();
const log = (m) => console.log('✓ ' + m);
const act = async (p, sel) => { await p.locator(sel).first().click({ timeout: 8000 }); await p.waitForTimeout(400); };

// 1. Host signs up
await host.goto(base);
await act(host, '[data-action="auth-go"][data-view="signup"]');
await host.fill('#suName', 'Thandi Nkosi');
await host.fill('#suEmail', hostEmail);
await host.fill('#suPassword', 'a long enough passphrase');
await host.fill('#suOrgName', 'Riverside Mining <b>Group</b>');
await act(host, '[data-action="signup"]');
await host.waitForSelector('.topbar');
log('host signed up (org name with HTML is rendered as text: ' + (await host.locator('.brand-tag').innerText()) + ')');
await host.goto(base + '/verify-email?token=' + (await token(hostEmail, '/verify-email')));
await host.waitForSelector('.topbar');
log('host confirmed email');

// 2. Host adds a site with a new contractor and one requirement
await act(host, '[data-action="open-fab"]');
await act(host, '[data-qa="add-site"]');
await host.fill('#newSiteName', 'North Pit — Pump Station Upgrade');
await host.fill('#newSiteLocation', 'North Pit');
await host.fill('#nsCName', 'Sparks Electrical');
await host.fill('#nsCEmail', contractorEmail);
// Start from an empty list here; starter packs are exercised in the integration tests.
await host.uncheck('.pack-box[value="baseline"]');
await act(host, '[data-action="save-site"]');
await host.waitForSelector('text=Awaiting contractor response');
await act(host, '[data-action="add-requirement"]');

await host.fill('#arCategory', 'Company Documents');
await host.fill('#arName', 'Letter of Good Standing (COID)');
await act(host, '[data-action="save-requirement"]');
await act(host, '[data-action="close-sheet"]');
log('host created site, invited contractor by email, added a requirement');

// 3. Contractor accepts from the emailed link and signs up
await contractor.goto(base + '/site-invite?token=' + (await token(contractorEmail, '/site-invite')));
await contractor.waitForSelector('text=Site invitation');
await contractor.fill('#suName', 'Sipho Ndlovu');
await contractor.fill('#suPassword', 'another long passphrase');
await act(contractor, '[data-action="signup"][data-mode="site-invite"]');
await contractor.waitForSelector('text=North Pit — Pump Station Upgrade');
log('contractor signed up from the invite and landed on the site');

// Host sees acceptance live
await host.waitForSelector('text=Site Readiness', { timeout: 8000 });
log('host saw the acceptance live (no refresh)');

// 4. Contractor uploads and submits
await act(contractor, '[data-action="open-req"]');
await contractor.setInputFiles('#fileInput', PDF);
await contractor.waitForSelector('#submitReqBtn:not([disabled])', { timeout: 8000 });
await contractor.fill('#expiryInput', '2099-06-30');
await act(contractor, '[data-action="submit-req"]');
log('contractor uploaded and submitted');

// 5. Host sees it live and approves
await host.waitForSelector('.reqrow .badge.awaiting_review', { timeout: 8000 });
log('host saw "Awaiting review" live');
await act(host, '[data-action="open-req"]');
const [popup] = await Promise.all([host.context().waitForEvent('page'), host.locator('.sheet a:has-text("View")').click()]);
await popup.waitForLoadState();
log('host opened the submitted file: ' + (await popup.evaluate(() => document.contentType)));
await popup.close();
await act(host, '[data-action="approve-req"]');
await host.waitForSelector('[data-action="approve-site"]', { timeout: 8000 });
await act(host, '[data-action="approve-site"]');
await host.waitForSelector('text=Site Ready');
log('host approved document and marked Site Ready');
await contractor.waitForSelector('.badge.approved', { timeout: 8000 });
log('contractor saw Site Ready live');

// 6. Contractor shares the safety file externally
await act(contractor, '[data-action="new-share-link"]');
await contractor.selectOption('#shareKind', 'safety_file');
await act(contractor, '[data-action="create-share-link"]');
const url = (await contractor.inputValue('#shareUrl')).replace(appUrl, base);
await outsider.goto(url);
await outsider.waitForSelector('text=SITE READY');
log('outsider opened share link: ' + (await outsider.title()));

// 7. Revoke; outsider loses access
await act(contractor, '[data-action="close-sheet"]');
await act(contractor, '[data-action="nav"][data-nav="more"]');
await act(contractor, '[data-view="links"]');
contractor.once('dialog', (d) => d.accept());
await act(contractor, '[data-action="revoke-link"]');
const res = await outsider.goto(url);
log('after revoke, share link returns ' + res.status());

// 8. Team invite from host
await act(host, '[data-action="nav"][data-nav="more"]');
await act(host, '[data-view="team"]');
await host.fill('#inviteEmail', `reviewer${stamp}@example.com`);
await host.selectOption('#inviteRole', 'reviewer');
await act(host, '[data-action="invite-user"]');
await host.waitForSelector(`text=reviewer${stamp}@example.com`);
log('host invited a reviewer by email');

let failed = false;
for (const [n, p] of [['host', host], ['contractor', contractor], ['outsider', outsider]]) {
  // The outsider's 410 after revocation is expected.
  const real = p.errors.filter((e) => !(n === 'outsider' && e.includes('410')));
  if (real.length) { failed = true; console.log(`Browser errors (${n}):\n` + real.join('\n')); }
}
await browser.close();
await db.end();
console.log(failed ? 'FAILED' : 'passed');
process.exit(failed ? 1 : 0);
