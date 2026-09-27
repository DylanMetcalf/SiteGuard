/**
 * Renders a Document Studio document to PDF: cover page with the company logo
 * and document control, branded header and footer on every page, numbered
 * sections, and professionally styled tables and sign-off blocks.
 */
import { createRequire } from 'node:module';
import type { Block, DocContent, DocMeta } from './model.js';
import { pdfSafe } from './model.js';

const require = createRequire(import.meta.url);
// pdfmake 0.3 server build (CommonJS singleton).
const pdfmake = require('pdfmake') as {
  setFonts(f: unknown): void;
  setUrlAccessPolicy(fn: (url: string) => boolean): void;
  setLocalAccessPolicy(fn: (path: string) => boolean): void;
  createPdf(def: unknown): { getBuffer(): Promise<Buffer> };
};
pdfmake.setFonts({ Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' } });
// Documents never load anything from the network or disk: only the embedded logo.
pdfmake.setUrlAccessPolicy(() => false);
const STANDARD_FONTS = new Set(['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique']);
pdfmake.setLocalAccessPolicy((p) => STANDARD_FONTS.has(p));

type Node = Record<string, unknown> | string | Node[];

/** Mixes a hex colour with white; t=0 is the colour, t=1 is white. */
export function tint(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0');
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
}

const INK = '#1B2433';
const MUTED = '#5E6A7A';
const RULE = '#D5DBE3';

function tableLayout(brand: string) {
  return {
    hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === 0 || i === node.table.body.length ? 0.8 : 0.5),
    vLineWidth: () => 0.5,
    hLineColor: () => RULE,
    vLineColor: () => RULE,
    fillColor: (row: number) => (row === 0 ? brand : row % 2 === 0 ? '#F6F8FA' : null),
    paddingLeft: () => 6,
    paddingRight: () => 6,
    paddingTop: () => 5,
    paddingBottom: () => 5,
  };
}

const plain = {
  hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => RULE, vLineColor: () => RULE,
  paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 5, paddingBottom: () => 5,
};

/** Risk ratings like "20 High" get the matching traffic-light fill. */
export const RATING_FILL: Record<string, [string, string]> = { High: ['#FBE3E0', '#9E2A21'], Medium: ['#FFF0D6', '#8A5200'], Low: ['#E2F3E9', '#146B47'] };
function ratingCell(text: string): Record<string, unknown> {
  const m = /^\d+ (High|Medium|Low)$/.exec(text);
  if (!m) return { text, fontSize: 8.5 };
  const [fill, color] = RATING_FILL[m[1]];
  return { text, fontSize: 8.5, bold: true, fillColor: fill, color };
}

function widthsFor(n: number, rel?: number[]): (string | number)[] {
  if (rel && rel.length === n) {
    const total = rel.reduce((a, b) => a + b, 0);
    return rel.map((r) => `${((r / total) * 100).toFixed(2)}%`);
  }
  return Array.from({ length: n }, () => '*');
}

function block(b: Block, brand: string): Node {
  switch (b.type) {
    case 'paragraph':
      return { text: pdfSafe(b.text), margin: [0, 0, 0, 7] };
    case 'bullets':
      return { ul: b.items.map(pdfSafe), margin: [0, 0, 0, 8], markerColor: brand };
    case 'numbered':
      return { ol: b.items.map(pdfSafe), margin: [0, 0, 0, 8] };
    case 'note':
      return {
        table: { widths: ['*'], body: [[{ text: pdfSafe(b.text), color: INK, fontSize: 9 }]] },
        layout: { hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 3 : 0), vLineColor: () => brand, fillColor: () => tint(brand, 0.9), paddingLeft: () => 9, paddingTop: () => 7, paddingBottom: () => 7 },
        margin: [0, 2, 0, 10],
      };
    case 'fields':
      return {
        table: { widths: ['32%', '*'], body: b.items.map(([k, val]) => [{ text: pdfSafe(k), bold: true, color: INK, fillColor: tint(brand, 0.92) }, pdfSafe(val || '—')]) },
        layout: plain, margin: [0, 0, 0, 10],
      };
    case 'table': {
      const n = b.columns.length;
      const body = [
        b.columns.map((c) => ({ text: pdfSafe(c), bold: true, color: '#FFFFFF', fontSize: 8.5 })),
        ...b.rows.map((r) => Array.from({ length: n }, (_, k) => ratingCell(pdfSafe(r[k] ?? '')))),
      ];
      return { table: { headerRows: 1, dontBreakRows: true, widths: widthsFor(n, b.widths), body }, layout: tableLayout(brand), margin: [0, 2, 0, 12] };
    }
    case 'signatures': {
      const head = ['Role', 'Name', 'Signature', 'Date'].map((t) => ({ text: t, bold: true, color: '#FFFFFF', fontSize: 8.5 }));
      const rows = b.roles.map((r) => [{ text: pdfSafe(r), fontSize: 8.5 }, { text: '', margin: [0, 14, 0, 0] }, '', '']);
      return { table: { headerRows: 1, dontBreakRows: true, widths: ['30%', '26%', '26%', '18%'], body: [head, ...rows] }, layout: tableLayout(brand), margin: [0, 4, 0, 12] };
    }
  }
}

