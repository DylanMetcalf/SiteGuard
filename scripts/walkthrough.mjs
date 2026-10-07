/**
 * Builds the illustrated COMVERA walkthrough (docs/walkthrough/): screenshots of the real app,
 * an HTML guide and a PDF of it. Run against a local server started with
 * ENFORCE_PLANS=true and PLATFORM_ADMIN_EMAILS=walkthrough-admin@comvera.test:
 *
 *   BASE_URL=http://localhost:3000 DATABASE_URL=postgres://… PLAYWRIGHT_CHROMIUM_PATH=… node scripts/walkthrough.mjs
 *
 * It creates throwaway accounts in that database (use a development database, never production).
 */
import { chromium } from 'playwright';
import pg from 'pg';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const B = process.env.BASE_URL || 'http://localhost:3000';
const OUT = path.resolve('docs/walkthrough');
const IMG = path.join(OUT, 'img');
mkdirSync(IMG, { recursive: true });
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const stamp = Date.now();
const PASSWORD = 'a long enough passphrase';
const shots = [];

async function account(kind, org, email, width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 860 : 820 }, deviceScaleFactor: width < 600 ? 2 : 1 });
  await ctx.addInitScript(() => { try { localStorage.setItem('sg_tutorial_seen', '1'); } catch {} });
  const page = await ctx.newPage();
  const r = await page.request.post(B + '/api/auth/signup', { data: { name: kind === 'host' ? 'Thandi Nkosi' : 'Sipho Ndlovu', email, password: PASSWORD, orgName: org, orgKind: kind } });
  if (!r.ok()) {
    // Re-running: the owner account already exists, so sign in instead.
    const l = await page.request.post(B + '/api/auth/login', { data: { email, password: PASSWORD } });
    if (!l.ok()) throw new Error(await r.text());
  }
  await db.query('update users set email_verified_at = now() where email = $1', [email]);
  const boot = await (await page.request.get(B + '/api/bootstrap')).json();
  const api = (method, url, data) => page.request.fetch(B + url, { method, data, headers: { 'x-csrf-token': boot.csrfToken } }).then((x) => x.json());
  return { page, api };
}
async function shot(page, name, caption, opts = {}) {
  await page.waitForTimeout(600);
  const file = `${String(shots.length + 1).padStart(2, '0')}-${name}.jpg`;
  await page.screenshot({ path: path.join(IMG, file), type: 'jpeg', quality: 78, fullPage: !!opts.full });
  shots.push({ file, caption, section: opts.section });
}
const click = async (page, sel) => { await page.click(sel); await page.waitForTimeout(500); };

// ---------- Public site ----------
const anon = await (await browser.newContext({ viewport: { width: 1280, height: 820 } })).newPage();
await anon.goto(B + '/'); await anon.waitForSelector('.lp-hero');
await shot(anon, 'home', 'The public home page: what COMVERA is, who it is for, and Start free trial.', { section: 'The website' });
for (const [url, name, caption] of [
  ['/features', 'features', 'Features: everything COMVERA does, in plain language.'],
  ['/for-contractors', 'for-contractors', 'For contractors: build a safety file once and reuse it for every site and client.'],
  ['/for-sites', 'for-sites', 'For mines and sites: one site code, many contractors, one review queue, gate clearance.'],
  ['/safety-file-builder', 'safety-file-builder', 'The Safety File Builder: the guided way to put a complete safety file together.'],
  ['/how-it-works', 'how-it-works', 'How it works, step by step, for both sides.'],
]) {
  await anon.goto(B + url); await anon.waitForSelector('.lp-page-head, .lp-hero');
  await shot(anon, name, caption);
}
await anon.goto(B + '/pricing'); await anon.waitForSelector('.lp-price');
await shot(anon, 'pricing', 'Pricing for contractors and for sites. Prices are set by you under Platform.');
await anon.goto(B + '/?code=COMVERA-LIFETIME'); await anon.waitForTimeout(800);
const roleCard = await anon.$('[data-kind="contractor"].role-card, .role-card[data-kind="contractor"]');
if (roleCard) await roleCard.click();
await anon.waitForTimeout(400);
await anon.evaluate(() => { const e = document.getElementById('suPromo'); if (e) e.scrollIntoView({ block: 'center' }); });
await shot(anon, 'signup-code', 'Sign-up with a promo code filled in from the link (?code=…). Each person has their own account and password.');

await anon.goto(B + '/contact'); await anon.waitForSelector('.lp-page-head');
await shot(anon, 'contact', 'Contact: how people reach you. Questions and sales enquiries come to your support email.');

