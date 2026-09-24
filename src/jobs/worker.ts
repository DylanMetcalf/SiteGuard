/**
 * Background work: delivers queued email every few seconds, and runs
 * reminder digests and housekeeping hourly. Runs inside the web process by
 * default (RUN_JOBS_IN_WEB), or standalone via `npm run worker`.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { deliverPendingEmail } from '../lib/email.js';
import { cleanupExpired, runReminders } from './reminders.js';
import { purgeOldDemos } from '../routes/demo.js';
import { pool } from '../db/pool.js';

export function startJobs(log: (msg: string) => void = console.log): () => void {
  let stopped = false;
  let sending = false;
  const mailTimer = setInterval(async () => {
    if (sending || stopped) return;
    sending = true;
    try {
      await deliverPendingEmail(log);
    } catch (err) {
      log(`email delivery error: ${(err as Error).message}`);
    } finally {
      sending = false;
    }
  }, 5_000);

  const hourly = async () => {
    if (stopped) return;
    try {
      const sent = await runReminders();
      if (sent) log(`reminders: queued ${sent} digest email(s)`);
      await cleanupExpired();
      const purged = await purgeOldDemos();
      if (purged) log(`demo: purged ${purged} old sandbox(es)`);
    } catch (err) {
      log(`hourly job error: ${(err as Error).message}`);
    }
  };
  const startup = setTimeout(hourly, 15_000);
  const hourlyTimer = setInterval(hourly, 60 * 60_000);

  return () => {
    stopped = true;
    clearInterval(mailTimer);
    clearInterval(hourlyTimer);
    clearTimeout(startup);
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const stop = startJobs();
  const shutdown = async () => {
    stop();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  console.log('worker: running');
}
