/**
 * External sharing. A share link is a random 256-bit token (only its hash is
 * stored) that grants read-only access to one site's readiness summary or
 * safety file until it expires or is revoked. Nothing else in the account is
 * reachable through it.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { many, one, pool, withTx } from '../db/pool.js';
import { conflict, forbidden, HttpError, notFound } from '../lib/errors.js';
import { canAdminOrg, canReview, isUuid, limitsEnforced, loadSite, requireOrg, requireWritable } from '../lib/authz.js';
import { audit } from '../lib/audit.js';
import { publishChange } from '../lib/realtime.js';
import { newToken, sha256 } from '../lib/security.js';
import { appUrl } from '../lib/email.js';
import { planOf } from '../lib/plans.js';
import { computeReadiness, effectiveStatus } from '../lib/readiness.js';
import { sendFile } from './files.js';
import { rl } from './auth.js';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmtDate = (v: unknown) => (v ? new Date(v as string).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const STATUS_LABEL: Record<string, string> = {
  complete: 'Complete', missing: 'Missing', expiring: 'Expiring', expired: 'Expired', awaiting_review: 'Awaiting review', correction_required: 'Correction required',
};
const STATUS_COLOR: Record<string, string> = {
  complete: '#2C6B44', missing: '#A23A2D', expiring: '#8E6410', expired: '#A23A2D', awaiting_review: '#2A4E62', correction_required: '#A23A2D',
};

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} · SiteGuard</title>
<link rel="icon" type="image/png" href="/icons/icon-32.png">
<style>
:root{--ink:#15181B;--grey:#6B7178;--line:#C7CABC;--paper:#E3E5DB;--raised:#F1F2EA;--orange:#C85417;--green:#2C6B44;--red:#A23A2D}
@media (prefers-color-scheme: dark){:root{--ink:#ECEEE8;--grey:#82877E;--line:#2E322A;--paper:#16181A;--raised:#1D2022;--orange:#EE7B3F;--green:#7BBE93;--red:#DE8776}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{max-width:760px;margin:0 auto;padding:20px 16px 40px}.brand{font-weight:700;font-size:16px;margin-bottom:16px}
.brand span{display:inline-block;width:18px;height:18px;background:var(--ink);border-radius:5px;vertical-align:-3px;margin-right:7px}
.card{background:var(--raised);border:1px solid var(--line);border-radius:3px;padding:14px;margin-bottom:12px}
h1{font-size:20px;margin:0 0 4px}.sub{color:var(--grey);font-size:12.5px}.big{font:600 34px/1 ui-monospace,monospace}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{text-align:left;padding:7px 6px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--grey)}.pill{font-size:11px;font-weight:600;white-space:nowrap}
.stamp{display:inline-block;border:2px solid var(--green);color:var(--green);padding:3px 10px;font-size:11px;letter-spacing:.08em;border-radius:3px;font-weight:700}
.warn{border-color:var(--red);color:var(--red)}a{color:var(--orange)}.foot{font-size:11px;color:var(--grey);margin-top:18px}
.scroll{overflow-x:auto}
</style></head><body><div class="wrap"><div class="brand"><span></span>SiteGuard</div>${body}
<div class="foot">Shared from SiteGuard. This view reflects the live record at the time you opened it and is read-only. It does not itself constitute a guarantee of legal compliance.</div></div></body></html>`;
}

function gone(reply: FastifyReply, message: string) {
  return reply.status(410).type('text/html').header('cache-control', 'no-store').send(page('Link unavailable', `<div class="card"><h1>This link is no longer available</h1><p class="sub">${esc(message)}</p></div>`));
}

async function resolveLink(token: string) {
  if (!token || token.length > 100) return null;
  return one<{ id: string; site_id: string; kind: string; expires_at: Date; revoked_at: Date | null; label: string; org_name: string }>(
    pool,
    `select l.id, l.site_id, l.kind, l.expires_at, l.revoked_at, l.label, o.name as org_name
       from share_links l join organisations o on o.id = l.org_id where l.token_hash = $1`,
    [sha256(token)],
  );
}

export default async function shareRoutes(app: FastifyInstance) {
  app.post('/api/share-links', rl(30), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const b = z
      .object({
        siteId: z.string().uuid(),
        kind: z.enum(['site_readiness', 'safety_file']),
        days: z.coerce.number().int().min(1).max(90).default(14),
        label: z.string().trim().max(200).default(''),
      })
      .parse(req.body);
    if (limitsEnforced() && !planOf(ctx.org).ai && planOf(ctx.org).kind === 'contractor') {
      throw new HttpError(402, 'plan', 'External share links are included in Contractor Pro. Upgrade under Billing.');
    }
    if (limitsEnforced() && planOf(ctx.org).id === 'host_starter') {
      throw new HttpError(402, 'plan', 'External share links are included in Site Professional. Upgrade under Billing.');
    }
    return withTx(async (db) => {
      const { site, side } = await loadSite(db, ctx, b.siteId);
      const allowed = side === 'host' ? canReview(ctx) : canAdminOrg(ctx);
      if (!allowed) throw forbidden('Only admins and reviewers can create external links.');
      const token = newToken();
      const l = (await one<{ id: string }>(
        db,
        `insert into share_links (org_id, site_id, kind, label, token_hash, created_by, created_by_name, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(days => $8)) returning id`,
        [ctx.org.id, site.id, b.kind, b.label, sha256(token), ctx.user.id, ctx.user.name, b.days],
      ))!;
      await audit(db, ctx, 'Created external share link', `${b.kind === 'safety_file' ? 'Safety file' : 'Readiness status'} for ${site.name}${b.label ? ` (${b.label})` : ''}, expires in ${b.days} days`, site.id);
      await publishChange(db, [ctx.org.id]);
      // The token is returned once and never stored in readable form.
      return { id: l.id, url: appUrl(`/share/${token}`) };
    });
  });

  app.post('/api/share-links/:id/revoke', async (req) => {
    const ctx = requireOrg(req.ctx);
    const { id } = req.params as { id: string };
    if (!isUuid(id)) throw notFound();
    await withTx(async (db) => {
      const l = await one<{ site_id: string; created_by: string | null; revoked_at: Date | null }>(
        db,
        'select site_id, created_by, revoked_at from share_links where id = $1 and org_id = $2 for update',
        [id, ctx.org.id],
      );
      if (!l) throw notFound();
      if (l.created_by !== ctx.user.id && !canAdminOrg(ctx)) throw forbidden();
      if (l.revoked_at) throw conflict('Already revoked.');
      await db.query('update share_links set revoked_at = now() where id = $1', [id]);
      await audit(db, ctx, 'Revoked external share link', '', l.site_id);
      await publishChange(db, [ctx.org.id]);
    });
    return { ok: true };
  });

  // ---- public pages ----
  app.get('/share/:token', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { token } = req.params as { token: string };
    const link = await resolveLink(token);
    if (!link) return gone(reply, 'The link is not valid.');
    if (link.revoked_at) return gone(reply, 'The sender revoked this link.');
    if (new Date(link.expires_at) < new Date()) return gone(reply, 'This link has expired. Ask the sender for a new one.');
    await pool.query('update share_links set access_count = access_count + 1, last_accessed_at = now() where id = $1', [link.id]);

    const site = (await one<any>(
      pool,
      `select s.*, c.name as contractor_name, o.name as host_name, a.verification_id, a.approved_on, a.approver_name, a.approver_role
         from sites s join contractors c on c.id = s.contractor_id join organisations o on o.id = s.org_id
         left join approvals a on a.site_id = s.id where s.id = $1`,
      [link.site_id],
    ))!;
    const r = await computeReadiness(pool, site.id);
    const severe = await many(pool, `select type, occurred_on from incidents where site_id = $1 and status <> 'closed' and type in ('lost_time','fatality')`, [site.id]);
    let body = `<div class="card"><div class="sub">Shared by ${esc(link.org_name)}${link.label ? ` · ${esc(link.label)}` : ''} · link expires ${fmtDate(link.expires_at)}</div>
      <h1>${esc(site.name)}</h1><div class="sub">${esc(site.location)} · Host: ${esc(site.host_name)} · Contractor: ${esc(site.contractor_name)}</div></div>
      <div class="card" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
        <div><div class="big">${site.status === 'site_ready' ? 100 : r.percent}%</div><div class="sub">Site readiness</div></div>
        <div style="flex:1;min-width:200px">${
          site.status === 'site_ready' && site.verification_id
            ? `<span class="stamp">SITE READY</span><div class="sub" style="margin-top:6px">Approved ${fmtDate(site.approved_on)} by ${esc(site.approver_name)}, ${esc(site.approver_role)} · Verification <a href="/verify/${esc(site.verification_id)}">${esc(site.verification_id)}</a></div>`
            : `<div class="sub">${r.counts.complete} of ${r.total} requirements complete · ${r.counts.awaiting_review} awaiting review · ${r.counts.missing} missing · ${r.counts.expired + r.counts.correction_required} need attention</div>`
        }${severe.length ? `<div class="stamp warn" style="margin-top:8px">${severe.length} open serious incident investigation${severe.length === 1 ? '' : 's'}</div>` : ''}</div></div>`;

    if (link.kind === 'safety_file') {
      const reqs = await many(
        pool,
        `select r.category, r.name, d.status, d.expiry_date, d.version, d.current_file_id, f.filename
           from requirements r left join documents d on d.requirement_id = r.id left join files f on f.id = d.current_file_id
          where r.site_id = $1 order by r.position, r.created_at`,
        [site.id],
      );
      body += `<div class="card scroll"><h1 style="font-size:16px">Safety file</h1><table><tr><th>Requirement</th><th>Status</th><th>Version</th><th>Expiry</th><th>File</th></tr>${reqs
        .map((q) => {
          const st = effectiveStatus(q.status ? { status: q.status, expiry_date: q.expiry_date } : null);
          const canView = q.current_file_id && ['complete', 'expiring', 'awaiting_review'].includes(st);
          return `<tr><td>${esc(q.name)}<div class="sub">${esc(q.category)}</div></td><td class="pill" style="color:${STATUS_COLOR[st]}">${STATUS_LABEL[st]}</td><td>${esc(q.version ?? '—')}</td><td>${fmtDate(q.expiry_date)}</td><td>${
            canView ? `<a href="/share/${esc(token)}/files/${q.current_file_id}" rel="noopener">${esc(q.filename)}</a>` : '—'
          }</td></tr>`;
        })
        .join('')}</table></div>`;
      const workers = await many(
        pool,
        `select w.full_name, w.occupation,
                (select json_agg(json_build_object('kind', c.kind, 'name', c.name, 'expires', c.expires_on) order by c.kind) from worker_certificates c where c.worker_id = w.id) as certs
           from site_workers sw join workers w on w.id = sw.worker_id where sw.site_id = $1 and w.active order by w.full_name`,
        [site.id],
      );
      if (workers.length) {
        body += `<div class="card scroll"><h1 style="font-size:16px">Workforce on site</h1><table><tr><th>Worker</th><th>Certificates</th></tr>${workers
          .map((w) => `<tr><td>${esc(w.full_name)}<div class="sub">${esc(w.occupation)}</div></td><td>${(w.certs ?? [])
            .map((c: any) => {
              const expired = c.expires && new Date(c.expires) < new Date();
              return `<div${expired ? ' style="color:var(--red)"' : ''}>${esc(c.name)}${c.expires ? ` — ${expired ? 'expired' : 'valid to'} ${fmtDate(c.expires)}` : ''}</div>`;
            })
            .join('') || '<span class="sub">None recorded</span>'}</td></tr>`)
          .join('')}</table></div>`;
      }
    }
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer');
    return reply.type('text/html').send(page(site.name, body));
  });

  app.get('/share/:token/files/:fileId', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { token, fileId } = req.params as { token: string; fileId: string };
    const link = await resolveLink(token);
    if (!link || link.revoked_at || new Date(link.expires_at) < new Date() || link.kind !== 'safety_file' || !isUuid(fileId)) {
      return gone(reply, 'This link has expired or was revoked.');
    }
    // Only the current, submitted file of a requirement on the shared site.
    const file = await one<any>(
      pool,
      `select f.id, f.org_id, f.storage_key, f.filename, f.content_type
         from documents d join requirements r on r.id = d.requirement_id join files f on f.id = d.current_file_id
        where r.site_id = $1 and f.id = $2 and d.status in ('complete', 'expiring', 'awaiting_review')`,
      [link.site_id, fileId],
    );
    if (!file) return reply.status(404).send('Not found');
    reply.header('referrer-policy', 'no-referrer');
    return sendFile(reply, file, false);
  });

  app.get('/verify/:code', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { code } = req.params as { code: string };
    const a = code.length <= 40
      ? await one<any>(
          pool,
          `select a.*, s.name as site_name, s.status, c.name as contractor_name, o.name as host_name
             from approvals a join sites s on s.id = a.site_id join contractors c on c.id = s.contractor_id join organisations o on o.id = s.org_id
            where a.verification_id = $1`,
          [code.toUpperCase()],
        )
      : null;
    reply.header('cache-control', 'no-store');
    if (!a) {
      return reply.status(404).type('text/html').send(page('Not verified', `<div class="card"><span class="stamp warn">NOT FOUND</span><h1 style="margin-top:10px">No record matches ${esc(code)}</h1><p class="sub">Check the code and try again. If you were shown this code as proof of approval, treat it as unverified.</p></div>`));
    }
    const current = a.status === 'site_ready';
    return reply.type('text/html').send(
      page(
        'Verification',
        `<div class="card"><span class="stamp${current ? '' : ' warn'}">${current ? 'VERIFIED · SITE READY' : 'SUPERSEDED'}</span>
        <h1 style="margin-top:10px">${esc(a.site_name)}</h1>
        <table><tr><td>Host</td><td>${esc(a.host_name)}</td></tr><tr><td>Contractor</td><td>${esc(a.contractor_name)}</td></tr>
        <tr><td>Approved</td><td>${fmtDate(a.approved_on)} by ${esc(a.approver_name)}, ${esc(a.approver_role)}</td></tr>
        <tr><td>Version</td><td>${esc(a.version)}</td></tr><tr><td>Verification ID</td><td style="font-family:ui-monospace,monospace">${esc(a.verification_id)}</td></tr></table>
        <p class="sub">Verification confirms this approval record exists in SiteGuard. It does not display private documents or personal information.</p></div>`,
      ),
    );
  });
}
