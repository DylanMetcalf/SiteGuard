import type { FastifyInstance } from 'fastify';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { loadSite, requireHostAdmin, requireOrg, requireWritable } from '../lib/authz.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { one, withTx } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { sha256 } from '../lib/security.js';
import { acceptSiteInvitation, rl } from './auth.js';

// No 0/O, 1/I/L: easy to read out loud and type on a phone.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const normaliseCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');
function newCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export default async function joinRoutes(app: FastifyInstance) {
  /** Host: create (or replace) the join code for a site whose contractor hasn't accepted yet. */
  app.post('/api/sites/:id/join-code', rl(20), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireHostAdmin(ctx);
    requireWritable(ctx);
    const { id } = req.params as { id: string };
    return withTx(async (db) => {
      const { site, side } = await loadSite(db, ctx, id);
      if (side !== 'host') throw notFound();
      if (site.status !== 'invited') throw conflict('The contractor has already joined this site.');
      const inv = await one<{ id: string }>(db, `select id from site_invitations where site_id = $1 and status = 'pending' order by sent_at desc limit 1`, [site.id]);
      if (!inv) throw conflict('There is no open invitation for this site — resend the invitation first.');
      const code = newCode();
      await db.query(
        `update site_invitations set join_code_hash = $2, join_code_expires_at = now() + interval '14 days' where id = $1`,
        [inv.id, sha256(normaliseCode(code))],
      );
      await audit(db, ctx, 'Created site join code', site.name, site.id);
      return { code, expiresInDays: 14, siteName: site.name };
    });
  });

  /** Contractor: join a site with a code. */
  app.post('/api/sites/join', rl(10), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    if (ctx.org.kind !== 'contractor') throw forbidden('Join codes are for contractor companies. Switch to your contractor organisation first.');
    const { code } = z.object({ code: z.string().trim().min(4).max(20) }).parse(req.body);
    const clean = normaliseCode(code);
    return withTx(async (db) => {
      const inv = await one<{ id: string }>(
        db,
        `select id from site_invitations where join_code_hash = $1 and status = 'pending' and join_code_expires_at > now()`,
        [sha256(clean)],
      );
      if (!inv) throw notFound('That code isn\'t valid or has expired. Check it with the site, or ask them for a new one.');
      return acceptSiteInvitation(db, ctx, inv.id);
    });
  });
}
