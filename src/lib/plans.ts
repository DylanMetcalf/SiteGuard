import { config, features } from '../config.js';

export type OrgKind = 'host' | 'contractor';

export interface Plan {
  id: string;
  name: string;
  kind: OrgKind;
  /** Maximum active sites (host plans). null = unlimited. */
  siteLimit: number | null;
  /** Contractor projects (safety files for clients not on SiteGuard). null = unlimited. Only enforced with billing on. */
  projectLimit: number | null;
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
    projectLimit: null,
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
    projectLimit: null,
    defaultSeats: 10,
    maxSeats: 500,
    ai: true,
    paid: true,
    stripePrice: config.STRIPE_PRICE_HOST_PRO,
    blurb: 'Unlimited sites, AI drafting and expiry detection, external share links.',
  },
  contractor_free: {
    id: 'contractor_free',
    name: 'Site-sponsored',
    kind: 'contractor',
    siteLimit: null,
    projectLimit: 0,
    defaultSeats: 3,
    maxSeats: 3,
    ai: false,
    paid: false,
    blurb: 'No subscription: work on the safety files of sites that sponsor you. Your own projects and other clients need a contractor plan.',
  },
  contractor_starter: {
    id: 'contractor_starter',
    name: 'Contractor Starter',
    kind: 'contractor',
    siteLimit: null,
    projectLimit: 5,
    defaultSeats: 3,
    maxSeats: 5,
    ai: true,
    paid: true,
    stripePrice: config.STRIPE_PRICE_CONTRACTOR_STARTER,
    blurb: 'Your own company account: up to 5 of your own safety files at a time, Document Studio with AI drafting, exports.',
  },
  contractor_pro: {
    id: 'contractor_pro',
    name: 'Contractor Pro',
    kind: 'contractor',
    siteLimit: null,
    projectLimit: null,
    defaultSeats: 5,
    maxSeats: 200,
    ai: true,
    paid: true,
    stripePrice: config.STRIPE_PRICE_CONTRACTOR_PRO,
    blurb: 'Unlimited safety files for every client, more seats, AI drafting and expiry detection, external share links.',
  },
  host_enterprise: {
    id: 'host_enterprise',
    name: 'Enterprise',
    kind: 'host',
    siteLimit: null,
    projectLimit: null,
    defaultSeats: 25,
    maxSeats: 5000,
    ai: true,
    paid: true,
    blurb: 'For mining groups: every site, sponsored contractor access, onboarding and an agreed contract. Set up by SiteGuard.',
  },
};

export const TRIAL_DAYS = 14;

/** Everyone starts with the full product for 14 days, no card needed. */
export function defaultPlanFor(kind: OrgKind): { plan: Plan; status: 'trialing'; trialEndsAt: Date } {
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86400_000);
  return { plan: kind === 'host' ? PLANS.host_pro : PLANS.contractor_pro, status: 'trialing', trialEndsAt };
}

export interface OrgBilling {
  plan: string;
  subscription_status: string;
  trial_ends_at: Date | string | null;
  kind?: string;
  /** A plan given by a promo code or an enterprise deal, without a Stripe subscription. */
  grant_plan?: string | null;
  grant_until?: Date | string | null;
  /** Set on contractor sessions: at least one site currently sponsors this contractor. */
  sponsored?: boolean;
}

export function grantActive(org: OrgBilling): boolean {
  return !!org.grant_plan && !!PLANS[org.grant_plan] && (!org.grant_until || new Date(org.grant_until).getTime() > Date.now());
}

/** The plan in force: an active grant wins over the subscription plan. */
export function planOf(org: OrgBilling): Plan {
  if (grantActive(org)) return PLANS[org.grant_plan!];
  return PLANS[org.plan] ?? PLANS.contractor_free;
}

/**
 * Whether the organisation has its own access to the product: a subscription,
 * a trial in date, or a grant. A contractor without it can still work on the
 * files of sites that sponsor it (see lib/sponsorship.ts).
 */
export function hasOwnAccess(org: OrgBilling): boolean {
  if (!features.billing || grantActive(org)) return true;
  switch (org.subscription_status) {
    case 'active':
    case 'past_due':
      return true;
    case 'trialing':
      return !!org.trial_ends_at && new Date(org.trial_ends_at).getTime() > Date.now();
    case 'free':
      return org.kind !== 'contractor';
    default:
      return false;
  }
}

/**
 * Whether the organisation may make changes. A lapsed organisation keeps
 * read access to everything (and to billing), but cannot write.
 */
export function standing(org: OrgBilling): 'ok' | 'grace' | 'lapsed' {
  if (!features.billing || grantActive(org)) return 'ok';
  // A contractor without its own subscription keeps working while a site sponsors it.
  if (org.kind === 'contractor' && !hasOwnAccess(org)) return org.sponsored ? 'ok' : 'lapsed';
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

/** Plans an organisation of the given kind may move to. */
export function plansFor(kind: OrgKind): Plan[] {
  return Object.values(PLANS).filter((p) => p.kind === kind && p.id !== 'host_enterprise');
}
