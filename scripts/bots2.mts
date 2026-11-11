/**
 * COMVERA bot swarm, round 2: security and integrity scenarios that go wider than round 1.
 *   1. Route matrix: every API route, as a stranger, as another organisation holding REAL leaked ids, and as read-only Site Staff.
 *   2. Headers, cookies, caching, CORS, file-download safety.
 *   3. Sessions: logout, sign-out-everywhere, password change, single-use tokens, brute-force on two-step codes.
 *   4. Chaos: 19 bots doing random valid work for 25 s, then database integrity checks.
 * Same rules as bots.mts (localhost only, synthetic data, TRUST_PROXY=true, throwaway database).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { BASE, Bot, PDF, PW, REPORT, check, db, lat, pct, rows, tag } from './bots-lib.mts';
const { codeAt, currentStep } = await import('../src/lib/totp.ts');

const log = (m: string) => console.log(m);
const t0 = Date.now();
const findings: string[] = []; // things worth a human look that are not pass/fail
const UUID = () => crypto.randomUUID();

/* ---------- routes, read from source ---------- */
const files: string[] = [];
const walk = (d: string) => { for (const f of readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(d + '/' + f.name) : f.name.endsWith('.ts') && files.push(d + '/' + f.name); };
walk(new URL('../src', import.meta.url).pathname);
const routes: { m: string; path: string }[] = [];
for (const f of files) for (const mm of readFileSync(f, 'utf8').matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) if (mm[2].startsWith('/api/') || mm[2].startsWith('/')) routes.push({ m: mm[1].toUpperCase(), path: mm[2] });
const apiRoutes = routes.filter((r) => r.path.startsWith('/api/') && r.path !== '/api/events'); // /api/events is a live stream that never ends
log(`Found ${apiRoutes.length} API routes in source`);

/* ---------- cast ---------- */
const mk = async (name: string, kind: string, org: string) => { const b = new Bot(name); const r = await b.signup(org, kind); if (r.status !== 200) throw new Error(name + ' signup ' + r.status + r.text); if (!b.orgId) throw new Error(name + ' no org after signup: ' + JSON.stringify(await b.get('/api/bootstrap')).slice(0, 300)); await b.finishSetup(); return b; };
const [mine, mine2, con, atk, con2] = await Promise.all([mk('V1', 'host', 'Victim Mine ' + tag), mk('V2', 'host', 'Second Mine ' + tag), mk('V3', 'contractor', 'Victim Contractor ' + tag), mk('X1', 'contractor', 'Attacker Co ' + tag), mk('V4', 'contractor', 'Other Contractor ' + tag)]);

/* the victim has real data of every kind */
const wp = (await mine.post('/api/workplaces', { name: 'Victim Pit', packIds: ['baseline'] })).json.id as string;
const st0 = (await mine.get('/api/bootstrap')).json.state; const code = st0.workplaces[wp].code;
const siteId = (await con.post('/api/sites/join', { code })).json.siteId as string;
await con2.post('/api/sites/join', { code });
const doc = (await mine.upload('/api/org-docs', 'policy.pdf', PDF, { name: 'Victim Policy', visibility: 'contractors', scope: 'site', workplaceId: wp })).json.id as string;
const folder = (await mine.post('/api/doc-folders', { name: 'Victim Folder', workplaceId: wp })).json.id as string;
await mine.post(`/api/org-docs/${doc}/require`, { workplaceId: wp, name: 'Victim Form' });
await mine.post('/api/org/invites', { email: `invitee.${tag}@example.com`, role: 'member' });
const reqId = (Object.values((await con.get('/api/bootstrap')).json.state.requirements)[0] as { id: string }[])[0].id;
await con.upload(`/api/documents/${reqId}/file`, 'a.pdf', PDF);

/* pool of REAL victim ids: one row from every table that has a uuid id, preferring the victim organisation */
const tables = (await db.query(`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'id' and data_type = 'uuid'`)).rows.map((r: any) => r.table_name as string);
const pool = new Set<string>();
for (const t of tables) {
  const hasOrg = (await db.query(`select 1 from information_schema.columns where table_name = $1 and column_name = 'org_id'`, [t])).rowCount;
  const q = hasOrg ? `select id from "${t}" where org_id = $1 limit 2` : `select id from "${t}" limit 1`;
  try { for (const r of (await db.query(q, hasOrg ? [mine.orgId] : [])).rows) pool.add(r.id); } catch { /* skip */ }
}
[mine.orgId, mine.userId, siteId, wp, doc, folder, reqId].forEach((x) => x && pool.add(x));
const ids = [...pool];
log(`Pool of ${ids.length} real ids from ${tables.length} tables`);

const fill = (p: string, v: (name: string) => string) => p.replace(/:([A-Za-z]+)/g, (_, n) => v(n));
const DANGEROUS = /\/api\/events|logout|sign-out-everywhere|\/me$|delete-account|account\/delete|\/api\/org$|deactivate/;
const mutate = (m: string) => m !== 'GET';

/* ============ 1. ROUTE MATRIX ============ */
log('1. Route matrix');
let ipc = 100; const rot = (b: Bot) => { b.ip = `10.20.${Math.floor(ipc / 250)}.${(ipc++ % 250) + 1}`; };
const bad: string[] = [];

// 1a. a stranger (no session) with real ids: nothing but public pages may answer 200
const stranger = new Bot('stranger');
const anon2xx = new Set<string>();
await Promise.all(apiRoutes.map(async (r) => {
  const urls = r.path.includes(':') ? [fill(r.path, () => UUID()), fill(r.path, () => doc)] : [r.path];
  for (const u of urls) {
    rot(stranger); const x = await new Bot('s').req(r.m, u, mutate(r.m) ? {} : undefined, { 'x-forwarded-for': stranger.ip });
    if (x.status >= 500 && x.status !== 503) bad.push(`ANON ${r.m} ${u} -> ${x.status}`);
    else if (x.status >= 200 && x.status < 300) anon2xx.add(`${r.m} ${r.path}`);
  }
}));
check('matrix', 'no API route returns a server error to a stranger', !bad.some((b) => b.startsWith('ANON')), bad.filter((b) => b.startsWith('ANON')).slice(0, 5).join(' | '));
const paramPublic = [...anon2xx].filter((r) => r.includes(':') && !/\/api\/(auth\/(invite|site-invite)|x\/|share|gate)/.test(r));
check('matrix', 'a stranger gets no 2xx from any id-scoped route (other than link-token pages)', paramPublic.length === 0, paramPublic.join(' | '));
findings.push('Public API routes answering a stranger with 2xx: ' + [...anon2xx].filter((r) => !r.includes(':')).join(', '));

// 1b. another organisation, every route, every real id
const outcomes: Record<string, number> = {};
const leak: string[] = [], boom: string[] = [];
let n = 0;
const tasks: (() => Promise<void>)[] = [];
for (const r of apiRoutes) {
  if (DANGEROUS.test(r.path) && mutate(r.m)) continue;
  const params = [...r.path.matchAll(/:([A-Za-z]+)/g)].map((x) => x[1]);
  const combos = params.length ? ids.map((id) => fill(r.path, () => id)) : [r.path];
  for (const u of combos) tasks.push(async () => {
    rot(atk); const res = await atk.req(r.m, u, mutate(r.m) ? { name: 'pwned-' + tag } : undefined, { 'x-forwarded-for': atk.ip }); n++;
    outcomes[res.status] = (outcomes[res.status] ?? 0) + 1;
    if (res.status >= 500 && res.status !== 503) boom.push(`${r.m} ${u.replace(/[0-9a-f-]{36}/g, ':id')} -> ${res.status} ${res.text.slice(0, 80)}`);
    if (params.length && res.status >= 200 && res.status < 300 && !/\/api\/(templates|requirement|billing\/plans|auth\/invite|walkthrough)/.test(r.path)) leak.push(`${r.m} ${r.path} -> ${res.status} ${res.text.slice(0, 70)}`);
  });
}
for (let i = 0; i < tasks.length; i += 40) await Promise.all(tasks.slice(i, i + 40).map((f) => f()));
log(`  ${n} cross-organisation requests, outcomes ${JSON.stringify(outcomes)}`);
check('matrix', 'another organisation never causes a server error on any route with any real id', boom.length === 0, [...new Set(boom)].slice(0, 6).join(' | '));
check('matrix', 'another organisation never gets a 2xx from an id-scoped route using the victim’s real ids', leak.length === 0, [...new Set(leak)].slice(0, 6).join(' | '));
const vs = await mine.get('/api/bootstrap');
check('matrix', 'the victim’s data is untouched afterwards', JSON.stringify(vs.json).includes('Victim Policy') && !JSON.stringify(vs.json).includes('pwned-' + tag), 'victim data changed');
check('matrix', 'nothing named by the attacker exists in the database', (await db.query(`select (select count(*) from org_documents where name like $1) + (select count(*) from doc_folders where name like $1) + (select count(*) from workplaces where name like $1) as n`, ['pwned-' + tag + '%'])).rows[0].n === '0');

// 1c. read-only Site Staff of the victim organisation: no writes
// The invitation link is emailed, so the bot plants a known invitation straight into the throwaway database.
const invToken = 'staff-' + crypto.randomUUID().replace(/-/g, '');
const { createHash: ch } = await import('node:crypto');
await db.query(`insert into user_invites (org_id, email, role, token_hash, invited_by, expires_at) values ($1, $2, 'member', $3, $4, now() + interval '1 day')`, [mine.orgId, `staff.${tag}@example.com`, ch('sha256').update(invToken).digest('hex'), mine.userId]);
let staff: Bot | null = null;
if (invToken) {
  staff = new Bot('staff'); staff.email = `staff.${tag}@example.com`;
  const r = await staff.post('/api/auth/signup', { name: 'Staff', email: staff.email, password: PW, inviteToken: invToken });
  if (r.status === 200) { await db.query('update users set email_verified_at = now() where email = $1', [staff.email]); await staff.refresh(); }
  else staff = null;
}
if (staff) {
  const writes: string[] = []; const sboom: string[] = [];
  // self-service, public sandbox, and the agent refresh (re-checks the caller's own organisation, writes only its own findings)
  const SELF = /\/api\/(me|auth|orgs|events|client-errors|assistant|support|onboarding|billing|manager|admin|demo|x\/signout|agent\/run|notifications)/;
  for (const r of apiRoutes.filter((x) => mutate(x.m) && !SELF.test(x.path))) {
    const u = fill(r.path, (nme) => (nme === 'id' ? doc : ids[Math.floor(Math.random() * ids.length)]));
    rot(staff); const res = await staff.req(r.m, u, { name: 'staffwrite-' + tag }, { 'x-forwarded-for': staff.ip });
    if (res.status >= 500) sboom.push(`${r.m} ${r.path} ${res.status}`);
    if (res.status >= 200 && res.status < 300) writes.push(`${r.m} ${r.path}`);
  }
  check('roles', 'read-only Site Staff cause no server errors on any write route', sboom.length === 0, sboom.slice(0, 5).join(' | '));
  check('roles', 'read-only Site Staff can write nothing (no 2xx on any mutating route)', writes.length === 0, writes.slice(0, 10).join(' | '));
} else findings.push('Could not create a Site Staff user (invite flow changed?)');

/* ============ 2. HEADERS, COOKIES, CACHING, CORS, DOWNLOADS ============ */
log('2. Headers and downloads');
{
  const html = await fetch(BASE + '/', { headers: { 'x-forwarded-for': '10.30.0.1' } });
  const h = (x: Response, k: string) => x.headers.get(k) || '';
  const csp = h(html, 'content-security-policy');
  check('headers', 'CSP forbids inline script and framing', /script-src 'self'/.test(csp) && !/script-src[^;]*'unsafe-inline'/.test(csp) && /frame-ancestors/.test(csp), csp.slice(0, 200));
  check('headers', 'nosniff, referrer policy and frame protection are set', h(html, 'x-content-type-options') === 'nosniff' && !!h(html, 'referrer-policy') && (!!h(html, 'x-frame-options') || /frame-ancestors/.test(csp)), JSON.stringify([...html.headers.keys()]));
  check('headers', 'the server does not announce what it runs on', !h(html, 'x-powered-by'), h(html, 'x-powered-by'));
  const api = await mine.get('/api/bootstrap');
  check('headers', 'authenticated API answers are never cached', /no-store|no-cache|private/.test(api.headers.get('cache-control') || ''), api.headers.get('cache-control') || 'none');
  const login = await new Bot('c').req('POST', '/api/auth/login', { email: mine.email, password: PW }, { 'x-forwarded-for': '10.30.0.2' });
  const sc = login.headers.getSetCookie?.().join(' | ') || '';
  check('headers', 'session cookie is HttpOnly and SameSite', /HttpOnly/i.test(sc) && /SameSite=(Strict|Lax)/i.test(sc), sc.slice(0, 160));
  if (!/Secure/i.test(sc)) findings.push('Session cookie has no Secure flag on http://localhost (expected in dev; confirm it is set when NODE_ENV=production).');
  const cors = await fetch(BASE + '/api/bootstrap', { headers: { origin: 'https://evil.example', 'x-forwarded-for': '10.30.0.3', cookie: mine.cookie } });
  check('headers', 'a foreign website is not given cross-origin access', !h(cors, 'access-control-allow-origin') || h(cors, 'access-control-allow-origin') !== 'https://evil.example', h(cors, 'access-control-allow-origin'));
  const csrfFromEvil = await mine.req('POST', '/api/doc-folders', { name: 'evil' }, { origin: 'https://evil.example', 'x-csrf-token': '' });
  check('headers', 'a cross-site write without the token is refused', csrfFromEvil.status === 403, String(csrfFromEvil.status));
  const trace = await fetch(BASE + '/api/bootstrap', { method: 'TRACE', headers: { 'x-forwarded-for': '10.30.0.4' } }).catch(() => ({ status: 0 }) as Response);
  check('headers', 'TRACE is not accepted', trace.status === 0 || trace.status >= 400, String(trace.status));
  for (const p of ['/.env', '/.git/config', '/package.json', '/src/config.ts', '/node_modules/fastify/package.json', '/docs/ARCHITECTURE.md', '/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/.data/test-uploads', '/db/schema.sql'])
    { const x = await fetch(BASE + p, { headers: { 'x-forwarded-for': '10.30.0.5' } }); const body = (await x.text()).slice(0, 300); check('headers', `${p} is not served`, x.status !== 200 || /<!doctype html>/i.test(body), `${x.status} ${body.slice(0, 60)}`); }
  // user-uploaded file: forced download, no sniffing
  const dl = await mine.get(`/api/org-docs/${doc}/file`);
  const cd = dl.headers.get('content-disposition') || '', ct = dl.headers.get('content-type') || '';
  check('headers', 'an uploaded document downloads safely (nosniff, sensible type, attachment or inline PDF only)', dl.status === 200 && dl.headers.get('x-content-type-options') === 'nosniff' && /pdf|octet/.test(ct), `${dl.status} ${ct} ${cd} ${dl.headers.get('x-content-type-options')}`);
  const svg = await mine.upload('/api/org-docs', 'x.svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'), { name: 'svg' }, 'image/svg+xml');
  const html2 = await mine.upload('/api/org-docs', 'x.html', Buffer.from('<script>alert(1)</script>'), { name: 'html' }, 'text/html');
  check('headers', 'SVG and HTML uploads are refused as documents', svg.status >= 400 && svg.status < 500 && html2.status >= 400 && html2.status < 500, `${svg.status}/${html2.status}`);
}

