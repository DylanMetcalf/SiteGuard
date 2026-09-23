/**
 * GET /api/bootstrap — the signed-in user's entire visible world, shaped like
 * the original single-file app's `state` object so the UI can render it
 * unchanged. Everything here is filtered server-side by tenant and role; the
 * client never receives data it isn't allowed to see.
 */
import type { FastifyInstance } from 'fastify';
import { many, pool, type Db } from '../db/pool.js';
import { features } from '../config.js';
import { actorRole, isHost, roleLabel, uiRole, type OrgCtx } from '../lib/authz.js';
import { aiAllowed, planOf, standing } from '../lib/plans.js';
import { auditFor } from './org.js';
import { personasFor } from './demo.js';
import { workforceState } from './workforce.js';

const d = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export function fileUrl(fileId: string | null) {
  return fileId ? `/api/files/${fileId}` : null;
}

interface SiteRow {
  id: string;
  org_id: string;
  name: string;
  location: string;
  contractor_id: string;
  status: string;
  emergency: Record<string, string>;
  created_at: Date;
  host_name: string;
}

export async function visibleSites(db: Db, ctx: OrgCtx): Promise<SiteRow[]> {
  return many<SiteRow>(
    db,
    isHost(ctx)
      ? `select s.*, o.name as host_name from sites s join organisations o on o.id = s.org_id where s.org_id = $1 order by s.created_at`
      : `select s.*, o.name as host_name from sites s join contractors c on c.id = s.contractor_id join organisations o on o.id = s.org_id
          where c.linked_org_id = $1 and s.status <> 'declined' order by s.created_at`,
    [ctx.org.id],
  );
}

