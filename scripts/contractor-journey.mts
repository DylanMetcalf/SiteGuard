/**
 * Contractor-first journey: 15 browser tests that walk the product the way a new contractor would, with a mine as the
 * secondary side. Made-up data on a LOCAL server. A mix of real clicks and API set-up, labelled in each test.
 *   BASE_URL=http://localhost:3100 DATABASE_URL=… npx tsx scripts/contractor-journey.mts
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BASE, Bot, PDF, PW, check, chromium, db, rows, tag } from './bots-lib.mts';

const AXE = readFileSync(process.env.AXE_PATH || '/tmp/axe/node_modules/axe-core/axe.min.js', 'utf8');
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
let ipn = 1;
const SHOTS = process.env.SHOTS;
async function page(w = 1280, h = 900, opts: Record<string, unknown> = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, extraHTTPHeaders: { 'x-forwarded-for': `10.95.${Math.floor(ipn / 250)}.${(ipn++ % 250) + 1}` }, ...opts });
  await ctx.addInitScript('window.__name = (f) => f');
  const p = await ctx.newPage(); const errs: string[] = []; p.on('pageerror', (e) => errs.push(e.message));
  return { ctx, p, errs };
}
async function signIn(p: any, bot: Bot) {
  await p.goto(BASE + '/'); if (!(await p.$('#siEmail'))) await p.$$eval('[data-action]', (e: any[]) => e.find((x) => /sign in/i.test(x.textContent))?.click());
  await p.fill('#siEmail', bot.email); await p.fill('#siPassword', PW); await p.click('[data-action="signin"]');
  await p.waitForSelector('.bottomnav'); await p.waitForTimeout(700); await p.click('#tutSkip').catch(() => {});
}
async function test(name: string, fn: () => Promise<void>) {
  if (process.env.ONLY && !name.startsWith(process.env.ONLY)) return;
  const t0 = Date.now();
  try { await fn(); } catch (e) { check(name, 'completed without an unexpected error', false, (e as Error).message.split('\n')[0]); }
  console.log(`  ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
const shot = async (p: any, n: string) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/cj-${n}.png` }); };

/* ---- shared world: two mines (secondary side) and an established contractor ---- */
const mineA = new Bot('CJMA'); await mineA.signup('Journey Mine A ' + tag, 'host'); await mineA.finishSetup();
const mineB = new Bot('CJMB'); await mineB.signup('Journey Mine B ' + tag, 'host'); await mineB.finishSetup();
const wpA = (await mineA.post('/api/workplaces', { name: 'Shaft A', packIds: [] })).json.id as string;
const wpB = (await mineB.post('/api/workplaces', { name: 'Plant B', packIds: [] })).json.id as string;
const reqs = [{ category: 'Company Documents', name: 'Letter of Good Standing (COID)', source: 'legal', required: true }, { category: 'Company Documents', name: 'Risk assessment', source: 'site', required: true }, { category: 'Company Documents', name: 'Method statement', source: 'site', required: true }];
await mineA.post(`/api/workplaces/${wpA}/requirements`, { requirements: reqs });
await mineB.post(`/api/workplaces/${wpB}/requirements`, { requirements: reqs.slice(0, 2) });
const codeA = (await mineA.get('/api/bootstrap')).json.state.workplaces[wpA].code, codeB = (await mineB.get('/api/bootstrap')).json.state.workplaces[wpB].code;
const con = new Bot('CJC'); await con.signup('Journey Contractor ' + tag, 'contractor'); await con.finishSetup();
const siteA = (await con.post('/api/sites/join', { code: codeA })).json.siteId as string;
const siteB = (await con.post('/api/sites/join', { code: codeB })).json.siteId as string;
const state = async () => (await con.get('/api/bootstrap')).json.state;
const reqOf = async (siteId: string, name: RegExp) => ((await state()).requirements[siteId] as { id: string; name: string }[]).find((r) => name.test(r.name))!.id;

