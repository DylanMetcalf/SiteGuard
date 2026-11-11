/**
 * Backup and restore drill. Proves a backup can actually be restored, without touching the live database:
 *   1. dumps the source database and archives the uploads folder;
 *   2. restores both into a NEW scratch database and a scratch folder;
 *   3. compares row counts table by table, and re-checks every stored file's SHA-256 against what the database recorded.
 * Prints PASS or FAIL with the reasons; the scratch database is dropped afterwards. Never writes to the source.
 *
 *   DATABASE_URL=postgres://… LOCAL_STORAGE_DIR=.data/uploads npx tsx scripts/restore-drill.mts
 * For a hosted setup, the same checks apply to a database restored from the provider's backup into a new database:
 * set DATABASE_URL to the source and RESTORED_DATABASE_URL to the restored copy to skip steps 1-2 for the database.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const req = createRequire(new URL('../package.json', import.meta.url).pathname);
const pg = req('pg');

const SRC = process.env.DATABASE_URL;
if (!SRC) throw new Error('Set DATABASE_URL to the database to back up.');
if (/prod/i.test(new URL(SRC).pathname) && process.env.DRILL_ALLOW_PROD_SOURCE !== '1') throw new Error('The source name looks like production. Reading is safe, but set DRILL_ALLOW_PROD_SOURCE=1 to confirm you mean it.');
const uploads = path.resolve(process.env.LOCAL_STORAGE_DIR || '.data/uploads');
const work = mkdtempSync(path.join(tmpdir(), 'comvera-drill-'));
const problems: string[] = [];
const url = new URL(SRC);
const scratchName = `${url.pathname.slice(1)}_restore_${Date.now().toString(36)}`;
const admin = new URL(SRC); admin.pathname = '/postgres';
const scratch = process.env.RESTORED_DATABASE_URL || (() => { const u = new URL(SRC); u.pathname = '/' + scratchName; return u.toString(); })();
const log = (m: string) => console.log(m);
const t0 = Date.now();

if (!process.env.RESTORED_DATABASE_URL) {
  log('1. Dumping the database');
  const dump = path.join(work, 'db.dump');
  execFileSync('pg_dump', ['--format=custom', '--no-owner', '--file', dump, SRC]);
  log('2. Restoring into a new scratch database');
  const a = new pg.Client({ connectionString: admin.toString() }); await a.connect();
  await a.query(`create database "${scratchName}"`); await a.end();
  execFileSync('pg_restore', ['--no-owner', '--dbname', scratch, dump]);
}

log('3. Archiving and restoring the uploaded files');
const restoredFiles = path.join(work, 'files');
if (existsSync(uploads)) {
  execFileSync('tar', ['-czf', path.join(work, 'uploads.tgz'), '-C', uploads, '.']);
  execFileSync('mkdir', ['-p', restoredFiles]);
  execFileSync('tar', ['-xzf', path.join(work, 'uploads.tgz'), '-C', restoredFiles]);
} else log(`   (no uploads folder at ${uploads}; if you use cloud storage, check the bucket's versioning instead)`);

log('4. Comparing the original with the restored copy');
const s = new pg.Client({ connectionString: SRC }); await s.connect();
const r = new pg.Client({ connectionString: scratch }); await r.connect();
const tables: string[] = (await s.query(`select tablename from pg_tables where schemaname = 'public' order by 1`)).rows.map((x: any) => x.tablename);
for (const t of tables) {
  const a = (await s.query(`select count(*)::int as n from "${t}"`)).rows[0].n;
  const b = (await r.query(`select count(*)::int as n from "${t}"`)).rows[0].n;
  if (a !== b) problems.push(`${t}: ${a} rows originally, ${b} after restore`);
}
log(`   ${tables.length} tables compared`);
const files = (await r.query(`select storage_key, sha256 from files`)).rows;
let checked = 0, missing = 0, bad = 0;
if (existsSync(uploads)) for (const f of files) {
  const p = path.join(restoredFiles, f.storage_key);
  if (!existsSync(p)) { missing++; continue; }
  checked++;
  if (createHash('sha256').update(readFileSync(p)).digest('hex') !== f.sha256) bad++;
}
if (missing) problems.push(`${missing} file(s) recorded in the database are missing from the restored uploads`);
if (bad) problems.push(`${bad} restored file(s) do not match their recorded checksum`);
log(`   ${files.length} file records, ${checked} files re-checked against their checksums`);
const mig = (await r.query(`select count(*)::int as n from schema_migrations`).catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
log(`   restored copy has ${mig} migrations recorded`);

await s.end(); await r.end();
if (!process.env.RESTORED_DATABASE_URL) {
  const a = new pg.Client({ connectionString: admin.toString() }); await a.connect();
  await a.query(`drop database "${scratchName}"`); await a.end();
}
rmSync(work, { recursive: true, force: true });
const secs = Math.round((Date.now() - t0) / 1000);
if (problems.length) { console.log(`\nFAIL after ${secs} s:\n - ` + problems.join('\n - ')); process.exit(1); }
console.log(`\nPASS in ${secs} s: every table has the same row count, and every stored file matches its checksum.`);