export async function buildState(db: Db, ctx: OrgCtx) {
  const host = isHost(ctx);
  const sites = await visibleSites(db, ctx);
  // Contractors see requirement detail only after accepting.
  const activeIds = sites.filter((s) => host || s.status !== 'invited').map((s) => s.id);
  const allIds = sites.map((s) => s.id);

  const state: Record<string, any> = {
    contractors: {},
    sites: {},
    requirements: {},
    documents: {},
    invitations: {},
    requests: {},
    reviews: {},
    approvals: {},
    audit: [],
    inspections: {},
    incidents: {},
    permits: {},
    diary: {},
    settings: host ? { inspectxEnabled: false, inspectxBaseUrl: '', ...(ctx.org.settings as object) } : { inspectxEnabled: false, inspectxBaseUrl: '' },
    shareLinks: [],
  };

  // ---- contractors ----
  if (host) {
    const rows = await many(
      db,
      `select c.*,
              (select count(*) from document_versions v join documents dd on dd.id = v.document_id join requirements r on r.id = dd.requirement_id
                 join sites s on s.id = r.site_id where s.contractor_id = c.id)::int as submissions,
              (select count(*) from reviews rv join documents dd on dd.id = rv.document_id join requirements r on r.id = dd.requirement_id
                 join sites s on s.id = r.site_id where s.contractor_id = c.id and rv.kind = 'correction')::int as corrections,
              (select count(*) from info_requests q join sites s on s.id = q.site_id where s.contractor_id = c.id and q.due_date is not null and q.status in ('submitted','completed'))::int as answered_with_due,
              (select count(*) from info_requests q join sites s on s.id = q.site_id where s.contractor_id = c.id and q.due_date is not null and q.status in ('submitted','completed') and q.responded_at::date <= q.due_date)::int as on_time
         from contractors c where c.org_id = $1 order by c.created_at`,
      [ctx.org.id],
    );
    for (const c of rows) {
      const ftr = c.submissions >= 3 ? Math.max(0, Math.round(100 * (1 - c.corrections / c.submissions))) : 0;
      const onTime = c.answered_with_due ? Math.round((100 * c.on_time) / c.answered_with_due) : 0;
      const reliability = c.submissions >= 3 ? Math.round(onTime ? (ftr + onTime) / 2 : ftr) : 0;
      state.contractors[c.id] = {
        id: c.id, name: c.name, reg: c.reg_number, coid: c.coid_number, trade: c.trade, contact: c.contact_name,
        contactEmail: c.contact_email, linked: !!c.linked_org_id, reliability, onTimeRate: onTime, firstTimeRightRate: ftr,
      };
    }
  } else {
    state.contractors[ctx.org.id] = {
      id: ctx.org.id, name: ctx.org.name, reg: ctx.org.reg_number, coid: ctx.org.coid_number, trade: ctx.org.trade,
      contact: '', linked: true, reliability: 0, onTimeRate: 0, firstTimeRightRate: 0,
    };
  }

  // ---- sites ----
  for (const s of sites) {
    state.sites[s.id] = {
      id: s.id, name: s.name, location: s.location,
      // On the contractor side every site belongs to "me".
      contractorId: host ? s.contractor_id : ctx.org.id,
      hostName: s.host_name, status: s.status, createdAt: d(s.created_at)?.slice(0, 10),
      emergency: { musterPoint: '', contact: '', hospital: '', ...s.emergency },
    };
    state.requirements[s.id] = [];
    state.inspections[s.id] = [];
    state.incidents[s.id] = [];
    state.permits[s.id] = [];
    state.diary[s.id] = [];
  }

  // ---- invitations ----
  const invs = await many(
    db,
    `select i.id, i.site_id, i.contractor_id, c.name as contractor_name, i.status, i.sent_at, i.email
       from site_invitations i join contractors c on c.id = i.contractor_id
      where i.site_id = any($1::uuid[]) ${host ? '' : "and i.status = 'pending'"}
      order by i.sent_at`,
    [allIds],
  );
  for (const i of invs) {
    state.invitations[i.id] = {
      id: i.id, siteId: i.site_id, contractorId: host ? i.contractor_id : ctx.org.id,
      contractorName: i.contractor_name, status: i.status, sentAt: d(i.sent_at), email: host ? i.email : undefined,
    };
  }

  if (activeIds.length) {
    // ---- requirements ----
    for (const r of await many(db, `select * from requirements where site_id = any($1::uuid[]) order by position, created_at`, [activeIds])) {
      state.requirements[r.site_id].push({ id: r.id, category: r.category, name: r.name, source: r.source, why: r.why });
    }

    // ---- documents (site requirements) ----
    const docs = await many(
      db,
      `select dd.*, r.site_id, cf.filename as current_name, cf.content_type as current_type, pf.filename as pending_name
         from documents dd join requirements r on r.id = dd.requirement_id
         left join files cf on cf.id = dd.current_file_id
         left join files pf on pf.id = dd.pending_file_id
        where r.site_id = any($1::uuid[])`,
      [activeIds],
    );
    await attachDocuments(db, ctx, state, docs.map((x) => ({ ...x, key: x.requirement_id })));

    // ---- reviews ----
    for (const rv of await many(
      db,
      `select rv.*, dd.requirement_id from reviews rv join documents dd on dd.id = rv.document_id
         join requirements r on r.id = dd.requirement_id where r.site_id = any($1::uuid[]) order by rv.created_at`,
      [activeIds],
    )) {
      (state.reviews[rv.requirement_id] ??= []).push({ author: rv.author_name, role: rv.author_role, text: rv.text, ts: d(rv.created_at), kind: rv.kind });
    }

    // ---- approvals ----
    for (const a of await many(db, `select * from approvals where site_id = any($1::uuid[])`, [activeIds])) {
      state.approvals[a.site_id] = {
        approver: a.approver_name, org: a.org_name, role: a.approver_role, date: a.approved_on,
        version: a.version, verificationId: a.verification_id, readiness: a.readiness_percent,
      };
    }

    // ---- requests ----
    for (const q of await many(db, `select q.*, s.contractor_id from info_requests q join sites s on s.id = q.site_id where q.site_id = any($1::uuid[]) order by q.created_at`, [activeIds])) {
      state.requests[q.id] = {
        id: q.id, siteId: q.site_id, contractorId: host ? q.contractor_id : ctx.org.id, type: q.type, title: q.title,
        message: q.message, dueDate: q.due_date, requestedBy: q.requested_by_name, requestedByRole: q.requested_by_role,
        status: q.status, linkedReqId: q.linked_requirement_id, response: q.response, respondedAt: d(q.responded_at), createdAt: d(q.created_at),
      };
    }

    // ---- incidents ----
    for (const i of await many(db, `select * from incidents where site_id = any($1::uuid[]) order by created_at desc`, [activeIds])) {
      state.incidents[i.site_id].push({
        id: i.id, type: i.type, date: i.occurred_on, person: i.person, description: i.description, immediateActions: i.immediate_actions,
        reportedBy: i.reported_by_name, reportedByRole: i.reported_by_role, status: i.status, rootCause: i.root_cause,
        correctiveActions: i.corrective_actions, closedAt: d(i.closed_at),
      });
    }

    // ---- permits ----
    for (const p of await many(db, `select * from permits where site_id = any($1::uuid[]) order by created_at desc`, [activeIds])) {
      state.permits[p.site_id].push({
        id: p.id, type: p.type, location: p.location, description: p.description, precautions: p.precautions, issuedTo: p.issued_to,
        issuedBy: p.issued_by_name, requestedBy: p.requested_by_name, validFrom: d(p.valid_from), validTo: d(p.valid_to),
        status: p.status, closedBy: p.closed_by_name, closedAt: d(p.closed_at), closeNotes: p.close_notes,
      });
    }

    // ---- diary ----
    for (const e of await many(db, `select * from diary_entries where site_id = any($1::uuid[]) order by entry_date desc, created_at desc`, [activeIds])) {
      state.diary[e.site_id].push({
        id: e.id, date: e.entry_date, author: e.author_name, crew: e.crew, weather: e.weather, summary: e.summary,
        incident: e.incident, incidentNote: e.incident_note,
      });
    }

    // ---- inspections + defects ----
    const insps = await many(db, `select * from inspections where site_id = any($1::uuid[]) order by inspected_on desc, created_at desc`, [activeIds]);
    const byId: Record<string, any> = {};
    for (const i of insps) {
      byId[i.id] = { id: i.id, title: i.title, type: i.type, inspector: i.inspector_name, date: i.inspected_on, status: i.status, externalRef: i.external_ref, defects: [] };
      state.inspections[i.site_id].push(byId[i.id]);
    }
    if (insps.length) {
      for (const df of await many(db, `select * from defects where inspection_id = any($1::uuid[]) order by created_at`, [insps.map((i) => i.id)])) {
        byId[df.inspection_id].defects.push({
          id: df.id, description: df.description, severity: df.severity, status: df.status, assignedTo: df.assigned_to,
          dueDate: df.due_date || 'TBC', closedAt: df.closed_at,
        });
      }
    }
  }

  // ---- contractor document library ----
  if (!host) {
    const lib = await many(
      db,
      `select dd.*, cf.filename as current_name, cf.content_type as current_type, pf.filename as pending_name
         from documents dd left join files cf on cf.id = dd.current_file_id left join files pf on pf.id = dd.pending_file_id
        where dd.library_org_id = $1`,
      [ctx.org.id],
    );
    await attachDocuments(db, ctx, state, lib.map((x) => ({ ...x, key: `lib:${ctx.org.id}:${x.library_type}` })));
  }

  // ---- audit (most recent; the audit screen can load more) ----
  state.audit = (await auditFor(db, ctx, { limit: 300 })).map((a: any) => ({ ...a, ts: d(a.ts) }));

  // ---- share links ----
  state.shareLinks = (
    await many(
      db,
      `select id, site_id, kind, label, created_by_name, created_at, expires_at, revoked_at, last_accessed_at, access_count
         from share_links where org_id = $1 order by created_at desc limit 200`,
      [ctx.org.id],
    )
  ).map((l) => ({
    id: l.id, siteId: l.site_id, kind: l.kind, label: l.label, createdBy: l.created_by_name, createdAt: d(l.created_at),
    expiresAt: d(l.expires_at), revokedAt: d(l.revoked_at), lastAccessedAt: d(l.last_accessed_at), accessCount: l.access_count,
  }));

  Object.assign(state, await workforceState(db, ctx, activeIds));

  return state;
}

