import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type pg from 'pg';
import { pool } from './pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Migrations live next to the source; the build copies them next to the output.
const candidates = [path.join(here, 'migrations'), path.join(here, '../../src/db/migrations')];

async function migrationsDir(): Promise<string> {
  for (const dir of candidates) {
    try {
      await readdir(dir);
      return dir;
    } catch {
      /* try next */
    }
  }
  throw new Error('migrations directory not found');
}

/** Applies any unapplied *.sql migrations in filename order, each in its own transaction. */
export async function migrate(db: pg.Pool = pool, log = console.log): Promise<void> {
  const client = await db.connect();
  try {
    // Serialise concurrent migrators (e.g. several instances booting at once).
    await client.query('select pg_advisory_lock(727001)');
    await client.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    const applied = new Set(
      (await client.query('select name from schema_migrations')).rows.map((r: { name: string }) => r.name),
    );
    const dir = await migrationsDir();
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        log(`migrated ${file}`);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock(727001)').catch(() => {});
    client.release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate()
    .then(() => pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
