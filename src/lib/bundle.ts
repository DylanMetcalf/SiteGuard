/**
 * The bound safety file: one PDF with a branded cover, a contents page with
 * each requirement's status and page number, then every submitted document in
 * order. PDFs are merged as-is, photos become pages, and anything that can't
 * be merged (Word files, protected PDFs) gets a placeholder page saying where
 * to find it. Every page is stamped "Safety file · <site> · page x of y".
 *
 * Only documents the other party may already see are included (complete,
 * expiring or awaiting review) — the same rule as the external safety-file link.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { many, one, type Db } from '../db/pool.js';
import { effectiveStatus, type DocStatus } from './readiness.js';
import { storage } from './storage.js';
import { pdfFromDefinition, tint } from './studio/render-pdf.js';
import { pdfSafe } from './studio/model.js';
import { DEFAULT_BRAND } from './studio/generate.js';

const INK = '#1B2433';
const MUTED = '#5E6A7A';
const INCLUDED: DocStatus[] = ['complete', 'expiring', 'awaiting_review'];
const LABEL: Record<DocStatus, string> = {
  complete: 'Approved', expiring: 'Approved (expiring soon)', awaiting_review: 'Awaiting review',
  missing: 'Missing', expired: 'Expired', correction_required: 'Correction needed',
};
const COLOR: Record<DocStatus, string> = {
  complete: '#146B47', expiring: '#8A5200', awaiting_review: '#16325C', missing: '#9E2A21', expired: '#9E2A21', correction_required: '#9E2A21',
};
/** Stops one huge upload from making the bundle unusable. */
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;

/** pdf-lib's standard fonts only encode Latin-1. */
const latin = (s: string) => pdfSafe(s).replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
const ver = (v: string | null) => (v ? (/^v/i.test(v) ? v : `v${v}`) : '—');
const fmt = (d: string | Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '—');

interface Row {
  category: string;
  name: string;
  status: string | null;
  expiry_date: string | null;
  version: string | null;
  storage_key: string | null;
  content_type: string | null;
  filename: string | null;
}

