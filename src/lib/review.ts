/**
 * Section-by-section review of Document Studio documents.
 *
 * Who can see a document:
 * - owner: the organisation that created it (always its latest revision);
 * - host: a site owner, once a revision has been submitted against one of its
 *   site requirements (they see the latest submitted revision);
 * - external: someone holding a valid review link (latest revision).
 *
 * Decisions are stored against a section's content hash, so an approved
 * section stays approved in later revisions until its content changes.
 */
import { createHash } from 'node:crypto';
import type { Db } from '../db/pool.js';
import { many, one } from '../db/pool.js';
import { isUuid, canReview, type OrgCtx } from './authz.js';
import { notFound } from './errors.js';
import { sha256 } from './security.js';
import { standing } from './plans.js';
import type { DocContent, Section } from './studio/model.js';

export type ReviewRole = 'owner' | 'host' | 'external';
export interface Viewer {
  role: ReviewRole;
  canComment: boolean;
  canDecide: boolean;
  canEdit: boolean;
}

export interface GenRow {
  id: string;
  org_id: string;
  site_id: string | null;
  requirement_id: string | null;
  blueprint: string;
  title: string;
  doc_number: string;
  revision: number;
  content: DocContent;
  pdf_file_id: string | null;
  docx_file_id: string | null;
  ai: boolean;
  review_due: string;
  created_at: Date;
  created_by_name: string;
}

const GEN_COLS = `g.id, g.org_id, g.site_id, g.requirement_id, g.blueprint, g.title, g.doc_number, g.revision, g.content, g.pdf_file_id,
                  g.docx_file_id, g.ai, to_char(g.review_due, 'YYYY-MM-DD') as review_due, g.created_at, g.created_by_name`;

/** JSON with sorted keys, so the same content always hashes the same (jsonb reorders keys). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const sectionHash = (s: Section) => createHash('sha256').update(canonical(s)).digest('hex').slice(0, 20);

/** The revision this signed-in viewer should see, and what they may do with it. */
export async function resolveForUser(db: Db, ctx: OrgCtx, anyId: string): Promise<{ doc: GenRow; viewer: Viewer }> {
  if (!isUuid(anyId)) throw notFound();
  const row = await one<{ org_id: string; doc_number: string }>(db, 'select org_id, doc_number from generated_documents where id = $1', [anyId]);
  if (!row) throw notFound();
  if (row.org_id === ctx.org.id) {
    const doc = (await one<GenRow>(db, `select ${GEN_COLS} from generated_documents g where g.org_id = $1 and g.doc_number = $2 order by g.revision desc limit 1`, [row.org_id, row.doc_number]))!;
    return { doc, viewer: { role: 'owner', canComment: true, canDecide: false, canEdit: standing(ctx.org) !== 'lapsed' } };
  }
  // A host sees revisions that were submitted to one of its own sites.
  const doc = await one<GenRow>(
    db,
    `select ${GEN_COLS} from generated_documents g
       join document_versions v on v.file_id = g.pdf_file_id
       join documents d on d.id = v.document_id
       join requirements r on r.id = d.requirement_id
       join sites s on s.id = r.site_id
      where g.org_id = $1 and g.doc_number = $2 and s.org_id = $3
      order by g.revision desc limit 1`,
    [row.org_id, row.doc_number, ctx.org.id],
  );
  if (!doc) throw notFound();
  return { doc, viewer: { role: 'host', canComment: true, canDecide: canReview(ctx), canEdit: false } };
}

export interface LinkRow { id: string; org_id: string; doc_number: string; label: string; expires_at: Date }

export async function resolveForToken(db: Db, token: string): Promise<{ doc: GenRow; viewer: Viewer; link: LinkRow }> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw notFound();
  const link = await one<LinkRow>(
    db,
    `select id, org_id, doc_number, label, expires_at from review_links where token_hash = $1 and revoked_at is null and expires_at > now()`,
    [sha256(token)],
  );
  if (!link) throw notFound();
  const doc = await one<GenRow>(db, `select ${GEN_COLS} from generated_documents g where g.org_id = $1 and g.doc_number = $2 order by g.revision desc limit 1`, [link.org_id, link.doc_number]);
  if (!doc) throw notFound();
  await db.query('update review_links set last_used_at = now() where id = $1', [link.id]);
  return { doc, viewer: { role: 'external', canComment: true, canDecide: true, canEdit: false }, link };
}

