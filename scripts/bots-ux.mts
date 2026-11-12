/**
 * COMVERA bot swarm, scenario "design review": real browsers walk every main screen as a mine and as a contractor, at
 * four screen sizes, and run an automated accessibility audit (axe-core, WCAG 2.2 AA) plus layout checks (sideways
 * scrolling, console errors, failed requests, tiny tap targets). Needs axe-core: AXE_PATH=/path/to/axe.min.js.
 * Output is a ranked list of problems for a person to review; only layout breakage and script errors fail the run.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { BASE, Bot, PDF, REPORT, check, chromium, db, rows, tag, PW } from './bots-lib.mts';

const AXE = readFileSync(process.env.AXE_PATH || '/tmp/axe/node_modules/axe-core/axe.min.js', 'utf8');
const mine = new Bot('UXM'); await mine.signup('UX Mine ' + tag, 'host'); await mine.finishSetup();
const con = new Bot('UXC'); await con.signup('UX Contractor ' + tag, 'contractor'); await con.finishSetup();
const wp = (await mine.post('/api/workplaces', { name: 'UX Pit', packIds: ['baseline'] })).json.id;
const code = (await mine.get('/api/bootstrap')).json.state.workplaces[wp].code;
await con.post('/api/sites/join', { code });
const d = await mine.upload('/api/org-docs', 'p.pdf', PDF, { name: 'Safety Policy', visibility: 'contractors', scope: 'site', workplaceId: wp });
await mine.post(`/api/org-docs/${d.json.id}/require`, { workplaceId: wp, name: 'Induction form' });
await mine.post('/api/doc-folders', { name: 'Permits', workplaceId: wp });

const SIZES = [{ w: 320, h: 640 }, { w: 390, h: 844 }, { w: 768, h: 1024 }, { w: 1280, h: 800 }];
type Issue = { rule: string; impact: string; who: string; screen: string; size: string; nodes: string[]; help: string };
const issues: Issue[] = []; const layout: string[] = []; const consoleErrs = new Set<string>(); const badReq = new Set<string>();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });

async function audit(p: any, who: string, screen: string, size: string) {
  await p.waitForTimeout(who === 'public' || /landing/.test(screen) ? 1600 : 350); // public pages fade in; measure colours once settled
  const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  if (over > 1) {
    const wide = await p.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed').slice(0, 3).map((e) => e.outerHTML.slice(0, 90).replace(/\s+/g, ' ') + ' | ' + e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '') + ' right=' + Math.round(e.getBoundingClientRect().right)));
    layout.push(`${who} / ${screen} / ${size}: page scrolls sideways by ${over}px — widest: ${wide.join(' ; ')}`);
  }
  await p.evaluate(AXE);
  const r = await p.evaluate(async () => await (window as any).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] }, resultTypes: ['violations'] }));
  for (const v of r.violations) issues.push({ rule: v.id, impact: v.impact, who, screen, size, help: v.help, nodes: v.nodes.slice(0, 6).map((n: any) => { const d = n.any?.[0]?.data; return n.target.join(' ').slice(0, 70) + (d && d.fgColor ? ` {${d.fgColor} on ${d.bgColor} = ${d.contrastRatio}}` : ''); }) });
}

async function walk(who: string, bot: Bot, size: { w: number; h: number }) {
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, extraHTTPHeaders: { 'x-forwarded-for': `10.40.${size.w % 250}.${who === 'mine' ? 1 : 2}` } });
  const p = await ctx.newPage(); const sz = `${size.w}px`;
  p.on('pageerror', (e: any) => consoleErrs.add(`${who} ${sz}: ${e.message}`));
  p.on('console', (m: any) => { if (m.type() === 'error') consoleErrs.add(`${who} ${sz}: ${m.text().slice(0, 140)}`); });
  p.on('response', (r: any) => { if (r.status() >= 400 && !/favicon|client-errors/.test(r.url()) && r.status() !== 401) badReq.add(`${r.status()} ${new URL(r.url()).pathname.replace(/[0-9a-f-]{36}/g, ':id')} (${who} ${sz})`); });
  await p.goto(BASE + '/'); await audit(p, who, 'landing / sign in', sz);
  if (!(await p.$('#siEmail'))) await p.$$eval('[data-action]', (els: any[]) => { const e = els.find((x) => /sign in/i.test(x.textContent)); if (e) e.click(); });
  await p.waitForSelector('#siEmail'); await p.fill('#siEmail', bot.email); await p.fill('#siPassword', PW); await p.click('[data-action="signin"]');
  await p.waitForSelector('.bottomnav, nav', { timeout: 15000 }); await p.waitForTimeout(900); await p.click('#tutSkip').catch(() => {});
  const navs: string[] = await p.$$eval('.bottomnav [data-nav]', (els: any[]) => els.map((e) => e.getAttribute('data-nav')));
  for (const n of navs) { await p.click(`.bottomnav [data-nav="${n}"]`).catch(() => {}); await audit(p, who, 'nav: ' + n, sz);
    if (n === 'studio') for (const tab of await p.$$eval('.studio-tabs [data-tab]', (e: any[]) => e.map((x) => x.getAttribute('data-tab')))) { await p.click(`.studio-tabs [data-tab="${tab}"]`).catch(() => {}); await audit(p, who, `studio tab: ${tab}`, sz); }
    if (n === 'sites') { const first = await p.$('[data-action=open-site], [data-action=open-workplace]'); if (first) { await first.click().catch(() => {}); await audit(p, who, 'a site opened', sz); await p.keyboard.press('Escape'); } }
  }
  await ctx.close();
}

const jobs: Promise<void>[] = [];
for (const s of SIZES) { jobs.push(walk('mine', mine, s).catch((e) => { layout.push(`WALK FAILED mine ${s.w}: ${e.message.split('\n')[0]}`); })); jobs.push(walk('contractor', con, s).catch((e) => { layout.push(`WALK FAILED contractor ${s.w}: ${e.message.split('\n')[0]}`); })); }
// public pages, signed out
for (const path of ['/pricing', '/walkthrough', '/privacy', '/terms']) jobs.push((async () => { for (const s of [SIZES[0], SIZES[3]]) { const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, extraHTTPHeaders: { 'x-forwarded-for': '10.41.0.' + (s.w % 200) } }); const p = await ctx.newPage(); const r = await p.goto(BASE + path); if (r && r.status() < 400) await audit(p, 'public', path, s.w + 'px'); else layout.push(`public ${path}: HTTP ${r?.status()}`); await ctx.close(); } })());
await Promise.all(jobs);
await browser.close();

// group
const g = new Map<string, { impact: string; help: string; where: Set<string>; sample: Set<string> }>();
for (const i of issues) { const k = i.rule; const e = g.get(k) ?? { impact: i.impact, help: i.help, where: new Set(), sample: new Set() }; e.where.add(`${i.who}:${i.screen}@${i.size}`); i.nodes.forEach((n) => e.sample.add(n)); g.set(k, e); }
const rank = { critical: 0, serious: 1, moderate: 2, minor: 3 } as Record<string, number>;
const out = [...g.entries()].sort((a, b) => rank[a[1].impact] - rank[b[1].impact] || b[1].where.size - a[1].where.size).map(([rule, e]) => ({ rule, impact: e.impact, help: e.help, screens: e.where.size, sample: [...e.sample].slice(0, 8), where: [...e.where].slice(0, 20) }));
console.log('\nACCESSIBILITY / DESIGN ISSUES (grouped, worst first):');
for (const o of out) console.log(` [${o.impact}] ${o.rule} — ${o.help} (${o.screens} screens) e.g. ${o.sample.slice(0, 5).join(' ; ')}\n      where: ${o.where.slice(0, 8).join(', ')}`);
console.log('\nLAYOUT:', layout.length ? '\n - ' + layout.join('\n - ') : 'no sideways scrolling anywhere');
console.log('\nSCRIPT ERRORS:', consoleErrs.size ? '\n - ' + [...consoleErrs].slice(0, 12).join('\n - ') : 'none');
console.log('\nFAILED REQUESTS:', badReq.size ? '\n - ' + [...badReq].slice(0, 12).join('\n - ') : 'none');
check('ux', 'no screen scrolls sideways at any of the four sizes', layout.length === 0, layout.slice(0, 4).join(' | '));
check('ux', 'no script errors on any screen', consoleErrs.size === 0, [...consoleErrs].slice(0, 3).join(' | '));
check('ux', 'no critical accessibility violations', !out.some((o) => o.impact === 'critical'), out.filter((o) => o.impact === 'critical').map((o) => o.rule).join(','));
writeFileSync(REPORT, JSON.stringify({ issues: out, layout, errors: [...consoleErrs], badReq: [...badReq] }, null, 2));
await db.end();
process.exit(rows.some((r) => !r.ok) ? 1 : 0);