/* 1 */ await test('T01 first impression', async () => {
  for (const [w, h] of [[390, 844], [1280, 800]] as const) {
    const { ctx, p } = await page(w, h); await p.goto(BASE + '/'); await p.waitForSelector('.lp-hero h1'); await p.waitForTimeout(1500);
    const r = await p.evaluate(() => { const vh = innerHeight, q = (s: string) => document.querySelector(s)!.getBoundingClientRect(); return { h1: (document.querySelector('.lp-hero h1') as HTMLElement).innerText, lead: q('.lp-hero .lp-lead').bottom <= vh, cta: q('.lp-hero [data-kind="contractor"]').bottom <= vh }; });
    check('T01', `${w}px: a contractor sees the promise, the definition and the main button without scrolling`, /safety file/i.test(r.h1) && r.lead && r.cta, JSON.stringify(r));
    if (w === 1280) { await p.click('.lp-hero [data-kind="contractor"]'); await p.waitForTimeout(500); check('T01', 'the main button opens sign-up with "contractor" already chosen', /contractor/i.test(await p.evaluate(() => (document.querySelector('.role-card.selected, .role-card[aria-checked="true"], .role-card.active') as HTMLElement | null)?.innerText || ''))); }
    await ctx.close();
  }
});

/* 2 */ await test('T02 time to first value (real sign-up in the browser)', async () => {
  const { ctx, p, errs } = await page(390, 844); const t0 = Date.now(); let steps = 0;
  const email = `newcon.${tag}@example.com`;
  await p.goto(BASE + '/'); await p.click('.lp-hero [data-kind="contractor"]'); await p.waitForSelector('#suEmail');
  await p.fill('#suName', 'Thandi Mokoena'); await p.fill('#suEmail', email); await p.fill('#suOrgName', 'Mokoena Scaffolding ' + tag); await p.fill('#suPassword', PW);
  await p.click('[data-action="signup"][data-mode="new"]'); steps++;
  await db.query('update users set email_verified_at = now() where email = $1', [email]).catch(() => {});
  for (let i = 0; i < 12; i++) {
    await p.waitForTimeout(500);
    if (await p.$('.bottomnav')) break;
    // walk the guided set-up: pick "later/no" where asked, fill what is empty, save or finish
    await p.evaluate(() => { for (const el of document.querySelectorAll('input[name="obDocs"]')) if ((el as HTMLInputElement).value === 'later' || (el as HTMLInputElement).value === 'no') (el as HTMLElement).click(); });
    for (const el of await p.$$('input[type="text"]:visible, input[type="email"]:visible, input[type="tel"]:visible, textarea:visible')) { if (!(await el.inputValue())) { const id = (await el.getAttribute('id')) || ''; await el.fill(/mail/i.test(id) || (await el.getAttribute('type')) === 'email' ? 'thandi@example.com' : /hone|tel/i.test(id) ? '0820000000' : 'Scaffolding'); } }
    const btn = (await p.$('[data-action="ob-complete"]')) || (await p.$('[data-action="ob-save"]'));
    if (process.env.DEBUG) console.log('  [T02 step ' + i + ']', (await p.locator('.view, body').first().innerText()).replace(/\s+/g, ' ').slice(0, 220), '| button:', btn ? await btn.getAttribute('data-action') : 'none', '| inputs:', JSON.stringify(await p.$$eval('input:visible, textarea:visible, select:visible', (e: any[]) => e.map((x) => (x.id || x.name) + '=' + (x.value || '').slice(0, 12)))), '| err:', (await p.locator('.ob-err, .error, .form-error, .toast, [role=alert]').allInnerTexts()).join(';'));
    if (btn) { await btn.click(); steps++; }
  }
  const ms = Date.now() - t0; const reached = !!(await p.$('.bottomnav'));
  check('T02', 'a brand-new contractor reaches the dashboard through the guided set-up', reached, `stuck after ${steps} actions; screen: ${(await p.locator('body').innerText()).slice(0, 160).replace(/\n/g, ' ')}`);
  check('T02', `…in 6 actions or fewer (${steps}) and under 40 s (${(ms / 1000).toFixed(1)} s)`, reached && steps <= 6 && ms < 40000, `${steps} actions, ${ms} ms`);
  check('T02', 'no script errors', errs.length === 0, errs.join(' | ')); await shot(p, 'first-dashboard'); await ctx.close();
});

