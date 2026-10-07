/**
 * The mine's oversight tools:
 *  - suspend a contractor company across every one of the mine's sites at once;
 *  - monthly contractor audits (a scored on-site checklist) whose findings are
 *    tracked until the mine closes them;
 *  - validity rules: how long the mine accepts medicals, inductions, COID
 *    letters and insurance.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, pool, withTx } from '../db/pool.js';
import { isUuid, loadSite, requireHostAdmin, requireOrg, requireReviewer, requireWritable } from '../lib/authz.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { publishChange } from '../lib/realtime.js';
import { notifyOrg, REVIEWERS } from '../lib/notify.js';
import { recheckSiteReady } from '../lib/siteready.js';
import { RULE_KEYS, saToday } from '../lib/validity.js';
import { auditFor } from './org.js';
import { sponsorFile } from '../lib/sponsorship.js';

/** The standard monthly audit checklist; the auditor can add items of their own. */
export const AUDIT_ITEMS = [
  'Safety file is on site, current and matches COMVERA',
  'Every worker on site is cleared at the gate (medical and induction)',
  'Toolbox talk held today and signed',
  'Risk assessment and method statement available and followed',
  'Permits to work displayed and valid for the work in progress',
  'Correct PPE worn by everyone',
  'Work area barricaded and signposted',
  'Housekeeping: access routes clear, waste removed',
  'Tools and equipment inspected and tagged',
  'Fire extinguishers present and in date',
  'First aid box stocked; first aider on site',
  'Emergency numbers and muster point known to the crew',
  'Competent supervisor present',
] as const;

