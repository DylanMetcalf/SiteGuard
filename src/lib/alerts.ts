/**
 * Early warning for the person running the service. The app counts a few signals over a rolling five minutes
 * (server errors, slow requests, failed sign-ins, rate-limit hits) and, when one crosses its threshold, emails the
 * platform owners listed in PLATFORM_ADMIN_EMAILS, at most once an hour per signal. Counts only: no names, emails,
 * addresses or document details are ever put in an alert. Counters live in memory (per instance), so a restart
 * starts them fresh; a hosting-level uptime check (see docs/OPERATIONS.md) covers "the whole thing is down".
 */
import { config } from '../config.js';
import type { Db } from '../db/pool.js';
import { queueEmail } from './email.js';
import { SlidingWindow } from './window.js';

export type Signal = 'server_error' | 'slow_request' | 'login_failed' | 'rate_limited';

export const WINDOW_MS = 5 * 60_000;
export const COOLDOWN_MS = 60 * 60_000;
export const SLOW_REQUEST_MS = 3_000;
export const THRESHOLDS: Record<Signal, number> = { server_error: 10, slow_request: 30, login_failed: 100, rate_limited: 200 };

const WHAT: Record<Signal, { title: string; check: string }> = {
  server_error: { title: 'Server errors are rising', check: 'Open the hosting logs and look for lines with "level":50, then the most recent deploy.' },
  slow_request: { title: 'Pages are responding slowly', check: 'Check database load and the hosting dashboard (CPU, memory, connections).' },
  login_failed: { title: 'Many failed sign-ins', check: 'Look for "security: login_failed" lines. A spike from one address can be a password-guessing attempt; the accounts lock themselves after 10 failures.' },
  rate_limited: { title: 'Many requests are being turned away', check: 'Look for "security: rate_limited" lines. It can be an attack or a busy site behind one router.' },
};

const windows = new SlidingWindow(WINDOW_MS);
const lastSent = new Map<Signal, number>();

/** Records one occurrence of a signal. Cheap enough to call on every request. */
export const noteSignal = (s: Signal, now = Date.now()) => windows.hit(s, now);
export const signalCount = (s: Signal, now = Date.now()) => windows.count(s, now);

export const alertRecipients = () => config.PLATFORM_ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

/** Queues an email for each signal over its threshold (outside its cooldown). Returns the signals that fired. */
export async function checkAlerts(db: Db, now = Date.now()): Promise<Signal[]> {
  const to = alertRecipients();
  const fired: Signal[] = [];
  for (const s of Object.keys(THRESHOLDS) as Signal[]) {
    const n = windows.count(s, now);
    if (n < THRESHOLDS[s]) continue;
    if (now - (lastSent.get(s) ?? 0) < COOLDOWN_MS) continue;
    lastSent.set(s, now);
    fired.push(s);
    for (const email of to) {
      await queueEmail(db, {
        to: email,
        subject: `COMVERA alert: ${WHAT[s].title}`,
        lines: [`${n} occurrences in the last 5 minutes (alert level: ${THRESHOLDS[s]}).`, WHAT[s].check, 'You will not get another alert for this signal for an hour.'],
        dedupeKey: `alert:${s}:${Math.floor(now / COOLDOWN_MS)}:${email}`,
      });
    }
  }
  return fired;
}

/** Test helper. */
export function resetAlerts() { lastSent.clear(); }