/* 3 */ await test('T03 the Today card tells a contractor what to do', async () => {
  const { ctx, p } = await page(390, 844); await signIn(p, con);
  const t = await p.locator('.today-card').first().innerText();
  check('T03', 'Today lists what to submit and shows the count waiting at EACH mine', /Submit: Risk assessment/.test(t) && /Shaft A · \d/.test(t) && /Plant B · \d/.test(t), t.slice(0, 220).replace(/\n/g, ' | '));
  await p.locator('.today-row', { hasText: 'Submit: Risk assessment' }).first().click(); await p.waitForTimeout(700);
  check('T03', 'tapping a task opens that requirement with a way to upload', (await p.locator('.sheet input[type=file], .sheet [data-action*="upload"]').count()) > 0, (await p.locator('.sheet').first().innerText().catch(() => 'no sheet')).slice(0, 120));
  await shot(p, 'today-contractor'); await ctx.close();
});

/* 4 */ await test('T04 joining another mine by site code (real clicks)', async () => {
  const mineC = new Bot('CJMC'); await mineC.signup('Journey Mine C ' + tag, 'host'); await mineC.finishSetup();
  const wpC = (await mineC.post('/api/workplaces', { name: 'Open Pit C', packIds: [] })).json.id; await mineC.post(`/api/workplaces/${wpC}/requirements`, { requirements: [reqs[0]] });
  const codeC = (await mineC.get('/api/bootstrap')).json.state.workplaces[wpC].code;
  const { ctx, p } = await page(390, 844); await signIn(p, con);
  await p.click('.bottomnav [data-nav="sites"]'); await p.waitForTimeout(400);
  await p.click('[data-action="join-site"], [data-action="join-code"]'); await p.waitForSelector('#joinCode'); await p.fill('#joinCode', codeC); await p.click('[data-action="join-go"]'); await p.waitForTimeout(1200);
  check('T04', 'a code typed in the browser joins the mine and shows its file', (await p.locator('body').innerText()).includes('Open Pit C'));
  await ctx.close();
});

/* 5 */ await test('T05 upload and submit (real clicks)', async () => {
  const rid = await reqOf(siteA, /Risk assessment/);
  const { ctx, p } = await page(1280, 900); await signIn(p, con);
  await p.locator('.today-row', { hasText: 'Submit: Risk assessment' }).first().click(); await p.waitForSelector('.sheet');
  const input = p.locator('.sheet input[type=file]').first();
  await input.setInputFiles({ name: 'risk-assessment.pdf', mimeType: 'application/pdf', buffer: PDF }); await p.waitForTimeout(1500);
  const submit = p.locator('.sheet [data-action="submit-req"]').first();
  if (await submit.count()) { await submit.click(); await p.waitForTimeout(1200); }
  const st = (await state()).documents[rid];
  check('T05', 'the file uploaded in the browser is on the requirement and sent for review', !!st && ['awaiting_review', 'complete'].includes(st.status), JSON.stringify(st));
  await ctx.close();
});

