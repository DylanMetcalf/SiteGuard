/**
 * Renders a Document Studio document to an editable Word file with the same
 * structure as the PDF: cover and document control, branded header and
 * footer with page numbers, numbered sections, tables and sign-off blocks.
 */
import {
  AlignmentType, BorderStyle, Document, Footer, Header, ImageRun, LevelFormat, Packer, PageBreak, PageNumber,
  Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType,
} from 'docx';
import type { Block, DocContent, DocMeta } from './model.js';
import { RATING_FILL, tint } from './render-pdf.js';

const INK = '1B2433';
const MUTED = '5E6A7A';
const RULE = 'D5DBE3';
const FONT = 'Arial';
const hex = (c: string) => c.replace('#', '').toUpperCase();

/** Pixel size of a PNG or JPEG, to keep the logo's proportions. */
export function imageSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xc3) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  return null;
}

function fit(size: { width: number; height: number }, maxW: number, maxH: number) {
  const s = Math.min(maxW / size.width, maxH / size.height, 1);
  return { width: Math.round(size.width * s), height: Math.round(size.height * s) };
}

const run = (text: string, o: Record<string, unknown> = {}) => new TextRun({ text, font: FONT, size: 19, color: INK, ...o });
const p = (text: string, o: Record<string, unknown> = {}, po: Record<string, unknown> = {}) => new Paragraph({ children: [run(text, o)], spacing: { after: 120, line: 290 }, ...po });

const cellBorders = { top: { style: BorderStyle.SINGLE, size: 4, color: RULE }, bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE }, left: { style: BorderStyle.SINGLE, size: 4, color: RULE }, right: { style: BorderStyle.SINGLE, size: 4, color: RULE } };
const noBorders = { top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } };

function cell(text: string, o: { fill?: string; color?: string; bold?: boolean; width?: number; minHeight?: boolean } = {}) {
  return new TableCell({
    children: [new Paragraph({ children: [run(text, { size: 17, bold: o.bold, color: o.color ?? INK })], spacing: { before: 40, after: o.minHeight ? 320 : 40 } })],
    shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
    borders: cellBorders,
    width: o.width ? { size: Math.round((9906 * o.width) / 100), type: WidthType.DXA } : undefined,
    margins: { top: 40, bottom: 40, left: 90, right: 90 },
  });
}

function widths(n: number, rel?: number[]): number[] {
  const r = rel && rel.length === n ? rel : Array.from({ length: n }, () => 1);
  const total = r.reduce((a, b) => a + b, 0);
  return r.map((x) => Math.round((x / total) * 100));
}

function ratingCell(text: string, width: number) {
  const m = /^\d+ (High|Medium|Low)$/.exec(text);
  if (!m) return cell(text, { width });
  const [fill, color] = RATING_FILL[m[1]];
  return cell(text, { fill: hex(fill), color: hex(color), bold: true, width });
}

function table(columns: string[], rows: string[][], brand: string, rel?: number[], opts: { tallRows?: boolean } = {}) {
  const w = widths(columns.length, rel);
  return new Table({
    width: { size: PAGE_W, type: WidthType.DXA },
    columnWidths: twips(w),
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({ tableHeader: true, children: columns.map((c, k) => cell(c, { fill: hex(brand), color: 'FFFFFF', bold: true, width: w[k] })) }),
      ...rows.map((r, n) => new TableRow({ cantSplit: true, children: columns.map((_, k) => {
        const t = r[k] ?? '';
        if (opts.tallRows && k > 0) return cell(t, { width: w[k], minHeight: true });
        const c = ratingCell(t, w[k]);
        return n % 2 === 1 && !/^\d+ (High|Medium|Low)$/.test(t) ? cell(t, { width: w[k], fill: 'F6F8FA' }) : c;
      }) })),
    ],
  });
}

function fieldsTable(items: [string, string][], brand: string) {
  return new Table({
    width: { size: PAGE_W, type: WidthType.DXA },
    columnWidths: twips([32, 68]),
    layout: TableLayoutType.FIXED,
    rows: items.map(([k, v]) => new TableRow({ cantSplit: true, children: [cell(k, { bold: true, fill: hex(tint(brand, 0.92)), width: 32 }), cell(v || '—', { width: 68 })] })),
  });
}

/** Usable page width in twips (A4 minus 2 × 1000 margins). */
const PAGE_W = 9906;
const twips = (pcts: number[]) => pcts.map((x) => Math.round((PAGE_W * x) / 100));

const spacer = () => new Paragraph({ children: [], spacing: { after: 120 } });