const text = (max: number) => z.string().trim().max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const addDays = (n: number) => new Date(Date.parse(saToday() + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);

export default async function oversightRoutes(app: FastifyInstance) {
  /**
   * Mine: end or resume sponsoring one contractor's file on its site. Ending it
   * means the contractor needs its own plan to keep changing that file; its
   * records stay readable to both sides.
   */
  app.post('/api/sites/:id/sponsorship/:action', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireHostAdmin(ctx);
    requireWritable(ctx);
    const { id, action } = req.params as { id: string; action: string };
    if (!['end', 'resume'].includes(action)) throw notFound();
    return withTx(async (db) => {
      const { site, side } = await loadSite(db, ctx, id);
      if (side !== 'host' || !site.linked_org_id) throw notFound();
      const sp = await one<{ id: string; ended_at: Date | null }>(db, 'select id, ended_at from sponsorships where site_id = $1 for update', [site.id]);
      if (action === 'end') {
        if (!sp || sp.ended_at) throw conflict('This file is not sponsored.');
        const reason = z.object({ reason: z.string().trim().max(300).default('') }).parse(req.body ?? {}).reason;
        await db.query('update sponsorships set ended_at = now(), ended_reason = $2 where id = $1', [sp.id, reason]);
        await audit(db, ctx, 'Ended sponsorship', `${site.contractor_name}${reason ? ' — ' + reason : ''}`, site.id);
        await notifyOrg(db, site.linked_org_id, null, { kind: 'site', title: `${ctx.org.name} no longer sponsors your ${site.name} file`, body: 'Your records stay readable. To keep changing this file, choose a contractor plan under Plan & billing.', link: { kind: 'site', siteId: site.id } });
      } else {
        if (sp && !sp.ended_at) throw conflict('This file is already sponsored.');
        await sponsorFile(db, site.id);
        await audit(db, ctx, 'Resumed sponsorship', site.contractor_name, site.id);
        await notifyOrg(db, site.linked_org_id, null, { kind: 'site', title: `${ctx.org.name} sponsors your ${site.name} file again`, body: 'You can keep working on this safety file without your own plan.', link: { kind: 'site', siteId: site.id } });
      }
      await publishChange(db, [ctx.org.id, site.linked_org_id]);
      return { ok: true };
    });
  });

  // ---- Suspension -------------------------------------------------------------------------
  app.post('/api/contractors/:id/:action', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireHostAdmin(ctx);
    requireWritable(ctx);
    const { id, action } = req.params as { id: string; action: string };
    if (!isUuid(id) || (action !== 'suspend' && action !== 'unsuspend')) throw notFound();
    const { reason } = z.object({ reason: text(300).default('') }).parse(req.body ?? {});
    if (action === 'suspend' && reason.length < 3) throw badRequest('Say why the contractor is suspended — they will see this.');
    return withTx(async (db) => {
      const c = await one<{ id: string; name: string; linked_org_id: string | null; suspended_at: Date | null }>(
        db, 'select id, name, linked_org_id, suspended_at from contractors where id = $1 and org_id = $2 for update', [id, ctx.org.id]);
      if (!c) throw notFound();
      const sites = await many<{ id: string }>(db, `select id from sites where contractor_id = $1 and status <> 'declined'`, [c.id]);
      if (action === 'suspend') {
        if (c.suspended_at) throw conflict('Already suspended.');
        await db.query(`update contractors set suspended_at = now(), suspended_reason = $2, suspended_by_name = $3 where id = $1`, [c.id, reason, ctx.user.name]);
        await audit(db, ctx, 'Suspended contractor', `${c.name} on all sites — ${reason}`);
        // Work stops: live and pending permits are closed, with the reason on each.
        const closed = await many<{ id: string; site_id: string; type: string; location: string }>(
          db,
          `update permits set status = 'closed', closed_by_name = $2, closed_at = now(), close_notes = $3
            where site_id = any($1::uuid[]) and status in ('pending', 'active') returning id, site_id, type, location`,
          [sites.map((s) => s.id), ctx.user.name, `Closed: contractor suspended — ${reason}`],
        );
        for (const p of closed) await audit(db, ctx, 'Closed permit', `${p.type.replace(/_/g, ' ')} at ${p.location} — contractor suspended`, p.site_id);
        for (const s of sites) await recheckSiteReady(db, s.id, 'contractor suspended');
        if (c.linked_org_id) await notifyOrg(db, c.linked_org_id, null, { kind: 'correction', title: `Suspended by ${ctx.org.name}`, body: `On all ${ctx.org.name} sites: ${reason}. Your people won't be cleared at the gate until the suspension is lifted.` });
      } else {
        if (!c.suspended_at) throw conflict('This contractor isn\'t suspended.');
        await db.query(`update contractors set suspended_at = null, suspended_reason = '', suspended_by_name = '' where id = $1`, [c.id]);
        await audit(db, ctx, 'Lifted contractor suspension', c.name);
        if (c.linked_org_id) await notifyOrg(db, c.linked_org_id, null, { kind: 'approved', title: `Suspension lifted by ${ctx.org.name}`, body: 'You can work on their sites again. Sites that were Site Ready need approving again.' });
      }
      await publishChange(db, [ctx.org.id, ...(c.linked_org_id ? [c.linked_org_id] : [])]);
      return { ok: true, sites: sites.length };
    });
  });

  // ---- Audits -------------------------------------------------------------------------------
  app.get('/api/audit-checklist', async (req) => {
    requireOrg(req.ctx);
    return { items: AUDIT_ITEMS };
  });

  app.post('/api/sites/:id/audits', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireReviewer(ctx);
    requireWritable(ctx);
    const body = z
      .object({
        auditedOn: isoDate.optional(),
        items: z.array(z.object({ text: text(200).min(1), result: z.enum(['yes', 'no', 'na']), note: text(500).default(''), dueOn: isoDate.optional() })).min(1).max(60),
        summary: text(1000).default(''),
      })
      .parse(req.body);
    const failed = body.items.filter((i) => i.result === 'no');
    for (const f of failed) if (!f.note) throw badRequest(`Say what was wrong for “${f.text}”, so the contractor knows what to fix.`);
    const scored = body.items.filter((i) => i.result !== 'na');
    if (!scored.length) throw badRequest('Mark at least one item yes or no.');
    const score = Math.round((100 * scored.filter((i) => i.result === 'yes').length) / scored.length);
    const on = body.auditedOn ?? saToday();
    if (on > saToday()) throw badRequest('The audit date can\'t be in the future.');
    return withTx(async (db) => {
      const { site, side, parties } = await loadSite(db, ctx, (req.params as { id: string }).id);
      if (side !== 'host') throw forbidden('Only the site audits its contractors.');
      const a = (await one<{ id: string }>(
        db,
        `insert into contractor_audits (site_id, org_id, audited_on, auditor_id, auditor_name, items, score, summary) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [site.id, ctx.org.id, on, ctx.user.id, ctx.user.name, JSON.stringify(body.items), score, body.summary],
      ))!;
      for (const f of failed) {
        await db.query(`insert into audit_findings (audit_id, site_id, text, due_on) values ($1, $2, $3, $4)`, [a.id, site.id, `${f.text}: ${f.note}`, f.dueOn ?? addDays(7)]);
      }
      await audit(db, ctx, 'Audited contractor', `${site.contractor_name}: ${score}%${failed.length ? `, ${failed.length} finding${failed.length === 1 ? '' : 's'}` : ''}`, site.id);
      if (site.linked_org_id) {
        await notifyOrg(db, site.linked_org_id, null, {
          kind: failed.length ? 'correction' : 'approved', title: `Site audit: ${score}% at ${site.name}`,
          body: failed.length ? `${failed.length} finding${failed.length === 1 ? '' : 's'} to fix — see the site's Audits tab.` : 'No findings. Well done.',
          link: { kind: 'site', siteId: site.id },
        });
      }
      await publishChange(db, parties);
      return { id: a.id, score, findings: failed.length };
    });
  });

  /** Contractor: say what was done about a finding. Mine: close it (or reopen it if the fix isn't good enough). */
  app.post('/api/findings/:id/:action', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const { id, action } = req.params as { id: string; action: string };
    if (!isUuid(id) || !['respond', 'close', 'reopen'].includes(action)) throw notFound();
    const { note } = z.object({ note: text(1000).default('') }).parse(req.body ?? {});
    return withTx(async (db) => {
      const f = await one<{ id: string; site_id: string; text: string; status: string }>(db, 'select id, site_id, text, status from audit_findings where id = $1 for update', [id]);
      if (!f) throw notFound();
      const { site, side, parties } = await loadSite(db, ctx, f.site_id);
      if (action === 'respond') {
        if (side !== 'contractor') throw forbidden('The contractor responds to its findings.');
        if (f.status === 'closed') throw conflict('This finding is already closed.');
        if (note.length < 3) throw badRequest('Say what was done to fix it.');
        await db.query(`update audit_findings set status = 'responded', response = case when response = '' then $2 else response || E'\n' || $2 end, responded_by = $3, responded_at = now() where id = $1`, [f.id, note, ctx.user.name]);
        await audit(db, ctx, 'Responded to audit finding', `${f.text.slice(0, 120)} — ${note.slice(0, 200)}`, site.id);
        await notifyOrg(db, site.org_id, [...REVIEWERS], { kind: 'review', title: `Finding fixed? ${site.contractor_name}`, body: `${f.text.slice(0, 120)} — ${note.slice(0, 200)}`, link: { kind: 'site', siteId: site.id } });
      } else {
        if (side !== 'host') throw forbidden();
        requireReviewer(ctx);
        if (action === 'close') {
          if (f.status === 'closed') throw conflict('Already closed.');
          await db.query(`update audit_findings set status = 'closed', closed_by_name = $2, closed_at = now() where id = $1`, [f.id, ctx.user.name]);
          await audit(db, ctx, 'Closed audit finding', f.text.slice(0, 200), site.id);
        } else {
          if (f.status !== 'responded') throw conflict('Only a finding the contractor has responded to can be reopened.');
          if (note.length < 3) throw badRequest('Say why the fix isn\'t good enough.');
          await db.query(`update audit_findings set status = 'open', response = response || $2 where id = $1`, [f.id, `\n[Reopened by ${ctx.user.name}: ${note}]`]);
          await audit(db, ctx, 'Reopened audit finding', `${f.text.slice(0, 120)} — ${note.slice(0, 200)}`, site.id);
        }
        if (site.linked_org_id) await notifyOrg(db, site.linked_org_id, null, { kind: action === 'close' ? 'approved' : 'correction', title: action === 'close' ? 'Audit finding closed' : 'Audit finding reopened', body: `${f.text.slice(0, 160)}${note ? ` — ${note.slice(0, 160)}` : ''}`, link: { kind: 'site', siteId: site.id } });
      }
      await publishChange(db, parties);
      return { ok: true };
    });
  });

  // ---- Timeline -----------------------------------------------------------------------------
  /** Everything recorded against one file, by either company, newest first: the evidence trail. */
  app.get('/api/sites/:id/timeline', async (req) => {
    const ctx = requireOrg(req.ctx);
    const { site } = await loadSite(pool, ctx, (req.params as { id: string }).id);
    // Same visibility as the audit trail: a contractor sees the mine's events only from when it joined.
    const rows = await auditFor(pool, ctx, { siteId: site.id, limit: 200 });
    return { events: rows.map((r: any) => ({ at: r.ts, actor: r.actor, role: r.role, action: r.action, detail: r.detail })) };
  });

  // ---- Validity rules ------------------------------------------------------------------------
  app.put('/api/org/validity-rules', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireHostAdmin(ctx);
    requireWritable(ctx);
    const shape = Object.fromEntries(RULE_KEYS.map((k) => [k, z.number().int().min(1).max(60).nullable().optional()]));
    const body = z.object(shape).parse(req.body) as Record<string, number | null | undefined>;
    const rules = Object.fromEntries(RULE_KEYS.filter((k) => body[k]).map((k) => [k, body[k]]));
    await withTx(async (db) => {
      await db.query(`update organisations set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{validityRules}', $2::jsonb) where id = $1`, [ctx.org.id, JSON.stringify(rules)]);
      await audit(db, ctx, 'Changed validity rules', Object.entries(rules).map(([k, v]) => `${k}: ${v} months`).join(', ') || 'none');
      await publishChange(db, [ctx.org.id]);
    });
    return { rules };
  });
}
