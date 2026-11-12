/**
 * Landing-page audit. Two modes:
 *   COPY=1   scores the hero's words and design against a plain-language checklist and saves screenshots (one "audit round").
 *   (default) runs the 10 browser checks a visitor would feel: clarity, paths, layout, accessibility, motion, speed.
 * Synthetic and signed-out: it only loads the public home page of a LOCAL server.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { BASE, check, chromium, rows } from './bots-lib.mts';

const SHOTS = process.env.SHOTS || '/tmp/landing-shots';
mkdirSync(SHOTS, { recursive: true });
const ROUND = process.env.ROUND || 'x';
const AXE = readFileSync(process.env.AXE_PATH || '/tmp/axe/node_modules/axe-core/axe.min.js', 'utf8');
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
let ipn = 1;
const open = async (w: number, h: number, opts: Record<string, unknown> = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, extraHTTPHeaders: { 'x-forwarded-for': `10.70.0.${ipn++}` }, ...opts });
  await ctx.addInitScript('window.__name = (f) => f'); // tsx wraps named functions; the page needs this no-op
  const p = await ctx.newPage(); await p.goto(BASE + '/'); await p.waitForSelector(".lp-hero h1"); await p.waitForTimeout(1600); // the hero animates in for about a second; measure when settled
  return { ctx, p };
};

/** syllables, roughly (good enough to compare versions with each other) */
const syl = (w: string) => { w = w.toLowerCase().replace(/[^a-z]/g, ''); if (w.length <= 3) return 1; w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, ''); return (w.match(/[aeiouy]{1,2}/g) || []).length || 1; };
const grade = (t: string) => { const s = t.split(/[.!?]+/).filter((x) => x.trim()); const ws = t.split(/\s+/).filter(Boolean); const sy = ws.reduce((n, w) => n + syl(w), 0); return +(0.39 * (ws.length / Math.max(1, s.length)) + 11.8 * (sy / Math.max(1, ws.length)) - 15.59).toFixed(1); };
const JARGON = ['bound pdf', 'site ready', 'gate clearance', 'qr', 'section by section', 'verification code', 'onboarding', 'workflow', 'compliance posture', 'stakeholder', 'leverage', 'seamless', 'solution', 'platform'];