async function attachDocuments(db: Db, ctx: OrgCtx, state: Record<string, any>, docs: any[]) {
  if (!docs.length) return;
  const versions = await many(
    db,
    `select v.*, f.filename from document_versions v left join files f on f.id = v.file_id
      where v.document_id = any($1::uuid[]) order by v.submitted_at`,
    [docs.map((x) => x.id)],
  );
  const byDoc: Record<string, any[]> = {};
  for (const v of versions) (byDoc[v.document_id] ??= []).push(v);
  for (const x of docs) {
    const all = byDoc[x.id] ?? [];
    const current = all[all.length - 1];
    const ownerSide = x.library_org_id === ctx.org.id || (!isHost(ctx) && x.requirement_id);
    state.documents[x.key] = {
      id: x.id,
      status: x.status,
      version: x.version,
      updatedAt: d(x.updated_at)?.slice(0, 10),
      expiryDate: x.expiry_date,
      note: x.note || undefined,
      fileId: x.current_file_id,
      assetUrl: fileUrl(x.current_file_id),
      assetName: x.current_name,
      assetType: x.current_type,
      aiDrafted: !!current?.ai_drafted,
      // A file attached but not yet submitted is visible only to the submitting side.
      pendingFileId: ownerSide ? x.pending_file_id : null,
      pendingFileName: ownerSide ? x.pending_name : null,
      history: all.slice(0, -1).map((v) => ({
        version: v.version, updatedAt: d(v.submitted_at)?.slice(0, 10), note: v.note, assetUrl: fileUrl(v.file_id),
        assetName: v.filename, submittedBy: v.submitted_by_name,
      })),
    };
  }
}