export async function renderDocx(content: DocContent, meta: DocMeta): Promise<Buffer> {
  const brand = meta.brandColor;
  const size = meta.logo ? imageSize(meta.logo.data) : null;
  const logoRun = (maxW: number, maxH: number) =>
    meta.logo && size ? new ImageRun({ type: meta.logo.type === 'image/png' ? 'png' : 'jpg', data: meta.logo.data, transformation: fit(size, maxW, maxH) }) : null;

  let listInstance = 0;
  const blocks = (b: Block): (Paragraph | Table)[] => {
    switch (b.type) {
      case 'paragraph': return [p(b.text)];
      case 'bullets': return b.items.map((t) => new Paragraph({ children: [run(t)], numbering: { reference: 'bullets', level: 0 }, spacing: { after: 60 } }));
      case 'numbered': {
        const instance = ++listInstance;
        return b.items.map((t) => new Paragraph({ children: [run(t)], numbering: { reference: 'numbers', level: 0, instance }, spacing: { after: 60 } }));
      }
      case 'note':
        return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: [new TableCell({
          children: [new Paragraph({ children: [run(b.text, { size: 17 })] })],
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: hex(tint(brand, 0.9)) },
          borders: { ...noBorders, left: { style: BorderStyle.SINGLE, size: 24, color: hex(brand) } },
          margins: { top: 100, bottom: 100, left: 160, right: 120 },
        })] })] }), spacer()];
      case 'fields': return [fieldsTable(b.items, brand), spacer()];
      case 'table': return [table(b.columns, b.rows, brand, b.widths), spacer()];
      case 'signatures': return [table(['Role', 'Name', 'Signature', 'Date'], b.roles.map((r) => [r, '', '', '']), brand, [3, 2.6, 2.6, 1.8], { tallRows: true }), spacer()];
    }
  };

  const coverLogo = logoRun(220, 90);
  const cover: (Paragraph | Table)[] = [
    coverLogo ? new Paragraph({ children: [coverLogo], spacing: { after: 600 } }) : p(meta.companyName, { size: 36, bold: true, color: hex(brand) }, { spacing: { after: 600 } }),
    p(meta.blueprintName.toUpperCase(), { size: 17, bold: true, color: MUTED, characterSpacing: 24 }, { spacing: { after: 80 } }),
    p(content.title, { size: 52, bold: true }, { spacing: { after: 160 } }),
    ...(content.subtitle ? [p(content.subtitle, { size: 25, color: MUTED }, { spacing: { after: 400 } })] : []),
    new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 24, color: hex(brand), space: 1 } }, spacing: { after: 400 }, indent: { right: 7800 } }),
    fieldsTable([
      ['Document number', meta.docNumber], ['Revision', String(meta.revision)], ['Issue date', meta.issueDate], ['Next review', meta.reviewDate],
      ['Company', meta.companyName + (meta.companyReg ? ` (Reg. ${meta.companyReg})` : '')],
      ...(meta.siteName ? [['Site / project', meta.siteName] as [string, string]] : []),
      ...(meta.clientName ? [['Client', meta.clientName] as [string, string]] : []),
      ['Prepared by', meta.preparedBy + (meta.preparedByTitle ? `, ${meta.preparedByTitle}` : '')],
    ], brand),
    spacer(),
    p('Revision history', { bold: true, size: 21 }),
    table(['Rev', 'Date', 'Description', 'By'], meta.revisions.map((r) => [String(r.revision), r.date, r.description, r.by]), brand, [1, 1.8, 5, 2.4]),
    p('This document is controlled electronically in SiteGuard. Printed copies are uncontrolled.', { size: 16, italics: true, color: MUTED }, { spacing: { before: 240 } }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  const body: (Paragraph | Table)[] = [];
  content.sections.forEach((s, n) => {
    body.push(new Paragraph({
      children: [run(`${n + 1}.  ${s.heading}`, { size: 25, bold: true, color: hex(brand) })],
      spacing: { before: 240, after: 120 }, keepNext: true,
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 4 } },
    }));
    for (const b of s.blocks) body.push(...blocks(b));
  });

  const headerLogo = logoRun(110, 34);
  const header = new Header({ children: [
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: [
      new TableCell({ borders: noBorders, width: { size: 40, type: WidthType.PERCENTAGE }, children: [headerLogo ? new Paragraph({ children: [headerLogo] }) : p(meta.companyName, { bold: true, color: hex(brand) })] }),
      new TableCell({ borders: noBorders, width: { size: 60, type: WidthType.PERCENTAGE }, children: [
        new Paragraph({ alignment: AlignmentType.RIGHT, children: [run(content.title, { size: 17, bold: true })] }),
        new Paragraph({ alignment: AlignmentType.RIGHT, children: [run(`${meta.docNumber}  ·  Rev ${meta.revision}`, { size: 15, color: MUTED })] }),
      ] }),
    ] })] }),
    new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: hex(brand), space: 1 } } }),
  ] });
  const footer = new Footer({ children: [
    new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 4 } }, children: [
      run(`${meta.companyName}  ·  ${meta.docNumber}  ·  Rev ${meta.revision}  ·  Review by ${meta.reviewDate}  ·  Uncontrolled when printed  ·  Page `, { size: 14, color: MUTED }),
      new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 14, color: MUTED }),
      run(' of ', { size: 14, color: MUTED }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 14, color: MUTED }),
    ] }),
  ] });

  const doc = new Document({
    creator: 'SiteGuard Document Studio',
    title: content.title,
    description: meta.blueprintName,
    styles: { default: { document: { run: { font: FONT, size: 19, color: INK } } } },
    numbering: { config: [
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 400, hanging: 260 } }, run: { color: hex(brand) } } }] },
      { reference: 'numbers', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 440, hanging: 300 } } } }] },
    ] },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1300, bottom: 1100, left: 1000, right: 1000, header: 500, footer: 500 } }, titlePage: true },
      headers: { default: header, first: new Header({ children: [new Paragraph({ children: [], border: { top: { style: BorderStyle.SINGLE, size: 48, color: hex(brand) } } })] }) },
      footers: { default: footer, first: footer },
      children: [...cover, ...body],
    }],
  });
  return Packer.toBuffer(doc);
}
