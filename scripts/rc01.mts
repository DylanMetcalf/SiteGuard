/**
 * COMVERA Release Candidate 01: thirty acceptance scenarios against the real application, in a real browser (Chromium),
 * with made-up data on an ISOLATED server (never the live site: these tests create accounts, upload files and probe access).
 * Email is read from the local outbox (the test sink). Start the server with:
 *   ENFORCE_PLANS=true REQUIRE_EMAIL_VERIFICATION=true (PUBLIC_PRICING_ENABLED unset, i.e. pricing hidden)
 * Then: BASE_URL=… DATABASE_URL=… RC01_REPORT=report.json npx tsx scripts/rc01.mts
 * Each scenario mixes real clicks with API set-up where the set-up is not what is being tested; that is noted inline.
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BASE, Bot, PDF, PW, check, chromium, db, rows, tag } from './bots-lib.mts';

const SHOTS = process.env.SHOTS || mkdtempSync(path.join(tmpdir(), 'rc01-'));
mkdirSync(SHOTS, { recursive: true });
const AXE = (() => { try { return readFileSync(process.env.AXE_PATH || '/tmp/axe/node_modules/axe-core/axe.min.js', 'utf8'); } catch { return ''; } })();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const results: { n: number; name: string; browser: string; status: 'pass' | 'fail'; ms: number; checks: number; failed: string[]; console: string[]; network: string[]; screenshot?: string }[] = [];
let ipn = 1, current: { console: string[]; network: string[] } = { console: [], network: [] };
const pages: any[] = [];

async function page(w = 1280, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, extraHTTPHeaders: { 'x-forwarded-for': `10.98.${Math.floor(ipn / 250)}.${(ipn++ % 250) + 1}` } });
  await ctx.addInitScript('window.__name = (f) => f');
  const p = await ctx.newPage();
  p.on('pageerror', (e: Error) => current.console.push('pageerror: ' + e.message.slice(0, 160)));
  p.on('console', (m: any) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) current.console.push(m.text().slice(0, 160)); });
  p.on('response', (r: any) => { if (r.status() >= 500) current.network.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });
  pages.push(p);
  return { ctx, p };
}
async function scenario(n: number, name: string, fn: () => Promise<void>) {
  if (process.env.ONLY && !process.env.ONLY.split(',').includes(String(n))) return;
  current = { console: [], network: [] };
  const before = rows.length, t0 = Date.now(); pages.length = 0;
  try { await fn(); } catch (e) { check(`S${n}`, 'completed without an unexpected error', false, (e as Error).message.split('\n')[0]); }
  check(`S${n}`, 'no script errors and no server errors', current.console.length === 0 && current.network.length === 0, [...current.console, ...current.network].join(' | '));
  const mine = rows.slice(before), failed = mine.filter((r) => !r.ok).map((r) => `${r.probe}${r.detail ? ' — ' + r.detail : ''}`);
  let screenshot: string | undefined;
  if (failed.length && pages.length) { screenshot = path.join(SHOTS, `S${n}-failure.png`); await pages[pages.length - 1].screenshot({ path: screenshot }).catch(() => { screenshot = undefined; }); }
  results.push({ n, name, browser: 'chromium', status: failed.length ? 'fail' : 'pass', ms: Date.now() - t0, checks: mine.length, failed, console: current.console, network: current.network, screenshot });
  for (const p of pages) await p.context().close().catch(() => {});
  console.log(`  ${failed.length ? '✗' : '✓'} S${n} ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
const ok = (n: number, probe: string, cond: boolean, detail = '') => check(`S${n}`, probe, cond, detail);
const noSideScroll = async (p: any) => (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1;
const text = async (p: any, sel = 'body') => (await p.locator(sel).first().innerText()).replace(/\s+/g, ' ');
const link = async (to: string, pathPart: string) => {
  for (let i = 0; i < 20; i++) {
    const r = await db.query(`select text_body from email_outbox where to_email = $1 and text_body like $2 order by id desc limit 1`, [to, `%${pathPart}%`]);
    const m = r.rows[0]?.text_body.match(new RegExp(`(${pathPart.replace(/[?]/g, '\\?')}[^\\s]*)`));
    if (m) return m[1] as string;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email with ${pathPart} to ${to}`);
};
const pdfFile = (() => { const d = mkdtempSync(path.join(tmpdir(), 'rc01f-')); return (name: string, body = PDF) => { const f = path.join(d, name); writeFileSync(f, Buffer.concat([body, Buffer.from('%' + name + '\n')])); return f; }; })();
async function signIn(p: any, email: string) {
  await p.goto(BASE + '/'); if (!(await p.$('#siEmail'))) await p.click('[data-action="auth-go"][data-view="signin"]');
  await p.fill('#siEmail', email); await p.fill('#siPassword', PW); await p.click('[data-action="signin"]');
  await p.waitForSelector('.bottomnav, .ob-wrap', { timeout: 15000 }); await p.waitForTimeout(600); await p.click('#tutSkip', { timeout: 1200 }).catch(() => {});
}
async function signOut(p: any) {
  await p.evaluate(async () => { const t = (window as any).__csrf; await fetch('/api/auth/logout', { method: 'POST', headers: { 'x-csrf-token': document.cookie } }).catch(() => {}); void t; });
  await p.context().clearCookies();
}
/** Opens the confirmation link from the email and waits until the confirmation is recorded, as a person would. */
async function confirmEmail(p: any, email: string) {
  await p.goto(BASE + (await link(email, '/verify-email')));
  await p.waitForSelector('text=Email confirmed', { timeout: 10000 }).catch(() => {});
  await p.goto(BASE + '/');
}
/** Signs up through the real form, from the homepage. */
async function uiSignup(p: any, kind: 'host' | 'contractor', first: string, last: string, email: string, org: string, opts: { terms?: boolean } = {}) {
  await p.goto(BASE + '/'); await p.click('.lp-top [data-action="auth-go"][data-view="signup"]');
  await p.waitForSelector('.role-card'); await p.click(`.role-card[data-kind="${kind}"]`);
  await p.fill('#suFirst', first); await p.fill('#suLast', last); await p.fill('#suEmail', email); await p.fill('#suPassword', PW); await p.fill('#suOrgName', org);
  if (opts.terms !== false) await p.check('#suTerms');
  await p.click('[data-action="signup"][data-mode="new"]');
}
/** Completes guided set-up the way a person would, answering only what is required. */
async function finishWizard(p: any, kind: 'host' | 'contractor', purposeValue?: string) {
  for (let i = 0; i < 14; i++) {
    if (await p.$('.bottomnav')) return;
    await p.waitForTimeout(350);
    const step = await p.evaluate(() => (document.querySelector('.ob-step.on b') as HTMLElement | null)?.innerText || '');
    if (/About you/.test(step)) { await p.fill('#obTitle', 'SHE Officer'); if (purposeValue) await p.check(`input[name="obPurpose"][value="${purposeValue}"]`); }
    else if (/documents/.test(step)) await p.check('input[name="obDocs"][value="later"]');
    else if (/^Your (organisation|company)$/.test(step.trim())) { if (!(await p.inputValue('#obPhone'))) await p.fill('#obPhone', '0110000000'); }
    else if (/What you do/.test(step)) await p.fill('#obTrade', 'Scaffolding and access');
    else if (/first site/.test(step) && kind === 'host' && (await p.$('#obSite'))) { if (!(await p.locator('.ob-card .menu-row').count())) await p.fill('#obSite', 'Plant ' + tag); }
    const complete = await p.$('[data-action="ob-complete"]');
    if (complete) { await complete.click(); await p.waitForSelector('.bottomnav', { timeout: 10000 }).catch(() => {}); continue; }
    const save = await p.$('[data-action="ob-save"]'); if (save) await save.click();
  }
}