export async function renderPdf(content: DocContent, meta: DocMeta): Promise<Buffer> {
  const brand = meta.brandColor;
  const logo = meta.logo ? `data:${meta.logo.type};base64,${meta.logo.data.toString('base64')}` : null;
  const title = pdfSafe(content.title);

  const cover: Node[] = [
    logo ? { image: 'logo', fit: [170, 70], margin: [0, 10, 0, 34] } : { text: pdfSafe(meta.companyName), fontSize: 18, bold: true, color: brand, margin: [0, 10, 0, 34] },
    { text: pdfSafe(meta.blueprintName).toUpperCase(), fontSize: 9, bold: true, color: MUTED, characterSpacing: 1.2, margin: [0, 0, 0, 6] },
    { text: title, fontSize: 26, bold: true, color: INK, lineHeight: 1.1, margin: [0, 0, 0, 8] },
    content.subtitle ? { text: pdfSafe(content.subtitle), fontSize: 12.5, color: MUTED, margin: [0, 0, 0, 22] } : { text: '', margin: [0, 0, 0, 14] },
    { canvas: [{ type: 'rect', x: 0, y: 0, w: 60, h: 4, color: brand }], margin: [0, 0, 0, 22] },
    {
      table: {
        widths: ['32%', '*'],
        body: [
          ['Document number', meta.docNumber],
          ['Revision', String(meta.revision)],
          ['Issue date', meta.issueDate],
          ['Next review', meta.reviewDate],
          ['Company', meta.companyName + (meta.companyReg ? ` (Reg. ${meta.companyReg})` : '')],
          ...(meta.siteName ? [['Site / project', meta.siteName]] : []),
          ...(meta.clientName ? [['Client', meta.clientName]] : []),
          ['Prepared by', meta.preparedBy + (meta.preparedByTitle ? `, ${meta.preparedByTitle}` : '')],
        ].map(([k, val]) => [{ text: pdfSafe(k), bold: true, color: INK, fillColor: tint(brand, 0.92) }, pdfSafe(val)]),
      },
      layout: plain,
      margin: [0, 0, 0, 20],
    },
    { text: 'Revision history', bold: true, fontSize: 10.5, color: INK, margin: [0, 6, 0, 6] },
    {
      table: {
        headerRows: 1,
        widths: ['10%', '18%', '*', '24%'],
        body: [
          ['Rev', 'Date', 'Description', 'By'].map((t) => ({ text: t, bold: true, color: '#FFFFFF', fontSize: 8.5 })),
          ...meta.revisions.map((r) => [String(r.revision), r.date, pdfSafe(r.description), pdfSafe(r.by)].map((t) => ({ text: t, fontSize: 8.5 }))),
        ],
      },
      layout: tableLayout(brand),
    },
    { text: 'This document is controlled electronically in SiteGuard. Printed copies are uncontrolled.', fontSize: 8, color: MUTED, italics: true, margin: [0, 16, 0, 0], pageBreak: 'after' },
  ];

  const body: Node[] = [];
  content.sections.forEach((s, n) => {
    body.push({
      stack: [
        { text: `${n + 1}.  ${pdfSafe(s.heading)}`, fontSize: 12.5, bold: true, color: brand, margin: [0, 10, 0, 3] },
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 499, y2: 0, lineWidth: 0.6, lineColor: RULE }], margin: [0, 0, 0, 8] },
      ],
      unbreakable: true,
    });
    for (const b of s.blocks) body.push(block(b, brand));
  });

  const def = {
    pageSize: 'A4',
    pageMargins: [48, 78, 48, 58],
    info: { title, author: meta.companyName, subject: meta.blueprintName, creator: 'SiteGuard Document Studio' },
    images: logo ? { logo } : {},
    defaultStyle: { font: 'Helvetica', fontSize: 9.5, lineHeight: 1.3, color: INK },
    background: (page: number, size: { width: number; height: number }) =>
      page === 1
        ? { canvas: [{ type: 'rect', x: 0, y: 0, w: size.width, h: 12, color: brand }, { type: 'rect', x: 0, y: size.height - 6, w: size.width, h: 6, color: tint(brand, 0.55) }] }
        : { canvas: [{ type: 'rect', x: 0, y: 0, w: size.width, h: 5, color: brand }] },
    header: (page: number) =>
      page === 1
        ? null
        : {
            margin: [48, 22, 48, 0],
            stack: [
              {
                columns: [
                  logo ? { image: 'logo', fit: [90, 28], width: 110 } : { text: pdfSafe(meta.companyName), bold: true, color: brand, fontSize: 10, width: 200 },
                  { width: '*', stack: [{ text: title, alignment: 'right', bold: true, fontSize: 9, color: INK }, { text: `${meta.docNumber}  ·  Rev ${meta.revision}`, alignment: 'right', fontSize: 8, color: MUTED }] },
                ],
              },
              { canvas: [{ type: 'line', x1: 0, y1: 8, x2: 499, y2: 8, lineWidth: 1, lineColor: brand }] },
            ],
          },
    footer: (page: number, pages: number) => ({
      margin: [48, 18, 48, 0],
      columns: [
        { text: pdfSafe(`${meta.companyName}  ·  ${meta.docNumber}  ·  Rev ${meta.revision}  ·  Review by ${meta.reviewDate}`), fontSize: 7.5, color: MUTED, width: '*' },
        { text: 'Uncontrolled when printed', fontSize: 7.5, color: MUTED, alignment: 'center', width: 120 },
        { text: `Page ${page} of ${pages}`, fontSize: 7.5, color: MUTED, alignment: 'right', width: 70 },
      ],
    }),
    content: [...cover, ...body],
  };
  return pdfmake.createPdf(def).getBuffer();
}
