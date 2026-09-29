import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { isUuid, requireOrg, requireWritable, type OrgCtx } from '../lib/authz.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { many, one, pool, withTx, type Db } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { publishChange } from '../lib/realtime.js';
import { newToken, sha256 } from '../lib/security.js';
import { appUrl } from '../lib/email.js';
import { notifyOrg, REVIEWERS } from '../lib/notify.js';
import { resolveForToken, resolveForUser, reviewPayload, sectionHash, type GenRow } from '../lib/review.js';
import { docContentSchema, sectionSchema } from '../lib/studio/model.js';
import { reviseWithContent } from '../lib/studio/generate.js';
import { sendFile } from './files.js';
import { rl } from './auth.js';

async function allSectionsApproved(db: Parameters<typeof reviewPayload>[0], doc: GenRow, viewer: Parameters<typeof reviewPayload>[2], hostOrgId?: string) {
  const p = await reviewPayload(db, doc, viewer, viewer.role === 'host' && hostOrgId ? { forHostOrgId: hostOrgId } : {});
  return p.summary.total > 0 && p.summary.approved === p.summary.total;
}

const decisionBody = z.object({
  sectionHash: z.string().regex(/^[0-9a-f]{20}$/),
  decision: z.enum(['approved', 'changes']),
  note: z.string().trim().max(2000).default(''),
  quote: z.string().trim().max(400).default(''),
});
const commentBody = z.object({
  sectionIndex: z.number().int().min(0).max(200).nullable().default(null),
  quote: z.string().trim().max(400).default(''),
  body: z.string().trim().min(1).max(4000),
});
const guestName = z.object({ name: z.string().trim().min(2).max(120) });

/** The host organisation the document was submitted to (if any), for notifications. */
async function hostOrgFor(db: Db, doc: GenRow): Promise<{ orgId: string; siteId: string } | null> {
  return one<{ orgId: string; siteId: string }>(
    db,
    `select s.org_id as "orgId", s.id as "siteId" from generated_documents g
       join document_versions v on v.file_id = g.pdf_file_id join documents d on d.id = v.document_id
       join requirements r on r.id = d.requirement_id join sites s on s.id = r.site_id
      where g.org_id = $1 and g.doc_number = $2 order by v.submitted_at desc limit 1`,
    [doc.org_id, doc.doc_number],
  );
}

function findSection(doc: GenRow, hash: string) {
  const i = doc.content.sections.findIndex((s) => sectionHash(s) === hash);
  if (i < 0) throw badRequest('That section has changed since you opened the document — refresh and try again.', 'stale_section');
  return { index: i, heading: doc.content.sections[i].heading };
}

async function recordDecision(db: Db, doc: GenRow, b: z.infer<typeof decisionBody>, who: { kind: 'host' | 'external'; orgId: string | null; userId: string | null; name: string }) {
  const s = findSection(doc, b.sectionHash);
  if (b.decision === 'changes' && !b.note) throw badRequest('Say what needs to change, so the author knows what to fix.', 'note_required');
  await db.query(
    `insert into doc_section_reviews (generated_document_id, section_index, section_hash, decision, note, reviewer_kind, reviewer_org_id, reviewer_user_id, reviewer_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [doc.id, s.index, b.sectionHash, b.decision, b.note, who.kind, who.orgId, who.userId, who.name],
  );
  if (b.decision === 'changes') {
    await db.query(
      `insert into doc_comments (org_id, doc_number, generated_document_id, section_index, section_heading, quote, body, author_kind, author_org_id, author_user_id, author_name)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [doc.org_id, doc.doc_number, doc.id, s.index, s.heading, b.quote, `Changes needed: ${b.note}`, who.kind, who.orgId, who.userId, who.name],
    );
  }
  return s;
}