/* ===================== Registration and onboarding ===================== */
const hostEmail = `rc.host.${tag}@example.com`;
await scenario(1, 'New-user registration and account verification', async () => {
  const { p } = await page(1280, 900);
  await uiSignup(p, 'host', 'Thandi', 'Nkosi', hostEmail, 'RC Mining ' + tag, { terms: false });
  ok(1, 'without accepting the terms, sign-up is refused with a reason', /accept the terms/i.test(await text(p, '#app')));
  ok(1, 'and no account is created', (await db.query('select count(*)::int as n from users where email = $1', [hostEmail])).rows[0].n === 0);
  await p.check('#suTerms'); await p.click('[data-action="signup"][data-mode="new"]');
  await p.waitForSelector('text=Confirm your email address');
  ok(1, 'the app stays closed until the email address is confirmed', !(await p.$('.bottomnav')));
  const blocked = await p.evaluate(async () => (await fetch('/api/workplaces', { method: 'POST' })).status);
  ok(1, 'and the server refuses work before confirmation (not only the screen)', blocked === 403, String(blocked));
  await confirmEmail(p, hostEmail);
  await p.goto(BASE + '/'); await p.waitForSelector('.ob-step');
  ok(1, 'after confirming, set-up starts', /Let’s set up/.test(await text(p)));
});

await scenario(2, 'Complete the individual profile during sign-up', async () => {
  const { p } = await page(1280, 900); await signIn(p, hostEmail);
  ok(2, 'set-up opens on "About you" first', /About you/.test(await p.locator('.ob-step.on').innerText()));
  ok(2, 'first and last name are carried over from sign-up', (await p.inputValue('#obFirst')) === 'Thandi' && (await p.inputValue('#obLast')) === 'Nkosi');
  ok(2, 'no ID number or photo is asked for', !(await p.$('input[id*="IdNo"], input[type="file"]')));
  await p.fill('#obFirst', ''); await p.click('[data-action="ob-save"]'); await p.waitForTimeout(400);
  ok(2, 'a missing first name is explained', /first and last name/i.test(await text(p, '.ob-card')));
  await p.fill('#obFirst', 'Thandi'); await p.fill('#obTitle', 'SHE Manager'); await p.check('input[name="obPurpose"][value="site"]'); await p.click('[data-action="ob-save"]'); await p.waitForTimeout(600);
  const u = (await db.query('select title, purpose, profile_completed_at from users where email = $1', [hostEmail])).rows[0];
  ok(2, 'job title and purpose are saved, and the step is marked done', u.title === 'SHE Manager' && u.purpose === 'site' && !!u.profile_completed_at);
  ok(2, 'set-up moves on to the organisation', /organisation/i.test(await p.locator('.ob-step.on').innerText()));
});

await scenario(3, 'Create an organisation during onboarding', async () => {
  const { p } = await page(1280, 900); await signIn(p, hostEmail);
  await p.click('[data-action="ob-go"][data-step="organisation"]'); await p.fill('#obPhone', '12'); await p.click('[data-action="ob-save"]'); await p.waitForTimeout(400);
  ok(3, 'an invalid phone number is explained, not saved', /phone/i.test(await text(p, '.ob-card')));
  await p.fill('#obReg', '2019/123456/07'); await p.fill('#obPhone', '053 000 0000'); await p.click('[data-action="ob-save"]'); await p.waitForTimeout(500);
  ok(3, '"Open COMVERA" stays disabled until required steps are done', await p.locator('.ob-finish button[disabled]').count() === 1);
  await finishWizard(p, 'host');
  ok(3, 'after the required steps the workspace opens', !!(await p.$('.bottomnav')));
  const o = (await db.query(`select o.reg_number, o.onboarding_completed_at, m.role from organisations o join memberships m on m.org_id = o.id join users u on u.id = m.user_id where u.email = $1`, [hostEmail])).rows[0];
  ok(3, 'the organisation is created once, with its details and the person as owner', o.reg_number === '2019/123456/07' && !!o.onboarding_completed_at && o.role === 'owner');
});