/* 6 */ await test('T06 build a safety file for a client who is not on COMVERA', async () => {
  const pr = await con.post('/api/projects', { clientName: 'Acme Quarries', clientContact: 'J Dlamini', name: 'Crusher Install', location: 'Rustenburg', packIds: [], requirements: [{ category: 'Company Documents', name: 'Letter of Good Standing (COID)', source: 'legal', required: true }, { category: 'Safety Documents', name: 'Risk assessment', source: 'site', required: true }] });
  check('T06', 'a contractor can start a file for a client outside COMVERA', pr.status === 200, JSON.stringify(pr.json));
  const projSite = Object.values((await state()).sites as Record<string, { id: string; name: string }>).find((s) => /Crusher Install/.test(s.name))!.id;
  const rid = await reqOf(projSite, /Letter of Good Standing/);
  await con.upload(`/api/documents/${rid}/file`, 'coid.pdf', PDF);
  const pdfRes = await fetch(BASE + `/api/sites/${projSite}/safety-file.pdf`, { headers: { cookie: con.cookie, 'x-forwarded-for': con.ip } });
  const buf = Buffer.from(await pdfRes.arrayBuffer()); const dir = mkdtempSync(path.join(tmpdir(), 'cj-')); writeFileSync(path.join(dir, 'f.pdf'), buf);
  let text = ''; try { text = execFileSync('pdftotext', ['-layout', path.join(dir, 'f.pdf'), '-'], { encoding: 'utf8' }); } catch { /* no pdftotext */ }
  check('T06', 'the bound safety file downloads as a real PDF', pdfRes.status === 200 && buf.slice(0, 4).toString() === '%PDF', `${pdfRes.status}`);
  check('T06', 'it has a cover with the client, contents and the invitation line for the client', /Acme Quarries/.test(text) && /collect, review and approve contractor safety files/.test(text), text.slice(0, 300).replace(/\s+/g, ' '));
  check('T06', 'it is a proper multi-page document', (text.match(/\f/g) || []).length >= 2, `${(text.match(/\f/g) || []).length + 1} pages`);
});

/* 7 */ await test('T07 Document Studio drafts a document', async () => {
  const t0 = Date.now();
  const gen = await con.post('/api/studio/documents', { blueprintId: 'risk-assessment', values: { scope: 'Install and commission a new conveyor drive' }, siteId: siteA });
  check('T07', 'Studio drafts a risk assessment from one sentence of scope (no AI key needed)', gen.status === 200, JSON.stringify(gen.json).slice(0, 160));
  check('T07', `…quickly (${Date.now() - t0} ms)`, Date.now() - t0 < 8000);
  if (gen.status === 200) { const id = gen.json.id || gen.json.documentId; const detail = (await con.get(`/api/studio/documents/${id}`)).json; const fileId = gen.json.pdfFileId || detail.pdfFileId || detail.document?.pdfFileId; const pdfR = await fetch(BASE + `/api/files/${fileId}`, { headers: { cookie: con.cookie, 'x-forwarded-for': con.ip } }); const b = Buffer.from(await pdfR.arrayBuffer()); check('T07', 'its PDF downloads as a real PDF', pdfR.status === 200 && b.slice(0, 4).toString() === '%PDF', `${pdfR.status} file ${fileId}`); }
});

/* 8 */ await test('T08 Oscar, the assistant (real chat in the browser)', async () => {
  const { ctx, p, errs } = await page(390, 844); await signIn(p, con);
  await p.click('.bottomnav [data-nav="oscar"]'); await p.waitForSelector('#chatInput');
  const asks = ['What do I still need to submit?', 'Which of my documents expire soon?', 'What does a contractor need to work on a mine?'];
  for (const q of asks) {
    const before = await p.locator('.chat-msg.bot').count(); const t0 = Date.now();
    await p.fill('#chatInput', q); await p.click('#chatSend'); await p.waitForFunction((n: number) => { const m = document.querySelectorAll('.chat-msg.bot'); return m.length > n && (m[m.length - 1] as HTMLElement).innerText.trim().length > 20; }, before, { timeout: 25000 });
    const ans = await p.locator('.chat-msg.bot').last().innerText();
    if (process.env.DEBUG) console.log('  [Oscar] Q: ' + q + '\n  A: ' + ans.replace(/\n+/g, ' / ').slice(0, 700));
    check('T08', `Oscar answers "${q}" with something useful in under 15 s`, ans.trim().length > 40 && Date.now() - t0 < 15000, `${Date.now() - t0} ms: ${ans.slice(0, 100)}`);
    if (q.startsWith('What do I still need')) check('T08', 'and it lists THIS contractor’s own outstanding items by mine, not a generic list', /Shaft A/.test(ans) && /Plant B/.test(ans) && /still to submit/.test(ans) && !/typical contractor safety file/.test(ans), ans.slice(0, 200));
  }
  await shot(p, 'oscar'); check('T08', 'no script errors', errs.length === 0, errs.join(' | ')); await ctx.close();
});