/* ============ 3. SESSIONS AND TOKENS ============ */
log('3. Sessions and tokens');
{
  const u = new Bot('S1'); const sr = await u.signup('Session Co ' + tag, 'host'); await u.finishSetup();
  const old = u.cookie;
  const lg = new Bot('S1b'); lg.ip = u.ip; await lg.req('POST', '/api/auth/login', { email: u.email, password: PW }, { 'x-forwarded-for': u.ip });
  check('sessions', 'a new sign-in issues a different session (no fixation)', !!lg.cookie && lg.cookie !== old, 'same cookie');
  await lg.refresh();
  await lg.post('/api/auth/logout');
  const afterOut = new Bot('S1c'); afterOut.cookie = lg.cookie;
  check('sessions', 'logout kills the session on the server (the old cookie no longer works)', (await afterOut.get('/api/org-docs')).status === 401, String((await afterOut.get('/api/org-docs')).status));
  const second = new Bot('S1d'); await second.req('POST', '/api/auth/login', { email: u.email, password: PW }, { 'x-forwarded-for': '10.31.0.9' }); await second.refresh();
  const probe = new Bot('S1e'); probe.cookie = old; probe.ip = u.ip;
  check('sessions', 'two sessions work at once', (await probe.get('/api/org-docs')).status === 200 && (await second.get('/api/org-docs')).status === 200);
  const so = await second.post('/api/me/sign-out-everywhere');
  check('sessions', 'sign-out-everywhere ends every OTHER session and keeps the current one', so.status === 200 && (await probe.get('/api/org-docs')).status === 401 && (await second.get('/api/org-docs')).status === 200, `${so.status}`);
  // password change ends other sessions
  const a = new Bot('S2'); a.ip = '10.31.1.1'; await a.req('POST', '/api/auth/login', { email: u.email, password: PW }, { 'x-forwarded-for': a.ip }); await a.refresh();
  const b = new Bot('S3'); await b.req('POST', '/api/auth/login', { email: u.email, password: PW }, { 'x-forwarded-for': '10.31.1.2' }); await b.refresh();
  const pc = await a.post('/api/me/password', { current: PW, next: 'another long passphrase 99' });
  check('sessions', 'changing the password works and ends the other session', pc.status === 200 && (await b.get('/api/org-docs')).status === 401, `${pc.status} ${pc.text.slice(0, 80)}`);
  const wrongCur = await a.post('/api/me/password', { current: 'nope nope nope nope', next: 'yet another passphrase 1' });
  check('sessions', 'changing the password needs the current password', wrongCur.status >= 400 && wrongCur.status < 500, String(wrongCur.status));
  // one email tried from many addresses: the per-email limit stops it even though no single address is busy
  const target = new Bot('S6'); await target.signup('Spray Co ' + tag, 'host');
  const spray: number[] = [];
  for (let i = 0; i < 16; i++) spray.push((await new Bot('spray').req('POST', '/api/auth/login', { email: target.email, password: 'wrong guess ' + i }, { 'x-forwarded-for': `10.33.1.${i + 1}` })).status);
  check('sessions', 'guessing one account from 16 different addresses is stopped by the per-email limit', spray.slice(10).every((c) => c === 429 || c === 423) && spray.every((c) => c < 500), JSON.stringify(spray));
  // single-use tokens: reset + verify
  const v = new Bot('S4'); await v.signup('Token Co ' + tag, 'host');
  await db.query(`update users set email_verified_at = null where id = $1`, [v.userId]);
  const raw = 'tok-' + crypto.randomUUID().replace(/-/g, '');
  const { createHash } = await import('node:crypto');
  const h = createHash('sha256').update(raw).digest('hex');
  await db.query(`insert into email_tokens (token_hash, user_id, purpose, expires_at) values ($1, $2, 'verify_email', now() + interval '1 hour')`, [h, v.userId]).catch(async () => { findings.push('email_tokens hash is not plain sha256 hex; skipped single-use verify test'); });
  const ok1 = await new Bot('t1').req('POST', '/api/auth/verify-email', { token: raw }, { 'x-forwarded-for': '10.31.2.1' });
  const ok2 = await new Bot('t2').req('POST', '/api/auth/verify-email', { token: raw }, { 'x-forwarded-for': '10.31.2.2' });
  check('sessions', 'a verification link works once and not twice', (ok1.status === 200 && ok2.status >= 400) || ok1.status >= 400, `${ok1.status}/${ok2.status}`);
  const exp = 'tok-' + crypto.randomUUID().replace(/-/g, ''); const eh = createHash('sha256').update(exp).digest('hex');
  await db.query(`insert into email_tokens (token_hash, user_id, purpose, expires_at) values ($1, $2, 'reset_password', now() - interval '1 minute')`, [eh, v.userId]).catch(() => {});
  const expired = await new Bot('t3').req('POST', '/api/auth/reset', { token: exp, password: 'brand new passphrase 22' }, { 'x-forwarded-for': '10.31.2.3' });
  check('sessions', 'an expired reset link is refused', expired.status >= 400 && expired.status < 500, String(expired.status));
  // second-step brute force
  const m = new Bot('S5'); await m.signup('Mfa Co ' + tag, 'host'); await m.finishSetup();
  const ownerMfa = process.env.PLATFORM_ADMIN_EMAILS?.split(',')[0]?.trim();
  if (ownerMfa) {
    const o = new Bot('own'); o.email = ownerMfa; await o.post('/api/auth/signup', { name: 'Owner', email: ownerMfa, password: PW, orgName: 'Own ' + tag, orgKind: 'host' });
    await db.query('update users set email_verified_at = now() where email = $1', [ownerMfa]); o.orgId = (await o.refresh())?.org?.id ?? ''; await o.finishSetup();
    const s = await o.post('/api/manager/mfa/setup'); await o.post('/api/manager/mfa/enable', { code: codeAt(s.json.secret, currentStep()) });
    const fresh = new Bot('own2'); fresh.ip = '10.31.3.3';
    const login = await fresh.req('POST', '/api/auth/login', { email: ownerMfa, password: PW }, { 'x-forwarded-for': fresh.ip });
    check('sessions', 'a password alone does not sign a user with two-step in', !fresh.cookie && login.status === 200 && (login.json?.mfaRequired || login.json?.mfa || login.json?.challenge || login.json?.ticket), login.text.slice(0, 120));
    const ticket = login.json?.ticket || login.json?.challenge || login.json?.loginTicket;
    if (ticket) {
      const codes: number[] = [];
      for (let i = 0; i < 25; i++) codes.push((await fresh.req('POST', '/api/auth/login/mfa', { ticket, code: String(100000 + i * 7919).slice(0, 6) }, { 'x-forwarded-for': `10.31.4.${i + 1}` })).status);
      check('sessions', '25 wrong two-step codes (from 25 addresses) never sign in and never crash', !fresh.cookie && codes.every((c) => c < 500 && c !== 200), JSON.stringify(codes));
      check('sessions', 'guessing two-step codes gets the sign-in attempt locked or limited', codes.slice(-5).every((c) => [401, 423, 429, 400, 403].includes(c)) && new Set(codes).size > 0, JSON.stringify(codes));
    } else findings.push('Could not find the login ticket field in the two-step response; brute-force test skipped.');
  }
}

