import type { FastifyInstance } from 'fastify';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgres://siteguard:siteguard@localhost:5432/siteguard_test';
process.env.TEST_DATABASE_URL && (process.env.DATABASE_URL = process.env.TEST_DATABASE_URL);
process.env.LOCAL_STORAGE_DIR = '.data/test-uploads';
process.env.APP_URL = 'http://localhost:3000';
delete process.env.STRIPE_SECRET_KEY;
delete process.env.ANTHROPIC_API_KEY;

const { pool } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { buildApp } = await import('../src/app.js');

export { pool };

let app: FastifyInstance | null = null;

export async function setup(): Promise<FastifyInstance> {
  await pool.query('drop schema public cascade; create schema public;');
  await migrate(pool, () => {});
  app = await buildApp({ logger: false });
  await app.ready();
  return app;
}

export async function teardown() {
  await app?.close();
  await pool.end();
}

/** A browser-like client: keeps its session cookie and CSRF token. */
export class Agent {
  cookie = '';
  csrf = '';
  constructor(private app: FastifyInstance) {}

  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.inject({
      method: method as 'GET',
      url,
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(this.csrf && method !== 'GET' ? { 'x-csrf-token': this.csrf } : {}),
        ...(body !== undefined && !(body instanceof Buffer) ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      payload: body === undefined ? undefined : body instanceof Buffer ? body : JSON.stringify(body),
    });
    const set = res.headers['set-cookie'];
    for (const c of Array.isArray(set) ? set : set ? [set] : []) {
      const [pair] = c.split(';');
      if (pair.startsWith('sg_session=')) {
        this.cookie = pair.endsWith('=') ? '' : pair;
        if (this.cookie) await this.refresh();
      }
    }
    let json: any = null;
    try {
      json = res.json();
    } catch {
      /* not json */
    }
    return { status: res.statusCode, body: json, raw: res };
  }

  async refresh() {
    const res = await this.app.inject({ method: 'GET', url: '/api/bootstrap', headers: { cookie: this.cookie } });
    this.csrf = res.json().csrfToken ?? '';
  }

  get = (url: string) => this.req('GET', url);
  post = (url: string, body: unknown = {}) => this.req('POST', url, body);
  patch = (url: string, body: unknown = {}) => this.req('PATCH', url, body);
  del = (url: string) => this.req('DELETE', url);

  async state() {
    const r = await this.get('/api/bootstrap');
    return r.body;
  }

  /** Uploads a file to a multipart endpoint. */
  async upload(url: string, filename: string, content: Buffer, type = 'application/pdf') {
    const boundary = '----sgtest' + Math.random().toString(16).slice(2);
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return this.req('POST', url, payload, { 'content-type': `multipart/form-data; boundary=${boundary}` });
  }
}

let n = 0;
export const uniqueEmail = (prefix: string) => `${prefix}.${Date.now()}.${n++}@example.com`;
export const PASSWORD = 'correct horse battery staple';

export async function signup(app: FastifyInstance, opts: { orgName: string; orgKind: 'host' | 'contractor'; name?: string; email?: string; siteInviteToken?: string; inviteToken?: string }) {
  const a = new Agent(app);
  const email = opts.email ?? uniqueEmail(opts.orgKind);
  const r = await a.post('/api/auth/signup', { name: opts.name ?? 'Test User', email, password: PASSWORD, ...opts });
  if (r.status !== 200) throw new Error(`signup failed: ${r.status} ${JSON.stringify(r.body)}`);
  await pool.query('update users set email_verified_at = now() where email = $1', [email]);
  await a.refresh();
  return { agent: a, email };
}

/** Pulls the most recent token link sent to an address from the outbox. */
export async function lastEmailToken(to: string, path: string): Promise<string> {
  const r = await pool.query(`select text_body from email_outbox where to_email = $1 order by id desc`, [to]);
  for (const row of r.rows) {
    const m = row.text_body.match(new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`));
    if (m) return m[1];
  }
  throw new Error(`no ${path} email for ${to}`);
}

export const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