/* 9 */ await test('T09 several mines, one place', async () => {
  const { ctx, p } = await page(390, 844); await signIn(p, con);
  await p.click('.bottomnav [data-nav="sites"]'); await p.waitForTimeout(500);
  const t = await p.locator('body').innerText();
  check('T09', 'the contractor sees every mine it works for in one list', /Shaft A/.test(t) && /Plant B/.test(t), t.slice(0, 200).replace(/\n/g, ' | '));
  await ctx.close();
});

/* 10 */ await test('T10 worker certificates are watched', async () => {
  const w = await con.post('/api/workers', { fullName: 'Sipho Nkosi', employeeNo: 'E100', idLast4: '1234', occupation: 'Electrician', phone: '0820000001' });
  const soon = new Date(Date.now() + 9 * 86400000).toISOString().slice(0, 10);
  const c = await con.post(`/api/workers/${w.json.id}/certificates`, { kind: 'medical_fitness', name: 'Medical fitness', issuer: 'Dr Test', issuedOn: '2025-11-01', expiresOn: soon });
  check('T10', 'a worker and an expiring medical can be recorded', w.status === 200 && c.status === 200, JSON.stringify(c.json));
  const { ctx, p } = await page(390, 844); await signIn(p, con); const t = await p.locator('.today-card').first().innerText();
  check('T10', 'Today warns that the medical is about to expire', /Sipho Nkosi.*Medical fitness.*expires/i.test(t), t.slice(0, 260).replace(/\n/g, ' | ')); await ctx.close();
});

/* 11 */ await test('T11 the mine reviews and approves (secondary side, real clicks)', async () => {
  const rid = await reqOf(siteA, /Risk assessment/);
  await con.post(`/api/documents/${rid}/submit`, {}).catch(() => {});
  const { ctx, p } = await page(1280, 900); await signIn(p, mineA);
  const row = p.locator('.today-row', { hasText: 'Review: Risk assessment' }).first();
  check('T11', 'the mine’s Today card shows the submission waiting', (await row.count()) > 0, (await p.locator('.today-card').first().innerText()).slice(0, 200));
  if (await row.count()) {
    await row.click(); await p.waitForTimeout(800);
    const approve = p.locator('.sheet [data-action="approve-req"]').first();
    check('T11', 'one tap offers Approve', (await approve.count()) > 0, (await p.locator('.sheet').first().innerText().catch(() => '')).slice(0, 160));
    if (await approve.count()) { await approve.click(); await p.waitForTimeout(1500); const d = (await state()).documents[rid]; check('T11', 'approval is recorded and the contractor sees it', d?.status === 'complete', JSON.stringify(d)); }
  }
  await ctx.close();
});

/* 12 */ await test('T12 the gate page', async () => {
  const wid = (await db.query(`select id from workers where full_name = 'Sipho Nkosi' order by created_at desc limit 1`)).rows[0]?.id;
  const as = await con.post(`/api/sites/${siteA}/workers`, { workerId: wid });
  const token = 'gt' + 'x'.repeat(8) + tag.padEnd(12, 'k') + 'abc';
  await db.query(`update site_workers set gate_token = $3 where site_id = $1 and worker_id = $2`, [siteA, wid, token]);
  const r = await fetch(BASE + '/gate/' + token, { headers: { 'x-forwarded-for': '10.99.0.1' } }); const html = await r.text();
  check('T12', 'a valid gate link shows the worker’s clearance (assigned: ' + as.status + ')', r.status === 200 && /CLEARED|NOT CLEARED|not cleared|cleared/i.test(html), `${r.status} ${html.slice(0, 120).replace(/\s+/g, ' ')}`);
  check('T12', 'the gate page never shows ID numbers or certificate details', !/1234|Dr Test|medical fitness/i.test(html.replace(/<style[\s\S]*?<\/style>/g, '')), 'leak');
  const bad = await fetch(BASE + '/gate/not-a-real-token-at-all-xx', { headers: { 'x-forwarded-for': '10.99.0.2' } });
  check('T12', 'a wrong link gives a calm "not found" page', bad.status === 404 && !/error|stack/i.test(await bad.text()), String(bad.status));
});