// ---------- The demo ----------
const demoCtx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
await demoCtx.addInitScript(() => { try { localStorage.setItem('sg_tutorial_seen', '1'); } catch {} });
const demo = await demoCtx.newPage();
await demo.goto(B + '/'); await demo.waitForSelector('.lp-hero');
await demo.click('[data-action="auth-go"][data-view="signin"]'); await demo.waitForSelector('[data-action="start-demo"]');
await demo.evaluate(() => document.querySelector('[data-action="start-demo"]').scrollIntoView({ block: 'center' }));
await shot(demo, 'demo-start', 'Anyone can try COMVERA without signing up: Explore the demo makes a private practice copy with sample data, deleted after a few days.', { section: 'The demo' });
await demo.click('[data-action="start-demo"]');
await demo.waitForSelector('.topbar', { timeout: 30000 }); await demo.waitForTimeout(1500);
await shot(demo, 'demo-mine', 'The demo opens as a mine\'s SHE manager, with sample sites, contractors, documents waiting for review and findings from the compliance agent.');
await demo.evaluate(() => { const b = document.querySelector('[data-action="nav"][data-nav="sites"]'); b && b.click(); });
await demo.waitForTimeout(900);
await shot(demo, 'demo-sites', 'The mine\'s sites in the demo, each with its contractors and how ready they are.');
const persona = await demo.$('#personaSel');
if (persona) {
  await persona.evaluate((el) => { el.style.outline = '3px solid #6E9C80'; el.style.outlineOffset = '2px'; });
  await shot(demo, 'demo-personas', 'The menu at the top switches between the sample people (mine manager, reviewer, contractor…), so you can show both sides of every step.');
  const contractorOpt = await persona.evaluate((el) => { const o = [...el.options].find((x) => /contractor/i.test(x.textContent)); return o ? o.value : null; });
  if (contractorOpt) {
    await persona.selectOption(contractorOpt);
    await demo.waitForTimeout(2000);
    await shot(demo, 'demo-contractor', 'The same demo as the contractor: their safety files, documents and what they still need to do.');
  }
}

// ---------- The in-app walkthrough ----------
await demo.goto(B + '/?tour=1'); await demo.waitForSelector('.tour-card h2', { timeout: 15000 });
await shot(demo, 'tour-1', 'The built-in Walkthrough: a guided tour of the real screens, with Back, Next and Auto-play (hands-free, for presenting). Start it from More → Walkthrough.', { section: 'The in-app walkthrough' });
const tourCaptions = [
  'Each step highlights one part of the screen and says what it is for.',
  'It moves through the screens by itself — nothing is changed.',
  'The progress bar shows how far along you are; Auto-play turns pages every few seconds.',
];
for (let i = 0, step = 1; i < tourCaptions.length; i++) {
  for (let k = 0; k < 2; k++) { const n = await demo.$('[data-tour="next"]'); if (n) { await n.click(); step++; await demo.waitForTimeout(700); } }
  await shot(demo, `tour-${step}`, tourCaptions[i]);
}
const x = await demo.$('[data-tour="close"]'); if (x) await x.click();
await demoCtx.close();

// ---------- Mine ----------
const mine = await account('host', 'Kathu Mining', `walk-mine-${stamp}@example.com`);
const site = await mine.api('POST', '/api/workplaces', { name: 'Kathu — Plant 2', location: 'Kathu, Northern Cape', packIds: ['general-mine'] });
await mine.page.goto(B + '/'); await mine.page.waitForTimeout(1200);
await shot(mine.page, 'mine-dashboard', 'A mine\'s dashboard: add sites, see contractors, open Document Studio or the Assistant.', { section: 'For a mine or site' });

