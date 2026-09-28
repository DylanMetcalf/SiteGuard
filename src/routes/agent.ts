import type { FastifyInstance } from 'fastify';
import { requireOrg } from '../lib/authz.js';
import { withTx } from '../db/pool.js';
import { openFindings, runAgentForOrg } from '../lib/agent.js';
import { publishChange } from '../lib/realtime.js';
import { rl } from './auth.js';

export default async function agentRoutes(app: FastifyInstance) {
  app.get('/api/agent/findings', async (req) => {
    const ctx = requireOrg(req.ctx);
    return openFindings(ctx.org.id);
  });

  /** Re-runs the compliance agent for the caller's organisation now. Read-only apart from its own findings. */
  app.post('/api/agent/run', rl(6), async (req) => {
    const ctx = requireOrg(req.ctx);
    await withTx(async (db) => {
      await runAgentForOrg(db, { id: ctx.org.id, kind: ctx.org.kind });
      await publishChange(db, [ctx.org.id]);
    });
    return openFindings(ctx.org.id);
  });
}
