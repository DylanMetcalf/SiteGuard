/**
 * Bound PDFs made from real documents, not summaries.
 *
 * - The site safety file: branded cover, contents with statuses and page
 *   numbers, the site registers (workforce, permits, incidents, toolbox talks),
 *   then every submitted requirement document, the site's appointment letters
 *   and the certificates of the workers assigned to the site.
 * - A document pack: the documents a company selects, merged the same way.
 *
 * PDFs are merged as-is, photos become pages, and anything that can't be merged
 * (Word files, protected PDFs) gets a placeholder page saying where to find it.
 * Every page after the cover is stamped with a label and "page x of y".
 *
 * The safety file includes only documents the other party may already see
 * (complete, expiring or awaiting review) — the same rule as the external
 * safety-file link — and only the certificates of workers assigned to the site.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { many, one, type Db } from '../db/pool.js';
import { daysUntil, effectiveStatus, type DocStatus } from './readiness.js';
import { storage } from './storage.js';
import { pdfFromDefinition, tint } from './studio/render-pdf.js';
import { pdfSafe } from './studio/model.js';
import { DEFAULT_BRAND } from './studio/generate.js';

const INK = '#1B2433';
const MUTED = '#5E6A7A';
const GREEN = '#146B47';
const AMBER = '#8A5200';
const RED = '#9E2A21';
const NAVY = '#16325C';
const INCLUDED: DocStatus[] = ['complete', 'expiring', 'awaiting_review'];
const LABEL: Record<DocStatus, [string, string]> = {
  complete: ['Approved', GREEN], expiring: ['Approved (expiring soon)', AMBER], awaiting_review: ['Awaiting review', NAVY],
  missing: ['Missing', RED], expired: ['Expired', RED], correction_required: ['Correction needed', RED],
};
/** Plain-language status and colour for a document status. */
export const statusLabel = (st: DocStatus): [string, string] => LABEL[st];
/** Stops one huge upload from making the bundle unusable. */
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;

