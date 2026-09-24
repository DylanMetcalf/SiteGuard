/**
 * Live sync. Any write calls `publishChange` with the organisations affected;
 * Postgres NOTIFY fans that out to every app instance, and each instance
 * pushes a small "changed" event over Server-Sent Events to the browsers
 * signed into those organisations. Browsers then refetch their own
 * (permission-scoped) view — the event itself carries no data.
 */
import pg from 'pg';
import type { Db } from '../db/pool.js';
import { config } from '../config.js';

const CHANNEL = 'siteguard_changes';

export async function publishChange(db: Db, orgIds: Iterable<string>): Promise<void> {
  const unique = [...new Set(orgIds)].filter(Boolean);
  if (!unique.length) return;
  // Inside a transaction, NOTIFY is delivered only on commit.
  await db.query('select pg_notify($1, $2)', [CHANNEL, JSON.stringify({ orgs: unique })]);
}

type Listener = (orgIds: string[]) => void;
const listeners = new Set<Listener>();

export function onChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let client: pg.Client | null = null;
let stopping = false;

export async function startRealtime(log: (msg: string) => void = console.log): Promise<void> {
  stopping = false;
  const connect = async () => {
    const c = new pg.Client({
      connectionString: config.DATABASE_URL,
      ssl: config.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
    });
    c.on('notification', (msg) => {
      if (msg.channel !== CHANNEL || !msg.payload) return;
      try {
        const { orgs } = JSON.parse(msg.payload) as { orgs: string[] };
        for (const fn of listeners) fn(orgs);
      } catch {
        /* ignore malformed payloads */
      }
    });
    c.on('error', () => {
      /* handled by 'end' */
    });
    c.on('end', () => {
      client = null;
      if (!stopping) setTimeout(() => connect().catch(() => {}), 2000);
    });
    await c.connect();
    await c.query(`listen ${CHANNEL}`);
    client = c;
    log('realtime: listening for changes');
  };
  await connect();
}

export async function stopRealtime(): Promise<void> {
  stopping = true;
  await client?.end().catch(() => {});
  client = null;
}