/* 13 */ await test('T13 phone journey: every main screen fits and is easy to tap', async () => {
  const { ctx, p } = await page(360, 740); await signIn(p, con);
  const heights = await p.$$eval('.bottomnav button', (e: any[]) => e.map((b) => Math.round(b.getBoundingClientRect().height)));
  check('T13', 'bottom navigation buttons are at least 44px tall', heights.every((h: number) => h >= 44), JSON.stringify(heights));
  for (const nav of ['dashboard', 'sites', 'studio', 'oscar', 'more']) { await p.click(`.bottomnav [data-nav="${nav}"]`); await p.waitForTimeout(450); const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); check('T13', `${nav} fits a 360px phone`, over <= 1, `${over}px`); }
  await ctx.close();
});

/* 14 */ await test('T14 keyboard only', async () => {
  const { ctx, p } = await page(1280, 800); await p.goto(BASE + '/'); await p.waitForSelector('.lp-hero h1');
  let reachedMain = false, ring = false;
  for (let i = 0; i < 25 && !reachedMain; i++) { await p.keyboard.press('Tab'); const f = await p.evaluate(() => { const a = document.activeElement as HTMLElement; const cs = getComputedStyle(a); return { main: a?.getAttribute('data-kind') === 'contractor' && !!a.closest('.lp-hero'), ring: cs.outlineStyle !== 'none' || cs.boxShadow !== 'none' }; }); reachedMain = f.main; ring = f.ring; }
  check('T14', 'Tab reaches the main contractor button within 25 presses', reachedMain);
  check('T14', 'the focused button has a visible focus ring', ring);
  await p.keyboard.press('Enter'); await p.waitForSelector('#suEmail', { timeout: 5000 }).catch(() => {});
  check('T14', 'Enter on it opens sign-up', !!(await p.$('#suEmail')));
  await ctx.close();
});

/* 15 */ await test('T15 speed, offline and dark mode', async () => {
  const { ctx, p } = await page(1280, 900, { colorScheme: 'dark' }); await signIn(p, con);
  const timing = await p.evaluate(async () => { const t = performance.now(); await fetch('/api/bootstrap', { credentials: 'same-origin' }); return Math.round(performance.now() - t); });
  check('T15', `the workspace data loads in under 1.5 s (${timing} ms)`, timing < 1500, String(timing));
  const t0 = Date.now(); await p.click('.bottomnav [data-nav="studio"]'); await p.waitForSelector('.studio-tabs'); const nav = Date.now() - t0;
  check('T15', `switching screens takes under 600 ms (${nav} ms)`, nav < 600, String(nav));
  await p.click('.bottomnav [data-nav="dashboard"]'); await p.waitForTimeout(500);
  await p.evaluate(AXE); const v = await p.evaluate(async () => (await (window as any).axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.filter((x: any) => ['critical', 'serious'].includes(x.impact)).map((x: any) => x.id + ': ' + x.nodes[0].target.join(' ')));
  check('T15', 'dark-mode dashboard has no serious accessibility violations', v.length === 0, v.join(' | ')); await shot(p, 'dashboard-dark');
  await ctx.setOffline(true); await p.goto(BASE + '/').catch(() => {}); await p.waitForTimeout(800);
  const off = await p.locator('body').innerText().catch(() => '');
  check('T15', 'with no signal the app shows its own friendly offline page', /offline|no connection|signal/i.test(off) && !/ERR_|can.t be reached/i.test(off), off.slice(0, 120).replace(/\n/g, ' '));
  await ctx.close();
});

await browser.close(); await db.end();
const failed = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - failed.length}/${rows.length} journey checks passed across 15 tests.`);
process.exit(failed.length ? 1 : 0);
