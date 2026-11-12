/**
 * Browser check for the dashboard "Today" card, with made-up data on a LOCAL server:
 *  - a mine with nothing to do sees "All clear today";
 *  - when a contractor submits a document the mine sees it under Do today / This week and the row opens the document;
 *  - the contractor sees what to submit; the mine gets the monthly report link; nothing overflows on a phone.
 */
import { BASE, Bot, PDF, PW, check, chromium, db, rows, tag } from './bots-lib.mts';

const mine = new Bot('TDM'); await mine.signup('Today Mine ' + tag, 'host'); await mine.finishSetup();
const con = new Bot('TDC'); await con.signup('Today Contractor ' + tag, 'contractor'); await con.finishSetup();
const wp = (await mine.post('/api/workplaces', { name: 'Today Pit', packIds: [] })).json.id;   // a site with no requirements yet
const code = (await mine.get('/api/bootstrap')).json.state.workplaces[wp].code;

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
let n = 1;
async function session(bot: Bot, w = 1280, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, extraHTTPHeaders: { 'x-forwarded-for': `10.80.0.${n++}` } });
  await ctx.addInitScript('window.__name = (f) => f');
  const p = await ctx.newPage(); const errs: string[] = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/'); if (!(await p.$('#siEmail'))) await p.$$eval('[data-action]', (e: any[]) => e.find((x) => /sign in/i.test(x.textContent))?.click());
  await p.fill('#siEmail', bot.email); await p.fill('#siPassword', PW); await p.click('[data-action="signin"]');
  await p.waitForSelector('.bottomnav'); await p.waitForTimeout(800); await p.click('#tutSkip').catch(() => {});
  return { ctx, p, errs };
}
const today = async (p: any) => (await p.locator('.today-card').first().innerText().catch(() => '')) as string;

// 1. nothing to do
{ const { ctx, p, errs } = await session(mine); const t = await today(p);
  check('today', 'a mine with nothing to do sees "All clear today"', /Today/.test(t) && /All clear today/.test(t), t.slice(0, 120));
  check('today', 'the host gets the monthly report link', (await p.locator('.today-foot a[href*="format=csv"]').count()) === 1);
  check('today', 'no script errors', errs.length === 0, errs.join(' | ')); await ctx.close(); }

// 2. work appears: the mine asks for a document, the contractor joins and submits
await mine.post(`/api/workplaces/${wp}/requirements`, { requirements: [{ category: 'Company Documents', name: 'Letter of Good Standing', source: 'site', required: true }] });
const joined = await con.post('/api/sites/join', { code }); const siteId = joined.json.siteId;
const reqId = (Object.values((await con.get('/api/bootstrap')).json.state.requirements)[0] as { id: string }[])[0].id;
{ const { ctx, p } = await session(con, 390, 844); const t = await today(p);
  check('today', 'the contractor sees what to submit', /Submit: Letter of Good Standing/.test(t), t.slice(0, 160));
  check('today', 'the Today card fits a phone (no sideways scroll)', (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
  await ctx.close(); }
await con.upload(`/api/documents/${reqId}/file`, 'standing.pdf', PDF); await con.post(`/api/documents/${reqId}/submit`, { expiryDate: '2035-01-31' });
{ const { ctx, p } = await session(mine); const t = await today(p);
  check('today', 'with work waiting, the Today card is the first card on the dashboard', await p.evaluate(() => document.querySelector('.view .card, .view .section-title')?.classList.contains('today-card') === true));
  check('today', 'the header counts the same work as the Today card', /1\s*To action/i.test((await p.locator('.hero-stats').innerText()).replace(/\n/g, ' ')), (await p.locator('.hero-stats').innerText()).replace(/\n/g, ' '));
  check('today', 'the mine sees the submission waiting for review', /Review: Letter of Good Standing/.test(t), t.slice(0, 200));
  if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/today-mine.png' });
  await p.locator('.today-row', { hasText: 'Review: Letter of Good Standing' }).first().click(); await p.waitForTimeout(700);
  const opened = await p.evaluate(() => /Letter of Good Standing/.test((document.querySelector('.sheet') as HTMLElement | null)?.innerText || ''));
  check('today', 'tapping a row opens that document', opened);
  await ctx.close(); }
await browser.close(); await db.end();
const failed = rows.filter((r) => !r.ok); console.log(`\n${rows.length - failed.length}/${rows.length} Today checks passed.`); process.exit(failed.length ? 1 : 0);