// ---------- Contractor ----------
const con = await account('contractor', 'Volt Electrical', `walk-con-${stamp}@example.com`, 390);
await con.page.goto(B + '/'); await con.page.waitForTimeout(1200);
await shot(con.page, 'welcome', 'First sign-in: one clear choice instead of the whole platform.', { section: 'For a contractor' });
await click(con.page, '.welcome [data-action="sfb-start"]');
await shot(con.page, 'create-safety-file', 'Create a safety file: for a site on COMVERA (type its code) or for any other client.');
await con.page.keyboard.press('Escape');
const joined = await con.api('POST', '/api/sites/join', { code: site.code });
await con.page.reload(); await con.page.waitForTimeout(1000);
await con.page.evaluate((id) => { const el = document.querySelector('[data-action="nav"][data-nav="sites"]'); el && el.click(); }, joined.siteId);
await con.page.waitForTimeout(600);
const card = await con.page.$('.site-card, [data-action="open-site"]'); if (card) await card.click();
await con.page.waitForTimeout(900);
await shot(con.page, 'safety-file', 'The safety file for one site: readiness, the guide, and every required document with its status.');
const guide = await con.page.$('[data-action="guide-open"]'); if (guide) { await guide.click(); await con.page.waitForTimeout(700); }
await shot(con.page, 'guide', 'The guide walks through company documents, people, documents COMVERA writes, uploads and the final check.');
await con.page.keyboard.press('Escape'); await con.page.waitForTimeout(300);
const writeNow = await con.page.$('.builder-card [data-action="builder-open"]');
if (writeNow) { await writeNow.click(); await con.page.waitForTimeout(900); await shot(con.page, 'builder', 'Write the missing documents in one go: tick them, answer a few questions, check and submit.'); await con.page.keyboard.press('Escape'); }
await con.page.waitForTimeout(300);
const g2 = await con.page.$('[data-action="guide-open"]'); if (g2) { await g2.click(); await con.page.waitForTimeout(700); }
const check = await con.page.$('.overlay [data-action="export-bundle"], [data-action="export-bundle"]');
if (check) { await check.click(); await con.page.waitForTimeout(700); await shot(con.page, 'check', 'Before the PDF: what is in, missing, expiring or waiting for review. Preview, choose documents, download or share.'); await con.page.keyboard.press('Escape'); }
await con.page.goto(B + '/'); await con.page.waitForTimeout(800);
await con.page.evaluate(() => { const b = document.querySelector('[data-action="goto-more"][data-view="studio"]'); b && b.click(); });
await con.page.waitForTimeout(1500);
await shot(con.page, 'studio', 'Document Studio: My documents first, then upload or create a document.');

// ---------- Mine reviews ----------
await mine.page.reload(); await mine.page.waitForTimeout(800);
await mine.page.evaluate(() => { const b = document.querySelector('[data-action="nav"][data-nav="sites"]'); b && b.click(); });
await mine.page.waitForTimeout(500);
const wp = await mine.page.$('[data-action="open-workplace"]'); if (wp) { await wp.click(); await mine.page.waitForTimeout(900); }
await shot(mine.page, 'mine-site', 'A mine\'s site: its code to share, contractors on it, the review queue, gate clearance and requirements.', { section: 'For a mine or site' });

// ---------- Exchanges: documents from someone without an account ----------
const outsider = `sipho.${stamp}@example.com`;
await mine.api('POST', '/api/sites', { name: 'Kathu — Workshop', newContractor: { name: 'Ndlovu Rigging', contact: 'Sipho Ndlovu', email: outsider } });
const rigging = (await db.query(`select c.id from contractors c join users u on u.email = $1 join memberships m on m.user_id = u.id and m.org_id = c.org_id where c.name = 'Ndlovu Rigging'`, [`walk-mine-${stamp}@example.com`])).rows[0].id;
await mine.page.reload(); await mine.page.waitForTimeout(800);
await mine.page.evaluate(() => { const b = document.querySelector('[data-action="nav"][data-nav="passport"]'); b && b.click(); });
await mine.page.waitForTimeout(500);
// Same as Contractors → the company → Request documents.
await mine.page.evaluate((id) => { const b = document.createElement('button'); b.dataset.action = 'exchange-request-for'; b.dataset.id = id; document.body.appendChild(b); b.click(); b.remove(); }, rigging);
await mine.page.waitForSelector('#xiDoc0');
await mine.page.fill('#xiDoc0', 'Working at Heights certificate'); await mine.page.fill('#xiPerson0', 'Thabo Mokoena');
await mine.page.fill('#xrMsg', 'Please send this before induction on Monday.');
await shot(mine.page, 'exchange-request', 'Request documents from a contractor who isn\'t on COMVERA: who, which documents (and for which employee), by when.', { section: 'Exchanges: documents from anyone' });
await mine.page.click('[data-action="exchange-request-send"]');
await mine.page.waitForTimeout(1200);
const link = (await db.query(`select text_body from email_outbox where to_email = $1 order by id desc limit 1`, [outsider])).rows[0].text_body.match(/\/x\/([A-Za-z0-9_-]+)/)[1];
const phone = await browser.newContext({ viewport: { width: 390, height: 860 }, deviceScaleFactor: 2 });
const portal = await phone.newPage();
await portal.goto(B + '/x/' + link); await portal.waitForSelector('#xEmail');
await shot(portal, 'exchange-portal', 'What the contractor sees from the email: no account or password — they confirm their email address with a one-time code.');
await portal.fill('#xEmail', outsider); await portal.click('button[type=submit]'); await portal.waitForSelector('#xCode');
const otp = (await db.query(`select subject from email_outbox where to_email = $1 and subject like 'Your COMVERA code%' order by id desc limit 1`, [outsider])).rows[0].subject.match(/(\d{6})/)[1];
await portal.fill('#xCode', otp); await portal.click('button[type=submit]'); await portal.waitForSelector('[data-x-upload]');
await (await portal.$('[data-x-upload]')).setInputFiles({ name: 'heights-certificate.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n') });
await portal.waitForSelector('text=Ready to submit');
await shot(portal, 'exchange-upload', 'They upload straight to the mine and press Submit. Only this one request is visible to them.');
await portal.click('[data-x="submit"]'); await portal.waitForTimeout(1000);
await mine.page.reload(); await mine.page.waitForTimeout(600);
await mine.page.evaluate(() => { const b = document.querySelector('[data-action="nav"][data-nav="more"]'); b && b.click(); });
await mine.page.evaluate(() => { const b = document.querySelector('[data-view="exchanges"]'); b && b.click(); });
await mine.page.waitForSelector('[data-action="exchange-open"]');
await mine.page.click('[data-action="exchange-open"]');
await mine.page.waitForSelector('[data-action="exchange-decide"]');
await mine.page.evaluate(() => { const h = [...document.querySelectorAll('.section-title')].find((x) => x.textContent.trim() === 'Documents'); h && h.scrollIntoView(); window.scrollBy(0, -90); });
await shot(mine.page, 'exchange-review', 'The mine reviews each document: approve, or send it back with a reason (they get a new link). Every step is in the history.');
await phone.close();

