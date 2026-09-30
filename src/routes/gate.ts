/**
 * Gate clearance routes: the cleared / not cleared list for a contractor's file
 * or a whole shared site, each worker's QR gate card, and the public page a
 * guard's phone opens when scanning a card (name, company and a green or red
 * answer — no medical details).
 */
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { many, one, pool } from '../db/pool.js';
import { isUuid, loadSite, requireOrg } from '../lib/authz.js';
import { notFound } from '../lib/errors.js';
import { gateRows } from '../lib/gate.js';
import { appUrl } from '../lib/email.js';
import { esc, page } from './share.js';

export default async function gateRoutes(app: FastifyInstance) {
  /** One contractor file: its crew's clearance (either side of the site). */
  app.get('/api/sites/:id/gate', async (req) => {
    const ctx = requireOrg(req.ctx);
    const { id } = req.params as { id: string };
    await loadSite(pool, ctx, id);
    return { workers: await gateRows(pool, [id]) };
  });

  /** A whole shared site (mine side): every contractor's crew. */
  app.get('/api/workplaces/:id/gate', async (req) => {
    const ctx = requireOrg(req.ctx);
    const { id } = req.params as { id: string };
    if (!isUuid(id) || !(await one(pool, 'select 1 from workplaces where id = $1 and org_id = $2', [id, ctx.org.id]))) throw notFound();
    const files = await many<{ id: string }>(pool, `select id from sites where workplace_id = $1 and status <> 'declined'`, [id]);
    return { workers: await gateRows(pool, files.map((f) => f.id)) };
  });

  /** The QR image for a worker's gate card. */
  app.get('/api/sites/:id/gate/:workerId/qr.svg', async (req, reply) => {
    const ctx = requireOrg(req.ctx);
    const { id, workerId } = req.params as { id: string; workerId: string };
    await loadSite(pool, ctx, id);
    if (!isUuid(workerId)) throw notFound();
    const row = (await gateRows(pool, [id])).find((w) => w.workerId === workerId);
    if (!row) throw notFound();
    const svg = await QRCode.toString(appUrl(`/gate/${row.token}`), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    reply.header('cache-control', 'private, max-age=300');
    return reply.type('image/svg+xml').send(svg);
  });

  /** What the guard sees after scanning a gate card. */
  app.get('/gate/:token', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { token } = req.params as { token: string };
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    const found = /^[A-Za-z0-9_-]{20,40}$/.test(token)
      ? await one<{ site_id: string; worker_id: string }>(pool, 'select site_id, worker_id from site_workers where gate_token = $1', [token])
      : null;
    const row = found ? (await gateRows(pool, [found.site_id])).find((w) => w.workerId === found.worker_id) : undefined;
    if (!row) return reply.status(404).type('text/html').send(page('Gate check', '<div class="card"><h1>Not recognised</h1><div class="sub">This card isn\'t valid for any site. The worker may have been removed from the site, or the card replaced.</div></div>'));
    const checked = new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', dateStyle: 'medium', timeStyle: 'short' });
    const body = `<div class="card" style="text-align:center;border:3px solid ${row.cleared ? 'var(--green)' : 'var(--red)'}">
        <div class="big" style="color:${row.cleared ? 'var(--green)' : 'var(--red)'};margin:8px 0">${row.cleared ? 'CLEARED' : 'NOT CLEARED'}</div>
        <h1>${esc(row.name)}</h1><div class="sub">${esc(row.occupation || 'Worker')}${row.employeeNo ? ` · ${esc(row.employeeNo)}` : ''}</div>
        <div style="margin-top:10px">${esc(row.company)}</div><div class="sub">${esc(row.siteName)}</div></div>
      ${row.cleared
        ? `<div class="card"><div class="sub">Cleared for this site${row.until ? ` until ${esc(row.until)}` : ''}: medical, induction and the contractor's safety file are in order.</div></div>`
        : `<div class="card"><strong>Why not</strong><ul>${row.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul><div class="sub">Refer the worker to their supervisor or the site's safety office.</div></div>`}
      <div class="sub" style="text-align:center">Checked ${esc(checked)}</div>`;
    return reply.type('text/html').send(page('Gate check', body));
  });
}
