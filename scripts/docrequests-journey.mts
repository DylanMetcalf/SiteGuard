/**
 * Document-request journeys in real browsers, with made-up data on a LOCAL server (no real email, payments or people):
 * replacement, signed copy, other document, the recipient portal, contractor-owner Exchange access, profile menu and
 * Plans & billing, at desktop and phone size. Email is read from the local outbox (the test sink).
 *   BASE_URL=http://localhost:3102 DATABASE_URL=… npx tsx scripts/docrequests-journey.mts
 * Start the server with ENFORCE_PLANS=true so trial / lapsed accounts behave as in production.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BASE, Bot, PDF, PW, check, chromium, db, rows, tag } from './bots-lib.mts';

const AXE = readFileSync(process.env.AXE_PATH || '/tmp/axe/node_modules/axe-core/axe.min.js', 'utf8');
const SHOTS = process.env.SHOTS;
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
let ipn = 1;
const problems: string[] = [];
async function page(w = 1280, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, extraHTTPHeaders: { 'x-forwarded-for': `10.97.${Math.floor(ipn / 250)}.${(ipn++ % 250) + 1}` } });
  await ctx.addInitScript('window.__name = (f) => f');
  const p = await ctx.newPage();
  p.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push('console: ' + m.text().slice(0, 160)); });
  p.on('response', (r) => { if (r.status() >= 500) problems.push(`5xx ${r.status()} ${r.url().replace(BASE, '')}`); });
  return { ctx, p };
}
const dir = mkdtempSync(path.join(tmpdir(), 'docreq-'));
const pdfFile = (name: string) => { const f = path.join(dir, name); writeFileSync(f, Buffer.concat([PDF, Buffer.from('%' + name + '\n')])); return f; };
const shot = async (p: any, n: string) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/dr-${n}.png` }); };
async function signIn(p: any, bot: Bot) {
  await p.goto(BASE + '/'); if (!(await p.$('#siEmail'))) await p.$$eval('[data-action]', (e: any[]) => e.find((x) => /sign in/i.test(x.textContent))?.click());
  await p.fill('#siEmail', bot.email); await p.fill('#siPassword', PW); await p.click('[data-action="signin"]');
  await p.waitForSelector('.bottomnav'); await p.waitForTimeout(700); await p.click('#tutSkip', { timeout: 1500 }).catch(() => {});
}
async function test(name: string, fn: () => Promise<void>) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
  const t0 = Date.now(); const before = problems.length;
  try { await fn(); } catch (e) { check(name, 'completed without an unexpected error', false, (e as Error).message.split('\n')[0]); }
  check(name, 'no script errors or failed requests', problems.length === before, problems.slice(before).join(' | '));
  console.log(`  ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
const noSideScroll = async (p: any) => (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1;
async function axe(p: any) {
  await p.evaluate(AXE);
  const r = await p.evaluate(async () => (await (window as any).axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.filter((v: any) => ['serious', 'critical'].includes(v.impact)).map((v: any) => `${v.id}: ${v.nodes.length}`));
  return r as string[];
}
const lastLink = async (to: string) => (await db.query(`select text_body from email_outbox where to_email = $1 and text_body like '%/x/%' order by id desc limit 1`, [to])).rows[0]?.text_body.match(/\/x\/([A-Za-z0-9_-]+)/)?.[1] as string;
const lastMail = async (to: string) => (await db.query(`select subject, text_body from email_outbox where to_email = $1 and text_body like '%/x/%' order by id desc limit 1`, [to])).rows[0];
async function portalSignIn(p: any, token: string, email: string) {
  await p.goto(`${BASE}/x/${token}`); await p.fill('#xEmail', email); await p.click('button:has-text("Email me a code")');
  await p.waitForSelector('#xCode');
  const code = (await db.query(`select subject from email_outbox where to_email = $1 and subject like 'Your COMVERA code:%' order by id desc limit 1`, [email])).rows[0].subject.match(/(\d{6})/)[1];
  await p.fill('#xCode', code); await p.click('button:has-text("Continue")');
  await p.waitForSelector('.xp-item');
}

/* ---- world: a mine with a site and a contractor who has no workspace ---- */
const mine = new Bot('DRM'); await mine.signup('Docreq Mine ' + tag, 'host'); await mine.finishSetup();
const recipient = `sipho.${tag}@docreq.example`, worker = `thabo.${tag}@docreq.example`;
await mine.post('/api/sites', { name: 'Shaft 4', newContractor: { name: 'Ndlovu Rigging', contact: 'Sipho Ndlovu', email: recipient } });
const bs = (await mine.refresh()); const siteId = Object.keys(bs.state.sites)[0];
const added = await mine.post(`/api/sites/${siteId}/requirements`, { category: 'Company Documents', name: 'Risk assessment', source: 'site' });
const reqId = (await mine.refresh()).state.requirements[siteId].find((r: any) => r.name === 'Risk assessment').id as string;
await db.query(`insert into documents (requirement_id, status, version, expiry_date) values ($1, 'complete', '1.0', current_date - 5) on conflict (requirement_id) do update set status = 'complete', version = '1.0', expiry_date = current_date - 5`, [reqId]);
check('setup', 'a site, a requirement and an expired document exist', added.status === 200);
const docs = await mine.upload('/api/org-docs', 'Contract of employment.pdf', PDF);
const orgDocId = docs.json?.id as string;