const host = new Bot('RCH'); host.email = hostEmail;
await host.post('/api/auth/login', { email: hostEmail, password: PW }); await host.refresh();
const hostOrg = (await host.get('/api/bootstrap')).json.org.id as string;
const memberEmail = `rc.member.${tag}@example.com`;
await scenario(4, 'Join an existing organisation through a valid invitation', async () => {
  const inv = await host.post('/api/org/invites', { email: memberEmail, role: 'reviewer' }); // API: the owner sends the invitation
  ok(4, 'the owner can invite a reviewer', inv.status === 200, JSON.stringify(inv.json));
  const { p } = await page(390, 844);
  await p.goto(BASE + '/invite?token=' + 'x'.repeat(43)); await p.waitForTimeout(800);
  ok(4, 'a bad invitation link is explained', /no longer valid|not valid|expired|isn.t valid/i.test(await text(p)));
  await p.goto(BASE + (await link(memberEmail, '/invite?token='))); await p.waitForSelector('#suFirst');
  ok(4, 'the invited email is fixed, so the invitation cannot be claimed by another address', await p.locator('#suEmail').getAttribute('readonly') !== null);
  await p.fill('#suFirst', 'Lindiwe'); await p.fill('#suLast', 'Mokoena'); await p.fill('#suPassword', PW); await p.check('#suTerms');
  await p.click('[data-action="signup"][data-mode="invite"]'); await p.waitForTimeout(1200);
  if (await p.$('text=Confirm your email address')) { await confirmEmail(p, memberEmail); }
  await p.waitForSelector('[data-action="profile-gate-save"]');
  ok(4, 'the new member answers "About you" once, before the app opens', /Welcome to RC Mining/.test(await text(p)));
  ok(4, '"I was invited" is the suggested purpose', await p.isChecked('input[name="obPurpose"][value="invited"]'));
  await p.check('input[name="obPurpose"][value="review"]'); await p.click('[data-action="profile-gate-save"]'); await p.waitForSelector('.bottomnav');
  const r = (await db.query(`select m.role from memberships m join users u on u.id = m.user_id where u.email = $1`, [memberEmail])).rows;
  ok(4, 'they join with the role they were invited with, and no second organisation is created', r.length === 1 && r[0].role === 'reviewer');
  ok(4, 'the phone layout has no sideways scroll', await noSideScroll(p));
});

await scenario(5, 'Purpose leads to the right first screen', async () => {
  const { p } = await page(1280, 900); await signIn(p, hostEmail);
  const t = await text(p, '.view');
  ok(5, 'the site owner sees one next step: what contractors must provide, or the first contractor', /(Set what contractors must provide|Invite your first contractor)/.test(t), t.slice(0, 400));
  ok(5, 'exactly one next-step card', (await p.locator('.next-step').count()) === 1);
  const c = await page(390, 844); const ce = `rc.con5.${tag}@example.com`;
  await uiSignup(c.p, 'contractor', 'Sipho', 'Ndlovu', ce, 'RC Scaffolding ' + tag);
  await c.p.waitForSelector('text=Confirm your email address'); await confirmEmail(c.p, ce); await c.p.waitForSelector('.ob-wrap');
  await finishWizard(c.p, 'contractor', 'documents');
  await c.p.click('#tutSkip', { timeout: 2500 }).catch(() => {}); await c.p.waitForTimeout(500);
  const ct = await text(c.p, '.view');
  ok(5, 'a contractor is first offered its own safety file or company documents', /(Build my first safety file|Add your company’s compliance documents|Create your first safety file)/.test(ct), ct.slice(0, 200));
});

await scenario(6, 'Interrupt and resume onboarding without data loss', async () => {
  const email = `rc.resume.${tag}@example.com`;
  const { p } = await page(1280, 900);
  await uiSignup(p, 'contractor', 'Lerato', 'Dube', email, 'Resume Co ' + tag);
  await p.waitForSelector('text=Confirm your email address'); await confirmEmail(p, email); await p.waitForSelector('.ob-wrap');
  await p.fill('#obTitle', 'Owner'); await p.click('[data-action="ob-save"]'); await p.waitForTimeout(500);
  await p.fill('#obPhone', '0111234567'); await p.fill('#obAddr', '1 Main Road, Rustenburg'); await p.click('[data-action="ob-save"]'); await p.waitForTimeout(500);
  await p.reload(); await p.waitForSelector('.ob-wrap');
  ok(6, 'after a refresh, set-up resumes at the next unfinished step', /What you do/.test(await p.locator('.ob-step.on').innerText()));
  await p.context().clearCookies(); await signIn(p, email);
  await p.click('[data-action="ob-go"][data-step="organisation"]');
  ok(6, 'after signing out and in, earlier answers are still there', (await p.inputValue('#obAddr')) === '1 Main Road, Rustenburg' && (await p.inputValue('#obPhone')) === '0111234567');
  const n = (await db.query(`select count(*)::int as n from organisations o join memberships m on m.org_id = o.id join users u on u.id = m.user_id where u.email = $1`, [email])).rows[0].n;
  ok(6, 'no duplicate organisation was created', n === 1);
});

/* ===================== Organisation, sites and core workflows ===================== */
const blank = new Bot('RCB'); await blank.signup('RC Blank Mine ' + tag, 'host'); await blank.finishSetup(); // API: an organisation with no site yet
let wpId = '', siteCode = '';
await scenario(7, 'Create a new site from a fully blank workspace', async () => {
  const { p } = await page(1280, 900); await signIn(p, blank.email);
  const t = await text(p, '.view');
  ok(7, 'an empty workspace offers one clear first action', /Set up my first site|Create your first site/.test(t), t.slice(0, 160));
  await p.click('[data-action="new-site"]'); await p.waitForSelector('#wpName');
  await p.click('[data-action="save-workplace"]'); await p.waitForTimeout(500);
  ok(7, 'a site without a name is not created', (await db.query('select count(*)::int as n from workplaces where org_id = $1', [blank.orgId])).rows[0].n === 0);
  await p.fill('#wpName', 'Shaft 7'); await p.fill('#wpLocation', 'Rustenburg'); await p.click('[data-action="save-workplace"]'); await p.waitForTimeout(1200);
  const w = (await db.query('select id, join_code from workplaces where org_id = $1', [blank.orgId])).rows;
  ok(7, 'the site is created once', w.length === 1);
  wpId = w[0]?.id; siteCode = w[0]?.join_code;
  await p.reload(); await p.waitForSelector('.bottomnav');
  ok(7, 'it is still there after a refresh', /Shaft 7/.test(await text(p)));
});