// ---------- Platform (owner) ----------
const ops = await account('contractor', 'COMVERA Owner', 'walkthrough-admin@comvera.test');
await ops.api('POST', '/api/admin/promos', { code: `COMVERA-LIFETIME-${String(stamp).slice(-4)}`, description: 'Family and friends', plan: 'contractor_pro', maxRedemptions: 4 });
await ops.page.goto(B + '/'); await ops.page.waitForTimeout(1000);
await ops.page.evaluate(() => { const b = document.querySelector('[data-action="nav"][data-nav="more"]'); b && b.click(); });
await ops.page.waitForTimeout(400);
await ops.page.evaluate(() => { const b = document.querySelector('[data-view="platform"]'); b && b.click(); });
await ops.page.waitForSelector('text=Promo codes');
await ops.page.evaluate(() => { const h = [...document.querySelectorAll('.section-title')].find((x) => x.textContent.includes('Promo codes')); h && h.scrollIntoView(); });
await shot(ops.page, 'promo-codes', 'Platform → Promo codes: create a lifetime code for family and friends, limit how many can use it, switch it off any time.', { section: 'For you, the owner' });
await ops.api('POST', '/api/billing/redeem', { code: `COMVERA-LIFETIME-${String(stamp).slice(-4)}` });
await ops.page.evaluate(() => { const b = document.querySelector('[data-action="goto-more"][data-view=""]'); b && b.click(); });
await ops.page.waitForTimeout(300);
await ops.page.evaluate(() => { const b = document.querySelector('[data-view="billing"]'); b && b.click(); });
await ops.page.waitForTimeout(1200);
await shot(ops.page, 'lifetime', 'After using the code: the plan is given by COMVERA with no end date. No card is needed.');

await browser.close();
await db.end();

