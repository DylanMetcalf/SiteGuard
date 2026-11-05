/**
 * Guided set-up: the steps a new organisation goes through before the app opens, and whether each is done.
 * Only "required" steps block the app; recommended and optional ones are shown afterwards as suggestions.
 * The answers are kept (organisations.onboarding and the real records they create), so set-up can be revisited.
 */
import type { Db } from '../db/pool.js';
import { one } from '../db/pool.js';

export type StepId = 'organisation' | 'contact' | 'services' | 'site' | 'areas' | 'documents' | 'connect';
export type Need = 'required' | 'recommended' | 'optional';
export interface StepDef { id: StepId; title: string; why: string; need: Need }

const HOST: StepDef[] = [
  { id: 'organisation', title: 'Your organisation', need: 'required', why: 'Your company name and details appear on documents, invitations and what contractors see.' },
  { id: 'contact', title: 'Safety contact', need: 'required', why: 'Contractors and COMVERA need one named person to contact about safety files.' },
  { id: 'site', title: 'Your first site', need: 'required', why: 'Contractors file their safety documents against a site. You can add more sites later.' },
  { id: 'areas', title: 'Departments and areas', need: 'optional', why: 'If a site has departments or operational areas (for example Plant or Shaft 2), documents can be tied to them.' },
  { id: 'documents', title: 'Your site documents', need: 'required', why: 'Policies, procedures, site rules and templates you already have. Uploading them is optional; we only need to know your answer.' },
];
const CONTRACTOR: StepDef[] = [
  { id: 'organisation', title: 'Your company', need: 'required', why: 'Your company details go on every safety file and document you send.' },
  { id: 'services', title: 'What you do', need: 'required', why: 'Sites see your trade and services, and COMVERA suggests the documents that kind of work usually needs.' },
  { id: 'contact', title: 'Safety contact', need: 'required', why: 'The person sites should contact about your safety files.' },
  { id: 'documents', title: 'Your company documents', need: 'required', why: 'Registration, insurance, policies and certificates you already have. Uploading them is optional; we only need to know your answer.' },
  { id: 'connect', title: 'Connect to a site', need: 'optional', why: 'If a site gave you a site code, join it now. Otherwise sites will invite you by email.' },
];
export const stepsFor = (kind: string) => (kind === 'host' ? HOST : CONTRACTOR);

type Answers = { phone?: string; contact?: { name?: string; role?: string; phone?: string; email?: string };
  services?: string; industries?: string[]; documents?: 'yes' | 'no' | 'later'; areasSkipped?: boolean; connectSkipped?: boolean };

export async function onboardingStatus(db: Db, org: { id: string; kind: string; name: string; trade?: string; onboarding?: unknown; onboarding_completed_at?: unknown }) {
  const a = (org.onboarding ?? {}) as Answers;
  const counts = await one<{ workplaces: number; areas: number; docs: number; joined: number }>(db,
    `select (select count(*) from workplaces where org_id = $1 and archived_at is null)::int as workplaces,
            (select count(*) from site_areas where org_id = $1)::int as areas,
            (select count(*) from org_documents where org_id = $1 and archived_at is null)::int as docs,
            (select count(*) from contractors c join sites s on s.contractor_id = c.id where c.linked_org_id = $1 and s.status <> 'declined')::int as joined`, [org.id]);
  const c = counts ?? { workplaces: 0, areas: 0, docs: 0, joined: 0 };
  const done: Record<StepId, boolean> = {
    organisation: !!org.name?.trim() && !!a.phone?.trim(),
    contact: !!a.contact?.name?.trim() && !!(a.contact?.phone?.trim() || a.contact?.email?.trim()),
    services: !!(org.trade ?? '').trim(),
    site: c.workplaces > 0,
    areas: c.areas > 0 || !!a.areasSkipped,
    documents: !!a.documents,
    connect: c.joined > 0 || !!a.connectSkipped,
  };
  const steps = stepsFor(org.kind).map((s) => ({ ...s, done: done[s.id] }));
  const missing = steps.filter((s) => s.need === 'required' && !s.done);
  return { steps, answers: a, counts: c, canComplete: missing.length === 0, missing: missing.map((s) => s.title), completedAt: org.onboarding_completed_at ?? null };
}

/** Set-up still to do: the app stays closed (apart from set-up itself) until it is finished. Demo sandboxes skip it. */
export const mustOnboard = (ctx: { org: { onboarding_completed_at?: unknown; is_demo?: boolean } | null }) =>
  !!ctx.org && !ctx.org.onboarding_completed_at && !ctx.org.is_demo;