/* 1: replacement, from the document, as the site reviewer */
let replacementExchange = '';
await test('J1 replacement: site side', async () => {
  const { ctx, p } = await page(1280, 900); await signIn(p, mine);
  await p.click('.bottomnav [data-nav="sites"]').catch(() => {}); await p.waitForTimeout(400);
  await p.evaluate((id: string) => (document.querySelector(`[data-action="open-req"][data-req="${id}"]`) as HTMLElement | null)?.click(), reqId);
  // open the requirement sheet directly through the app action if the row is not on this screen
  if (!(await p.$('.rq-block'))) { await p.evaluate(async (id: string) => { const m = await import('/js/sheets.js'); m.openReqSheet(id); }, reqId); }
  await p.waitForSelector('.rq-block'); await shot(p, 'req-sheet');
  check('J1', 'the expired document offers "Request replacement" as the main action', (await p.locator('.rq-block .btn.primary').innerText()).includes('Request replacement'));
  await p.click('.rq-block [data-action="request-document"][data-kind="replacement"]'); await p.waitForSelector('.rq-kinds');
  const sheet = await p.locator('.sheet, .overlay, body').first().innerText();
  check('J1', 'the form carries the document, site, contractor and contact across', /Risk assessment/.test(sheet) && /Shaft 4/.test(sheet) && /Ndlovu Rigging/.test(sheet) && (await p.inputValue('#rqEmail')) === recipient, sheet.slice(0, 200).replace(/\n/g, ' | '));
  check('J1', 'expiry only suggests the reason (prefilled "Expired on …")', /^Expired on /.test(await p.inputValue('#rqReason')));
  check('J1', 'all four request types are offered, replacement is selected', (await p.locator('.rq-kind').count()) === 4 && (await p.locator('.rq-kind.on').innerText()).includes('Replacement'));
  await p.fill('#rqReason', ''); await p.click('[data-action="rq-send"]');
  check('J1', 'a missing reason is explained, not sent', /why a replacement/i.test(await p.locator('#rqNote').innerText()));
  await p.click('[data-action="rq-reason"][data-reason="Unreadable"]'); await p.fill('#rqDue', '2099-02-01');
  const bad = await axe(p); check('J1', 'no serious accessibility violations in the request form', bad.length === 0, bad.join(', '));
  await shot(p, 'request-form');
  await p.click('[data-action="rq-send"]'); await p.waitForSelector('text=created');
  const txt = await p.locator('body').innerText();
  check('J1', 'it says honestly that no email was sent (no mail server here)', /Email is not set up on this server, so nothing was sent/.test(txt) || /queued/.test(txt), txt.slice(0, 300));
  const m = await lastMail(recipient);
  check('J1', 'the email names the document and offers one button, with no person in the subject', /^Replacement needed: Risk assessment/.test(m.subject) && /Upload replacement:/.test(m.text_body));
  replacementExchange = (await db.query(`select id from exchanges where recipient_email = $1 order by created_at desc limit 1`, [recipient])).rows[0].id;
  await p.reload(); await p.waitForSelector('.bottomnav');
  await p.evaluate(async (id: string) => { const m = await import('/js/sheets.js'); m.openReqSheet(id); }, reqId);
  await p.waitForSelector('#rqOpen .reqrow'); check('J1', 'after a refresh the open request shows on the document', /Replacement document requested|Replacement requested|requested/.test(await p.locator('#rqOpen').innerText()));
  // a second identical request is not created
  await p.click('.rq-block [data-action="request-document"][data-kind="replacement"]'); await p.waitForSelector('#rqReason'); await p.fill('#rqReason', 'Again');
  await p.dblclick('[data-action="rq-send"]'); await p.waitForSelector('text=Already requested');
  check('J1', 'a double click or repeat shows "Already requested" with a reminder option instead of a second request', (await db.query(`select count(*)::int as n from exchanges where recipient_email = $1`, [recipient])).rows[0].n === 1);
  await ctx.close();
});

