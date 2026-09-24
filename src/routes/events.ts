import type { FastifyInstance } from 'fastify';
import { requireOrg } from '../lib/authz.js';
import { onChange } from '../lib/realtime.js';

/**
 * Server-Sent Events: tells a browser "something in your organisation changed"
 * so it refetches its (permission-filtered) view. No record data is pushed.
 */
export default async function eventRoutes(app: FastifyInstance) {
  app.get('/api/events', async (req, reply) => {
    const ctx = requireOrg(req.ctx);
    const orgId = ctx.org.id;
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write('retry: 3000\n\n');
    let pending: NodeJS.Timeout | null = null;
    const off = onChange((orgs) => {
      if (!orgs.includes(orgId)) return;
      // Coalesce bursts (one action often touches several rows).
      if (pending) return;
      pending = setTimeout(() => {
        pending = null;
        reply.raw.write(`event: change\ndata: {}\n\n`);
      }, 150);
    });
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25_000);
    req.raw.on('close', () => {
      off();
      clearInterval(ping);
      if (pending) clearTimeout(pending);
    });
    return reply;
  });
}
