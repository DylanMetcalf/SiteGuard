/**
 * Stored-file hygiene. A failed upload or a deleted document can leave a row in `files` (and its stored object) that
 * nothing points at. This finds them and, only when explicitly switched on, removes them.
 *
 * Safety rules, because deleting files cannot be undone:
 *  - a file counts as an orphan only if NO foreign key anywhere points at it (read from the database catalogue, so a
 *    table added later is covered automatically) AND no organisation setting mentions its id (logos are stored by id
 *    inside settings JSON) AND it is older than ORPHAN_MIN_AGE_DAYS;
 *  - the default is report-only: set ORPHAN_CLEANUP=delete to remove. The report is logged once a day;
 *  - the row is deleted first, then the stored object; a failure on the object is logged and never blocks the rest.
 */
import { pool, withTx, type Db } from '../db/pool.js';
import { storage } from './storage.js';

export const ORPHAN_MIN_AGE_DAYS = 7;

export interface Orphan { id: string; org_id: string; storage_key: string; size_bytes: number; created_at: Date }

/** Every (table, column) that references files(id) with a foreign key. */
export async function fileReferences(db: Db): Promise<{ table: string; column: string }[]> {
  const r = await db.query(
    `select c.conrelid::regclass::text as tbl, a.attname as col
       from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
      where c.contype = 'f' and c.confrelid = 'public.files'::regclass`,
  );
  return r.rows.map((x: { tbl: string; col: string }) => ({ table: x.tbl, column: x.col }));
}

export async function findOrphans(db: Db, olderThanDays = ORPHAN_MIN_AGE_DAYS, onlyId?: string): Promise<Orphan[]> {
  const refs = await fileReferences(db);
  const notReferenced = refs.map((x) => `not exists (select 1 from ${x.table} t where t.${JSON.stringify(x.column)} = f.id)`).join(' and ') || 'true';
  const r = await db.query(
    `select f.id, f.org_id, f.storage_key, f.size_bytes::int as size_bytes, f.created_at
       from files f
      where f.created_at < now() - ($1::int * interval '1 day')
        and ($2::uuid is null or f.id = $2)
        and ${notReferenced}
        and not exists (select 1 from organisations o where o.settings::text like '%' || f.id::text || '%')
      order by f.created_at
      limit 5000`,
    [olderThanDays, onlyId ?? null],
  );
  return r.rows;
}

/** Deletes the orphans' rows and stored objects. Returns how many were removed. */
export async function removeOrphans(orphans: Orphan[], log: (m: string) => void = console.log): Promise<number> {
  let removed = 0;
  for (const o of orphans) {
    // Re-check inside the transaction: something may have attached the file since the scan.
    let gone = false;
    try {
      gone = await withTx(async (db) => {
        await db.query('select id from files where id = $1 for update', [o.id]);
        if (!(await findOrphans(db, ORPHAN_MIN_AGE_DAYS, o.id)).length) return false;
        await db.query('delete from files where id = $1', [o.id]);
        return true;
      });
    } catch (err) {
      log(`file hygiene: skipped ${o.id}: ${(err as Error).message}`); // e.g. something attached it a moment ago; the foreign key protected it
      continue;
    }
    if (!gone) continue;
    removed++;
    try { await storage.remove(o.storage_key); } catch (err) { log(`file hygiene: row removed but object ${o.storage_key} was not: ${(err as Error).message}`); }
  }
  return removed;
}

let lastRun = '';
/** Called from the hourly job; does its work once a day. */
export async function runFileHygiene(log: (m: string) => void = console.log, now = new Date()): Promise<number> {
  const day = now.toISOString().slice(0, 10);
  if (lastRun === day) return 0;
  const orphans = await findOrphans(pool);
  lastRun = day; // after the scan succeeded, so a failed scan is retried next hour
  if (!orphans.length) return 0;
  const bytes = orphans.reduce((n, o) => n + Number(o.size_bytes), 0);
  if (process.env.ORPHAN_CLEANUP !== 'delete') {
    log(`file hygiene: ${orphans.length} unreferenced file(s), ${(bytes / 1e6).toFixed(1)} MB, older than ${ORPHAN_MIN_AGE_DAYS} days (report only; set ORPHAN_CLEANUP=delete to remove)`);
    return 0;
  }
  const n = await removeOrphans(orphans, log);
  log(`file hygiene: removed ${n} of ${orphans.length} unreferenced file(s)`);
  return n;
}