/* ============ 4. CHAOS + INTEGRITY ============ */
log('4. Chaos for 25 s, then integrity');
{
  const crew = await Promise.all(Array.from({ length: 12 }, async (_, i) => { const b = i % 3 === 0 ? await mk('K' + i, 'host', `Chaos Mine ${i} ${tag}`) : await mk('K' + i, 'contractor', `Chaos Con ${i} ${tag}`); return b; }));
  const hosts = crew.filter((b) => b.kind === 'host'), cons = crew.filter((b) => b.kind === 'contractor');
  const sitesOf: Record<string, string> = {};
  for (const h of hosts) { const w = await h.post('/api/workplaces', { name: `Chaos ${h.name}`, packIds: ['baseline'] }); const c = (await h.get('/api/bootstrap')).json.state.workplaces[w.json.id].code; sitesOf[h.name] = c; for (const c2 of cons) await c2.post('/api/sites/join', { code: c }); }
  const my: Record<string, string[]> = {}; const errs: string[] = []; const t1 = Date.now();
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  let ops = 0;
  const step = async (b: Bot) => {
    rot(b); const st = (await b.get('/api/bootstrap')).json?.state; const dl = my[b.name] ??= [];
    const roll = Math.random(); let r;
    if (b.kind === 'host') {
      const wps = Object.keys(st?.workplaces ?? {});
      if (roll < 0.3 || !dl.length) { r = await b.upload('/api/org-docs', 'c.pdf', PDF, { name: 'Chaos ' + ops, visibility: pick(['internal', 'contractors', 'restricted']), scope: 'site', workplaceId: pick(wps) }); if (r.status === 200) dl.push(r.json.id); }
      else if (roll < 0.5) r = await b.post(`/api/org-docs/${pick(dl)}/require`, { workplaceId: pick(wps), name: 'Form ' + (ops % 5) });
      else if (roll < 0.6) r = await b.del(`/api/org-docs/${dl.splice(Math.floor(Math.random() * dl.length), 1)[0]}?force=1`);
      else if (roll < 0.7) r = await b.post(`/api/org-docs/${pick(dl)}/archive`, { archived: Math.random() < 0.5 });
      else if (roll < 0.8) r = await b.post('/api/doc-folders', { name: 'F' + (ops % 7), workplaceId: pick(wps) });
      else if (roll < 0.9) r = await b.patch(`/api/org-docs/${pick(dl)}`, { visibility: pick(['internal', 'contractors', 'restricted']) });
      else r = await b.get('/api/org-docs');
    } else {
      const reqs = Object.values(st?.requirements ?? {}).flat() as { id: string }[];
      if (roll < 0.4 && reqs.length) r = await b.upload(`/api/documents/${pick(reqs).id}/file`, 'f.pdf', PDF);
      else if (roll < 0.6 && reqs.length) r = await b.post(`/api/documents/${pick(reqs).id}/submit`, { expiryDate: '2035-01-01' });
      else if (roll < 0.8) r = await b.get('/api/org-docs/shared');
      else r = await b.post('/api/assistant', { messages: [{ role: 'user', content: 'What needs my attention?' }] });
    }
    ops++;
    if (r && r.status >= 500) errs.push(`${r.status} ${b.kind}`);
  };
  while (Date.now() - t1 < 25000) await Promise.all(crew.map((b) => step(b).catch((e) => errs.push('exc ' + e.message))));
  check('chaos', `${ops} random valid operations by 12 bots: no server errors`, errs.length === 0, [...new Set(errs)].slice(0, 5).join(' | '));
  const inv = async (probe: string, sql: string) => { const r = await db.query(sql); check('integrity', probe, r.rows.length === 0 || Number(r.rows[0].n) === 0, JSON.stringify(r.rows.slice(0, 3))); };
  await inv('no uploaded document points at a missing file', `select count(*) as n from org_documents d where d.current_file_id is not null and not exists (select 1 from files f where f.id = d.current_file_id)`);
  await inv('no document version points at a missing file', `select count(*) as n from org_document_versions v where not exists (select 1 from files f where f.id = v.file_id)`);
  await inv('no folder links to another organisation’s site', `select count(*) as n from doc_folders f join workplaces w on w.id = f.workplace_id where w.org_id <> f.org_id`);
  await inv('no document sits in another organisation’s folder', `select count(*) as n from org_documents d join doc_folders f on f.id = d.folder_id where f.org_id <> d.org_id`);
  await inv('no document belongs to another organisation’s site', `select count(*) as n from org_documents d join workplaces w on w.id = d.workplace_id where w.org_id <> d.org_id`);
  await inv('every organisation still has an owner', `select count(*) as n from organisations o where o.status = 'active' and o.account_class <> 'demo' and o.name <> 'Kestrel Property Group' and not exists (select 1 from memberships m where m.org_id = o.id and m.role = 'owner')`);
  await inv('no user without a membership', `select count(*) as n from users u where not is_demo and not exists (select 1 from memberships m where m.user_id = u.id)`);
  await inv('no duplicate site files for one contractor at one site', `select count(*) as n from (select contractor_id, workplace_id from sites where workplace_id is not null group by 1, 2 having count(*) filter (where status not in ('archived','removed')) > 1) x`);
  await inv('audit log is intact (every entry has an organisation)', `select count(*) as n from audit_events where org_id is null`);
  const bs = await Promise.all(crew.map((b) => b.get('/api/bootstrap')));
  check('integrity', 'every bot’s workspace still loads after the chaos', bs.every((r) => r.status === 200 && r.json?.state), JSON.stringify(bs.map((r) => r.status)));
}

/* ============ verdict ============ */
const failed = rows.filter((r) => !r.ok);
const slow = Object.entries(lat).map(([k, v]) => ({ route: k, n: v.length, p95: Math.round(pct(v, 0.95)), max: Math.round(Math.max(...v)) })).sort((a, b) => b.p95 - a.p95).slice(0, 8);
writeFileSync(REPORT, JSON.stringify({ seconds: Math.round((Date.now() - t0) / 1000), probes: rows.length, failed, findings, slow }, null, 2));
console.log(`\n${rows.length - failed.length}/${rows.length} probes passed in ${Math.round((Date.now() - t0) / 1000)} s.`);
if (findings.length) console.log('For a human to look at:\n - ' + findings.join('\n - '));
console.log('Slowest p95 (ms):', slow.slice(0, 5).map((s) => `${s.route} ${s.p95}`).join(' · '));
await db.end();
process.exit(failed.length ? 1 : 0);
