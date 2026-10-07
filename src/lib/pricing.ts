/**
 * What the public pricing page shows. The platform admin edits it (More → Platform);
 * these defaults apply until then. Prices are display-only: what a customer is
 * charged is the Stripe price configured for the plan.
 *
 * Defaults are proposals set against the market in Oct 2026: online safety-file
 * generators sell single files from about R400–R500, specialist-compiled files
 * cost roughly R2,000 to R10,000, and a traditionally prepared file is about R5,000.
 * A contractor subscription should cost less per month than one prepared file.
 */
import type { Db } from '../db/pool.js';
import { many } from '../db/pool.js';
import { PLANS } from './plans.js';

export interface PlanPrice {
  planId: string;
  priceCents: number | null;
  currency: string;
  per: string;
  blurb: string | null;
  highlights: string[];
  visible: boolean;
}

export const DEFAULT_PRICING: Record<string, Omit<PlanPrice, 'planId'>> = {
  contractor_starter: { priceCents: 39900, currency: 'ZAR', per: 'month', blurb: null, visible: true,
    highlights: ['Your own safety files for up to 5 clients at a time', 'Document Studio with AI drafting', 'Expiry reminders', 'Up to 5 people'] },
  contractor_pro: { priceCents: 89900, currency: 'ZAR', per: 'month', blurb: null, visible: true,
    highlights: ['Unlimited safety files and clients', 'Secure share links for clients', 'AI drafting and expiry detection', 'Up to 200 people'] },
  host_starter: { priceCents: 249900, currency: 'ZAR', per: 'month', blurb: null, visible: true,
    highlights: ['Up to 5 active sites', 'Sponsored access for your contractors', 'Gate clearance, audits and validity rules', 'Permits, incidents and audit trail'] },
  host_pro: { priceCents: 599900, currency: 'ZAR', per: 'month', blurb: null, visible: true,
    highlights: ['Unlimited sites', 'Sponsored access for your contractors', 'AI drafting and expiry detection', 'External share links'] },
  host_enterprise: { priceCents: null, currency: 'ZAR', per: 'month', blurb: null, visible: true,
    highlights: ['Every site in your group', 'Onboarding for your contractors', 'Agreed terms and invoicing', 'Priority support'] },
};

/** Plans in pricing-page order with their display prices (admin edits applied). */
export async function pricingTable(db: Db): Promise<(PlanPrice & { name: string; kind: string; defaultBlurb: string })[]> {
  const rows = await many<{ plan_id: string; price_cents: number | null; currency: string; per: string; blurb: string | null; highlights: string[]; visible: boolean }>(
    db, 'select plan_id, price_cents, currency, per, blurb, highlights, visible from plan_settings',
  );
  const byId = new Map(rows.map((r) => [r.plan_id, r]));
  return Object.keys(DEFAULT_PRICING).map((planId) => {
    const d = DEFAULT_PRICING[planId];
    const r = byId.get(planId);
    const plan = PLANS[planId];
    return {
      planId, name: plan.name, kind: plan.kind, defaultBlurb: plan.blurb,
      priceCents: r ? r.price_cents : d.priceCents,
      currency: r?.currency ?? d.currency,
      per: r?.per ?? d.per,
      blurb: r?.blurb ?? d.blurb,
      highlights: r && r.highlights.length ? r.highlights : d.highlights,
      visible: r ? r.visible : d.visible,
    };
  });
}
