/**
 * The Document Studio's document model. Blueprints (rules) and the AI both
 * produce this structure; the PDF and Word renderers both consume it, so a
 * document looks the same whichever way it was written or downloaded.
 */
import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);

export const blockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('paragraph'), text: text(4000) }),
  z.object({ type: z.literal('bullets'), items: z.array(text(600)).max(40) }),
  z.object({ type: z.literal('numbered'), items: z.array(text(800)).max(60) }),
  z.object({
    type: z.literal('table'),
    columns: z.array(text(80)).min(1).max(8),
    rows: z.array(z.array(text(600)).max(8)).max(80),
    /** Relative column widths, e.g. [1, 3, 2]. */
    widths: z.array(z.number().positive().max(20)).max(8).optional(),
  }),
  z.object({ type: z.literal('fields'), items: z.array(z.tuple([text(80), text(400)])).max(30) }),
  z.object({ type: z.literal('signatures'), roles: z.array(text(80)).min(1).max(8) }),
  z.object({ type: z.literal('note'), text: text(1200) }),
]);
export type Block = z.infer<typeof blockSchema>;

export const sectionSchema = z.object({ heading: text(120).min(1), blocks: z.array(blockSchema).max(30) });
export type Section = z.infer<typeof sectionSchema>;

export const docContentSchema = z.object({
  title: text(160).min(1),
  subtitle: text(240).optional(),
  sections: z.array(sectionSchema).min(1).max(30),
});
export type DocContent = z.infer<typeof docContentSchema>;

/** Everything about the document that isn't its body: who, where, which revision. */
export interface DocMeta {
  docNumber: string;
  revision: number;
  issueDate: string;
  reviewDate: string;
  companyName: string;
  companyReg?: string;
  companyAddress?: string;
  preparedBy: string;
  preparedByTitle?: string;
  siteName?: string;
  clientName?: string;
  brandColor: string;
  logo?: { data: Buffer; type: 'image/png' | 'image/jpeg' };
  blueprintName: string;
  revisions: { revision: number; date: string; description: string; by: string }[];
}

/** The standard 14 PDF fonts only cover Windows-1252; replace anything outside it. */
export function pdfSafe(s: string): string {
  return s
    .replace(/[≤]/g, '<=')
    .replace(/[≥]/g, '>=')
    .replace(/[→]/g, '->')
    .replace(/[✓✔]/g, 'Yes')
    .replace(/[ ]/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E¡-ÿ–—‘’“”•…€™]/g, '');
}