if (process.env.COPY) {
  const { p } = await open(1280, 800);
  const hero = await p.evaluate(() => {
    const h = document.querySelector('.lp-hero')!;
    const t = (s: string) => (h.querySelector(s) as HTMLElement | null)?.innerText.trim() || '';
    const vh = innerHeight;
    const inView = (el: Element) => { const r = el.getBoundingClientRect(); return r.top < vh && r.bottom > 0; };
    const ctas = [...h.querySelectorAll('a.btn, button.btn')].filter(inView).map((e) => (e as HTMLElement).innerText.trim());
    const anim = [...h.querySelectorAll('*')].filter((e) => { const a = getComputedStyle(e).animationName; return a && a !== 'none'; }).length;
    return { h1: t('h1'), lead: t('.lp-lead'), all: (h as HTMLElement).innerText, ctas, anim, hasVisual: !!h.querySelector('.lp-mock, .lp-visual, svg'), steps: h.querySelectorAll('.lp-hsteps li, .lp-steps li').length };
  });
  const first = (hero.lead.split(/(?<=[.!?])\s/)[0] || '').toLowerCase();
  const text = (hero.h1 + ' ' + hero.lead).toLowerCase();
  const jargon = JARGON.filter((j) => hero.all.toLowerCase().includes(j));
  const wordsH1 = hero.h1.split(/\s+/).length, wordsLead = hero.lead.split(/\s+/).length;
  const checks: [string, boolean, string][] = [
    ['Says what it IS in the first sentence (a portal / online service, "COMVERA is…")', /comvera is|is an? (online )?(portal|service|web)/.test(first), first.slice(0, 90)],
    ['Names WHO it is for (mines AND contractors)', /mine|site/.test(text) && /contractor/.test(text), ''],
    ['Names WHAT moves through it (safety documents / files)', /(safety )?(documents|files?)/.test(text), ''],
    ['States the OUTCOME (cleared / approved / ready to work / at the gate)', /cleared|approved|ready|gate|let on site/.test(text), ''],
    ['Headline is short (12 words or fewer)', wordsH1 <= 12, `${wordsH1} words`],
    ['Lead paragraph is short (45 words or fewer)', wordsLead <= 45, `${wordsLead} words`],
    ['Lead reads at school grade 9 or below', grade(hero.lead) <= 9, `grade ${grade(hero.lead)}`],
    ['No jargon in the hero', jargon.length === 0, jargon.join(', ')],
    ['Two clear paths above the fold, one per audience', hero.ctas.some((c) => /mine|site/i.test(c)) && hero.ctas.some((c) => /contractor/i.test(c)), hero.ctas.join(' | ')],
    ['No more than 4 buttons above the fold', hero.ctas.length <= 4, `${hero.ctas.length}: ${hero.ctas.join(' | ')}`],
    ['A visual shows the product working (illustration or live mock)', hero.hasVisual, ''],
    ['Some life: at least 3 gently animated elements', hero.anim >= 3, `${hero.anim} animated`],
    ['A 3-step "how it works" strip sits inside the hero', hero.steps >= 3, `${hero.steps} steps`],
  ];
  const pass = checks.filter((c) => c[1]).length;
  console.log(`\n=== AUDIT ROUND ${ROUND}: ${pass}/${checks.length} ===`);
  console.log(`H1: ${hero.h1}\nLead: ${hero.lead}\n`);
  for (const [n, ok, d] of checks) console.log(` ${ok ? '✓' : '✗'} ${n}${!ok && d ? '  → ' + d : ''}`);
  for (const [w, h] of [[1280, 800], [390, 844]] as const) { const o = await open(w, h); await o.p.screenshot({ path: `${SHOTS}/round${ROUND}-${w}.png` }); await o.ctx.close(); }
  writeFileSync(`${SHOTS}/round${ROUND}.json`, JSON.stringify({ pass, total: checks.length, checks }, null, 2));
  await browser.close(); process.exit(0);
}