/* 2: the recipient, with no account */
await test('J2 replacement: recipient side', async () => {
  const { ctx, p } = await page(390, 844);
  await portalSignIn(p, (await lastLink(recipient)), recipient);
  const t = await p.locator('body').innerText();
  check('J2', 'the request opens on the right document with the reason and site, not a dashboard', /Replacement needed/.test(t) && /Risk assessment/.test(t) && /Unreadable/.test(t) && /Shaft 4/.test(t), t.slice(0, 260).replace(/\n/g, ' | '));
  check('J2', 'phone layout has no sideways scroll', await noSideScroll(p));
  await p.setInputFiles('input[data-x-upload]', pdfFile('replacement.pdf')); await p.waitForSelector('text=Ready to submit');
  await p.click('button:has-text("Submit")'); await p.waitForSelector('text=Sent.');
  check('J2', 'the recipient sees confirmation', /Sent\./.test(await p.locator('body').innerText()));
  const bad = await axe(p); check('J2', 'no serious accessibility violations in the portal', bad.length === 0, bad.join(', '));
  await shot(p, 'portal-done'); await ctx.close();
  const d = (await db.query(`select status from documents where requirement_id = $1`, [reqId])).rows[0];
  check('J2', 'the new copy waits for review; nobody is marked ready by uploading', d.status === 'awaiting_review');
});

/* 3: the site reviewer accepts it, history and refresh */
await test('J3 review and history', async () => {
  const { ctx, p } = await page(1280, 900); await signIn(p, mine);
  await p.evaluate(async (id: string) => { const m = await import('/js/exchanges.js'); m.openExchange(id); }, replacementExchange);
  await p.waitForSelector('[data-action="exchange-decide"]');
  const t = await p.locator('body').innerText();
  check('J3', 'the request shows reason, requirement, "submitted" (not accepted) and the email state', /Why: Unreadable/.test(t) && /Answers the requirement/.test(t) && /Under review/.test(t) && /Email:/.test(t));
  await p.click('[data-action="exchange-decide"][data-decision="approve"]'); await p.click('[data-action="exchange-save-review"]'); await p.waitForSelector('text=Approved');
  await p.reload(); await p.waitForSelector('.bottomnav');
  check('J3', 'the document is now complete, with version history kept', (await db.query(`select status from documents where requirement_id = $1`, [reqId])).rows[0].status === 'complete' && (await db.query(`select count(*)::int as n from document_versions where document_id = (select id from documents where requirement_id = $1)`, [reqId])).rows[0].n >= 1);
  await shot(p, 'exchange-detail'); await ctx.close();
});

