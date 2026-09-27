import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../lib/authz.js';
import { withTx } from '../db/pool.js';
import { queueEmail } from '../lib/email.js';
import { config } from '../config.js';
import { rl } from './auth.js';

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

export default async function supportRoutes(app: FastifyInstance) {
  /** "Report a problem" / "Suggest an idea" from inside the app. Stored, and emailed to SUPPORT_EMAIL when set. */
  app.post('/api/feedback', rl(5), async (req) => {
    const ctx = requireUser(req.ctx);
    const body = z
      .object({
        kind: z.enum(['problem', 'idea']).default('problem'),
        message: z.string().trim().min(3).max(4000),
        context: z.object({ view: z.string().max(200).optional(), userAgent: z.string().max(400).optional() }).default({}),
      })
      .parse(req.body);
    const orgId = ctx.org?.id ?? null;
    const orgName = ctx.org?.name ?? '(no organisation)';
    await withTx(async (db) => {
      await db.query(`insert into feedback (org_id, user_id, kind, message, context) values ($1, $2, $3, $4, $5)`, [orgId, ctx.user.id, body.kind, body.message, JSON.stringify(body.context)]);
      if (config.SUPPORT_EMAIL) {
        await queueEmail(db, {
          to: config.SUPPORT_EMAIL,
          subject: `SiteGuard ${body.kind === 'problem' ? 'problem report' : 'idea'} from ${clip(orgName, 60)}`,
          lines: [
            `From: ${ctx.user.name} <${ctx.user.email}>, ${orgName}`,
            `Where: ${body.context.view ?? 'unknown'}`,
            `Browser: ${body.context.userAgent ?? 'unknown'}`,
            '',
            body.message,
          ],
        });
      }
    });
    req.log.warn({ feedback: body.kind, org: orgId, view: body.context.view }, 'user feedback received');
    return { ok: true };
  });

  /** Browser-side errors, so bugs users hit show up in the server log. Nothing is stored. */
  app.post('/api/client-errors', rl(20), async (req) => {
    const body = z
      .object({ message: z.string().max(2000), stack: z.string().max(4000).optional(), url: z.string().max(500).optional(), view: z.string().max(200).optional() })
      .parse(req.body);
    req.log.error({ clientError: { message: body.message, stack: body.stack, url: body.url, view: body.view }, user: req.ctx?.user.id ?? null }, 'browser error');
    return { ok: true };
  });
}