/* ---------------- the 10 browser checks ---------------- */
// 1. clarity in 5 seconds, phone and desktop: headline and definition are above the fold
for (const [w, h] of [[390, 844], [1280, 800]] as const) {
  const { ctx, p } = await open(w, h);
  const r = await p.evaluate(() => { const vh = innerHeight; const q = (s: string) => document.querySelector(s)!.getBoundingClientRect(); return { h1: q('.lp-hero h1').bottom <= vh, lead: q('.lp-hero .lp-lead').bottom <= vh, h1text: (document.querySelector('.lp-hero h1') as HTMLElement).innerText }; });
  check('1 clarity', `${w}px: headline and definition are on screen without scrolling`, r.h1 && r.lead, JSON.stringify(r));
  await ctx.close();
}
// 2. both audiences have an above-the-fold path
for (const [w, h] of [[390, 844], [1280, 800]] as const) {
  const { ctx, p } = await open(w, h);
  const ok = await p.evaluate(() => { const vh = innerHeight; const vis = (re: RegExp) => [...document.querySelectorAll('.lp-hero a, .lp-hero button')].some((e) => re.test((e as HTMLElement).innerText) && e.getBoundingClientRect().top < vh && e.getBoundingClientRect().bottom > 0); return { mine: vis(/mine|site/i), contractor: vis(/contractor/i) }; });
  check('2 paths', `${w}px: a mine path and a contractor path are both on screen`, ok.mine && ok.contractor, JSON.stringify(ok));
  await ctx.close();
}
// 3. the "how it works" strip is in the hero and readable
{ const { ctx, p } = await open(1280, 800); const n = await p.locator('.lp-hero .lp-hsteps li').count(); check('3 steps', 'a three-step strip explains the process inside the hero', n === 3, String(n)); await ctx.close(); }
// 4. no sideways scrolling at four sizes
for (const w of [320, 390, 768, 1280]) { const { ctx, p } = await open(w, 800); const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); check('4 layout', `${w}px: no sideways scroll`, over <= 1, `${over}px`); await ctx.close(); }
// 5. accessibility audit of the hero in light and dark
for (const scheme of ['light', 'dark'] as const) {
  const { ctx, p } = await open(1280, 800, { colorScheme: scheme });
  await p.evaluate(AXE);
  const v = await p.evaluate(async () => (await (window as any).axe.run(document.querySelector('.lp-hero'), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] })).violations.map((x: any) => `${x.id}: ${x.nodes[0].target.join(' ')}`));
  check('5 access', `${scheme} mode: the hero has no accessibility violations`, v.length === 0, v.join(' | '));
  await ctx.close();
}
// 6. the audience buttons start the right sign-up
for (const [label, kind] of [['mine', 'host'], ['contractor', 'contractor']] as const) {
  const { ctx, p } = await open(1280, 800);
  await p.locator('.lp-hero [data-kind="' + kind + '"]').first().click();
  await p.waitForTimeout(400);
  const selected = await p.evaluate(() => (document.querySelector('.role-card.selected, .role-card[aria-checked="true"], .role-card.active') as HTMLElement | null)?.innerText || '');
  check('6 signup', `the ${label} button opens sign-up with the right type already chosen`, new RegExp(kind === 'host' ? 'site|mine' : 'contractor', 'i').test(selected), selected.slice(0, 60));
  await ctx.close();
}
// 7. the walkthrough link works
{ const { ctx, p } = await open(1280, 800); const href = await p.locator('.lp-hero a[href="/walkthrough"]').first().getAttribute('href'); const r = await p.request.get(BASE + (href || '/walkthrough')); check('7 walkthrough', 'the "see how it works" link opens a working page', r.status() === 200, String(r.status())); await ctx.close(); }
// 8. motion respects "reduce motion"; with it on, nothing in the hero animates
{
  const { ctx, p } = await open(1280, 800, { reducedMotion: 'reduce' });
  const running = await p.evaluate(() => [...document.querySelectorAll('.lp-hero *')].filter((e) => { const s = getComputedStyle(e); return s.animationName !== 'none' && parseFloat(s.animationDuration) > 0.01 && s.animationIterationCount !== '1'; }).length);
  check('8 motion', 'with "reduce motion" on, no hero element loops an animation', running === 0, `${running} looping`);
  const { ctx: c2, p: p2 } = await open(1280, 800); const anim = await p2.evaluate(() => [...document.querySelectorAll('.lp-hero *')].filter((e) => getComputedStyle(e).animationName !== 'none').length);
  check('8 motion', 'with motion allowed, the hero has life (3+ animated elements)', anim >= 3, `${anim}`); await ctx.close(); await c2.close();
}
// 9. no errors, nothing loaded from other websites
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, extraHTTPHeaders: { 'x-forwarded-for': '10.70.1.1' } }); await ctx.addInitScript('window.__name = (f) => f'); const p = await ctx.newPage();
  const errs: string[] = [], ext: string[] = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:')) ext.push(r.url()); });
  await p.goto(BASE + '/'); await p.waitForTimeout(1200);
  check('9 clean', 'no script errors and nothing loaded from other websites', errs.length === 0 && ext.length === 0, errs.concat(ext).join(' | ')); await ctx.close();
}
// 10. speed and stability: headline visible fast, layout does not jump
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'x-forwarded-for': '10.70.1.2' } }); await ctx.addInitScript('window.__name = (f) => f'); const p = await ctx.newPage();
  await p.addInitScript(() => { (window as any).__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries() as any[]) if (!e.hadRecentInput) (window as any).__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
  const t0 = Date.now(); await p.goto(BASE + '/'); await p.waitForSelector('.lp-hero h1', { state: 'visible' }); const ms = Date.now() - t0; await p.waitForTimeout(1500);
  const cls = await p.evaluate(() => (window as any).__cls);
  check('10 speed', `headline visible in under 1.5 s on a phone (${ms} ms) and layout shift under 0.05 (${cls.toFixed(3)})`, ms < 1500 && cls < 0.05, `${ms} ms, CLS ${cls}`); await ctx.close();
}
await browser.close();
const failed = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - failed.length}/${rows.length} landing checks passed.`);
process.exit(failed.length ? 1 : 0);
