import { buildApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { startRealtime, stopRealtime } from './lib/realtime.js';
import { startJobs } from './jobs/worker.js';

const app = await buildApp();
const log = (msg: string) => app.log.info(msg);

await migrate(pool, log);
await startRealtime(log);
const stopJobs = config.RUN_JOBS_IN_WEB ? startJobs(log) : () => {};

await app.listen({ port: config.PORT, host: config.HOST });

const shutdown = async (signal: string) => {
  log(`${signal} received, shutting down`);
  stopJobs();
  await app.close();
  await stopRealtime();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