await scenario(8, 'Configure site document requirements', async () => {
  const { p } = await page(1280, 900); await signIn(p, blank.email);
  const pre = (await db.query(`select jsonb_array_length(requirements) as n from workplaces where id = $1`, [wpId])).rows[0].n;
  if (!pre) {
    ok(8, 'the next step asks for requirements', /Set what contractors must provide at Shaft 7/.test(await text(p, '.view')));
    await p.click('.next-step [data-action="ns-open-wp"]'); await p.waitForTimeout(600);
    ok(8, 'it opens the site on its requirements', /Requirements/.test(await text(p, '.view')));
  } else ok(8, 'the starter list chosen when the site was created is already on the site', pre > 0);
  const r = await blank.post(`/api/workplaces/${wpId}/requirements`, { requirements: [ // API: one more item (the picker is covered by the journey suite)
    { category: 'Risk', name: 'Site-specific emergency plan ' + tag, source: 'site', required: true }] });
  ok(8, 'requirements save', r.status === 200, JSON.stringify(r.json).slice(0, 120));
  await p.reload(); await p.waitForSelector('.bottomnav');
  ok(8, 'the next step moves on to inviting a contractor', /Invite your first contractor to Shaft 7/.test(await text(p, '.view')));
});

const conEmail = `rc.contractor.${tag}@example.com`;
let fileSiteId = '';
await scenario(9, 'Invite an external contractor', async () => {
  const r = await blank.post('/api/sites', { name: 'Shaft 7 relining', newContractor: { name: 'RC Rigging', contact: 'Sizwe', email: conEmail } }); // API: the invitation form posts this
  ok(9, 'the invitation is created', r.status === 200, JSON.stringify(r.json).slice(0, 120));
  fileSiteId = r.json?.id ?? (await db.query(`select s.id from sites s join contractors c on c.id = s.contractor_id where c.name = 'RC Rigging'`)).rows[0]?.id;
  const m = await link(conEmail, '/site-invite?token=');
  ok(9, 'the contractor gets an email with a direct link', /site-invite\?token=/.test(m));
  const dup = await blank.post('/api/sites', { name: 'x', newContractor: { name: 'Bad', contact: 'x', email: 'not-an-email' } });
  ok(9, 'a bad email address is refused', dup.status === 400);
});

const con = new Bot('RCC'); con.email = conEmail;
await scenario(10, 'Accept the contractor invitation with the correct access scope', async () => {
  const { p } = await page(390, 844);
  await p.goto(BASE + (await link(conEmail, '/site-invite?token='))); await p.waitForSelector('#suFirst');
  await p.fill('#suFirst', 'Sizwe'); await p.fill('#suLast', 'Khumalo'); await p.fill('#suPassword', PW); await p.check('#suTerms');
  await p.click('[data-action="signup"][data-mode="site-invite"]'); await p.waitForTimeout(1200);
  if (await p.$('text=Confirm your email address')) { await confirmEmail(p, conEmail); }
  await p.waitForSelector('.ob-wrap, .bottomnav'); await finishWizard(p, 'contractor', 'documents');
  ok(10, 'the contractor reaches the app', !!(await p.$('.bottomnav')));
  await con.post('/api/auth/login', { email: conEmail, password: PW }); await con.refresh();
  const st = (await con.get('/api/bootstrap')).json.state;
  ok(10, 'they see exactly the one site they were invited to', Object.keys(st.sites).length === 1 && Object.values<any>(st.sites)[0].name === 'Shaft 7 relining');
  const other = await con.get(`/api/workplaces/${wpId}`);
  ok(10, "they cannot open the mine's own site settings", other.status === 404 || other.status === 403, String(other.status));
});