/** pdf-lib's standard fonts only encode Latin-1. */
const latin = (s: string) => pdfSafe(s).replace(/[\u2012-\u2015]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
const ver = (v: string | null | undefined) => (v ? (/^v/i.test(v) ? v : `v${v}`) : '—');
const fmt = (d: string | Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const t = (s: unknown) => pdfSafe(String(s ?? ''));
/** South African time, e.g. 2026-09-29 07:00 — permits are issued per shift. */
const fmtTime = (d: string | Date | null | undefined) =>
  d ? new Date(new Date(d).getTime() + 2 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '—';

interface FileRef { storage_key: string; content_type: string; filename: string }
export interface BundleItem {
  section: string;
  name: string;
  sub?: string;
  status: [string, string];
  version?: string | null;
  expiry?: string | null;
  file: FileRef | null;
}
interface BundleSpec {
  eyebrow: string;
  title: string;
  subtitle: string;
  author: string;
  brand: string;
  logo: string | null;
  coverRows: [string, string][];
  items: BundleItem[];
  contentsNote: string;
  /** pdfmake nodes printed after the contents, e.g. registers. */
  registers?: unknown[];
  stamp: string;
}

async function loadBranding(db: Db, orgId: string | null): Promise<{ brand: string; logo: string | null }> {
  if (!orgId) return { brand: DEFAULT_BRAND, logo: null };
  const o = await one<{ settings: Record<string, unknown> | null }>(db, 'select settings from organisations where id = $1', [orgId]);
  const s = o?.settings ?? {};
  const brand = typeof s.brandColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.brandColor) ? s.brandColor : DEFAULT_BRAND;
  let logo: string | null = null;
  if (typeof s.logoFileId === 'string') {
    const f = await one<{ storage_key: string; content_type: string }>(db, 'select storage_key, content_type from files where id = $1 and org_id = $2', [s.logoFileId, orgId]);
    if (f && ['image/png', 'image/jpeg'].includes(f.content_type)) {
      try { logo = `data:${f.content_type};base64,${(await storage.read(f.storage_key)).toString('base64')}`; } catch { /* no logo */ }
    }
  }
  return { brand, logo };
}

const certStatus = (expires: string | null): [string, string] => {
  const d = daysUntil(expires);
  if (d === null) return ['Valid (no expiry)', GREEN];
  if (d < 0) return ['Expired', RED];
  if (d <= 30) return ['Expiring soon', AMBER];
  return ['Valid', GREEN];
};

export async function buildSafetyFile(db: Db, siteId: string, generatedBy: string): Promise<{ pdf: Buffer; filename: string }> {
  const site = (await one<any>(
    db,
    `select s.name, s.location, s.status, o.name as host_name, c.name as contractor_name, c.linked_org_id,
            a.verification_id, a.approved_on, a.approver_name
       from sites s join organisations o on o.id = s.org_id join contractors c on c.id = s.contractor_id
       left join approvals a on a.site_id = s.id
      where s.id = $1`,
    [siteId],
  ))!;
  const reqs = await many<any>(
    db,
    `select r.category, r.name, d.status, d.expiry_date, d.version, f.storage_key, f.content_type, f.filename
       from requirements r left join documents d on d.requirement_id = r.id left join files f on f.id = d.current_file_id
      where r.site_id = $1 order by r.position, r.created_at`,
    [siteId],
  );
  const items: BundleItem[] = reqs.map((r) => {
    const st = effectiveStatus(r.status ? { status: r.status, expiry_date: r.expiry_date } : null);
    return {
      section: 'Site requirements', name: r.name, sub: r.category, status: LABEL[st], version: r.version, expiry: r.expiry_date,
      file: INCLUDED.includes(st) && r.storage_key ? { storage_key: r.storage_key, content_type: r.content_type, filename: r.filename } : null,
    };
  });

  const appointments = await many<any>(
    db,
    `select a.appointee_name, a.appointment_type, a.legal_reference, a.start_date, a.end_date, f.storage_key, f.content_type, f.filename
       from appointments a left join files f on f.id = a.file_id
      where a.site_id = $1 and a.revoked_at is null order by a.start_date`,
    [siteId],
  );
  for (const a of appointments) {
    const ended = a.end_date && (daysUntil(a.end_date) ?? 0) < 0;
    items.push({
      section: 'Appointments', name: `${a.appointment_type} — ${a.appointee_name}`, sub: a.legal_reference || undefined,
      status: ended ? ['Ended', RED] : ['Active', GREEN], expiry: a.end_date,
      file: a.storage_key ? { storage_key: a.storage_key, content_type: a.content_type, filename: a.filename } : null,
    });
  }

  const workers = await many<any>(
    db,
    `select w.full_name, w.occupation,
            coalesce((select json_agg(json_build_object('kind', c.kind, 'name', c.name, 'issuer', c.issuer, 'expires', c.expires_on,
                        'storage_key', f.storage_key, 'content_type', f.content_type, 'filename', f.filename) order by c.kind, c.name)
                        from worker_certificates c left join files f on f.id = c.file_id where c.worker_id = w.id), '[]') as certs
       from site_workers sw join workers w on w.id = sw.worker_id where sw.site_id = $1 and w.active order by w.full_name`,
    [siteId],
  );
  for (const w of workers) {
    for (const c of w.certs) {
      items.push({
        section: 'Workforce certificates', name: `${w.full_name} — ${c.name}`, sub: c.issuer || w.occupation || undefined,
        status: certStatus(c.expires), expiry: c.expires,
        file: c.storage_key ? { storage_key: c.storage_key, content_type: c.content_type, filename: c.filename } : null,
      });
    }
  }

  const registers = await siteRegisters(db, siteId, workers);
  const { brand, logo } = await loadBranding(db, site.linked_org_id);
  const reqStatuses = reqs.map((r) => effectiveStatus(r.status ? { status: r.status, expiry_date: r.expiry_date } : null));
  const n = (...s: DocStatus[]) => reqStatuses.filter((x) => s.includes(x)).length;
  const ready = site.status === 'site_ready' && site.verification_id;

  const pdf = await renderBundle(db, {
    eyebrow: 'SAFETY FILE',
    title: site.name,
    subtitle: [site.location, `Client: ${site.host_name}`].filter(Boolean).join('  ·  '),
    author: site.contractor_name,
    brand,
    logo,
    coverRows: [
      ['Contractor', site.contractor_name],
      ['Client (host)', site.host_name],
      ['Site status', ready ? `Site ready — approved ${fmt(site.approved_on)} by ${site.approver_name}` : 'Not yet approved'],
      ...(ready ? ([['Verification code', site.verification_id]] as [string, string][]) : []),
      ['Requirements', `${n('complete', 'expiring')} approved · ${n('awaiting_review')} awaiting review · ${n('missing', 'expired', 'correction_required')} outstanding`],
      ['Workforce', `${workers.length} worker${workers.length === 1 ? '' : 's'} assigned`],
      ['Compiled', `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by ${generatedBy}`],
    ],
    items,
    registers,
    contentsNote: 'Only documents that have been submitted to the site are included. Missing, expired and returned documents are listed so the gaps are visible.',
    stamp: `Safety file · ${site.name} · ${site.contractor_name}`,
  });
  return { pdf, filename: `Safety-file-${safeName(site.name)}.pdf` };
}

/** A company's own selection of documents, merged into one PDF. */
export async function buildDocumentPack(db: Db, org: { id: string; name: string }, items: BundleItem[], generatedBy: string): Promise<{ pdf: Buffer; filename: string }> {
  const { brand, logo } = await loadBranding(db, org.id);
  const pdf = await renderBundle(db, {
    eyebrow: 'DOCUMENT PACK',
    title: org.name,
    subtitle: `${items.length} document${items.length === 1 ? '' : 's'}`,
    author: org.name,
    brand,
    logo,
    coverRows: [
      ['Company', org.name],
      ['Documents', String(items.length)],
      ['Compiled', `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by ${generatedBy}`],
    ],
    items,
    contentsNote: 'The current version of each selected document.',
    stamp: `Document pack · ${org.name}`,
  });
  return { pdf, filename: `Document-pack-${safeName(org.name)}.pdf` };
}

const safeName = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'documents';

async function siteRegisters(db: Db, siteId: string, workers: any[]): Promise<unknown[]> {
  const permits = await many<any>(db, `select type, location, status, issued_to, valid_from, valid_to from permits where site_id = $1 order by created_at`, [siteId]);
  const incidents = await many<any>(db, `select type, occurred_on, status, description, root_cause, corrective_actions from incidents where site_id = $1 order by occurred_on`, [siteId]);
  const talks = await many<any>(
    db,
    `select t.topic, t.held_on, t.presenter_name, (select string_agg(a.attendee_name, ', ' order by a.attendee_name) from toolbox_attendance a where a.talk_id = t.id) as attendees
       from toolbox_talks t where t.site_id = $1 order by t.held_on`,
    [siteId],
  );
  const h = (s: string) => ({ text: s, bold: true, color: '#FFFFFF', fontSize: 8, fillColor: NAVY });
  const c = (s: unknown, extra: Record<string, unknown> = {}) => ({ text: t(s) || '—', fontSize: 8, ...extra });
  const table = (title: string, widths: (string | number)[], head: string[], rows: unknown[][], empty: string) => [
    { text: title, fontSize: 12, bold: true, color: INK, margin: [0, 14, 0, 6] },
    rows.length
      ? { table: { headerRows: 1, widths, body: [head.map(h), ...rows] }, layout: { hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => '#D5DBE3', paddingTop: () => 4, paddingBottom: () => 4 } }
      : { text: empty, fontSize: 8.5, color: MUTED, italics: true },
  ];
  const nice = (s: string) => s.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());
  return [
    { text: 'Site registers', fontSize: 16, bold: true, color: INK, margin: [0, 0, 0, 2], pageBreak: 'before' },
    { text: 'The live records for this site at the time of compiling.', fontSize: 8.5, color: MUTED },
    ...table('Workforce', ['30%', '22%', '*'], ['Worker', 'Occupation', 'Certificates'],
      workers.map((w) => [c(w.full_name), c(w.occupation), c(w.certs.map((x: any) => `${x.name}${x.expires ? ` (to ${fmt(x.expires)})` : ''}`).join('; ') || 'None recorded')]),
      'No workers assigned to this site yet.'),
    ...table('Permits to work', ['18%', '*', '14%', '20%', '22%'], ['Type', 'Location', 'Status', 'Issued to', 'Valid'],
      permits.map((p) => [c(nice(p.type)), c(p.location), c(nice(p.status)), c(p.issued_to), c(p.valid_from ? `${fmtTime(p.valid_from)} to ${fmtTime(p.valid_to)}` : '')]),
      'No permits recorded.'),
    ...table('Incidents', ['14%', '16%', '12%', '*', '24%'], ['Date', 'Type', 'Status', 'Description', 'Root cause / actions'],
      incidents.map((i) => [c(fmt(i.occurred_on)), c(nice(i.type)), c(nice(i.status)), c(i.description), c([i.root_cause, i.corrective_actions].filter(Boolean).join(' — '))]),
      'No incidents recorded.'),
    ...table('Toolbox talks', ['14%', '*', '20%', '34%'], ['Date', 'Topic', 'Presenter', 'Attendees (signed)'],
      talks.map((x) => [c(fmt(x.held_on)), c(x.topic), c(x.presenter_name), c(x.attendees)]),
      'No toolbox talks recorded.'),
  ];
}

async function renderBundle(_db: Db, spec: BundleSpec): Promise<Buffer> {
  const { brand, logo } = spec;
  // Load each file's pages first, so the contents can show page numbers.
  const docs: (PDFDocument | null)[] = [];
  let total = 0;
  for (const it of spec.items) {
    if (!it.file) { docs.push(null); continue; }
    let buf: Buffer | null = null;
    try { buf = await storage.read(it.file.storage_key); } catch { /* reported below */ }
    if (!buf) { docs.push(await notice(it, 'The file could not be read from storage. Open it in SiteGuard.')); continue; }
    if (total + buf.length > MAX_TOTAL_BYTES) { docs.push(await notice(it, 'This file is too large to include here. Open it in SiteGuard.')); continue; }
    total += buf.length;
    docs.push(await asPdf(it, buf));
  }

  const regPdf = spec.registers ? await PDFDocument.load(await pdfFromDefinition(base(spec, spec.registers.map((x, i) => (i === 0 ? { ...(x as object), pageBreak: undefined } : x))))) : null;

  const contents = (pages: number[] | null, regPage: number | null): unknown[] => {
    const body: unknown[][] = [['#', 'Document', 'Status', 'Version', 'Expiry', 'Page'].map((x) => ({ text: x, bold: true, color: '#FFFFFF', fontSize: 8.5, fillColor: brand }))];
    if (regPdf) {
      body.push([{ text: '', fontSize: 8.5 }, { text: 'Site registers: workforce, permits, incidents, toolbox talks', fontSize: 9 }, { text: '', fontSize: 8.5 }, { text: '', fontSize: 8.5 }, { text: '', fontSize: 8.5 }, { text: String(regPage ?? 999), fontSize: 8.5 }]);
    }
    let section = '';
    let num = 0;
    let at = 0;
    spec.items.forEach((it, i) => {
      if (it.section !== section) {
        section = it.section;
        body.push([{ text: t(section).toUpperCase(), colSpan: 6, bold: true, fontSize: 7.5, color: MUTED, characterSpacing: 0.8, fillColor: tint(brand, 0.94), margin: [0, 2, 0, 0] }, {}, {}, {}, {}, {}]);
      }
      num++;
      const included = !!docs[i];
      const page = included ? (pages ? pages[at] : 999) : null;
      if (included) at++;
      body.push([
        { text: String(num), fontSize: 8.5, color: MUTED },
        { stack: [{ text: t(it.name), fontSize: 9 }, ...(it.sub ? [{ text: t(it.sub), fontSize: 7.5, color: MUTED }] : [])] },
        { text: t(it.status[0]), fontSize: 8.5, bold: true, color: it.status[1] },
        { text: ver(it.version), fontSize: 8.5 },
        { text: fmt(it.expiry), fontSize: 8.5 },
        { text: page !== null ? String(page) : '—', fontSize: 8.5, color: page !== null ? INK : MUTED },
      ]);
    });
    if (!spec.items.length) body.push([{ text: 'No documents yet.', colSpan: 6, fontSize: 8.5, color: MUTED, italics: true }, {}, {}, {}, {}, {}]);
    return [
      { text: 'Contents', fontSize: 16, bold: true, color: INK, margin: [0, 0, 0, 10] },
      { table: { headerRows: 1, widths: [18, '*', 92, 44, 58, 30], body }, layout: { hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => '#D5DBE3', paddingTop: () => 5, paddingBottom: () => 5 } },
      { text: spec.contentsNote, fontSize: 8, color: MUTED, italics: true, margin: [0, 12, 0, 0] },
    ];
  };
  const front = (pages: number[] | null, regPage: number | null) =>
    base(spec, [
      logo ? { image: 'logo', fit: [170, 70], margin: [0, 10, 0, 40] } : { text: t(spec.author), fontSize: 18, bold: true, color: brand, margin: [0, 10, 0, 40] },
      { text: spec.eyebrow, fontSize: 10, bold: true, color: MUTED, characterSpacing: 1.6, margin: [0, 0, 0, 6] },
      { text: t(spec.title), fontSize: 28, bold: true, color: INK, lineHeight: 1.1, margin: [0, 0, 0, 8] },
      { text: t(spec.subtitle), fontSize: 12, color: MUTED, margin: [0, 0, 0, 22] },
      { canvas: [{ type: 'rect', x: 0, y: 0, w: 60, h: 4, color: brand }], margin: [0, 0, 0, 22] },
      {
        table: { widths: ['32%', '*'], body: spec.coverRows.map(([k, v]) => [{ text: t(k), bold: true, fillColor: tint(brand, 0.92) }, t(v)]) },
        layout: { hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => '#D5DBE3', paddingTop: () => 6, paddingBottom: () => 6, paddingLeft: () => 8 },
      },
      { text: 'Compiled from the digital record in SiteGuard. The platform record is the source of truth; printed copies are uncontrolled.', fontSize: 8, color: MUTED, italics: true, margin: [0, 18, 0, 0], pageBreak: 'after' },
      ...contents(pages, regPage),
    ], true);

  // Render once to learn how many pages the front matter takes, then again with real page numbers.
  const frontLen = (await PDFDocument.load(await pdfFromDefinition(front(null, null)))).getPageCount();
  let next = frontLen + 1;
  const regPage = regPdf ? next : null;
  if (regPdf) next += regPdf.getPageCount();
  const starts: number[] = [];
  for (const d of docs) if (d) { starts.push(next); next += d.getPageCount(); }
  const out = await PDFDocument.load(await pdfFromDefinition(front(starts, regPage)));
  out.setTitle(latin(`${spec.eyebrow === 'SAFETY FILE' ? 'Safety file' : 'Document pack'} — ${spec.title}`));
  out.setCreator('SiteGuard');
  for (const d of [regPdf, ...docs]) {
    if (!d) continue;
    for (const pg of await out.copyPages(d, d.getPageIndices())) out.addPage(pg);
  }

  // Stamp every page after the cover.
  const font = await out.embedFont(StandardFonts.Helvetica);
  const pages = out.getPages();
  const label = latin(spec.stamp);
  pages.forEach((pg, i) => {
    if (i === 0) return;
    const { width } = pg.getSize();
    const text = `${label}  ·  page ${i + 1} of ${pages.length}`;
    const w = font.widthOfTextAtSize(text, 7);
    pg.drawRectangle({ x: width - w - 22, y: 6, width: w + 12, height: 12, color: rgb(1, 1, 1), opacity: 0.85 });
    pg.drawText(text, { x: width - w - 16, y: 9.5, size: 7, font, color: rgb(0.37, 0.42, 0.48) });
  });
  return Buffer.from(await out.save());
}

function base(spec: BundleSpec, content: unknown[], cover = false) {
  return {
    pageSize: 'A4',
    pageMargins: [48, 60, 48, 58],
    info: { title: t(spec.title), author: t(spec.author), creator: 'SiteGuard' },
    images: spec.logo ? { logo: spec.logo } : {},
    defaultStyle: { font: 'Helvetica', fontSize: 9.5, lineHeight: 1.3, color: INK },
    background: (page: number, size: { width: number; height: number }) =>
      cover && page === 1 ? { canvas: [{ type: 'rect', x: 0, y: 0, w: size.width, h: 12, color: spec.brand }, { type: 'rect', x: 0, y: size.height - 6, w: size.width, h: 6, color: tint(spec.brand, 0.55) }] } : null,
    content,
  };
}

async function asPdf(it: BundleItem, buf: Buffer): Promise<PDFDocument> {
  const type = it.file?.content_type ?? '';
  try {
    if (type === 'application/pdf') {
      const src = await PDFDocument.load(buf);
      if (src.getPageCount() > 0) return src; // merged as-is; Studio PDFs carry their own cover
    }
    if (type === 'image/png' || type === 'image/jpeg') {
      const doc = await PDFDocument.create();
      const img = type === 'image/png' ? await doc.embedPng(buf) : await doc.embedJpg(buf);
      const page = doc.addPage([595.28, 841.89]);
      const font = await doc.embedFont(StandardFonts.HelveticaBold);
      page.drawText(latin(it.name), { x: 48, y: 800, size: 13, font, color: rgb(0.11, 0.14, 0.2), maxWidth: 499 });
      const s = Math.min(499 / img.width, 700 / img.height, 1.5);
      page.drawImage(img, { x: 48 + (499 - img.width * s) / 2, y: 780 - img.height * s, width: img.width * s, height: img.height * s });
      return doc;
    }
  } catch {
    return notice(it, 'This PDF is password-protected or damaged, so it could not be merged. Open it in SiteGuard.');
  }
  return notice(it, `This is a ${it.file?.filename?.split('.').pop()?.toUpperCase() ?? 'non-PDF'} file, so it is not merged here. Open or download it in SiteGuard.`);
}

async function notice(it: BundleItem, message: string): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(latin(it.name), { x: 48, y: 760, size: 18, font: bold, color: rgb(0.11, 0.14, 0.2), maxWidth: 499 });
  page.drawText(latin(`File: ${it.file?.filename ?? '—'}${it.version ? `  ·  ${ver(it.version)}` : ''}${it.expiry ? `  ·  expires ${fmt(it.expiry)}` : ''}`), { x: 48, y: 730, size: 10, font, color: rgb(0.37, 0.42, 0.48) });
  page.drawText(latin(message), { x: 48, y: 700, size: 11, font, color: rgb(0.11, 0.14, 0.2), maxWidth: 499, lineHeight: 15 });
  return doc;
}