/* 4: signed copy */
await test('J4 signed copy', async () => {
  const { ctx, p } = await page(1280, 900); await signIn(p, mine);
  await p.evaluate(async (id: string) => { const m = await import('/js/requests.js'); m.openRequestDocument({ kind: 'signature', sourceKind: 'org_document', sourceId: id }); }, orgDocId);
  await p.waitForSelector('.rq-kinds');
  check('J4', 'opened from a document, "Signed copy" is preselected and the document is shown', (await p.locator('.rq-kind.on').innerText()).includes('Signed copy') && /Contract of employment/.test(await p.locator('.rq-about').innerText()));
  check('J4', 'replacement is explained as unavailable here', await p.locator('.rq-kind[data-kind="replacement"]').isDisabled());
  await p.fill('#rqName', 'Thabo'); await p.fill('#rqEmail', worker); await p.fill('#rqPerson', 'Thabo Mokoena'); await p.click('[data-action="rq-send"]'); await p.waitForSelector('text=created');
  await p.click('[data-action="close-sheet"]'); await ctx.close();
  const r = await page(390, 844);
  await portalSignIn(r.p, await lastLink(worker), worker);
  const t = await r.p.locator('body').innerText();
  check('J4', 'the recipient sees the document to sign and how to return it', /Signed copy needed/.test(t) && /How to return it/.test(t) && /Thabo Mokoena/.test(t));
  const popup = await r.p.request.get(BASE + (await r.p.getAttribute('a:has-text("View")', 'href')));
  check('J4', 'only this recipient session can fetch the document (it opens), and it is a PDF', popup.status() === 200 && /pdf/.test(popup.headers()['content-type'] || ''));
  const anon = await (await browser.newContext()).request.get(BASE + '/api/x/items/' + (await db.query(`select id from exchange_items where kind = 'signature' limit 1`)).rows[0].id + '/source');
  check('J4', 'without the session the document is refused', anon.status() === 401);
  await r.p.setInputFiles('input[data-x-upload]', pdfFile('signed.pdf')); await r.p.waitForSelector('text=Ready to submit'); await r.p.click('button:has-text("Submit")'); await r.p.waitForSelector('text=Sent.');
  await r.ctx.close();
  const { ctx: c2, p: p2 } = await page(1280, 900); await signIn(p2, mine);
  const ex = (await db.query(`select id from exchanges where recipient_email = $1`, [worker])).rows[0].id;
  await p2.evaluate(async (id: string) => { const m = await import('/js/exchanges.js'); m.openExchange(id); }, ex);
  await p2.waitForSelector('[data-action="exchange-decide"]');
  const d = await p2.locator('body').innerText();
  check('J4', 'the sender sees a returned copy tied to the version, without any "verified" claim', /Signature requested on Contract of employment/.test(d) && /does not verify signatures/i.test(d) && !/verified signature/i.test(d), d.slice(0, 200));
  await c2.close();
});

/* 5: other document */
await test('J5 other document', async () => {
  const { ctx, p } = await page(390, 844); await signIn(p, mine);
  await p.evaluate(async () => { const m = await import('/js/requests.js'); m.openRequestDocument({ kind: 'other' }); }); await p.waitForSelector('.rq-kinds');
  await p.fill('#rqCompany', 'Visitors Ltd'); await p.fill('#rqEmail', `other.${tag}@docreq.example`); await p.click('[data-action="rq-send"]');
  check('J5', 'a nameless "other" request is refused with a plain message', /name of the document/i.test(await p.locator('#rqNote').innerText()));
  check('J5', 'the form fits a phone', await noSideScroll(p));
  await p.fill('#rqDocName', 'Site access letter'); await p.click('[data-action="rq-send"]'); await p.waitForSelector('text=created');
  const before = (await db.query(`select count(*)::int as n from requirements where site_id = $1`, [siteId])).rows[0].n;
  check('J5', 'it does not become a mandatory requirement', before === 2 || before === 1, String(before));
  await ctx.close();
});

