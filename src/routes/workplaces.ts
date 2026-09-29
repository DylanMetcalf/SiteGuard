/**
 * Sites that many contractors join with one site code.
 *
 * The mine (host) creates the site once, with its safety file requirements, and
 * shares the site code. Each contractor company that joins gets its own safety
 * file for the site: an ordinary `sites` row linked to the workplace, with the
 * requirements copied in, so review, the builder, exports and permits all work
 * per contractor exactly as before.
 */
import type { FastifyInstance } from 'fastify';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { many, one, withTx, type Db } from '../db/pool.js';
import { canAdminOrg, isUuid, limitsEnforced, requireHostAdmin, requireOrg, requireWritable, type OrgCtx } from '../lib/authz.js';
import { conflict, forbidden, HttpError, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { publishChange } from '../lib/realtime.js';
import { planOf } from '../lib/plans.js';
import { notifyOrg, REVIEWERS } from '../lib/notify.js';
import { itemsFromPacks } from '../lib/templates.js';
import { emergencySchema, packIdsSchema, requirementSchema, text } from './sites.js';
import { rl } from './auth.js';

// No 0/O, 1/I/L: easy to read out loud and type on a phone.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const normaliseCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');
export function newCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

type Item = z.infer<typeof requirementSchema>;
interface Workplace {
  id: string;
  org_id: string;
  name: string;
  location: string;
  emergency: Record<string, string>;
  requirements: Item[];
  join_code: string | null;
  join_open: boolean;
}

async function loadWorkplace(db: Db, ctx: OrgCtx, id: string, lock = false): Promise<Workplace> {
  if (!isUuid(id)) throw notFound();
  const w = await one<Workplace>(db, `select * from workplaces where id = $1 and org_id = $2${lock ? ' for update' : ''}`, [id, ctx.org.id]);
  if (!w) throw notFound();
  return w;
}

/** Contractor files on this site (one `sites` row per contractor). */
const filesOf = (db: Db, workplaceId: string) =>
  many<{ id: string; contractor_id: string; linked_org_id: string | null }>(
    db,
    `select s.id, s.contractor_id, c.linked_org_id from sites s join contractors c on c.id = s.contractor_id where s.workplace_id = $1`,
    [workplaceId],
  );

/** Adds requirements to every contractor's file on the site, skipping names already there. */
async function addToFiles(db: Db, workplaceId: string, items: Item[]): Promise<number> {
  let touched = 0;
  for (const f of await filesOf(db, workplaceId)) {
    const have = new Set((await many<{ name: string }>(db, 'select name from requirements where site_id = $1', [f.id])).map((r) => r.name.toLowerCase()));
    const pos = Number((await one<{ n: number }>(db, 'select coalesce(max(position), -1) + 1 as n from requirements where site_id = $1', [f.id]))!.n);
    let i = 0;
    for (const r of items) {
      if (have.has(r.name.toLowerCase())) continue;
      await db.query(`insert into requirements (site_id, category, name, source, why, position) values ($1, $2, $3, $4, $5, $6)`, [f.id, r.category, r.name, r.source, r.why, pos + i++]);
    }
    if (i) touched++;
  }
  return touched;
}

async function uniqueCode(db: Db): Promise<string> {
  for (;;) {
    const code = newCode();
    if (!(await one(db, 'select 1 from workplaces where join_code = $1', [code]))) return code;
  }
}

export default async function workplaceRoutes(app: FastifyInstance) {
  /** Mine: create a site that contractors join with a code. */
  app.post('/api/workplaces', rl(30), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireHostAdmin(ctx);
    requireWritable(ctx);
    const body = z
      .object({
        name: text(300).min(1, 'Give the site a name.'),
        location: text(300).default(''),
        packIds: packIdsSchema.default([]),
        requirements: z.array(requirementSchema).max(200).default([]),
        emergency: emergencySchema.default({}),
      })
      .parse(req.body);
    return withTx(async (db) => {
      await db.query('select id from organisations where id = $1 for update', [ctx.org.id]);
      const limit = planOf(ctx.org).siteLimit;
      if (limitsEnforced() && limit !== null) {
        const n = Number((await one<{ n: number }>(
          db,
          `select (select count(*) from sites where org_id = $1 and status <> 'declined' and workplace_id is null) + (select count(*) from workplaces where org_id = $1) as n`,
          [ctx.org.id],
        ))!.n);
        if (n >= limit) throw new HttpError(402, 'site_limit', `Your plan includes ${limit} active sites. Upgrade under Billing to add more.`);
      }
      const items = body.requirements.concat(itemsFromPacks(body.packIds, body.requirements.map((r) => r.name)));
      const code = await uniqueCode(db);
      const w = (await one<{ id: string }>(
        db,
        `insert into workplaces (org_id, name, location, emergency, requirements, join_code, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [ctx.org.id, body.name, body.location, JSON.stringify(body.emergency), JSON.stringify(items), code, ctx.user.id],
      ))!;
      await audit(db, ctx, 'Created site', `${body.name} — open to contractors with a site code, ${items.length} requirements`);
      await publishChange(db, [ctx.org.id]);
      return { id: w.id, code, requirements: items.length };
    });
  });

  /** Mine: rename, move, change emergency details, or open/close the site to new contractors. */
  app.patch('/api/workplaces/:id', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireHostAdmin(ctx);
    requireWritable(ctx);
    const body = z.object({ name: text(300).min(1).optional(), location: text(300).optional(), emergency: emergencySchema.optional(), joinOpen: z.boolean().optional() }).parse(req.body);
    await withTx(async (db) => {
      const w = await loadWorkplace(db, ctx, (req.params as { id: string }).id, true);
      await db.query(
        `update workplaces set name = coalesce($2, name), location = coalesce($3, location),
                emergency = case when $4::jsonb is null then emergency else emergency || $4::jsonb end, join_open = coalesce($5, join_open)
          where id = $1`,
        [w.id, body.name ?? null, body.location ?? null, body.emergency ? JSON.stringify(body.emergency) : null, body.joinOpen ?? null],
      );
      // Every contractor's file for this site shows the same name, location and emergency details.
      await db.query(
        `update sites set name = coalesce($2, name), location = coalesce($3, location),
                emergency = case when $4::jsonb is null then emergency else emergency || $4::jsonb end where workplace_id = $1`,
        [w.id, body.name ?? null, body.location ?? null, body.emergency ? JSON.stringify(body.emergency) : null],
      );
      await audit(db, ctx, 'Updated site', `${w.name}${body.joinOpen === false ? ' — closed to new contractors' : body.joinOpen === true ? ' — open to new contractors' : ''}`);
      const files = await filesOf(db, w.id);
      await publishChange(db, [ctx.org.id, ...files.map((f) => f.linked_org_id).filter((x): x is string => !!x)]);
    });
    return { ok: true };
  });

  /** Mine: add requirements to the site; they are added to every contractor's file too. */
  app.post('/api/workplaces/:id/requirements', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireHostAdmin(ctx);
    requireWritable(ctx);
    const body = z.object({ packIds: packIdsSchema.default([]), requirements: z.array(requirementSchema).max(200).default([]) }).parse(req.body);
    return withTx(async (db) => {
      const w = await loadWorkplace(db, ctx, (req.params as { id: string }).id, true);
      const have = w.requirements.map((r) => r.name);
      const fresh = body.requirements.filter((r) => !have.some((h) => h.toLowerCase() === r.name.toLowerCase()));
      const items = fresh.concat(itemsFromPacks(body.packIds, have.concat(fresh.map((r) => r.name))));
      if (!items.length) throw conflict('Those requirements are already on this site.');
      await db.query('update workplaces set requirements = requirements || $2::jsonb where id = $1', [w.id, JSON.stringify(items)]);
      const touched = await addToFiles(db, w.id, items);
      await audit(db, ctx, 'Added site requirements', `${w.name}: ${items.map((r) => r.name).join(', ').slice(0, 400)}`);
      const files = await filesOf(db, w.id);
      for (const f of files) {
        if (f.linked_org_id) await notifyOrg(db, f.linked_org_id, null, { kind: 'site', title: `${w.name} added ${items.length} requirement${items.length === 1 ? '' : 's'}`, body: items.map((r) => r.name).join(', ').slice(0, 300), link: { kind: 'site', siteId: f.id } });
      }
      await publishChange(db, [ctx.org.id, ...files.map((f) => f.linked_org_id).filter((x): x is string => !!x)]);
      return { added: items.length, contractorsUpdated: touched };
    });
  });

  /** Mine: take a requirement off the site for contractors who join from now on (existing files keep their history). */
  app.post('/api/workplaces/:id/requirements/remove', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireHostAdmin(ctx);
    requireWritable(ctx);
    const { name } = z.object({ name: text(200).min(1) }).parse(req.body);
    return withTx(async (db) => {
      const w = await loadWorkplace(db, ctx, (req.params as { id: string }).id, true);
      const left = w.requirements.filter((r) => r.name.toLowerCase() !== name.toLowerCase());
      if (left.length === w.requirements.length) throw notFound();
      await db.query('update workplaces set requirements = $2 where id = $1', [w.id, JSON.stringify(left)]);
      await audit(db, ctx, 'Removed site requirement', `${w.name}: ${name}`);
      await publishChange(db, [ctx.org.id]);
      return { ok: true };
    });
  });

  /** Mine: replace the site code (the old one stops working). */
  app.post('/api/workplaces/:id/code', rl(20), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireHostAdmin(ctx);
    requireWritable(ctx);
    return withTx(async (db) => {
      const w = await loadWorkplace(db, ctx, (req.params as { id: string }).id, true);
      const code = await uniqueCode(db);
      await db.query('update workplaces set join_code = $2, join_open = true where id = $1', [w.id, code]);
      await audit(db, ctx, 'Replaced site code', `${w.name} — the old code no longer works`);
      await publishChange(db, [ctx.org.id]);
      return { code };
    });
  });
}

/**
 * Contractor: join a site by its site code. Creates (or finds) the mine's directory
 * entry for this contractor and the contractor's own safety file for the site.
 * Returns null when the code isn't a site code, so the caller can try invitation codes.
 */
export async function joinWorkplaceByCode(db: Db, ctx: OrgCtx, code: string): Promise<{ siteId: string; hostOrgId: string; already: boolean } | null> {
  const clean = normaliseCode(code);
  if (clean.length !== 8) return null;
  const w = await one<Workplace>(db, 'select * from workplaces where join_code = $1 for update', [`${clean.slice(0, 4)}-${clean.slice(4)}`]);
  if (!w) return null;
  if (!w.join_open) throw forbidden(`${w.name} isn't taking new contractors at the moment. Ask the site to open it again.`);
  if (w.org_id === ctx.org.id) throw forbidden('That is your own site.');
  if (!canAdminOrg(ctx)) throw forbidden('Ask an owner or admin of your company to join sites.');
  // The mine's directory entry for this contractor company.
  let c = await one<{ id: string }>(db, 'select id from contractors where org_id = $1 and linked_org_id = $2', [w.org_id, ctx.org.id]);
  if (!c) {
    const owner = await one<{ name: string; email: string }>(db, `select u.name, u.email from memberships m join users u on u.id = m.user_id where m.org_id = $1 and m.role = 'owner' order by m.created_at limit 1`, [ctx.org.id]);
    c = (await one<{ id: string }>(
      db,
      `insert into contractors (org_id, name, trade, reg_number, coid_number, contact_name, contact_email, linked_org_id) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [w.org_id, ctx.org.name, ctx.org.trade ?? '', ctx.org.reg_number ?? '', ctx.org.coid_number ?? '', owner?.name ?? '', owner?.email ?? null, ctx.org.id],
    ))!;
  }
  const existing = await one<{ id: string }>(db, 'select id from sites where workplace_id = $1 and contractor_id = $2', [w.id, c.id]);
  if (existing) return { siteId: existing.id, hostOrgId: w.org_id, already: true };
  const site = (await one<{ id: string }>(
    db,
    `insert into sites (org_id, name, location, contractor_id, status, emergency, workplace_id) values ($1, $2, $3, $4, 'in_progress', $5, $6) returning id`,
    [w.org_id, w.name, w.location, c.id, JSON.stringify(w.emergency ?? {}), w.id],
  ))!;
  for (const [i, r] of w.requirements.entries()) {
    await db.query(`insert into requirements (site_id, category, name, source, why, position) values ($1, $2, $3, $4, $5, $6)`, [site.id, r.category, r.name, r.source, r.why, i]);
  }
  await audit(db, ctx, 'Joined site with site code', `${w.name} — ${w.requirements.length} requirements`, site.id);
  await notifyOrg(db, w.org_id, [...REVIEWERS], { kind: 'accepted', title: `${ctx.org.name} joined ${w.name}`, body: `${ctx.org.trade ? ctx.org.trade + ' · ' : ''}They can now see the site's requirements and start their safety file.`, link: { kind: 'site', siteId: site.id } });
  await publishChange(db, [w.org_id, ctx.org.id]);
  return { siteId: site.id, hostOrgId: w.org_id, already: false };
}
