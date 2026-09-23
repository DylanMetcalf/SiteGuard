/**
 * Server-side authorization. Every route resolves the caller's organisation and
 * role from their session (never from the request body), then asks these
 * helpers whether the action is allowed on the specific record.
 *
 * Records owned by another tenant are reported as 404, not 403, so the API
 * never confirms that something exists in someone else's account.
 */
import type { Db } from '../db/pool.js';
import { one } from '../db/pool.js';
import { features } from '../config.js';
import { forbidden, notFound, paymentRequired, unauthorized } from './errors.js';
import { standing, type OrgKind } from './plans.js';

export type Role = 'owner' | 'admin' | 'reviewer' | 'member';

export interface OrgRow {
  id: string;
  name: string;
  kind: OrgKind;
  reg_number: string;
  coid_number: string;
  vat_number: string;
  address: string;
  trade: string;
  plan: string;
  subscription_status: string;
  trial_ends_at: Date | null;
  seat_limit: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: Date | null;
  settings: Record<string, unknown>;
  is_demo: boolean;
  demo_group: string | null;
  created_at: Date;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  title: string;
  phone: string;
  email_verified_at: Date | null;
  is_demo: boolean;
}

export interface Ctx {
  user: UserRow;
  sessionId: string;
  csrfToken: string;
  org: OrgRow | null;
  role: Role | null;
  /** Set when the session's expiry was extended on this request, so the cookie is re-issued. */
  renewedUntil?: Date;
}

export interface OrgCtx extends Ctx {
  org: OrgRow;
  role: Role;
}

export function requireUser(ctx: Ctx | null): Ctx {
  if (!ctx) throw unauthorized();
  return ctx;
}

export function requireOrg(ctx: Ctx | null): OrgCtx {
  const c = requireUser(ctx);
  if (!c.org || !c.role) throw forbidden('Create or join an organisation first.');
  return c as OrgCtx;
}

/** Blocks writes for organisations whose trial/subscription has lapsed. */
export function requireWritable(ctx: OrgCtx): void {
  if (standing(ctx.org) === 'lapsed') {
    throw paymentRequired(
      "Your organisation's trial or subscription has ended. Everything is still readable; choose a plan under Billing to keep making changes.",
    );
  }
}

export const isHost = (ctx: OrgCtx) => ctx.org.kind === 'host';
export const isContractor = (ctx: OrgCtx) => ctx.org.kind === 'contractor';

const ADMIN_ROLES: Role[] = ['owner', 'admin'];
const REVIEW_ROLES: Role[] = ['owner', 'admin', 'reviewer'];

export const canAdminOrg = (ctx: OrgCtx) => ADMIN_ROLES.includes(ctx.role);
export const canReview = (ctx: OrgCtx) => isHost(ctx) && REVIEW_ROLES.includes(ctx.role);

export function requireAdmin(ctx: OrgCtx): void {
  if (!canAdminOrg(ctx)) throw forbidden('Only organisation owners and admins can do that.');
}
export function requireHostAdmin(ctx: OrgCtx): void {
  if (!isHost(ctx) || !canAdminOrg(ctx)) throw forbidden('Only site-owner admins can do that.');
}
export function requireReviewer(ctx: OrgCtx): void {
  if (!canReview(ctx)) throw forbidden('Only site reviewers can do that.');
}

/** Roles that make sense for each kind of organisation. */
export function rolesFor(kind: OrgKind): Role[] {
  return kind === 'host' ? ['owner', 'admin', 'reviewer', 'member'] : ['owner', 'admin', 'member'];
}

const ROLE_LABELS: Record<OrgKind, Record<Role, string>> = {
  host: { owner: 'Organisation Owner', admin: 'Organisation Admin', reviewer: 'Site Reviewer', member: 'Site Staff' },
  contractor: { owner: 'Contractor Owner', admin: 'Contractor Admin', reviewer: 'Contractor Admin', member: 'Contractor Staff' },
};

export function roleLabel(kind: OrgKind, role: Role): string {
  return ROLE_LABELS[kind][role];
}

/** How the actor is shown on records and in the audit trail. */
export function actorRole(ctx: OrgCtx): string {
  return ctx.user.title || roleLabel(ctx.org.kind, ctx.role);
}

/** The UI persona the client renders for this membership. */
export function uiRole(ctx: OrgCtx): 'admin' | 'reviewer' | 'contractor' | 'viewer' {
  if (isContractor(ctx)) return 'contractor';
  if (ctx.role === 'reviewer') return 'reviewer';
  if (ctx.role === 'member') return 'viewer';
  return 'admin';
}

export interface SiteAccess {
  site: {
    id: string;
    org_id: string;
    name: string;
    location: string;
    contractor_id: string;
    status: 'invited' | 'in_progress' | 'declined' | 'site_ready';
    emergency: Record<string, string>;
    contractor_name: string;
    linked_org_id: string | null;
    host_name: string;
  };
  side: 'host' | 'contractor';
  /** Organisations that should be told when this site changes. */
  parties: string[];
}

/**
 * Resolves a site the caller may act on. Hosts see all their own sites.
 * Contractors see sites assigned to them once they've accepted; invited sites
 * only when `allowInvited` (for accept/decline).
 */
export async function loadSite(
  db: Db,
  ctx: OrgCtx,
  siteId: string,
  opts: { allowInvited?: boolean } = {},
): Promise<SiteAccess> {
  if (!isUuid(siteId)) throw notFound();
  const site = await one<SiteAccess['site']>(
    db,
    `select s.id, s.org_id, s.name, s.location, s.contractor_id, s.status, s.emergency,
            c.name as contractor_name, c.linked_org_id, o.name as host_name
       from sites s
       join contractors c on c.id = s.contractor_id
       join organisations o on o.id = s.org_id
      where s.id = $1 and (s.org_id = $2 or c.linked_org_id = $2)`,
    [siteId, ctx.org.id],
  );
  if (!site) throw notFound();
  const side = site.org_id === ctx.org.id ? 'host' : 'contractor';
  if (side === 'contractor') {
    if (site.status === 'declined') throw notFound();
    if (site.status === 'invited' && !opts.allowInvited) throw notFound();
  }
  const parties = [site.org_id, ...(site.linked_org_id ? [site.linked_org_id] : [])];
  return { site, side, parties };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** Seat and site caps only apply when billing is configured. */
export const limitsEnforced = () => features.billing;
