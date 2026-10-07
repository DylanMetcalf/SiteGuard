/**
 * Trial notices (only when billing is switched on): three days before a trial
 * ends, and once it has ended, the organisation's admins get an email and an
 * in-app notification. Each notice is sent once (email dedupe key + notification check).
 */
import { many, withTx } from '../db/pool.js';
import { features } from '../config.js';
import { appUrl, queueToOrg } from '../lib/email.js';
import { notifyOrg } from '../lib/notify.js';

export async function runTrialNotices(): Promise<number> {
  if (!features.billing) return 0;
  return withTx(async (db) => {
    const lock = await many<{ ok: boolean }>(db, 'select pg_try_advisory_xact_lock(727003) as ok');
    if (!lock[0]?.ok) return 0;
    const orgs = await many<{ id: string; name: string; kind: string; trial_ends_at: Date; ended: boolean }>(
      db,
      `select id, name, kind, trial_ends_at, trial_ends_at <= now() as ended from organisations
        where subscription_status = 'trialing' and not is_demo and managed_by_org is null and grant_plan is null
          and trial_ends_at between now() - interval '2 days' and now() + interval '3 days'`,
    );
    let sent = 0;
    for (const o of orgs) {
      const key = `trial-${o.ended ? 'ended' : 'ending'}:${o.id}`;
      const fresh = await db.query('insert into reminder_log (key) values ($1) on conflict do nothing', [key]);
      if (!fresh.rowCount) continue;
      const day = new Date(o.trial_ends_at).toISOString().slice(0, 10);
      const keep = o.kind === 'contractor'
        ? 'Sites that sponsor you stay covered. Your own projects and other clients need a contractor plan.'
        : 'Your contractors keep their own records; your sites become read-only until you choose a plan.';
      const lines = o.ended
        ? [`The COMVERA trial for ${o.name} ended on ${day}.`, 'Nothing has been deleted: everything stays readable.', keep, 'Choose a plan under More → Plan & billing to keep making changes.']
        : [`The COMVERA trial for ${o.name} ends on ${day}.`, 'Nothing is deleted when it ends.', keep, 'Choose a plan any time under More → Plan & billing.'];
      await queueToOrg(db, o.id, ['owner', 'admin'], (m) => ({
        to: m.email,
        subject: o.ended ? 'Your COMVERA trial has ended' : 'Your COMVERA trial ends in 3 days',
        lines: [`Hi ${m.name},`, ...lines], action: { label: 'See plans', url: appUrl('/') }, dedupeKey: `${key}:${m.email}`,
      }));
      await notifyOrg(db, o.id, ['owner', 'admin'], { kind: 'site', title: o.ended ? 'Your trial has ended' : `Your trial ends on ${day}`, body: lines.slice(1).join(' ') });
      sent++;
    }
    return sent;
  });
}
