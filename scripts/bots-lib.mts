/**
 * COMVERA bot swarm: about 19 concurrent bots (mines, contractors, attackers, the platform owner, and real
 * browsers) pushing on a running server with realistic and hostile behaviour. Synthetic data only, never a
 * production URL: it refuses to run against anything but localhost unless BOTS_ALLOW_REMOTE=1.
 *
 *   BASE_URL=http://localhost:3000 DATABASE_URL=postgres://… PLATFORM_ADMIN_EMAILS=… npm run test:bots
 *
 * Needs the server started with TRUST_PROXY=true (each bot gets its own address, like real visitors) and a
 * throwaway database. It writes a JSON report and exits non-zero when any probe fails.
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const req = createRequire(import.meta.url.startsWith('file:') ? new URL('../package.json', import.meta.url).pathname : process.cwd() + '/package.json');
const pg = req('pg');

export const BASE = process.env.BASE_URL || 'http://localhost:3000';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE) && process.env.BOTS_ALLOW_REMOTE !== '1') throw new Error('Refusing to run bots against ' + BASE);
export const DB_URL = process.env.DATABASE_URL || 'postgres://siteguard:siteguard@localhost:5432/siteguard_bots';
export const REPORT = process.env.BOTS_REPORT || 'bots-report.json';
export const PW = 'correct horse battery staple';
export const tag = Date.now().toString(36);
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
export const db = new pg.Client({ connectionString: DB_URL }); await db.connect();
export const { chromium } = req('playwright');

/* ---------------- reporting ---------------- */
export type Row = { bot: string; probe: string; ok: boolean; detail: string };
export const rows: Row[] = [];
export const lat: Record<string, number[]> = {};
export const check = (bot: string, probe: string, ok: boolean, detail = '') => { rows.push({ bot, probe, ok, detail: ok ? '' : detail }); if (!ok) console.log(`  ✗ [${bot}] ${probe} ${detail}`); };
export const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };

/* ---------------- an HTTP bot: own cookie jar, own address ---------------- */
let ipN = 10;
export class Bot {
  cookie = ''; csrf = ''; ip = `10.7.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 1}`;
  email = ''; orgId = ''; kind = ''; userId = '';
  constructor(public name: string) {}
  async req(method: string, url: string, body?: unknown, extra: Record<string, string> = {}, raw?: Buffer) {
    const t0 = performance.now();
    const headers: Record<string, string> = { 'x-forwarded-for': this.ip, ...extra };
    if (this.cookie) headers.cookie = this.cookie;
    if (this.csrf && method !== 'GET' && !('x-csrf-token' in headers)) headers['x-csrf-token'] = this.csrf;
    let payload: BodyInit | undefined;
    if (raw) payload = raw; else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    let res: Response;
    try { res = await fetch(BASE + url, { method, headers, body: payload, redirect: 'manual', signal: AbortSignal.timeout(15000) }); }
    catch (e) { return { status: 0, json: null as any, text: String(e), ms: performance.now() - t0, headers: new Headers() }; }
    const ms = performance.now() - t0; (lat[method + ' ' + url.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id').split('?')[0]] ??= []).push(ms);
    for (const c of res.headers.getSetCookie?.() ?? []) { const [pair] = c.split(';'); if (pair.startsWith('sg_session=')) this.cookie = pair.endsWith('=') ? '' : pair; }
    const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, ms, headers: res.headers };
  }
  get = (u: string) => this.req('GET', u);
  post = (u: string, b: unknown = {}) => this.req('POST', u, b);
  patch = (u: string, b: unknown = {}) => this.req('PATCH', u, b);
  put = (u: string, b: unknown = {}) => this.req('PUT', u, b);
  del = (u: string) => this.req('DELETE', u);
  async refresh() { const r = await this.get('/api/bootstrap'); this.csrf = r.json?.csrfToken ?? ''; return r.json; }
  async upload(url: string, filename: string, buf: Buffer, meta?: object, type = 'application/pdf') {
    const b = '----bot' + Math.random().toString(16).slice(2);
    const parts = [Buffer.from(meta ? `--${b}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(meta)}\r\n` : ''),
      Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`), buf, Buffer.from(`\r\n--${b}--\r\n`)];
    return this.req('POST', url, undefined, { 'content-type': `multipart/form-data; boundary=${b}` }, Buffer.concat(parts));
  }
  async signup(org: string, kind: string, extra: object = {}) {
    this.email = `${this.name.toLowerCase()}.${tag}@example.com`; this.kind = kind;
    const r = await this.post('/api/auth/signup', { name: `${this.name} Bot`, email: this.email, password: PW, orgName: org, orgKind: kind, ...extra });
    if (r.status !== 200) return r;
    await db.query('update users set email_verified_at = now() where email = $1', [this.email]);
    const st = await this.refresh(); this.orgId = st?.org?.id ?? ''; this.userId = st?.me?.id ?? '';
    return r;
  }
  /** Fast path for bots whose set-up is not what is being tested. */
  async finishSetup() { await db.query('update organisations set onboarding_completed_at = now() where id = $1', [this.orgId]); return this.refresh(); }
}

