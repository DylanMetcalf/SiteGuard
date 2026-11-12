/**
 * A safety consultant's portfolio of client companies (rules and reasoning in lib/consultants.ts).
 * Every route is for consultant organisations only (404 for anyone else) and only ever touches clients that
 * belong to the caller's own organisation.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { many, one, pool, withTx } from '../db/pool.js';
import { conflict, HttpError, notFound } from '../lib/errors.js';
import { requireAdmin, requireOrg, requireWritable, type OrgCtx } from '../lib/authz.js';
import { planOf } from '../lib/plans.js';
import { archiveCheck, clientLimitFor, looseKey, registrationKey } from '../lib/consultants.js';
import { audit } from '../lib/audit.js';
import { track } from '../lib/events.js';
import { publishChange } from '../lib/realtime.js';
import { mySites } from '../lib/assistant.js';
import { createOrganisation, rl } from './auth.js';
import { requireVerified } from './org.js';

function consultantCtx(req: { ctx: unknown }): OrgCtx {
  const ctx = requireOrg(req.ctx as Parameters<typeof requireOrg>[0]);
  if (!ctx.org.is_consultant) throw notFound();
  requireAdmin(ctx);
  return ctx;
}

const formatKey = (k: string | null) => (k && /^\d{12}$/.test(k) ? `${k.slice(0, 4)}/${k.slice(4, 10)}/${k.slice(10)}` : '');

interface ClientRow { id: string; name: string; reg_number: string; registration_key: string | null; created_at: Date; client_archived_at: Date | null; last_activity: Date }

async function clientRows(parentId: string): Promise<ClientRow[]> {
  return many<ClientRow>(
    pool,
    `select o.id, o.name, o.reg_number, o.registration_key, o.created_at, o.client_archived_at,
            greatest(o.created_at, (select max(created_at) from files where org_id = o.id), (select max(created_at) from audit_events where org_id = o.id)) as last_activity
       from organisations o where o.billing_parent_id = $1 order by o.created_at, o.id`,
    [parentId],
  );
}

export default async function consultantRoutes(app: FastifyInstance) {
  app.get('/api/consultant/clients', async (req) => {
    const ctx = consultantCtx(req);
    const plan = planOf(ctx.org);
    const rows = await clientRows(ctx.org.id);
    const live = rows.filter((r) => !r.client_archived_at);
    const clients = [];
    for (const r of rows) {
      const stats = r.client_archived_at ? [] : await mySites({ org: { id: r.id } } as unknown as OrgCtx);
      const sum = (k: 'missing' | 'awaitingReview' | 'correctionsRequired' | 'expired' | 'expiringSoon') => stats.reduce((n, s) => n + s[k], 0);
      clients.push({
        id: r.id, name: r.name, registrationNumber: formatKey(r.registration_key) || r.reg_number, createdAt: r.created_at, archived: !!r.client_archived_at,
        inactiveDays: Math.floor((Date.now() - new Date(r.last_activity).getTime()) / 86400_000),
        canArchive: r.client_archived_at ? false : (await archiveCheck(pool, r.id)).ok,
        sites: stats.length, missing: sum('missing'), awaitingReview: sum('awaitingReview'), needsCorrection: sum('correctionsRequired'), expired: sum('expired'), expiringSoon: sum('expiringSoon'),
      });
    }
    return { plan: { id: plan.id, name: plan.name }, limit: clientLimitFor(ctx.org), used: live.length, trial: ctx.org.subscription_status === 'trialing', clients };
  });

  app.post('/api/consultant/clients', rl(20), async (req) => {
    const ctx = consultantCtx(req);
    requireWritable(ctx);
    requireVerified(ctx, 'adding client companies');
    const body = z.object({ name: z.string().trim().min(2).max(200), registrationNumber: z.string().trim().max(40) }).strict().parse(req.body);
    const key = registrationKey(body.registrationNumber);
    if (!key) throw new HttpError(400, 'invalid', 'Enter the company’s registration number, for example 2015/123456/07. It cannot be changed later, so check it.');
    return withTx(async (db) => {
      await db.query('select id from organisations where id = $1 for update', [ctx.org.id]); // one add at a time per consultant
      const used = (await one<{ n: number }>(db, 'select count(*)::int as n from organisations where billing_parent_id = $1 and client_archived_at is null', [ctx.org.id]))!.n;
      const limit = clientLimitFor(ctx.org);
      if (used >= limit) throw new HttpError(402, 'client_limit', `Your plan covers ${limit} client compan${limit === 1 ? 'y' : 'ies'} and you have ${used}. Choose a larger plan to add more.`);
      if (key === looseKey(ctx.org.reg_number)) throw conflict('That is your own company’s registration number. Clients must be other companies.');
      const taken = await one(db, `select 1 from organisations where registration_key = $1 or (billing_parent_id is null and regexp_replace(lower(coalesce(reg_number, '')), '[^0-9a-z]', '', 'g') = $1) limit 1`, [key]);
      if (taken) throw conflict('A company with that registration number is already on COMVERA. If it is your client, ask them to invite you; otherwise contact support.');
      const org = await createOrganisation(db, body.name, 'contractor');
      // Covered by the consultant's plan (computed live), so it carries no trial or subscription of its own.
      await db.query(
        `update organisations set plan = 'contractor_free', subscription_status = 'free', trial_ends_at = null, seat_limit = 5,
                billing_parent_id = $2, registration_key = $3, reg_number = $4, onboarding_completed_at = now()
          where id = $1`,
        [org.id, ctx.org.id, key, body.registrationNumber],
      );
      await db.query(`insert into memberships (org_id, user_id, role, via_consultant) values ($1, $2, 'owner', true)`, [org.id, ctx.user.id]);
      await audit(db, ctx, 'Added client company', `${body.name} (${used + 1} of ${limit})`);
      await track(db, ctx.org.id, 'client_company_added');
      await publishChange(db, [ctx.org.id]);
      return { id: org.id, name: body.name };
    });
  });

  // Only the display name can be corrected. The registration number is locked on purpose.
  app.patch('/api/consultant/clients/:id', async (req) => {
    const ctx = consultantCtx(req);
    requireWritable(ctx);
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().trim().min(2).max(200) }).strict().parse(req.body);
    return withTx(async (db) => {
      const c = await one<{ name: string }>(db, 'select name from organisations where id = $1 and billing_parent_id = $2 for update', [id, ctx.org.id]);
      if (!c) throw notFound();
      await db.query('update organisations set name = $2 where id = $1', [id, body.name]);
      await audit(db, ctx, 'Renamed client company', `${c.name} to ${body.name}`);
      await publishChange(db, [ctx.org.id, id]);
      return { ok: true };
    });
  });

  app.post('/api/consultant/clients/:id/archive', async (req) => {
    const ctx = consultantCtx(req);
    requireWritable(ctx);
    const { id } = req.params as { id: string };
    return withTx(async (db) => {
      const c = await one<{ name: string }>(db, 'select name from organisations where id = $1 and billing_parent_id = $2 for update', [id, ctx.org.id]);
      if (!c) throw notFound();
      const check = await archiveCheck(db, id);
      if (!check.ok) throw conflict(check.reason ?? 'This client cannot be archived yet.');
      // A client that was never used (a mistake) gives its registration number back; a used one keeps it reserved.
      await db.query('update organisations set client_archived_at = now(), registration_key = case when $2 then null else registration_key end where id = $1', [id, !!check.mistake]);
      await audit(db, ctx, 'Archived client company', c.name);
      await publishChange(db, [ctx.org.id, id]);
      return { ok: true };
    });
  });

  // Opens a client company: makes sure the consultant's own admin is a member of it, so the normal organisation switch works.
  app.post('/api/consultant/clients/:id/access', async (req) => {
    const ctx = consultantCtx(req);
    const { id } = req.params as { id: string };
    return withTx(async (db) => {
      const c = await one<{ name: string; archived: boolean }>(db, 'select name, (client_archived_at is not null) as archived from organisations where id = $1 and billing_parent_id = $2', [id, ctx.org.id]);
      if (!c) throw notFound();
      const added = await db.query(`insert into memberships (org_id, user_id, role, via_consultant) values ($1, $2, 'owner', true) on conflict do nothing`, [id, ctx.user.id]);
      if (added.rowCount) await audit(db, ctx, 'Opened client company', `${c.name} (access for ${ctx.user.name})`);
      return { orgId: id, archived: c.archived };
    });
  });
}