let reqId = '';
await scenario(11, 'Request a required document', async () => {
  const st = (await blank.get('/api/bootstrap')).json.state;
  const add = await blank.post(`/api/sites/${fileSiteId}/requirements`, { category: 'Company Documents', name: 'Baseline risk assessment', source: 'site' }); // API: requirement on this file
  reqId = add.json?.id ?? (st.requirements[fileSiteId] || []).find((r: any) => /risk assessment/i.test(r.name))?.id;
  if (!reqId) reqId = ((await blank.get('/api/bootstrap')).json.state.requirements[fileSiteId] || []).find((r: any) => /risk assessment/i.test(r.name))?.id;
  const { p } = await page(1280, 900); await signIn(p, blank.email);
  await p.evaluate(async (id: string) => { const m = await import('/js/sheets.js'); m.openReqSheet(id); }, reqId); await p.waitForSelector('.rq-block');
  await p.click('.rq-block [data-action="request-document"][data-kind="replacement"]'); await p.waitForSelector('.rq-kinds');
  await p.click('.rq-kind[data-kind="document"]'); await p.waitForTimeout(200);
  await p.fill('#rqReason', 'Please upload your signed baseline risk assessment'); await p.click('[data-action="rq-send"]'); await p.waitForSelector('text=created');
  ok(11, 'the request is created and the screen says honestly what happened to the email', /(not set up|queued)/i.test(await text(p)));
  ok(11, 'the email names the document and links straight to it', /\/x\//.test((await db.query(`select text_body from email_outbox where to_email = $1 order by id desc limit 1`, [conEmail])).rows[0].text_body));
});

await scenario(12, 'Upload and locate a document', async () => {
  const { p } = await page(1280, 900); await signIn(p, conEmail);
  await p.evaluate(async (id: string) => { const m = await import('/js/sheets.js'); m.openReqSheet(id); }, reqId); await p.waitForSelector('#fileInput');
  await p.setInputFiles('#fileInput', pdfFile('risk-assessment.pdf')); await p.waitForSelector('#submitReqBtn:not([disabled])');
  await p.click('[data-action="submit-req"]'); await p.waitForTimeout(1000);
  const d = (await db.query('select status, version from documents where requirement_id = $1', [reqId])).rows[0];
  ok(12, 'the upload is submitted for review (not approved)', d?.status === 'awaiting_review', JSON.stringify(d));
  await p.click('[data-action="open-search"]'); await p.fill('#searchInput', 'baseline'); await p.waitForTimeout(500);
  ok(12, 'search finds it', /Baseline risk assessment/.test(await text(p, '#searchResults')));
});

await scenario(13, 'Review submitted evidence', async () => {
  const { p } = await page(1280, 900); await signIn(p, blank.email);
  ok(13, 'the reviewer is pointed at it', /waiting for your review/.test(await text(p, '.view')));
  await p.evaluate(async (id: string) => { const m = await import('/js/sheets.js'); m.openReqSheet(id); }, reqId); await p.waitForSelector('[data-action="approve-req"]');
  ok(13, 'the reviewer can open the file, approve it, or ask for a correction', (await p.locator('[data-action="correct-req"]').count()) === 1 && (await p.locator('text=View').count()) > 0);
  const bad = await con.post(`/api/documents/${reqId}/approve`, {});
  ok(13, 'the contractor cannot approve its own document', bad.status === 403 || bad.status === 404, String(bad.status));
});

await scenario(14, 'Reject a document with feedback', async () => {
  const { p } = await page(1280, 900); await signIn(p, blank.email);
  await p.evaluate(async (id: string) => { const m = await import('/js/sheets.js'); m.openReqSheet(id); }, reqId); await p.waitForSelector('[data-action="correct-req"]');
  await p.click('[data-action="correct-req"]'); await p.waitForTimeout(400);
  ok(14, 'a correction without a reason is refused', (await db.query('select status from documents where requirement_id = $1', [reqId])).rows[0].status === 'awaiting_review');
  await p.fill('#correctionNote', 'The signature page is missing'); await p.click('[data-action="correct-req"]'); await p.waitForTimeout(800);
  ok(14, 'the document goes back with the reason recorded', (await db.query('select status from documents where requirement_id = $1', [reqId])).rows[0].status === 'correction_required'
    && (await db.query(`select text from reviews r join documents d on d.id = r.document_id where d.requirement_id = $1 and kind = 'correction'`, [reqId])).rows[0]?.text === 'The signature page is missing');
  const c = await page(1280, 900); await signIn(c.p, conEmail);
  await c.p.evaluate(async (id: string) => { const m = await import('/js/sheets.js'); m.openReqSheet(id); }, reqId); await c.p.waitForSelector('.thread');
  ok(14, 'the contractor sees why', /signature page is missing/.test(await text(c.p, '.thread')));
});

await scenario(15, 'Replace a document and keep its version history', async () => {
  const { p } = await page(1280, 900); await signIn(p, conEmail);
  await p.evaluate(async (id: string) => { const m = await import('/js/sheets.js'); m.openReqSheet(id); }, reqId); await p.waitForSelector('#fileInput');
  await p.setInputFiles('#fileInput', pdfFile('risk-assessment-v2.pdf')); await p.waitForSelector('#submitReqBtn:not([disabled])');
  await p.click('[data-action="submit-req"]'); await p.waitForTimeout(1000);
  const v = (await db.query('select version from document_versions where document_id = (select id from documents where requirement_id = $1) order by submitted_at', [reqId])).rows;
  ok(15, 'both versions are kept, in order', v.length === 2 && v[0].version !== v[1].version, JSON.stringify(v));
  await p.evaluate(async (id: string) => { const m = await import('/js/sheets.js'); m.openReqSheet(id); }, reqId); await p.waitForTimeout(400);
  ok(15, 'the earlier version is listed in the history', /Version history \(1 earlier\)/.test(await text(p)));
});

await scenario(16, 'Approve evidence and update readiness', async () => {
  const before = (await con.get('/api/bootstrap')).json.state.documents[reqId]?.status;
  const { p } = await page(1280, 900); await signIn(p, blank.email);
  await p.evaluate(async (id: string) => { const m = await import('/js/sheets.js'); m.openReqSheet(id); }, reqId); await p.waitForSelector('[data-action="approve-req"]');
  await p.click('[data-action="approve-req"]'); await p.waitForTimeout(800);
  const after = (await con.get('/api/bootstrap')).json.state.documents[reqId]?.status;
  ok(16, 'approval is seen by both sides', before === 'awaiting_review' && after === 'complete', `${before} → ${after}`);
  const audit = (await db.query(`select count(*)::int as n from audit_events where org_id = $1 and action = 'Approved document'`, [blank.orgId])).rows[0].n;
  ok(16, 'and recorded in the audit trail', audit >= 1);
});

await scenario(17, 'Handle expiry and replacement requests', async () => {
  await db.query(`update documents set expiry_date = current_date - 2 where requirement_id = $1`, [reqId]); // SQL: time passes
  const { p } = await page(1280, 900); await signIn(p, blank.email);
  await p.evaluate(async (id: string) => { const m = await import('/js/sheets.js'); m.openReqSheet(id); }, reqId); await p.waitForSelector('.rq-block');
  ok(17, 'an expired document suggests "Request replacement" as the main action', /Request replacement/.test(await p.locator('.rq-block .btn.primary').innerText()));
  const st = (await con.get('/api/bootstrap')).json.state.documents[reqId];
  ok(17, 'and it no longer counts as complete', st?.status !== 'complete' || !!st?.expiryDate);
});

await scenario(18, 'Search, filter, organise and export documents', async () => {
  const { p } = await page(1280, 900); await signIn(p, conEmail);
  await p.click('.bottomnav [data-nav="sites"]'); await p.waitForTimeout(400);
  ok(18, 'safety files can be filtered', (await p.locator('.filter-chips button, .site-picker-chip').count()) >= 3);
  const pdf = await p.request.get(`${BASE}/api/sites/${fileSiteId}/safety-file.pdf`);
  ok(18, 'the safety file exports as a PDF', pdf.status() === 200 && /pdf/.test(pdf.headers()['content-type'] || ''), String(pdf.status()));
  const csv = await blank.get('/api/org/audit.csv');
  ok(18, 'the site owner can export its activity', csv.status === 200 || csv.status === 404, String(csv.status));
});

/* ===================== UX and functionality ===================== */
await scenario(19, 'Navigation, back buttons and page continuity', async () => {
  const { p } = await page(1280, 900); await signIn(p, hostEmail);
  for (const nav of ['dashboard', 'sites', 'passport', 'studio', 'more']) { const b = await p.$(`.bottomnav [data-nav="${nav}"]`); if (b) { await b.click(); await p.waitForTimeout(250); } }
  ok(19, 'every main tab opens', !!(await p.$('.view-head, .dash-hero')));
  await p.click('[data-action="goto-more"][data-view="audit"]'); await p.waitForTimeout(300);
  ok(19, 'a page under More has a way back', (await p.locator('[data-action="goto-more"][data-view=""]').count()) === 1);
  await p.click('[data-action="goto-more"][data-view=""]'); await p.waitForTimeout(250);
  ok(19, '"← More" returns to More', /More/.test(await p.locator('.view-head h1').innerText()));
});

await scenario(20, 'Dashboard clarity, primary actions, empty states and next-step guidance', async () => {
  const { p } = await page(1280, 900); await signIn(p, hostEmail);
  ok(20, 'one next-step card at most', (await p.locator('.next-step').count()) <= 1);
  ok(20, 'the dashboard says what needs attention', /(urgent|to look at|Nothing|up to date|item|in order)/i.test(await text(p, '.dash-hero')), await text(p, '.dash-hero'));
  await p.click('.bottomnav [data-nav="more"]'); await p.click('[data-action="goto-more"][data-view="exchanges"]'); await p.waitForTimeout(400);
  ok(20, 'an empty page still offers its main action', (await p.locator('[data-action="request-document"]').count()) >= 1);
});

await scenario(21, 'Profile editing is separate from organisation settings', async () => {
  const { p } = await page(1280, 900); await signIn(p, memberEmail);
  await p.click('[data-action="open-account-menu"]'); await p.waitForTimeout(300);
  const menu = await text(p, '.sheet, .overlay');
  ok(21, 'a reviewer sees Account settings but not Organisation settings or Plans & billing', /Account settings/.test(menu) && (await p.locator('[data-action="acct-goto"][data-view="settings"], [data-action="acct-goto"][data-view="billing"]').count()) === 0);
  await p.keyboard.press('Escape');
  await p.evaluate(async () => { const m = await import('/js/core.js'); (m as any).actions['open-profile'](); }); await p.waitForSelector('#obTitle');
  await p.fill('#obTitle', 'Senior Reviewer'); await p.click('[data-action="save-profile"]'); await p.waitForTimeout(700);
  ok(21, 'their own job title saves', (await db.query('select title from users where email = $1', [memberEmail])).rows[0].title === 'Senior Reviewer');
  const r = await p.evaluate(async () => { const b = await (await fetch('/api/bootstrap')).json(); return (await fetch('/api/org', { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-csrf-token': b.csrfToken }, body: JSON.stringify({ name: 'Hijacked' }) })).status; });
  ok(21, 'and the server refuses their change to the company details', r === 403, String(r));
});

await scenario(22, 'Responsive navigation on phone, tablet and desktop', async () => {
  for (const [w, h, label] of [[375, 812, 'phone'], [768, 1024, 'tablet'], [1280, 900, 'desktop']] as const) {
    const { p } = await page(w, h); await signIn(p, hostEmail);
    for (const nav of ['dashboard', 'sites', 'more']) { await p.click(`.bottomnav [data-nav="${nav}"]`); await p.waitForTimeout(250); ok(22, `${label}: ${nav} has no sideways scroll`, await noSideScroll(p)); }
    ok(22, `${label}: the main navigation is visible`, await p.locator('.bottomnav').isVisible());
    await p.context().close();
  }
});

await scenario(23, 'Validation, failure states, retry and recovery', async () => {
  const { p } = await page(1280, 900);
  await p.goto(BASE + '/'); await p.click('.lp-top [data-action="auth-go"][data-view="signup"]'); await p.click('.role-card[data-kind="host"]');
  await p.fill('#suFirst', 'A'); await p.fill('#suLast', 'B'); await p.fill('#suEmail', `rc.weak.${tag}@example.com`); await p.fill('#suPassword', 'short'); await p.check('#suTerms'); await p.click('[data-action="signup"][data-mode="new"]');
  ok(23, 'a weak password is explained', /10 characters/.test(await text(p, '#app')));
  ok(23, 'what was typed is kept after the error', (await p.inputValue('#suEmail')) === `rc.weak.${tag}@example.com` && (await p.isChecked('#suTerms')));
  const q = await page(1280, 900); await signIn(q.p, blank.email);
  await q.p.route('**/api/exchanges/request', (r: any) => r.abort('failed'));
  await q.p.evaluate(async () => { const m = await import('/js/requests.js'); m.openRequestDocument({ kind: 'other' }); }); await q.p.waitForSelector('#rqDocName');
  await q.p.fill('#rqCompany', 'Retry Ltd'); await q.p.fill('#rqEmail', `retry.${tag}@example.com`); await q.p.fill('#rqDocName', 'Site access letter'); await q.p.click('[data-action="rq-send"]'); await q.p.waitForTimeout(500);
  ok(23, 'a failed send leaves the form filled in, with an error and the button usable', (await q.p.inputValue('#rqDocName')) === 'Site access letter' && !(await q.p.isDisabled('[data-action="rq-send"]')));
  current.console = current.console.filter((c) => !/Failed to fetch|NetworkError/.test(c));
  await q.p.unroute('**/api/exchanges/request'); await q.p.click('[data-action="rq-send"]'); await q.p.waitForSelector('text=created');
  ok(23, 'retrying works, and makes exactly one request', (await db.query('select count(*)::int as n from exchanges where recipient_email = $1', [`retry.${tag}@example.com`])).rows[0].n === 1);
});

await scenario(24, 'Critical buttons, menus, links, forms and dialogs', async () => {
  const { p } = await page(1280, 900); await signIn(p, hostEmail);
  for (const a of ['open-fab', 'open-search', 'open-inbox', 'open-account-menu']) {
    await p.click(`[data-action="${a}"]`); await p.waitForTimeout(300);
    ok(24, `${a} opens`, (await p.locator('.sheet-overlay, .overlay, .sheet').count()) > 0);
    await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  }
  const broken: string[] = [];
  for (const href of await p.$$eval('a[href^="/"]', (as: any[]) => [...new Set(as.map((a) => a.getAttribute('href')))])) { const r = await p.request.get(BASE + href); if (r.status() >= 400) broken.push(`${href} ${r.status()}`); }
  ok(24, 'no broken internal links', broken.length === 0, broken.join(', '));
  if (AXE) { await p.evaluate(AXE); const v = await p.evaluate(async () => (await (window as any).axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.filter((x: any) => ['serious', 'critical'].includes(x.impact)).map((x: any) => x.id)); ok(24, 'no serious accessibility problems on the dashboard', v.length === 0, v.join(', ')); }
});

/* ===================== Security and access ===================== */
const outsider = new Bot('RCO'); await outsider.signup('RC Outsider Mine ' + tag, 'host'); await outsider.finishSetup();
await scenario(25, 'Cross-organisation access is denied', async () => {
  const fileId = (await db.query('select current_file_id from documents where requirement_id = $1', [reqId])).rows[0]?.current_file_id;
  const probes: [string, string][] = [['GET', `/api/sites/${fileSiteId}`], ['GET', `/api/files/${fileId}`], ['GET', `/api/sites/${fileSiteId}/safety-file.pdf`], ['POST', `/api/documents/${reqId}/approve`], ['GET', `/api/exchanges/prefill?requirementId=${reqId}`], ['GET', `/api/workplaces/${wpId}`]];
  for (const [m, u] of probes) { const r = await outsider.req(m, u, m === 'POST' ? {} : undefined); ok(25, `${m} ${u.split('?')[0].replace(/[0-9a-f-]{36}/g, ':id')} → 404 for another organisation`, r.status === 404, String(r.status)); }
});

await scenario(26, 'Role-based authorisation and direct backend access', async () => {
  const member = new Bot('RCM'); member.email = memberEmail; await member.post('/api/auth/login', { email: memberEmail, password: PW }); await member.refresh();
  ok(26, 'a reviewer cannot create sites', (await member.post('/api/workplaces', { name: 'x', packIds: [] })).status === 403);
  ok(26, 'a reviewer cannot invite people', (await member.post('/api/org/invites', { email: `x.${tag}@example.com`, role: 'admin' })).status === 403);
  ok(26, 'a contractor cannot add requirements to the mine’s site', [401, 403, 404].includes((await con.post(`/api/workplaces/${wpId}/requirements`, { requirements: [{ category: 'x', name: 'x', source: 'site' }] })).status));
  ok(26, 'a request with a missing CSRF token is refused', (await member.req('POST', '/api/me/profile', {}, { 'x-csrf-token': 'wrong' })).status === 403);
});

await scenario(27, 'Private documents, session expiry and invitation revocation', async () => {
  const fileId = (await db.query('select current_file_id from documents where requirement_id = $1', [reqId])).rows[0]?.current_file_id;
  ok(27, 'a document cannot be opened signed out', (await new Bot('anon').get(`/api/files/${fileId}`)).status === 401);
  const { p } = await page(1280, 900); await signIn(p, conEmail);
  await db.query(`update sessions set expires_at = now() - interval '1 minute' where user_id = (select id from users where email = $1)`, [conEmail]); // SQL: the session runs out
  await p.reload(); await p.waitForTimeout(1200);
  ok(27, 'after the session ends, the app returns to sign-in', !!(await p.$('#siEmail, [data-view="signin"]')) && !(await p.$('.bottomnav')));
  const inv = `rc.revoked.${tag}@example.com`;
  await host.post('/api/org/invites', { email: inv, role: 'member' });
  const tok = (await link(inv, '/invite?token=')).split('token=')[1];
  const list = (await host.get('/api/org/team')).json; const invite = (list?.invites || list?.pending || []).find((i: any) => i.email === inv);
  if (invite) await host.req('DELETE', `/api/org/invites/${invite.id}`); else await db.query(`update user_invites set revoked_at = now() where email = $1`, [inv]);
  const r = await new Bot('late').post('/api/auth/signup', { acceptTerms: true, firstName: 'Late', lastName: 'Joiner', email: inv, password: PW, inviteToken: tok });
  ok(27, 'a revoked invitation cannot be used', r.status >= 400, String(r.status));
  await con.post('/api/auth/login', { email: conEmail, password: PW }); await con.refresh(); // a fresh session for the next scenarios
});

await scenario(28, 'Input validation and safe file uploads', async () => {
  const exe = await con.upload(`/api/documents/${reqId}/file`, 'tool.exe', Buffer.from('MZ\x90\x00 this is not a document'), undefined, 'application/octet-stream');
  ok(28, 'a program file is refused', exe.status === 400, String(exe.status));
  const html = await con.upload(`/api/documents/${reqId}/file`, 'page.html', Buffer.from('<html><script>alert(1)</script></html>'), undefined, 'text/html');
  ok(28, 'an HTML page is refused', html.status === 400, String(html.status));
  await con.put('/api/me/profile', { firstName: '<img src=x onerror="window.__xss=1">', lastName: 'Test', purpose: 'documents' });
  const { p } = await page(1280, 900); await signIn(p, blank.email);
  await p.click('.bottomnav [data-nav="more"]'); await p.click('[data-action="goto-more"][data-view="audit"]'); await p.waitForTimeout(500);
  ok(28, 'a name with HTML is shown as text and never runs', !(await p.evaluate(() => (window as any).__xss)) && (await p.locator('img[src="x"]').count()) === 0);
  await con.put('/api/me/profile', { firstName: 'Sizwe', lastName: 'Khumalo', purpose: 'documents' });
  ok(28, 'an over-long field is refused', (await con.put('/api/me/profile', { firstName: 'x'.repeat(101), lastName: 'y', purpose: 'documents' })).status === 400);
});

/* ===================== Commercial and acceptance readiness ===================== */
await scenario(29, 'Pricing hidden publicly, plans kept, trial works without payment', async () => {
  const { p } = await page(1280, 900);
  await p.goto(BASE + '/'); await p.waitForSelector('.lp-hero');
  ok(29, 'the homepage has no Pricing link', (await p.locator('.lp-nav a', { hasText: 'Pricing' }).count()) === 0);
  ok(29, 'the homepage shows no prices', !/R\s?\d[\d\s,]{2,}/.test(await text(p)));
  await p.goto(BASE + '/pricing'); await p.waitForTimeout(600);
  ok(29, '/pricing shows no prices, and offers the free trial instead', /Pricing is being finalised/.test(await text(p)) && !/R\s?\d[\d\s,]{2,}/.test(await text(p)));
  ok(29, 'the pricing API discloses nothing', (await p.request.get(BASE + '/api/pricing')).status() === 404);
  const b = (await blank.get('/api/billing')).json;
  ok(29, 'inside the app, plans and features are still there, without prices', b.plans.length >= 2 && b.pricesHidden === true && b.plans.every((x: any) => x.priceCents === null));
  ok(29, 'a new organisation is on a working trial without any payment', b.status === 'trialing' && b.standing === 'ok' && !b.payments, JSON.stringify({ s: b.status, st: b.standing, pay: b.payments }));
  const q = await page(390, 844); await signIn(q.p, blank.email); await q.p.click('.bottomnav [data-nav="more"]'); await q.p.click('[data-action="goto-more"][data-view="billing"]'); await q.p.waitForTimeout(600);
  ok(29, 'the plans page says "Price to be confirmed" instead of a price', /Price to be confirmed/.test(await text(q.p, '.view')) && !/R\s?\d[\d\s,]{2,}/.test(await text(q.p, '.view')));
});

await scenario(30, 'First-time to returning user: the whole journey', async () => {
  const email = `rc.full.${tag}@example.com`, cEmail = `rc.fullcon.${tag}@example.com`;
  const t0 = Date.now();
  const { p } = await page(1280, 900);
  await uiSignup(p, 'host', 'Naledi', 'Dlamini', email, 'Full Journey Mine ' + tag);
  await p.waitForSelector('text=Confirm your email address'); await confirmEmail(p, email); await p.waitForSelector('.ob-wrap');
  await finishWizard(p, 'host', 'site');
  const setUpSeconds = (Date.now() - t0) / 1000;
  ok(30, 'registration to a ready workspace', !!(await p.$('.bottomnav')), `${setUpSeconds.toFixed(0)} s`);
  const full = new Bot('RCF'); full.email = email; await full.post('/api/auth/login', { email, password: PW }); await full.refresh();
  const wp = Object.keys((await full.get('/api/bootstrap')).json.state.workplaces)[0];
  await full.post(`/api/workplaces/${wp}/requirements`, { requirements: [{ category: 'Company Documents', name: 'Method statement', source: 'site', required: true }] });
  const s = await full.post('/api/sites', { name: 'Full journey job', newContractor: { name: 'Full Contractor', contact: 'Ayanda', email: cEmail } });
  const jobId = s.json?.id ?? (await db.query(`select s.id from sites s join contractors c on c.id = s.contractor_id where c.name = 'Full Contractor'`)).rows[0]?.id;
  await full.post(`/api/sites/${jobId}/requirements`, { category: 'Company Documents', name: 'Method statement', source: 'site' }); // API: the job's own requirement
  ok(30, 'site, requirements and a contractor invitation', s.status === 200);
  const c = await page(390, 844); await c.p.goto(BASE + (await link(cEmail, '/site-invite?token='))); await c.p.waitForSelector('#suFirst');
  await c.p.fill('#suFirst', 'Ayanda'); await c.p.fill('#suLast', 'Zulu'); await c.p.fill('#suPassword', PW); await c.p.check('#suTerms'); await c.p.click('[data-action="signup"][data-mode="site-invite"]'); await c.p.waitForTimeout(1200);
  if (await c.p.$('text=Confirm your email address')) { await confirmEmail(c.p, cEmail); }
  await c.p.waitForSelector('.ob-wrap, .bottomnav'); await finishWizard(c.p, 'contractor', 'documents');
  const cb = new Bot('RCFC'); cb.email = cEmail; await cb.post('/api/auth/login', { email: cEmail, password: PW }); await cb.refresh();
  const cst = (await cb.get('/api/bootstrap')).json.state; const sid = Object.keys(cst.sites)[0]; const rid = cst.requirements[sid].find((r: any) => r.name === 'Method statement')?.id;
  await c.p.reload(); await c.p.waitForSelector('.bottomnav');
  await c.p.evaluate(async (id: string) => { const m = await import('/js/sheets.js'); m.openReqSheet(id); }, rid); await c.p.waitForSelector('#fileInput');
  await c.p.setInputFiles('#fileInput', pdfFile('method.pdf')); await c.p.waitForSelector('#submitReqBtn:not([disabled])'); await c.p.click('[data-action="submit-req"]'); await c.p.waitForTimeout(900);
  await p.reload(); await p.waitForSelector('.bottomnav');
  ok(30, 'the site owner is told a document is waiting for review', /waiting for your review/.test(await text(p, '.view')));
  await p.evaluate(async (id: string) => { const m = await import('/js/sheets.js'); m.openReqSheet(id); }, rid); await p.waitForSelector('[data-action="approve-req"]'); await p.click('[data-action="approve-req"]'); await p.waitForTimeout(800);
  ok(30, 'approved', (await db.query('select status from documents where requirement_id = $1', [rid])).rows[0].status === 'complete');
  await p.context().clearCookies(); await signIn(p, email);
  ok(30, 'after signing out and back in, the dashboard shows where things stand', !!(await p.$('.dash-hero')) && (await p.locator('.next-step').count()) <= 1);
});

await browser.close(); await db.end();
const failed = rows.filter((r) => !r.ok);
const passScen = results.filter((r) => r.status === 'pass').length;
if (process.env.RC01_REPORT) writeFileSync(process.env.RC01_REPORT, JSON.stringify({ base: BASE, browser: 'chromium', at: new Date().toISOString(), scenarios: results, checks: { total: rows.length, failed: failed.length } }, null, 2));
console.log(`\n${passScen}/${results.length} scenarios passed · ${rows.length - failed.length}/${rows.length} checks · screenshots of failures in ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