/** Everything the review workspace shows. */
export async function reviewPayload(db: Db, doc: GenRow, viewer: Viewer, opts: { forHostOrgId?: string } = {}) {
  const sections = doc.content.sections.map((s, index) => ({ index, heading: s.heading, hash: sectionHash(s), blocks: s.blocks }));
  const decisions = await many<{ section_hash: string; decision: 'approved' | 'changes'; note: string; reviewer_kind: string; reviewer_name: string; created_at: Date; revision: number }>(
    db,
    `select r.section_hash, r.decision, r.note, r.reviewer_kind, r.reviewer_name, r.created_at, g.revision
       from doc_section_reviews r join generated_documents g on g.id = r.generated_document_id
      where g.org_id = $1 and g.doc_number = $2 order by r.created_at`,
    [doc.org_id, doc.doc_number],
  );
  const latest = new Map<string, (typeof decisions)[number]>();
  for (const d of decisions) latest.set(d.section_hash, d);
  const comments = await many<Record<string, unknown>>(
    db,
    `select c.id, c.section_index as "sectionIndex", c.section_heading as "sectionHeading", c.quote, c.body, c.author_kind as "authorKind",
            c.author_name as "authorName", c.created_at as "createdAt", c.resolved_at as "resolvedAt", c.resolved_by_name as "resolvedBy", g.revision
       from doc_comments c join generated_documents g on g.id = c.generated_document_id
      where c.org_id = $1 and c.doc_number = $2 order by c.created_at`,
    [doc.org_id, doc.doc_number],
  );
  const revisions = await many<Record<string, unknown>>(
    db,
    `select id, revision, revision_note as note, created_by_name as "by", created_at as "createdAt", pdf_file_id as "pdfFileId"
       from generated_documents where org_id = $1 and doc_number = $2 order by revision desc`,
    [doc.org_id, doc.doc_number],
  );
  // Where it has been submitted, and the latest submitted revision (for the owner's resubmit prompt).
  const submitted = await one<{ requirement_id: string; revision: number; status: string; site_id: string; site_name: string; req_name: string }>(
    db,
    `select r.id as requirement_id, g.revision, d.status, s.id as site_id, s.name as site_name, r.name as req_name
       from generated_documents g
       join document_versions v on v.file_id = g.pdf_file_id
       join documents d on d.id = v.document_id
       join requirements r on r.id = d.requirement_id
       join sites s on s.id = r.site_id
      where g.org_id = $1 and g.doc_number = $2 ${opts.forHostOrgId ? 'and s.org_id = $3' : ''}
      order by v.submitted_at desc limit 1`,
    opts.forHostOrgId ? [doc.org_id, doc.doc_number, opts.forHostOrgId] : [doc.org_id, doc.doc_number],
  );
  const target = submitted ?? (doc.requirement_id
    ? await one<{ requirement_id: string; site_id: string; site_name: string; req_name: string; status: string | null }>(
        db,
        `select r.id as requirement_id, s.id as site_id, s.name as site_name, r.name as req_name, d.status
           from requirements r join sites s on s.id = r.site_id left join documents d on d.requirement_id = r.id where r.id = $1`,
        [doc.requirement_id],
      )
    : null);
  const withStatus = sections.map((s) => {
    const d = latest.get(s.hash);
    return { ...s, status: d ? { decision: d.decision, note: d.note, by: d.reviewer_name, kind: d.reviewer_kind, at: d.created_at, revision: d.revision } : null };
  });
  return {
    viewer,
    doc: {
      id: doc.id, title: doc.title, docNumber: doc.doc_number, revision: doc.revision, blueprint: doc.blueprint, ai: doc.ai,
      reviewDue: doc.review_due, createdAt: doc.created_at, createdBy: doc.created_by_name,
      pdfFileId: viewer.role === 'external' ? null : doc.pdf_file_id,
      docxFileId: viewer.role === 'external' ? null : doc.docx_file_id,
      subtitle: doc.content.subtitle ?? '',
    },
    sections: withStatus,
    summary: {
      approved: withStatus.filter((s) => s.status?.decision === 'approved').length,
      changes: withStatus.filter((s) => s.status?.decision === 'changes').length,
      total: withStatus.length,
    },
    comments,
    revisions,
    target: target ? { requirementId: target.requirement_id, siteId: target.site_id, siteName: target.site_name, requirementName: target.req_name, status: target.status ?? 'missing', submittedRevision: submitted?.revision ?? null } : null,
  };
}
