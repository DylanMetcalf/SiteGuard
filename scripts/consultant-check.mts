/**
 * Browser check for the pricing toggle and the safety-consultant journey, with made-up data on a LOCAL server:
 * three plans per audience, the consultant sign-up, adding / opening / leaving a client company, the plan meter.
 */
import { BASE, check, chromium, db, rows, tag } from './bots-lib.mts';

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
let n = 1;
async function page(w = 1280, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, extraHTTPHeaders: { 'x-forwarded-for': `10.96.0.${n++}` } });
  await ctx.addInitScript('window.__name = (f) => f');
  const p = await ctx.newPage(); const errs: string[] = []; p.on('pageerror', (e) => errs.push(e.message));
  return { ctx, p, errs };
}

/* 1. pricing: three choices per audience */
{
  const { ctx, p, errs } = await page();
  await p.goto(BASE + '/pricing'); await p.waitForSelector('.lp-toggle');
  for (const [who, label, ids] of [['contractor', 'Contractors', ['Once-off safety file', 'Contractor Starter', 'Contractor Pro']], ['consultant', 'Safety consultants', ['Consultant Solo', 'Consultant Practice', 'Consultant Firm']], ['host', 'Mines and sites', ['Site Starter', 'Site Professional', 'Enterprise']]] as const) {
    await p.click(`.lp-toggle [data-who="${who}"]`); await p.waitForTimeout(250);
    const names = await p.$$eval('.lp-price h3', (e: any[]) => e.map((x) => x.innerText));
    check('pricing', `${label}: exactly three plans, the right three`, JSON.stringify(names) === JSON.stringify(ids), JSON.stringify(names));
    check('pricing', `${label}: one is marked "Most popular"`, (await p.locator('.lp-flag').count()) === 1);
  }
  await p.click('.lp-toggle [data-who="consultant"]');
  const t = await p.locator('.lp-prices').innerText();
  check('pricing', 'consultant prices are R1,299 / R2,499 / R4,999 with the price per client shown', /R1[\s,\u00a0\u202f]?299/.test(t) && /R2[\s,\u00a0\u202f]?499/.test(t) && /R4[\s,\u00a0\u202f]?999/.test(t) && /per client/.test(t), t.replace(/\s+/g, ' ').slice(0, 260));
  await p.locator('.lp-price').filter({ has: p.locator('h3', { hasText: /^Consultant Solo$/ }) }).locator('[data-kind]').click(); await p.waitForTimeout(400);
  check('pricing', 'a consultant plan button opens sign-up with "consultant" already chosen', /consultant/i.test(await p.evaluate(() => (document.querySelector('.role-card.on, .role-card[aria-checked="true"]') as HTMLElement | null)?.innerText || '')));
  for (const w of [360, 1280]) { await p.setViewportSize({ width: w, height: 800 }); await p.goto(BASE + '/pricing'); await p.waitForSelector('.lp-toggle'); await p.click('.lp-toggle [data-who="consultant"]'); await p.waitForTimeout(300); check('pricing', `${w}px: the pricing page has no sideways scroll`, (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1); }
  check('pricing', 'no script errors', errs.length === 0, errs.join(' | ')); await ctx.close();
}

/* 2. a consultant signs up in the browser and adds a client */
{
  const { ctx, p, errs } = await page(390, 844);
  const email = `consult.${tag}@example.com`;
  if (process.env.DEBUG) p.on('response', async (r) => { if (r.url().includes('/api/consultant') || r.status() >= 400) console.log('  [net]', r.status(), r.request().method(), r.url().replace(BASE, ''), (await r.text().catch(() => '')).slice(0, 140)); });
  await p.goto(BASE + '/pricing'); await p.waitForSelector('.lp-toggle'); await p.click('.lp-toggle [data-who="consultant"]');
  await p.locator('.lp-price').filter({ has: p.locator('h3', { hasText: /^Consultant Practice$/ }) }).locator('[data-kind]').click(); await p.waitForSelector('#suEmail');
  await p.fill('#suName', 'Naledi Khumalo'); await p.fill('#suEmail', email); await p.fill('#suOrgName', 'Khumalo Safety Advisory ' + tag); await p.fill('#suPassword', 'correct horse battery staple');
  await p.click('[data-action="signup"][data-mode="new"]');
  for (let i = 0; i < 20; i++) { const r = await db.query('update users set email_verified_at = now() where email = $1', [email]); if (r.rowCount) break; await p.waitForTimeout(250); } // wait for the account to exist, then confirm the address
  for (let i = 0; i < 12; i++) {
    await p.waitForTimeout(500); if (await p.$('.bottomnav')) break;
    await p.evaluate(() => { for (const el of document.querySelectorAll('input[name="obDocs"]')) if ((el as HTMLInputElement).value === 'later' || (el as HTMLInputElement).value === 'no') (el as HTMLElement).click(); });
    for (const el of await p.$$('input[type="text"]:visible, input[type="email"]:visible, input[type="tel"]:visible, textarea:visible')) { if (!(await el.inputValue())) { const id = (await el.getAttribute('id')) || ''; await el.fill(/mail/i.test(id) ? 'naledi@example.com' : /hone|tel/i.test(id) ? '0820000000' : 'Safety consulting'); } }
    const btn = (await p.$('[data-action="ob-complete"]')) || (await p.$('[data-action="ob-save"]')); if (btn) await btn.click();
  }
  check('consultant', 'a consultant signs up and reaches the app', !!(await p.$('.bottomnav')));
  await p.waitForTimeout(1500); await p.click('#tutSkip', { timeout: 3000 }).catch(() => {}); // the tour offer appears a moment after the app opens
  await p.waitForTimeout(400);
  check('consultant', 'a new consultant is first offered "Add my first client company", not a contractor’s safety file', /Add my first client company/.test(await p.locator('.view').first().innerText()) && !/Build my first safety file/.test(await p.locator('.view').first().innerText()), (await p.locator('.view').first().innerText()).slice(0, 240).replace(/\n/g, ' | '));
  await p.click('.bottomnav [data-nav="more"]'); await p.waitForTimeout(400);
  check('consultant', 'the More menu has "Client companies"', /Client companies/.test(await p.locator('.view').first().innerText()));
  await p.click('[data-action="goto-more"][data-view="clients"]'); await p.waitForSelector('[data-action="client-add"]');
  await p.click('.view [data-action="client-add"]'); await p.waitForSelector('#clName');
  await p.fill('#clName', 'Alpha Scaffolding (Pty) Ltd'); await p.fill('#clReg', 'nonsense'); await p.click('[data-action="client-add-go"]');
  await p.waitForFunction(() => /registration number/i.test((document.getElementById('clErr') as HTMLElement | null)?.innerText || ''), null, { timeout: 8000 }).catch(() => {});
  check('consultant', 'a badly typed registration number is explained, not accepted', /registration number/i.test(await p.locator('#clErr').innerText()));
  await p.waitForFunction(() => !(document.querySelector('[data-action="client-add-go"]') as HTMLButtonElement | null)?.disabled, null, { timeout: 8000 }).catch(() => {});
  await p.fill('#clReg', '2015/123456/07'); await p.click('[data-action="client-add-go"]'); await p.waitForSelector('.client-card');
  const txt = await p.locator('.view').first().innerText();
  check('consultant', 'the client appears, the meter shows 1 of 5 used and the trial limit is explained', /Alpha Scaffolding/.test(txt) && /1 of 5 client companies used/.test(txt) && /Free trial: up to 5 client companies/.test(txt), txt.slice(0, 260).replace(/\n/g, ' | '));
  check('consultant', 'the portfolio fits a phone (no sideways scroll)', (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1);
  await p.click('[data-action="client-open"]'); await p.waitForSelector('.bottomnav'); await p.waitForTimeout(900);
  check('consultant', 'opening a client shows a banner saying who it is managed for, with a way back', /working inside this client company for/i.test(await p.locator('body').innerText()) && (await p.locator('[data-action="client-back"]').count()) > 0);
  await p.click('[data-action="client-back"]'); await p.waitForSelector('[data-action="client-add"]');
  check('consultant', '"Back to my clients" returns to the portfolio', /Client companies/.test(await p.locator('.view').first().innerText()));
  await p.click('.bottomnav [data-nav="dashboard"]'); await p.waitForTimeout(900);
  const dash = await p.locator('.view').first().innerText();
  check('consultant', 'the dashboard now shows "Your clients" first, 1 of 5 used', /Your clients/.test(dash) && /1 of 5 used/.test(dash) && /Alpha Scaffolding/.test(dash), dash.slice(0, 260).replace(/\n/g, ' | '));
  check('consultant', 'no script errors', errs.length === 0, errs.join(' | ')); await ctx.close();
}

await browser.close(); await db.end();
const failed = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - failed.length}/${rows.length} consultant and pricing checks passed.`);
process.exit(failed.length ? 1 : 0);