async function recordComment(db: Db, doc: GenRow, b: z.infer<typeof commentBody>, who: { kind: 'owner' | 'host' | 'external'; orgId: string | null; userId: string | null; name: string }) {
  const heading = b.sectionIndex !== null ? doc.content.sections[b.sectionIndex]?.heading ?? '' : '';
  if (b.sectionIndex !== null && !heading) throw badRequest('That section no longer exists — refresh and try again.', 'stale_section');
  const row = (await one<{ id: string }>(
    db,
    `insert into doc_comments (org_id, doc_number, generated_document_id, section_index, section_heading, quote, body, author_kind, author_org_id, author_user_id, author_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [doc.org_id, doc.doc_number, doc.id, b.sectionIndex, heading, b.quote, b.body, who.kind, who.orgId, who.userId, who.name],
  ))!;
  return { id: row.id, heading };
}

export default async function reviewRoutes(app: FastifyInstance) {
  // ---------------- Signed-in viewers (owner or host) ----------------

  app.get('/api/review/:id', async (req) => {
    const ctx = requireOrg(req.ctx);
    const reqId = (req.query as { req?: string }).req;
    const { doc, viewer } = await resolveForUser(pool, ctx, (req.params as { id: string }).id, reqId);
    const payload = await reviewPayload(pool, doc, viewer, viewer.role === 'host' ? { forHostOrgId: ctx.org.id, requirementId: reqId } : {});
    const links = viewer.role === 'owner'
      ? await many(pool, `select id, label, created_by_name as "createdBy", created_at as "createdAt", expires_at as "expiresAt", revoked_at as "revokedAt", last_used_at as "lastUsedAt"
                            from review_links where org_id = $1 and doc_number = $2 order by created_at desc`, [doc.org_id, doc.doc_number])
      : [];
    return { ...payload, links };
  });

  app.post('/api/review/:id/decision', rl(60), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const b = decisionBody.parse(req.body);
    return withTx(async (db) => {
      const { doc, viewer } = await resolveForUser(db, ctx, (req.params as { id: string }).id);
      if (!viewer.canDecide) throw forbidden('Only reviewers at the site can approve or reject sections.');
      const s = await recordDecision(db, doc, b, { kind: 'host', orgId: ctx.org.id, userId: ctx.user.id, name: ctx.user.name });
      await audit(db, ctx, b.decision === 'approved' ? 'Approved section' : 'Requested section changes', `${doc.doc_number} Rev ${doc.revision} — ${s.heading}`);
      // Tell the author about changes straight away, but not about every single approved section:
      // one message when the whole document has been approved section by section is enough.
      if (b.decision === 'changes') {
        await notifyOrg(db, doc.org_id, null, {
          kind: 'review', title: `Changes requested: “${s.heading}”`,
          body: `${doc.title} (${doc.doc_number}) — ${ctx.org.name}${b.note ? `: ${b.note}` : ''}`, link: { kind: 'review', id: doc.id },
        });
      } else if (await allSectionsApproved(db, doc, viewer, ctx.org.id)) {
        await notifyOrg(db, doc.org_id, null, {
          kind: 'review', title: `All sections approved: ${doc.title}`,
          body: `${doc.doc_number} Rev ${doc.revision} — ${ctx.org.name}`, link: { kind: 'review', id: doc.id },
        });
      }
      await publishChange(db, [doc.org_id, ctx.org.id]);
      return { ok: true };
    });
  });

  app.post('/api/review/:id/comments', rl(60), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const b = commentBody.parse(req.body);
    return withTx(async (db) => {
      const { doc, viewer } = await resolveForUser(db, ctx, (req.params as { id: string }).id);
      const c = await recordComment(db, doc, b, { kind: viewer.role === 'owner' ? 'owner' : 'host', orgId: ctx.org.id, userId: ctx.user.id, name: ctx.user.name });
      const title = `${ctx.user.name} commented on ${doc.title}`;
      const body = `${c.heading ? `${c.heading}: ` : ''}${b.body}`.slice(0, 300);
      const orgs = [doc.org_id];
      if (viewer.role === 'owner') {
        const host = await hostOrgFor(db, doc);
        if (host) { await notifyOrg(db, host.orgId, REVIEWERS, { kind: 'review', title, body, link: { kind: 'review', id: doc.id } }); orgs.push(host.orgId); }
      } else {
        await notifyOrg(db, doc.org_id, null, { kind: 'review', title, body, link: { kind: 'review', id: doc.id } });
        orgs.push(ctx.org.id);
      }
      await publishChange(db, orgs);
      return { id: c.id };
    });
  });

  app.post('/api/review/comments/:cid/resolve', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const { cid } = req.params as { cid: string };
    if (!isUuid(cid)) throw notFound();
    return withTx(async (db) => {
      const c = await one<{ org_id: string; author_org_id: string | null }>(db, 'select org_id, author_org_id from doc_comments where id = $1', [cid]);
      if (!c || (c.org_id !== ctx.org.id && c.author_org_id !== ctx.org.id)) throw notFound();
      await db.query('update doc_comments set resolved_at = now(), resolved_by_name = $2 where id = $1 and resolved_at is null', [cid, ctx.user.name]);
      await publishChange(db, [c.org_id, ...(c.author_org_id ? [c.author_org_id] : [])]);
      return { ok: true };
    });
  });

  /** Saves the author's edits as the next revision. */
  app.post('/api/review/:id/save', rl(20), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const b = z.object({ sections: z.array(sectionSchema).min(1).max(30), note: z.string().trim().max(300).default('') }).parse(req.body);
    const { doc, viewer } = await resolveForUser(pool, ctx, (req.params as { id: string }).id);
    if (viewer.role !== 'owner') throw forbidden('Only the company that wrote this document can edit it.');
    const content = docContentSchema.parse({ title: doc.content.title, subtitle: doc.content.subtitle, sections: b.sections });
    const changed = content.sections.map((s, i) => (sectionHash(s) === (doc.content.sections[i] ? sectionHash(doc.content.sections[i]) : '') ? null : s.heading)).filter(Boolean);
    if (!changed.length && content.sections.length === doc.content.sections.length) throw badRequest('Nothing has changed yet.', 'no_changes');
    const note = b.note || `Updated: ${changed.slice(0, 4).join(', ')}${changed.length > 4 ? ` and ${changed.length - 4} more` : ''}`;
    const out = await reviseWithContent(ctx, doc.id, content, note);
    await withTx(async (db) => {
      await audit(db, ctx, 'Revised document', `${out.docNumber} Rev ${out.revision} — ${note}`, out.siteId);
      await publishChange(db, [ctx.org.id]);
    });
    return out;
  });

  // ---------------- Review links (owner) ----------------

  app.post('/api/review/:id/links', rl(20), async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const b = z.object({ label: z.string().trim().max(120).default(''), days: z.number().int().min(1).max(60).default(14) }).parse(req.body ?? {});
    const { doc, viewer } = await resolveForUser(pool, ctx, (req.params as { id: string }).id);
    if (viewer.role !== 'owner') throw forbidden('Only the company that wrote this document can share it.');
    const token = newToken();
    await withTx(async (db) => {
      await db.query(
        `insert into review_links (org_id, doc_number, token_hash, label, created_by, created_by_name, expires_at) values ($1, $2, $3, $4, $5, $6, now() + ($7 || ' days')::interval)`,
        [ctx.org.id, doc.doc_number, sha256(token), b.label, ctx.user.id, ctx.user.name, String(b.days)],
      );
      await audit(db, ctx, 'Created review link', `${doc.doc_number}${b.label ? ` for ${b.label}` : ''} (${b.days} days)`);
      await publishChange(db, [ctx.org.id]);
    });
    return { url: appUrl(`/review/${token}`), days: b.days };
  });

  app.delete('/api/review/links/:linkId', async (req) => {
    const ctx = requireOrg(req.ctx);
    requireWritable(ctx);
    const { linkId } = req.params as { linkId: string };
    if (!isUuid(linkId)) throw notFound();
    return withTx(async (db) => {
      const r = await db.query('update review_links set revoked_at = now() where id = $1 and org_id = $2 and revoked_at is null', [linkId, ctx.org.id]);
      if (!r.rowCount) throw notFound();
      await audit(db, ctx, 'Revoked review link', linkId);
      return { ok: true };
    });
  });

  // ---------------- Guests with a review link ----------------

  const tokenOf = (req: { params: unknown }) => (req.params as { token: string }).token;

  app.get('/api/review-links/:token', rl(60), async (req) => {
    const { doc, viewer, link } = await resolveForToken(pool, tokenOf(req));
    const org = await one<{ name: string }>(pool, 'select name from organisations where id = $1', [doc.org_id]);
    return { ...(await reviewPayload(pool, doc, viewer)), link: { label: link.label, expiresAt: link.expires_at, companyName: org?.name ?? '' } };
  });

  app.get('/api/review-links/:token/pdf', rl(30), async (req, reply: FastifyReply) => {
    const { doc } = await resolveForToken(pool, tokenOf(req));
    const file = doc.pdf_file_id ? await one<{ id: string; org_id: string; storage_key: string; filename: string; content_type: string }>(pool, 'select id, org_id, storage_key, filename, content_type from files where id = $1', [doc.pdf_file_id]) : null;
    if (!file) throw notFound();
    return sendFile(reply, file, false);
  });

  app.post('/api/review-links/:token/decision', rl(40), async (req) => {
    const b = decisionBody.merge(guestName).parse(req.body);
    return withTx(async (db) => {
      const { doc } = await resolveForToken(db, tokenOf(req));
      const s = await recordDecision(db, doc, b, { kind: 'external', orgId: null, userId: null, name: b.name });
      if (b.decision === 'changes') {
        await notifyOrg(db, doc.org_id, null, {
          kind: 'review', title: `${b.name} requested changes to “${s.heading}”`,
          body: `${doc.title} (${doc.doc_number})${b.note ? `: ${b.note}` : ''}`, link: { kind: 'review', id: doc.id },
        });
      } else if (!(await one(db, `select 1 from notifications where org_id = $1 and kind = 'review' and title = $2 and created_at > now() - interval '12 hours' limit 1`, [doc.org_id, `${b.name} is approving ${doc.title}`]))) {
        // One message per reviewer per document per half-day, not one per section.
        await notifyOrg(db, doc.org_id, null, { kind: 'review', title: `${b.name} is approving ${doc.title}`, body: `${doc.doc_number} — first approved section: “${s.heading}”`, link: { kind: 'review', id: doc.id } });
      }
      await publishChange(db, [doc.org_id]);
      return { ok: true };
    });
  });

  app.post('/api/review-links/:token/comments', rl(40), async (req) => {
    const b = commentBody.merge(guestName).parse(req.body);
    return withTx(async (db) => {
      const { doc } = await resolveForToken(db, tokenOf(req));
      const c = await recordComment(db, doc, b, { kind: 'external', orgId: null, userId: null, name: b.name });
      await notifyOrg(db, doc.org_id, null, { kind: 'review', title: `${b.name} commented on ${doc.title}`, body: `${c.heading ? `${c.heading}: ` : ''}${b.body}`.slice(0, 300), link: { kind: 'review', id: doc.id } });
      await publishChange(db, [doc.org_id]);
      return { id: c.id };
    });
  });

  // ---------------- Notifications inbox ----------------

  app.post('/api/notifications/read', async (req) => {
    const ctx = requireOrg(req.ctx);
    const b = z.object({ ids: z.array(z.number().int().positive()).max(200).optional() }).parse(req.body ?? {});
    await pool.query(
      `update notifications set read_at = now() where user_id = $1 and org_id = $2 and read_at is null and ($3::bigint[] is null or id = any($3))`,
      [ctx.user.id, ctx.org.id, b.ids ?? null],
    );
    return { ok: true };
  });
}