export async function buildSafetyFile(db: Db, siteId: string, generatedBy: string): Promise<{ pdf: Buffer; filename: string }> {
  const site = (await one<any>(
    db,
    `select s.name, s.location, s.status, o.name as host_name, c.name as contractor_name, c.linked_org_id,
            lo.settings as contractor_settings, a.verification_id, a.approved_on, a.approver_name
       from sites s join organisations o on o.id = s.org_id join contractors c on c.id = s.contractor_id
       left join organisations lo on lo.id = c.linked_org_id left join approvals a on a.site_id = s.id
      where s.id = $1`,
    [siteId],
  ))!;
  const rows = await many<Row>(
    db,
    `select r.category, r.name, d.status, d.expiry_date, d.version, f.storage_key, f.content_type, f.filename
       from requirements r left join documents d on d.requirement_id = r.id left join files f on f.id = d.current_file_id
      where r.site_id = $1 order by r.position, r.created_at`,
    [siteId],
  );

  // The file belongs to the contractor: use their brand colour and logo when they have an account.
  const settings = (site.contractor_settings ?? {}) as Record<string, unknown>;
  const brand = typeof settings.brandColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(settings.brandColor) ? settings.brandColor : DEFAULT_BRAND;
  let logo: string | null = null;
  if (site.linked_org_id && typeof settings.logoFileId === 'string') {
    const f = await one<{ storage_key: string; content_type: string }>(db, 'select storage_key, content_type from files where id = $1 and org_id = $2', [settings.logoFileId, site.linked_org_id]);
    if (f && ['image/png', 'image/jpeg'].includes(f.content_type)) {
      try { logo = `data:${f.content_type};base64,${(await storage.read(f.storage_key)).toString('base64')}`; } catch { /* no logo */ }
    }
  }

  // Load each included document's pages first, so the contents can show page numbers.
  type Part = { row: Row; st: DocStatus; doc: PDFDocument | null; note?: string };
  const parts: Part[] = [];
  let total = 0;
  for (const row of rows) {
    const st = effectiveStatus(row.status ? { status: row.status, expiry_date: row.expiry_date } : null);
    if (!INCLUDED.includes(st) || !row.storage_key) { parts.push({ row, st, doc: null }); continue; }
    let buf: Buffer | null = null;
    try { buf = await storage.read(row.storage_key); } catch { /* reported below */ }
    if (!buf) { parts.push({ row, st, doc: await notice(row, 'The file could not be read from storage. Open it in SiteGuard.') }); continue; }
    if (total + buf.length > MAX_TOTAL_BYTES) { parts.push({ row, st, doc: await notice(row, 'This file is too large to include in the bundle. Open it in SiteGuard.') }); continue; }
    total += buf.length;
    parts.push({ row, st, doc: await asPdf(row, buf) });
  }

  const docs = parts.filter((p) => p.doc);
  const contents = (pages: number[] | null): unknown[] => [
    { text: 'Contents', fontSize: 16, bold: true, color: INK, margin: [0, 0, 0, 10] },
    {
      table: {
        headerRows: 1,
        widths: [18, '*', 92, 48, 58, 34],
        body: [
          ['#', 'Document', 'Status', 'Version', 'Expiry', 'Page'].map((t) => ({ text: t, bold: true, color: '#FFFFFF', fontSize: 8.5, fillColor: brand })),
          ...parts.map((p, i) => {
            const at = p.doc ? docs.indexOf(p) : -1;
            return [
              { text: String(i + 1), fontSize: 8.5, color: MUTED },
              { stack: [{ text: pdfSafe(p.row.name), fontSize: 9 }, { text: pdfSafe(p.row.category), fontSize: 7.5, color: MUTED }] },
              { text: LABEL[p.st], fontSize: 8.5, bold: true, color: COLOR[p.st] },
              { text: ver(p.row.version), fontSize: 8.5 },
              { text: fmt(p.row.expiry_date), fontSize: 8.5 },
              { text: at >= 0 ? String(pages ? pages[at] : 999) : '—', fontSize: 8.5, color: at >= 0 ? INK : MUTED },
            ];
          }),
        ],
      },
      layout: { hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => '#D5DBE3', paddingTop: () => 5, paddingBottom: () => 5 },
    },
    { text: 'Only documents that have been submitted to the site are included. Missing, expired and returned documents are listed so the gaps are visible.', fontSize: 8, color: MUTED, italics: true, margin: [0, 12, 0, 0] },
  ];
  const counts = parts.reduce<Record<string, number>>((a, p) => ((a[p.st] = (a[p.st] ?? 0) + 1), a), {});
  const ready = site.status === 'site_ready' && site.verification_id;
  const front = (pages: number[] | null) => ({
    pageSize: 'A4',
    pageMargins: [48, 60, 48, 58],
    info: { title: `Safety file — ${pdfSafe(site.name)}`, author: pdfSafe(site.contractor_name), creator: 'SiteGuard' },
    images: logo ? { logo } : {},
    defaultStyle: { font: 'Helvetica', fontSize: 9.5, lineHeight: 1.3, color: INK },
    background: (page: number, size: { width: number; height: number }) =>
      page === 1 ? { canvas: [{ type: 'rect', x: 0, y: 0, w: size.width, h: 12, color: brand }, { type: 'rect', x: 0, y: size.height - 6, w: size.width, h: 6, color: tint(brand, 0.55) }] } : null,
    content: [
      logo ? { image: 'logo', fit: [170, 70], margin: [0, 10, 0, 40] } : { text: pdfSafe(site.contractor_name), fontSize: 18, bold: true, color: brand, margin: [0, 10, 0, 40] },
      { text: 'SAFETY FILE', fontSize: 10, bold: true, color: MUTED, characterSpacing: 1.6, margin: [0, 0, 0, 6] },
      { text: pdfSafe(site.name), fontSize: 28, bold: true, color: INK, lineHeight: 1.1, margin: [0, 0, 0, 8] },
      { text: pdfSafe([site.location, `Client: ${site.host_name}`].filter(Boolean).join('  ·  ')), fontSize: 12, color: MUTED, margin: [0, 0, 0, 22] },
      { canvas: [{ type: 'rect', x: 0, y: 0, w: 60, h: 4, color: brand }], margin: [0, 0, 0, 22] },
      {
        table: {
          widths: ['32%', '*'],
          body: [
            ['Contractor', site.contractor_name],
            ['Client (host)', site.host_name],
            ['Site status', ready ? `Site ready — approved ${fmt(site.approved_on)} by ${site.approver_name}` : 'Not yet approved'],
            ...(ready ? [['Verification code', site.verification_id]] : []),
            ['Documents', `${(counts.complete ?? 0) + (counts.expiring ?? 0)} approved · ${counts.awaiting_review ?? 0} awaiting review · ${(counts.missing ?? 0) + (counts.expired ?? 0) + (counts.correction_required ?? 0)} outstanding`],
            ['Compiled', `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by ${generatedBy}`],
          ].map(([k, v]) => [{ text: pdfSafe(k), bold: true, fillColor: tint(brand, 0.92) }, pdfSafe(String(v))]),
        },
        layout: { hLineWidth: () => 0.5, vLineWidth: () => 0, hLineColor: () => '#D5DBE3', paddingTop: () => 6, paddingBottom: () => 6, paddingLeft: () => 8 },
      },
      { text: 'Compiled from the digital record in SiteGuard. The platform record is the source of truth; printed copies are uncontrolled.', fontSize: 8, color: MUTED, italics: true, margin: [0, 18, 0, 0], pageBreak: 'after' },
      ...contents(pages),
    ],
  });

  // Render once to learn how many pages the front matter takes, then again with real page numbers.
  const frontLen = (await PDFDocument.load(await pdfFromDefinition(front(null)))).getPageCount();
  const starts: number[] = [];
  let next = frontLen + 1;
  for (const p of docs) { starts.push(next); next += p.doc!.getPageCount(); }
  const out = await PDFDocument.load(await pdfFromDefinition(front(starts)));
  out.setTitle(`Safety file — ${latin(site.name)}`);
  out.setCreator('SiteGuard');

  for (const p of docs) {
    const copied = await out.copyPages(p.doc!, p.doc!.getPageIndices());
    for (const pg of copied) out.addPage(pg);
  }

  // Stamp every page after the cover.
  const font = await out.embedFont(StandardFonts.Helvetica);
  const pages = out.getPages();
  const label = latin(`Safety file · ${site.name} · ${site.contractor_name}`);
  pages.forEach((pg, i) => {
    if (i === 0) return;
    const { width } = pg.getSize();
    const text = `${label}  ·  page ${i + 1} of ${pages.length}`;
    const size = 7;
    const w = font.widthOfTextAtSize(text, size);
    pg.drawRectangle({ x: width - w - 22, y: 6, width: w + 12, height: 12, color: rgb(1, 1, 1), opacity: 0.85 });
    pg.drawText(text, { x: width - w - 16, y: 9.5, size, font, color: rgb(0.37, 0.42, 0.48) });
  });

  const safeName = site.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'site';
  return { pdf: Buffer.from(await out.save()), filename: `Safety-file-${safeName}.pdf` };
}