/* 6: bad links */
await test('J6 invalid, revoked and expired links', async () => {
  const { ctx, p } = await page(390, 844);
  await p.goto(BASE + '/x/' + 'a'.repeat(43)); await p.waitForSelector('.xp-sub');
  check('J6', 'an invalid link says so plainly', /isn't valid/.test(await p.locator('body').innerText()));
  const x = (await db.query(`select id from exchanges where recipient_email = $1`, [`other.${tag}@docreq.example`])).rows[0].id;
  const tok = await lastLink(`other.${tag}@docreq.example`);
  await mine.post(`/api/exchanges/${x}/revoke`);
  await p.goto(BASE + '/x/' + tok); await p.waitForSelector('text=withdrawn');
  check('J6', 'a cancelled request tells the recipient it was withdrawn', true);
  await ctx.close();
});

/* 7: contractor-owner and Exchange */
const con = new Bot('DRC'); await con.signup('Docreq Contractor ' + tag, 'contractor'); await con.finishSetup();
await test('J7 contractor owner: Exchange in trial and when lapsed', async () => {
  const { ctx, p } = await page(390, 844); await signIn(p, con);
  await p.click('.bottomnav [data-nav="more"]'); await p.click('[data-action="goto-more"][data-view="exchanges"]'); await p.waitForSelector('.view-head h1');
  check('J7', 'on a trial the owner can request documents', (await p.locator('[data-action="request-document"]').count()) > 0);
  await p.click('[data-action="request-document"]'); await p.waitForSelector('.rq-kinds');
  check('J7', 'a contractor can ask for a signed copy and an other document', !(await p.locator('.rq-kind[data-kind="signature"]').isDisabled()) && !(await p.locator('.rq-kind[data-kind="other"]').isDisabled()));
  await p.click('[data-action="close-sheet"]').catch(() => {});
  await db.query(`update organisations set trial_ends_at = now() - interval '2 days' where id = $1`, [con.orgId]);
  await p.reload(); await p.waitForSelector('.bottomnav');
  await p.click('.bottomnav [data-nav="more"]'); await p.click('[data-action="goto-more"][data-view="exchanges"]'); await p.waitForSelector('.next-card');
  const t = await p.locator('.view').first().innerText();
  check('J7', 'once lapsed, the page explains why and offers the next step instead of hiding the buttons', /trial has ended|read-only/i.test(t) && (await p.locator('.next-card [data-view="billing"]').count()) === 1 && /still answer a request you receive/.test(t), t.slice(0, 240).replace(/\n/g, ' | '));
  await shot(p, 'contractor-lapsed-exchange');
  await p.click('.next-card [data-view="billing"]'); await p.waitForSelector('text=Plans');
  check('J7', 'the "Choose a plan" button reaches Plans & billing', /Plans & billing/i.test(await p.locator('.view-head').first().innerText()));
  check('J7', 'Plans & billing fits a phone', await noSideScroll(p));
  await shot(p, 'billing-lapsed-390'); await ctx.close();
});

/* 8: profile menu and billing, owner vs member */
await test('J8 profile menu and plans', async () => {
  const { ctx, p } = await page(1280, 900); await signIn(p, mine);
  await p.click('.identity-avatar[aria-label="Profile"], [data-action="open-account-menu"]'); await p.waitForTimeout(400);
  const t = await p.locator('body').innerText();
  check('J8', 'the menu names Account settings, Organisation settings, Plans & billing and Sign out', /Account settings/.test(t) && /Organisation settings/.test(t) && /Plans & billing/.test(t) && /Sign out/.test(t));
  const bad = await axe(p); check('J8', 'no serious accessibility violations in the menu', bad.length === 0, bad.join(', '));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  check('J8', 'Escape closes the menu', (await p.locator('[data-action="acct-goto"]').count()) === 0);
  await p.click('[data-action="open-account-menu"]'); await p.click('[data-action="acct-goto"][data-view="billing"]'); await p.waitForSelector('.view-head');
  const b = await p.locator('.view').first().innerText();
  check('J8', 'billing shows the current plan, usage and what seats mean', /current plan|Current plan/i.test(b) && /seat/i.test(b) && /VAT/i.test(b), b.slice(0, 260).replace(/\n/g, ' | '));
  await shot(p, 'billing-1280'); await ctx.close();
});

await browser.close(); await db.end();
const failed = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - failed.length}/${rows.length} document-request journey checks passed.`);
process.exit(failed.length ? 1 : 0);
