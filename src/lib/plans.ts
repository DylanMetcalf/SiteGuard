import { config, features } from '../config.js';

export type OrgKind = 'host' | 'contractor';

export interface Plan {
  id: string;
  name: string;
  kind: OrgKind;
  /** Maximum active sites (host plans). null = unlimited. */
  siteLimit: number | null;
  /** Seats given on a fresh org / free plan. Paid plans bill per seat. */
  defaultSeats: number;
  maxSeats: number;
  ai: boolean;
  paid: boolean;
  /** Stripe Price id (per-seat, recurring). */
  stripePrice?: string;
  blurb: string;
}

export const PLANS: Record<string, Plan> = {
  host_starter: {
    id: 'host_starter',
    name: 'Site Starter',
    kind: 'host',
    siteLimit: 5,
    defaultSeats: 5,
    maxSeats: 25,
    ai: false,
    paid: true,
    stripePrice: config.STRIPE_PRICE_HOST_STARTER,
    blurb: 'Up to 5 active sites. Compliance, permits, incidents, audit trail.',
  },
  host_pro: {
    id: 'host_pro',
    name: 'Site Professional',
    kind: 'host',
    siteLimit: null,
    defaultSeats: 10,
    maxSeats: 500,
    ai: true,
    paid: true,
    stripePrice: config.STRIPE_PRICE_HOST_PRO,
    blurb: 'Unlimited sites, AI drafting and expiry detection, external share links.',
  },
  contractor_free: {
    id: 'contractor_free',
    name: 'Contractor Free',
    kind: 'contractor',
    siteLimit: null,
    defaultSeats: 3,
    maxSeats: 3,
    ai: false,
    paid: false,
    blurb: 'Respond to site invitations and submit safety files. Always free.',
  },
  contractor_pro: {
    id: 'contractor_pro',
    name: 'Contractor Pro',
    kind: 'contractor',
    siteLimit: null,
    defaultSeats: 5,
    maxSeats: 200,
    ai: true,
    paid: true,
    stripePrice: config.STRIPE_PRICE_CONTRACTOR_PRO,
    blurb: 'More seats, AI document drafting, expiry detection and share links.',
  },
};

export const TRIAL_DAYS = 14;

export function defaultPlanFor(kind: OrgKind): { plan: Plan; status: 'trialing' | 'free'; trialEndsAt: Date | null } {
  if (kind === 'host') {
    return { plan: PLANS.host_pro, status: 'trialing', trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 86400_000) };
  }
  return { plan: PLANS.contractor_free, status: 'free', trialEndsAt: null };
}

export function planOf(org: { plan: string }): Plan {
  return PLANS[org.plan] ?? PLANS.contractor_free;
}

export interface OrgBilling {
  plan: string;
  subscription_status: string;
  trial_ends_at: Date | string | null;
}

/**
 * Whether the organisation may make changes. A lapsed organisation keeps
 * read access to everything (and to billing), but cannot write.
 */
export function standing(org: OrgBilling): 'ok' | 'grace' | 'lapsed' {
  if (!features.billing) return 'ok';
  switch (org.subscription_status) {
    case 'active':
    case 'free':
      return 'ok';
    case 'past_due':
      return 'grace';
    case 'trialing':
      return org.trial_ends_at && new Date(org.trial_ends_at).getTime() > Date.now() ? 'ok' : 'lapsed';
    default:
      return 'lapsed';
  }
}

export function aiAllowed(org: OrgBilling): boolean {
  // Without billing configured there is nothing to upsell, so don't gate by plan.
  return features.ai && (!features.billing || planOf(org).ai) && standing(org) !== 'lapsed';
}

/** Plans an organisation of the given kind may move to. */
export function plansFor(kind: OrgKind): Plan[] {
  return Object.values(PLANS).filter((p) => p.kind === kind);
}