// ---------- the guide itself ----------
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
let body = '';
for (const s of shots) {
  if (s.section) body += `<h2>${esc(s.section)}</h2>`;
  body += `<figure><img src="img/${s.file}" alt=""><figcaption>${esc(s.caption)}</figcaption></figure>`;
}
// What's left before launch (kept in step with docs/GO_LIVE.md).
const LAUNCH = `<h2>What's left to launch</h2>
<p>The software is finished and tested (195 automated tests). What remains are accounts and settings only the owner can create — about 2 hours, plus waiting for the domain and email checks. Full click-by-click instructions are in <strong>docs/GO_LIVE.md</strong>.</p>
<ol class="todo">
<li><strong>Merge the work on GitHub.</strong> Open the pull request and click <em>Merge pull request</em>.</li>
<li><strong>Create a Render account</strong> (render.com, sign up with GitHub) and add a card.</li>
<li><strong>Create COMVERA on Render in one click:</strong> New → Blueprint → choose the repository. Enter your email for <code>PLATFORM_ADMIN_EMAILS</code> and <code>SUPPORT_EMAIL</code>. Wait until it shows <em>Live</em>.</li>
<li><strong>Sign up as yourself</strong> and confirm your email (from Render's log until email is set up). Check that <em>More → Platform</em> appears.</li>
<li><strong>Make the lifetime promo code</strong> for family and friends: More → Platform → Promo codes (100% off, no end date, limited uses).</li>
<li><strong>Buy the domain</strong> (e.g. comvera.co.za, about R99/year), add it in Render, add the CNAME record at the registrar, then set <code>APP_URL</code>.</li>
<li><strong>Set up email with Resend:</strong> verify the domain, create an API key, set <code>SMTP_URL</code> and <code>EMAIL_FROM</code> in Render. Needed for confirmations, resets, invitations, reminders and Exchanges.</li>
<li><strong>Optional — AI:</strong> buy $10–$20 credit at console.anthropic.com and set <code>ANTHROPIC_API_KEY</code>. Everything works without it.</li>
<li><strong>Uptime check:</strong> add the GitHub variable <code>COMVERA_URL</code> so you are emailed if the site goes down.</li>
<li><strong>Backups:</strong> confirm Render's daily database backups and disk snapshots; do the monthly restore test.</li>
<li><strong>First real test:</strong> sign up your parents with the promo link, build a safety file, try an Exchange (see GO_LIVE §7).</li>
</ol>
<h3>Before charging anyone (not needed for the beta)</h3>
<ul class="todo">
<li>An attorney finishes the draft <em>Privacy</em> and <em>Terms</em> pages.</li>
<li>Decide on card payments (Stripe is built in; check it pays out to your South African business) and set real prices under Platform → Pricing.</li>
<li>Add virus scanning for uploads before opening sign-ups to the public.</li>
</ul>
<h3>Running cost</h3>
<p>About <strong>R265 per month</strong> for the beta: Render web service ≈ R126, database ≈ R108, document storage ≈ R23, domain ≈ R8, email R0 (free tier), monitoring R0. AI is optional, roughly R50–R400 a month for a small beta.</p>`;
const symbol = readFileSync('public/brand/comvera-logo-light.svg', 'utf8');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>COMVERA — Walkthrough</title><style>
body{margin:0;background:#F3F6F4;color:#0E1A2B;font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:28px 18px 60px}.logo svg{height:44px;width:auto}
h1{font-size:30px;margin:18px 0 6px}h2{margin:40px 0 12px;font-size:21px;border-top:1px solid #E2E7E4;padding-top:24px}
p.lead{color:#3E4A5A;font-size:16px}figure{margin:0 0 26px;background:#fff;border:1px solid #E2E7E4;border-radius:14px;overflow:hidden;break-inside:avoid}
figure img{display:block;max-width:100%;margin:0 auto}figcaption{padding:12px 16px;font-size:14px;color:#3E4A5A;border-top:1px solid #E2E7E4}
.todo li{margin:0 0 10px}.todo{padding-left:22px}code{background:#E6EFE9;padding:1px 5px;border-radius:5px;font-size:13px}h3{margin:24px 0 8px;font-size:17px}
.note{background:#E6EFE9;border-radius:12px;padding:14px 16px;font-size:14px}
@media print{body{background:#fff}h2{break-before:page}figure img{max-height:640px;width:auto}}
</style></head><body><div class="wrap"><div class="logo">${symbol}</div>
<h1>Walkthrough</h1><p class="lead">Everything in COMVERA, in pictures: the public website, the demo anyone can try, the built-in guided walkthrough, what it looks like for a mine or site and for a contractor, Exchanges, and the owner's tools. Every picture is a screenshot of the real app. At the end is the list of what is still needed to launch.</p>
${body}${LAUNCH}<p style="color:#5E6A7A;font-size:12px;margin-top:30px">Generated ${new Date().toISOString().slice(0, 10)} by scripts/walkthrough.mjs from a test database.</p></div></body></html>`;
writeFileSync(path.join(OUT, 'index.html'), html);

const b2 = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const p2 = await b2.newPage();
await p2.goto('file://' + path.join(OUT, 'index.html'));
await p2.waitForTimeout(800);
await p2.pdf({ path: path.join(OUT, 'COMVERA-Walkthrough.pdf'), format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' } });
await b2.close();
console.log(`walkthrough: ${shots.length} screenshots, docs/walkthrough/index.html and COMVERA-Walkthrough.pdf`);
