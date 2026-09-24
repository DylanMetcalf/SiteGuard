import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import Anthropic from '@anthropic-ai/sdk';
import { requireOrg, requireWritable } from '../lib/authz.js';
import { HttpError, paymentRequired, unavailable } from '../lib/errors.js';
import { aiAllowed } from '../lib/plans.js';
import { features } from '../config.js';
import { DRAFT_TYPES, reserveAiRequest, streamDraft } from '../lib/ai.js';
import { rl } from './auth.js';

export default async function aiRoutes(app: FastifyInstance) {
  /**
   * Streams a drafted document back as text/plain. The browser shows it as it
   * arrives, then saves it into the document library via the normal upload +
   * submit endpoints.
   */
  app.post('/api/ai/draft', rl(10), async (req, reply) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    if (!features.ai) throw unavailable('AI drafting is not configured on this server.');
    if (!aiAllowed(ctx.org)) throw paymentRequired('AI drafting is included in Site Professional and Contractor Pro. Upgrade under Billing.');
    const body = z.object({ type: z.enum(DRAFT_TYPES), brief: z.string().trim().max(4000).default('') }).parse(req.body);
    await reserveAiRequest(ctx.org.id);

    const abort = new AbortController();
    req.raw.on('close', () => abort.abort());
    reply.raw.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    try {
      for await (const chunk of streamDraft(
        ctx.org.id,
        {
          type: body.type,
          brief: body.brief,
          company: { name: ctx.org.name, reg: ctx.org.reg_number, coid: ctx.org.coid_number, address: ctx.org.address },
          preparer: { name: ctx.user.name, title: ctx.user.title, phone: ctx.user.phone, email: ctx.user.email },
        },
        abort.signal,
      )) {
        reply.raw.write(chunk);
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        const message =
          err instanceof HttpError
            ? err.message
            : err instanceof Anthropic.RateLimitError
              ? 'The AI service is busy right now. Try again in a minute.'
              : err instanceof Anthropic.APIConnectionError
                ? 'Could not reach the AI service. Try again.'
                : 'Drafting failed part-way. Try again.';
        req.log.warn({ err: (err as Error).message }, 'ai draft failed');
        // Headers are already sent; signal the failure in-band with a marker the client recognises.
        reply.raw.write(`\n\u0000ERROR:${message}`);
      }
    }
    reply.raw.end();
    return reply;
  });
}
