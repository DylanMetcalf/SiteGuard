import type { FastifyInstance } from 'fastify';
import { can } from '../lib/entitlements.js';
import { z } from 'zod';
import { requireOrg } from '../lib/authz.js';
import { HttpError } from '../lib/errors.js';
import { reserveAiRequest } from '../lib/ai.js';
import { isTransientAiError, runAssistantAI, runAssistantOffline, type ChatMessage } from '../lib/assistant.js';
import { rl } from './auth.js';

export default async function assistantRoutes(app: FastifyInstance) {
  /**
   * One assistant turn. The browser keeps the conversation and sends it back
   * each time; nothing is stored server-side. The reply may carry cards the
   * user confirms through the normal endpoints — the assistant never writes.
   */
  app.post('/api/assistant', rl(20), async (req, reply) => {
    const ctx = requireOrg(req.ctx);
    const body = z
      .object({
        messages: z
          .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().trim().min(1).max(6000) }))
          .min(1)
          .max(60),
      })
      .parse(req.body);
    // Keep the last 20 turns, starting and ending on a user message.
    let history: ChatMessage[] = body.messages.slice(-20);
    while (history.length && history[0].role !== 'user') history = history.slice(1);
    if (!history.length || history[history.length - 1].role !== 'user') throw new HttpError(400, 'invalid', 'The last message must be from the user.');

    if (can(ctx.org, 'AI_GENERATION')) {
      const abort = new AbortController();
      // The response closing before we finish means the browser went away.
      reply.raw.on('close', () => { if (!reply.raw.writableEnded) abort.abort(); });
      let note = '';
      try {
        await reserveAiRequest(ctx.org.id);
        return await runAssistantAI(ctx, history, abort.signal);
      } catch (err) {
        if (err instanceof HttpError && err.statusCode === 429) note = err.message;
        else if (isTransientAiError(err)) note = 'The AI service is busy right now, so this answer comes from SiteGuard\'s built-in rules.';
        else throw err;
        req.log.warn({ err: (err as Error).message }, 'assistant fell back to offline mode');
      }
      const offline = await runAssistantOffline(ctx, history);
      return { ...offline, notice: note };
    }
    return runAssistantOffline(ctx, history);
  });
}