async function asPdf(row: Row, buf: Buffer): Promise<PDFDocument> {
  const type = row.content_type ?? '';
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
      page.drawText(latin(row.name), { x: 48, y: 800, size: 13, font, color: rgb(0.11, 0.14, 0.2) });
      const s = Math.min(499 / img.width, 700 / img.height, 1.5);
      page.drawImage(img, { x: 48 + (499 - img.width * s) / 2, y: 780 - img.height * s, width: img.width * s, height: img.height * s });
      return doc;
    }
  } catch {
    return notice(row, 'This PDF is password-protected or damaged, so it could not be merged. Open it in SiteGuard.');
  }
  return notice(row, `This is a ${row.filename?.split('.').pop()?.toUpperCase() ?? 'non-PDF'} file, so it is not merged here. Open or download it in SiteGuard.`);
}

async function notice(row: Row, message: string): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(latin(row.name), { x: 48, y: 760, size: 18, font: bold, color: rgb(0.11, 0.14, 0.2) });
  page.drawText(latin(`File: ${row.filename ?? '—'}${row.version ? `  ·  ${ver(row.version)}` : ''}${row.expiry_date ? `  ·  expires ${fmt(row.expiry_date)}` : ''}`), { x: 48, y: 735, size: 10, font, color: rgb(0.37, 0.42, 0.48) });
  page.drawText(latin(message), { x: 48, y: 705, size: 11, font, color: rgb(0.11, 0.14, 0.2), maxWidth: 499, lineHeight: 15 });
  return doc;
}