export default async function bootstrapRoutes(app: FastifyInstance) {
  app.get('/api/bootstrap', async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const ctx = req.ctx;
    const baseFeatures = { demo: features.demo, billing: features.billing, email: features.email, aiConfigured: features.ai };
    if (!ctx) return { authenticated: false, features: baseFeatures };

    const orgs = await many(
      pool,
      `select o.id, o.name, o.kind, m.role, o.is_demo from memberships m join organisations o on o.id = m.org_id
        where m.user_id = $1 order by o.name`,
      [ctx.user.id],
    );
    const me = {
      id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, title: ctx.user.title, phone: ctx.user.phone,
      verified: !!ctx.user.email_verified_at || ctx.user.is_demo, isDemo: ctx.user.is_demo,
    };
    if (!ctx.org || !ctx.role) {
      return { authenticated: true, csrfToken: ctx.csrfToken, me, orgs, org: null, features: baseFeatures };
    }
    const c = ctx as OrgCtx;
    const plan = planOf(c.org);
    return {
      authenticated: true,
      csrfToken: ctx.csrfToken,
      me: { ...me, roleLabel: actorRole(c) },
      orgs,
      org: {
        id: c.org.id, name: c.org.name, kind: c.org.kind,
        kindLabel: c.org.kind === 'host' ? 'Mining House / Principal Employer' : 'Contractor company',
        reg: c.org.reg_number, coid: c.org.coid_number, vat: c.org.vat_number, address: c.org.address, trade: c.org.trade,
        role: c.role, roleLabel: roleLabel(c.org.kind, c.role), uiRole: uiRole(c),
        plan: plan.id, planName: plan.name, subscriptionStatus: c.org.subscription_status, trialEndsAt: d(c.org.trial_ends_at),
        currentPeriodEnd: d(c.org.current_period_end), standing: standing(c.org), seatLimit: c.org.seat_limit, isDemo: c.org.is_demo,
        siteLimit: plan.siteLimit,
      },
      features: { ...baseFeatures, ai: aiAllowed(c.org) },
      personas: await personasFor(pool, c),
      myContractorId: c.org.kind === 'contractor' ? c.org.id : null,
      state: await buildState(pool, c),
    };
  });
}
