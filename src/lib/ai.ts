/**
 * Server-side proxy to the Claude API. The API key lives only in the server's
 * environment; browsers call /api/ai/*, which checks the caller's plan and
 * monthly allowance before anything is sent to Anthropic.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { FastifyBaseLogger } from 'fastify';
import { config } from '../config.js';
import { one, pool } from '../db/pool.js';
import { HttpError } from './errors.js';

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  client ??= new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 2 });
  return client;
}

// Server-side refusal fallbacks: a declined request is re-run on Anthropic's
// recommended fallback model instead of failing outright.
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'] as Anthropic.Beta.AnthropicBeta[], fallbacks: 'default' as const };

const month = () => new Date().toISOString().slice(0, 7);

/** Reserves one AI request against the organisation's monthly allowance. */
export async function reserveAiRequest(orgId: string): Promise<void> {
  const row = await one<{ requests: number }>(
    pool,
    `insert into ai_usage (org_id, month, requests) values ($1, $2, 1)
     on conflict (org_id, month) do update set requests = ai_usage.requests + 1
     returning requests`,
    [orgId, month()],
  );
  if (row && row.requests > config.AI_MONTHLY_REQUEST_LIMIT) {
    await pool.query('update ai_usage set requests = requests - 1 where org_id = $1 and month = $2', [orgId, month()]);
    throw new HttpError(429, 'ai_limit', `Your organisation has used this month's ${config.AI_MONTHLY_REQUEST_LIMIT} AI requests. The allowance resets on the 1st.`);
  }
}

async function recordTokens(orgId: string, usage: { input_tokens?: number | null; output_tokens?: number | null } | undefined) {
  if (!usage) return;
  await pool.query(
    `update ai_usage set input_tokens = input_tokens + $3, output_tokens = output_tokens + $4 where org_id = $1 and month = $2`,
    [orgId, month(), usage.input_tokens ?? 0, usage.output_tokens ?? 0],
  );
}

export const DRAFT_TYPES = [
  'Site-specific risk assessment',
  'Method statement',
  'Toolbox talk record',
  'Emergency response plan',
  'Daily site diary template',
] as const;

const DRAFT_SYSTEM = `You draft health-and-safety paperwork for contractors working on South African mines and industrial sites.
Write a real, usable first draft that a site supervisor could review and adopt: clear headings, specific hazards and controls for the described job (isolation/lock-out, working at heights, confined space, moving machinery, hot work — whichever apply), responsibilities, and sign-off lines.
Reference the Mine Health and Safety Act 29 of 1996 and its regulations where genuinely relevant, without inventing section numbers you are unsure of.
Output plain text with simple headings — no markdown symbols. End with one line stating that this is a draft for review by a competent person before use.`;

export interface DraftInput {
  type: string;
  brief: string;
  company: { name: string; reg?: string; coid?: string; address?: string };
  preparer: { name: string; title?: string; phone?: string; email?: string };
}

/** Streams a drafted document as plain-text chunks. */
export async function* streamDraft(orgId: string, input: DraftInput, signal: AbortSignal): AsyncGenerator<string> {
  const header = [
    `Company: ${input.company.name}`,
    input.company.reg && `Registration: ${input.company.reg}`,
    input.company.coid && `COID: ${input.company.coid}`,
    input.company.address && `Address: ${input.company.address}`,
    `Prepared by: ${input.preparer.name}${input.preparer.title ? ` (${input.preparer.title})` : ''}`,
    input.preparer.phone && `Phone: ${input.preparer.phone}`,
    input.preparer.email && `Email: ${input.preparer.email}`,
  ]
    .filter(Boolean)
    .join('\n');
  const stream = anthropic().beta.messages.stream(
    {
      model: config.ANTHROPIC_MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      system: DRAFT_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Document type: ${input.type}\n\nJob description (written by the contractor):\n<job>\n${input.brief || 'General site work'}\n</job>\n\nPut this header block at the top, then the document body:\n${header}`,
        },
      ],
      ...FALLBACK,
    },
    { signal },
  );
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') yield event.delta.text;
  }
  const final = await stream.finalMessage();
  await recordTokens(orgId, final.usage);
  if (final.stop_reason === 'refusal') {
    throw new HttpError(422, 'ai_refused', "The AI couldn't draft this document. Try rephrasing the job description.");
  }
}

/**
 * Looks for an expiry / valid-until date on an uploaded certificate. Best
 * effort: any failure simply returns null and the user types the date.
 */
export async function extractExpiryDate(orgId: string, buf: Buffer, contentType: string, log: FastifyBaseLogger): Promise<string | null> {
  if (buf.length > 15 * 1024 * 1024) return null;
  try {
    await reserveAiRequest(orgId);
    const data = buf.toString('base64');
    const source: Anthropic.Beta.BetaContentBlockParam =
      contentType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : { type: 'image', source: { type: 'base64', media_type: contentType as 'image/png' | 'image/jpeg' | 'image/webp', data } };
    const msg = await anthropic().beta.messages.create({
      model: config.ANTHROPIC_MODEL,
      max_tokens: 1024,
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            properties: { expiryDate: { type: ['string', 'null'], description: 'YYYY-MM-DD, or null if no expiry/valid-until/renewal date is shown' } },
            required: ['expiryDate'],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: 'user',
          content: [
            source,
            {
              type: 'text',
              text: 'This is a compliance document (certificate, licence, medical, insurance schedule or inspection tag). If it shows an expiry, valid-until or renewal date, return it. Otherwise return null.',
            },
          ],
        },
      ],
      ...FALLBACK,
    });
    await recordTokens(orgId, msg.usage);
    if (msg.stop_reason !== 'end_turn') return null;
    const text = msg.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return null;
    const parsed = JSON.parse(text.text) as { expiryDate: string | null };
    if (parsed.expiryDate && /^\d{4}-\d{2}-\d{2}$/.test(parsed.expiryDate) && !isNaN(Date.parse(parsed.expiryDate))) {
      return parsed.expiryDate;
    }
    return null;
  } catch (err) {
    if (err instanceof HttpError) return null;
    log.warn({ err: (err as Error).message }, 'expiry extraction failed');
    return null;
  }
}
