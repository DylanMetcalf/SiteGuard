/**
 * What each plan includes, in one place. Routes ask `can(org, feature)` or
 * `requireFeature(ctx, feature)` instead of checking plan names, so plans and
 * prices can change (or new ones be added, e.g. per-file purchases or another
 * currency) without touching the compliance code.
 *
 * Without billing configured nothing is gated: there is nothing to sell.
 */
import { features } from '../config.js';
import { HttpError } from './errors.js';
import { PLANS, hasOwnAccess, planOf, standing, type OrgBilling } from './plans.js';

export type Feature =
  | 'SAFETY_FILE_BUILDER'
  | 'DOCUMENT_STUDIO'
  | 'TOOLBOX_TALKS'
  | 'AUDIT_TRAIL'
  | 'EXPORTS'
  | 'AI_GENERATION'
  | 'SHARE_LINKS'
  | 'MULTI_SITE'
  | 'CONTRACTOR_PROJECTS'
  | 'ADVANCED_COMPLIANCE';

/**
 * What a contractor without its own plan can use, on the files sites sponsor
 * (lib/sponsorship.ts). Everything else needs the contractor's own plan.
 */
export const SPONSORED: Feature[] = ['SAFETY_FILE_BUILDER', 'DOCUMENT_STUDIO', 'TOOLBOX_TALKS', 'AUDIT_TRAIL', 'EXPORTS'];

/** Everyone with a plan or trial gets these; paid plans add the rest. */
const CORE: Feature[] = ['SAFETY_FILE_BUILDER', 'DOCUMENT_STUDIO', 'TOOLBOX_TALKS', 'AUDIT_TRAIL', 'EXPORTS', 'CONTRACTOR_PROJECTS'];

export const PLAN_FEATURES: Record<string, Feature[]> = {
  host_starter: [...CORE, 'MULTI_SITE', 'ADVANCED_COMPLIANCE'],
  host_pro: [...CORE, 'MULTI_SITE', 'ADVANCED_COMPLIANCE', 'AI_GENERATION', 'SHARE_LINKS'],
  host_enterprise: [...CORE, 'MULTI_SITE', 'ADVANCED_COMPLIANCE', 'AI_GENERATION', 'SHARE_LINKS'],
  // No subscription: only what a sponsoring site's files need. Own projects need a plan.
  contractor_free: SPONSORED,
  contractor_starter: [...CORE, 'MULTI_SITE', 'AI_GENERATION'],
  contractor_pro: [...CORE, 'MULTI_SITE', 'AI_GENERATION', 'SHARE_LINKS'],
};

/** Plain-language names for upgrade messages and the billing page. */
export const FEATURE_NAMES: Record<Feature, string> = {
  SAFETY_FILE_BUILDER: 'Safety file builder', DOCUMENT_STUDIO: 'Document Studio', TOOLBOX_TALKS: 'Toolbox talks, inductions and training',
  AUDIT_TRAIL: 'Audit trail', EXPORTS: 'PDF exports', AI_GENERATION: 'AI drafting and expiry detection', SHARE_LINKS: 'External share links',
  MULTI_SITE: 'Multiple sites', CONTRACTOR_PROJECTS: 'Contractor projects', ADVANCED_COMPLIANCE: 'Gate clearance, audits and validity rules',
};

/** Whether the organisation's plan includes a feature right now. */
export function can(org: OrgBilling, feature: Feature): boolean {
  if (feature === 'AI_GENERATION') {
    // AI also needs a key, and stops when an account lapses.
    if (!features.ai || standing(org) === 'lapsed') return false;
  }
  if (!features.billing) return true;
  if (org.kind === 'contractor' && !hasOwnAccess(org)) return SPONSORED.includes(feature);
  return (PLAN_FEATURES[planOf(org).id] ?? CORE).includes(feature);
}

/** The cheapest plan of the organisation's kind that includes the feature, for the upgrade message. */
export function planWith(kind: 'host' | 'contractor', feature: Feature) {
  return Object.values(PLANS).find((p) => p.kind === kind && (PLAN_FEATURES[p.id] ?? []).includes(feature));
}

export function requireFeature(ctx: { org: OrgBilling & { kind: string } }, feature: Feature): void {
  if (can(ctx.org, feature)) return;
  const plan = planWith(ctx.org.kind as 'host' | 'contractor', feature);
  if (ctx.org.kind === 'contractor' && !hasOwnAccess(ctx.org) && plan) {
    throw new HttpError(402, 'plan', `${FEATURE_NAMES[feature]} ${/s$/.test(FEATURE_NAMES[feature]) ? 'need' : 'needs'} your own contractor plan — a site's sponsorship covers only that site's safety file. Start one under Plan & billing (${plan.name} or higher).`);
  }
  const name = FEATURE_NAMES[feature];
  const verb = /s$/.test(name) ? 'are' : 'is';
  throw new HttpError(402, 'plan', plan ? `${name} ${verb} included in ${plan.name}. Upgrade under Plan & billing.` : `${name} ${verb} not included in your plan.`);
}

/** Everything the web app needs to show or hide paid features (it never decides access itself). */
export function entitlementsFor(org: OrgBilling): Record<Feature, boolean> {
  return Object.fromEntries((Object.keys(FEATURE_NAMES) as Feature[]).map((f) => [f, can(org, f)])) as Record<Feature, boolean>;
}
