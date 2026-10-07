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
await anon.goto(B + '/pricing'); await anon.waitForSelector('.lp-price');
await shot(anon, 'pricing', 'Pricing for contractors and for sites. Prices are set by you under Platform.');
await anon.goto(B + '/?code=COMVERA-LIFETIME'); await anon.waitForTimeout(800);
const roleCard = await anon.$('[data-kind="contractor"].role-card, .role-card[data-kind="contractor"]');
if (roleCard) await roleCard.click();
await anon.waitForTimeout(400);
await anon.evaluate(() => { const e = document.getElementById('suPromo'); if (e) e.scrollIntoView({ block: 'center' }); });
await shot(anon, 'signup-code', 'Sign-up with a promo code filled in from the link (?code=…). Each person has their own account and password.');

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
const symbol = readFileSync('public/brand/comvera-logo-light.svg', 'utf8');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>COMVERA — Walkthrough</title><style>
body{margin:0;background:#F3F6F4;color:#0E1A2B;font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:28px 18px 60px}.logo svg{height:44px;width:auto}
h1{font-size:30px;margin:18px 0 6px}h2{margin:40px 0 12px;font-size:21px;border-top:1px solid #E2E7E4;padding-top:24px}
p.lead{color:#3E4A5A;font-size:16px}figure{margin:0 0 26px;background:#fff;border:1px solid #E2E7E4;border-radius:14px;overflow:hidden;break-inside:avoid}
figure img{display:block;max-width:100%;margin:0 auto}figcaption{padding:12px 16px;font-size:14px;color:#3E4A5A;border-top:1px solid #E2E7E4}
.note{background:#E6EFE9;border-radius:12px;padding:14px 16px;font-size:14px}
@media print{body{background:#fff}h2{break-before:page}figure img{max-height:640px;width:auto}}
</style></head><body><div class="wrap"><div class="logo">${symbol}</div>
<h1>Walkthrough</h1><p class="lead">What COMVERA looks like for a contractor, for a mine or site, and for you as the owner. Every picture is a screenshot of the real app.</p>
<div class="note">Going live? The step-by-step checklist is <strong>docs/GO_LIVE.md</strong> (what to click, what to copy, what it costs, and the first test with your parents).</div>
${body}<p style="color:#5E6A7A;font-size:12px;margin-top:30px">Generated ${new Date().toISOString().slice(0, 10)} by scripts/walkthrough.mjs from a test database.</p></div></body></html>`;
writeFileSync(path.join(OUT, 'index.html'), html);

const b2 = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const p2 = await b2.newPage();
await p2.goto('file://' + path.join(OUT, 'index.html'));
await p2.waitForTimeout(800);
await p2.pdf({ path: path.join(OUT, 'COMVERA-Walkthrough.pdf'), format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '12mm', right: '12mm' } });
await b2.close();
console.log(`walkthrough: ${shots.length} screenshots, docs/walkthrough/index.html and COMVERA-Walkthrough.pdf`);
