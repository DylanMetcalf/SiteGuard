/**
 * Document Studio blueprints. Each blueprint asks a few questions and builds a
 * complete, professionally structured document from the answers plus
 * SiteGuard's work-type knowledge. The AI (when configured) starts from this
 * draft and tailors it; without a key this draft is the document.
 *
 * Content is original, written to the structure SHE departments expect
 * (purpose, scope, legal requirements, responsibilities, procedure, controls,
 * records, review, sign-off). Legal references are limited to ones we are
 * confident of; every document says to confirm requirements with the site.
 * A practical starting point, not legal advice.
 */
import type { Block, DocContent, Section } from './model.js';
import { HAZARD_CONTROLS, hazardsFor, matchProfiles, TOOLS, WORK_PROFILES, type Tool } from '../knowledge.js';

/** 'checks' is a tick-box list; the answer is the ticked options joined by '; '. */
export type FieldType = 'text' | 'textarea' | 'lines' | 'date' | 'select' | 'checks';
export interface Field {
  id: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: string[];
}

export interface BuildInput {
  values: Record<string, string>;
  company: { name: string; reg?: string; address?: string; coid?: string };
  preparer: { name: string; title?: string };
  site?: { name: string; location?: string; clientName?: string; emergency?: Record<string, string> };
}

export interface Blueprint {
  id: string;
  code: string;
  name: string;
  category: Category;
  description: string;
  /** Requirement names this blueprint satisfies (matched case-insensitively). */
  matches: RegExp;
  fields: Field[];
  reviewMonths: number;
  /** What the AI must keep and improve, beyond the shared rules. */
  guidance: string;
  build(input: BuildInput): DocContent;
}

export const CATEGORIES = [
  'Plans & policies',
  'Risk assessments',
  'Procedures',
  'Emergency',
  'Appointments & agreements',
  'Toolbox & training',
  'Registers & checklists',
] as const;
export type Category = (typeof CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const v = (i: BuildInput, id: string, fallback = '') => (i.values[id] ?? '').trim() || fallback;
const lines = (s: string) => s.split(/\r?\n|;\s*/).map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim()).filter(Boolean);
const para = (text: string): Block => ({ type: 'paragraph', text });
const bullets = (items: string[]): Block => ({ type: 'bullets', items });
const numbered = (items: string[]): Block => ({ type: 'numbered', items });
const note = (text: string): Block => ({ type: 'note', text });
const sec = (heading: string, ...blocks: Block[]): Section => ({ heading, blocks });
/** "Name, Location", without repeating a location the name already contains. */
export function joinSite(name: string, location?: string): string {
  if (!location) return name;
  const words = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const inName = new Set(words(name));
  return words(location).every((w) => inName.has(w)) ? name : `${name}, ${location}`;
}
const siteLabel = (i: BuildInput) => (i.site ? joinSite(i.site.name, i.site.location) : v(i, 'site', 'the site'));
const clientLabel = (i: BuildInput) => i.site?.clientName || v(i, 'client', 'the client');
const scopeText = (i: BuildInput) => v(i, 'scope', v(i, 'task', 'the work described in this document'));
/** The scope plus any work activities ticked: what hazards, controls, PPE and permits are worked out from. */
const workText = (i: BuildInput) => [scopeText(i), v(i, 'activities')].filter(Boolean).join('; ');
const activityField: Field = {
  id: 'activities', label: 'Work activities (tick all that apply)', type: 'checks', options: WORK_PROFILES.map((p) => p.label),
  help: 'Each activity adds its hazards, controls, PPE and permits. SiteGuard also picks them up from the scope of work.',
};
const toolsField: Field = {
  id: 'tools', label: 'Tools and equipment (tick all that will be used)', type: 'checks', options: TOOLS.map((t) => t.label),
  help: 'Each tool adds its own hazards and controls, PPE and pre-use check.',
};
/** The tools ticked, in library order. */
const toolsOf = (i: BuildInput) => {
  const picked = v(i, 'tools').split(';').map((x) => x.trim()).filter(Boolean);
  return TOOLS.filter((t) => picked.includes(t.label));
};

const LEGAL_CORE = [
  'Occupational Health and Safety Act 85 of 1993 (OHS Act), including section 8 (general duties of employers) and section 37(2) (agreements with mandataries)',
  'Mine Health and Safety Act 29 of 1996 (MHSA) and its regulations, where the work is on a mine',
  'Construction Regulations, 2014, where the work is construction work',
  'Compensation for Occupational Injuries and Diseases Act 130 of 1993 (COIDA)',
  "The client's SHE specification, site rules and standards for contractors",
];

const CONFIRM = "Legal references are a guide. Confirm the applicable requirements with the client's SHE department before work starts; site-specific standards take precedence.";

function purposeScope(i: BuildInput, purpose: string): Section[] {
  return [
    sec('Purpose', para(purpose)),
    sec('Scope', para(`This document applies to all ${i.company.name} employees, subcontractors and visitors involved in ${scopeText(i)} at ${siteLabel(i)} for ${clientLabel(i)}.`)),
  ];
}

function legalSection(extra: string[] = []): Section {
  return sec('Legal and other requirements', bullets([...LEGAL_CORE, ...extra]), note(CONFIRM));
}

function responsibilities(i: BuildInput, rows: [string, string][]): Section {
  return sec('Responsibilities', {
    type: 'table',
    columns: ['Role', 'Responsibility'],
    widths: [1, 3],
    rows: [
      ['Chief Executive Officer (OHS Act s16(1))', `Accountable for health and safety at ${i.company.name}; provides resources and approves this document.`],
      ...rows,
      ['All employees', 'Follow this document, use the PPE provided, report hazards and incidents immediately, and stop work when it is unsafe to continue.'],
    ],
  });
}

function recordsReview(i: BuildInput, records: string[], months: number): Section[] {
  return [
    sec('Records', bullets([...records, 'Records are kept for at least the period the client and the law require, and are available to the client on request. SiteGuard holds the electronic copy and its revision history.'])),
    sec('Review', para(`This document is reviewed at least every ${months} months, and immediately after an incident, a change in the work method, equipment, legislation or site requirements. Changes are recorded in the revision history.`)),
  ];
}

function signOff(): Section {
  return sec('Approval and sign-off', { type: 'signatures', roles: ['Prepared by', 'Reviewed by (SHE)', 'Approved by (CEO / Manager)', 'Accepted by (Client representative)'] });
}

/**
 * Likelihood × consequence scoring. Companies use different matrices, so the size is a
 * choice (5×5 by default); ratings are judged on a 1–5 scale and scaled to the chosen size.
 */
export const MATRIX_SIZES: Record<string, number> = { '5×5 (scores 1–25)': 5, '4×4 (scores 1–16)': 4, '3×3 (scores 1–9)': 3 };
const band = (s: number, n: number) => (s >= Math.round(0.6 * n * n) ? 'High' : s >= Math.round(0.32 * n * n) ? 'Medium' : 'Low');
function rate(l: number, c: number, n = 5) {
  const sl = Math.max(1, Math.ceil((l * n) / 5)), sc = Math.max(1, Math.ceil((c * n) / 5));
  const s = sl * sc;
  return { score: s, label: band(s, n) };
}
const L_NAMES: Record<number, string[]> = { 5: ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'], 4: ['Unlikely', 'Possible', 'Likely', 'Almost certain'], 3: ['Unlikely', 'Possible', 'Likely'] };
const C_NAMES: Record<number, string[]> = { 5: ['Insignificant', 'Minor', 'Moderate', 'Major', 'Catastrophic'], 4: ['Minor', 'Moderate', 'Major', 'Catastrophic'], 3: ['Minor', 'Serious', 'Major'] };
function matrixBlock(n: number): Block {
  const rows: string[][] = [];
  for (let l = n; l >= 1; l--) rows.push([`${l} ${L_NAMES[n][l - 1]}`, ...Array.from({ length: n }, (_, k) => { const s = l * (k + 1); return `${s} ${band(s, n)}`; })]);
  return { type: 'table', columns: ['Likelihood \\ Consequence', ...C_NAMES[n].map((c, k) => `${k + 1} ${c}`)], rows };
}
const matrixField: Field = { id: 'matrix', label: 'Risk matrix your company uses', type: 'select', options: Object.keys(MATRIX_SIZES) };
const matrixOf = (i: BuildInput) => MATRIX_SIZES[v(i, 'matrix')] ?? 5;
const SEVERE = /from height|falling objects|electr|arc flash|engulf|oxygen|toxic|explos|fire|collapse|struck|crush|entangle|dropped|swinging|overturn|fall of ground|power lines|re-energis|flammable gas/i;

function hazardTable(text: string, owner: string, tools: Tool[] = [], n = 5): Block {
  const { hazards } = hazardsFor(text);
  // Work hazards first, then each ticked tool's own, without repeats.
  const pairs: [string, string][] = hazards.slice(0, 16).map((h) => [h, HAZARD_CONTROLS[h] ?? 'Controls to be defined by the risk assessment team.']);
  for (const t of tools) for (const [h, c] of t.hazards) if (!pairs.some(([x]) => x === h)) pairs.push([`${h} (${t.label.toLowerCase()})`, c]);
  const rows = pairs.slice(0, 40).map(([h, control], n) => {
    const c = SEVERE.test(h) ? 5 : 3;
    const before = rate(SEVERE.test(h) ? 4 : 3, c, n);
    const after = rate(SEVERE.test(h) ? 2 : 1, c, n);
    return [String(n + 1), h, `${before.score} ${before.label}`, control, `${after.score} ${after.label}`, owner];
  });
  return { type: 'table', columns: ['#', 'Hazard / risk', 'Inherent risk', 'Controls', 'Residual risk', 'Responsible'], widths: [0.4, 2, 1, 3.2, 1, 1.2], rows };
}


const PPE_BASE = ['Hard hat', 'Safety boots (steel toe)', 'High-visibility vest or reflective clothing', 'Safety glasses', 'Hearing protection where noise exceeds 85 dB(A)', 'Gloves suited to the task'];
function ppeFor(text: string, tools: Tool[] = []): string[] {
  const extra: string[] = [];
  for (const t of tools) for (const p of t.ppe) if (!extra.includes(p)) extra.push(`${p} (${t.label.toLowerCase()})`);
  const ids = matchProfiles(text).map((p) => p.id);
  if (ids.includes('electrical')) extra.push('Arc-rated clothing and face shield rated for the fault level; insulated gloves');
  if (ids.includes('heights')) extra.push('Full-body harness with double shock-absorbing lanyards');
  if (ids.includes('hot')) extra.push('Welding helmet or face shield, leather apron and gauntlets, flame-retardant overalls');
  if (ids.includes('confined')) extra.push('Personal gas monitor; respiratory protection as the atmosphere test requires');
  if (ids.includes('chemicals')) extra.push('Chemical-resistant gloves, goggles and respirator as the SDS requires');
  if (ids.includes('underground')) extra.push('Cap lamp and self-contained self-rescuer (SCSR)');
  return [...PPE_BASE, ...extra];
}

function emergencyBlocks(i: BuildInput): Block[] {
  const e = i.site?.emergency ?? {};
  return [
    { type: 'fields', items: [
      ['Emergency number', e.contact || v(i, 'emergencyNumber', 'Site emergency number: __________')],
      ['Assembly / muster point', e.musterPoint || v(i, 'musterPoint', '__________')],
      ['Nearest medical facility', e.hospital || v(i, 'hospital', '__________')],
      ['First aider on site', v(i, 'firstAider', '__________')],
    ] },
  ];
}

// ---------------------------------------------------------------------------
// Blueprints
// ---------------------------------------------------------------------------

const common = {
  site: { id: 'site', label: 'Site / project', type: 'text', placeholder: 'e.g. Leeuwpan Colliery — Shaft 3 conveyor', help: 'Filled in for you when you start from a site.' } as Field,
  scope: { id: 'scope', label: 'Scope of work', type: 'textarea', required: true, placeholder: 'e.g. Replace conveyor idlers and weld a new guard on the Shaft 3 gantry, working at height' } as Field,
  supervisor: { id: 'supervisor', label: 'Site supervisor', type: 'text', placeholder: 'Name and phone' } as Field,
  safetyOfficer: { id: 'safetyOfficer', label: 'Safety officer', type: 'text', placeholder: 'Name and phone' } as Field,
};

const hsePolicy: Blueprint = {
  id: 'hse-policy', code: 'HSP', name: 'Health & Safety Policy', category: 'Plans & policies',
  description: 'Your signed commitment to health and safety, as sites expect from every contractor.',
  matches: /health\s*&?\s*(and)?\s*safety policy|she policy/i, reviewMonths: 12,
  fields: [
    { id: 'ceo', label: 'CEO / managing director', type: 'text', required: true, placeholder: 'Full name' },
    { id: 'activities', label: 'What your company does', type: 'textarea', placeholder: 'e.g. Electrical installation and maintenance on mines and industrial plants' },
    { id: 'commitments', label: 'Anything specific you commit to (optional)', type: 'lines', placeholder: 'One per line, e.g. Zero harm to people and the environment' },
  ],
  guidance: 'A one-to-two page signed policy statement. Keep it specific to the company activities; avoid generic filler.',
  build(i) {
    const extra = lines(v(i, 'commitments'));
    return {
      title: 'Health and Safety Policy',
      subtitle: i.company.name,
      sections: [
        sec('Policy statement', para(`${i.company.name} ${v(i, 'activities') ? `(${v(i, 'activities')}) ` : ''}believes that every person who works for us or with us must go home unharmed at the end of every shift. Health and safety is part of how we plan, price and carry out every job, and it is the responsibility of every manager and employee.`)),
        sec('Our commitments', bullets([
          'Comply with the Occupational Health and Safety Act 85 of 1993, the Mine Health and Safety Act 29 of 1996 where applicable, their regulations, and every client\'s site rules.',
          'Identify hazards and assess risks before work starts, and control them using the hierarchy of controls: eliminate, substitute, engineer, administer, then protect with PPE.',
          'Provide competent supervision, training and the right tools, equipment and PPE at no cost to employees.',
          'Consult employees and health and safety representatives, and give every worker the right to stop unsafe work without fear of victimisation.',
          'Report and investigate incidents and near misses, learn from them, and share the lessons.',
          'Monitor medical fitness and look after the health and wellbeing of our people.',
          'Protect the environment and the communities around the sites where we work.',
          'Set objectives, measure our performance and continually improve.',
          ...extra,
        ])),
        sec('Accountability', para(`The Chief Executive Officer is accountable for this policy in terms of section 16(1) of the OHS Act and assigns duties in writing under section 16(2). Managers and supervisors are responsible for putting it into practice on every site. Every employee is expected to follow it.`)),
        sec('Communication and review', para('This policy is displayed at our offices and on site, explained at induction, and reviewed every year or when our activities change.')),
        sec('Signed', { type: 'signatures', roles: [`Chief Executive Officer — ${v(i, 'ceo', 'Name')}`] }),
      ],
    };
  },
};

const shePlan: Blueprint = {
  id: 'she-plan', code: 'SHEP', name: 'Contractor SHE Plan', category: 'Plans & policies',
  description: "How you'll manage safety, health and environment on this job, aligned to the client's SHE specification.",
  matches: /she plan|safety plan|health and safety plan|h&s plan/i, reviewMonths: 12,
  fields: [common.site, common.scope,
    { id: 'duration', label: 'Duration', type: 'text', placeholder: 'e.g. 6 weeks from 1 November 2026' },
    { id: 'workforce', label: 'Workforce on site', type: 'text', placeholder: 'e.g. 1 supervisor, 2 electricians, 4 assistants' },
    common.supervisor, common.safetyOfficer,
    { id: 'equipment', label: 'Main plant and equipment', type: 'lines', placeholder: 'One per line, e.g. Mobile scaffold, arc welder, 10 t mobile crane' }],
  guidance: 'A full SHE plan structured to typical mine SHE specifications. Tailor hazards, controls, training and monitoring to the scope.',
  build(i) {
    const scope = scopeText(i);
    const { profiles, permits } = hazardsFor(scope);
    return {
      title: 'Contractor Safety, Health and Environment Plan',
      subtitle: `${scope} — ${siteLabel(i)}`,
      sections: [
        ...purposeScope(i, `To set out how ${i.company.name} will manage safety, health and the environment for this scope, in line with the client's SHE specification.`),
        sec('Project information', { type: 'fields', items: [
          ['Client', clientLabel(i)], ['Site', siteLabel(i)], ['Scope of work', scope], ['Duration', v(i, 'duration', 'As per contract')],
          ['Workforce', v(i, 'workforce', 'As per the approved workforce list')], ['Work types', profiles.map((p) => p.label).join(', ') || 'General site work'],
        ] }),
        legalSection(),
        responsibilities(i, [
          ['Contracts / site manager', `Plans the work, allocates resources and ensures this plan is implemented at ${siteLabel(i)}.`],
          ['Site supervisor', `${v(i, 'supervisor', 'Appointed in writing')}. Briefs the crew daily, checks permits and controls, and stops unsafe work.`],
          ['Safety officer', `${v(i, 'safetyOfficer', 'Appointed in writing')}. Inspects, audits, keeps records and advises on compliance.`],
        ]),
        sec('Legal appointments', bullets(['Section 16(2) assignee (OHS Act)', 'Site supervisor / construction supervisor where Construction Regulations apply', 'Safety officer', 'First aider(s)', 'Risk assessor', ...(profiles.some((p) => p.id === 'heights') ? ['Fall protection plan developer'] : []), ...(profiles.some((p) => p.id === 'lifting') ? ['Lifting supervisor / rigger'] : [])])),
        sec('Risk management', para('A baseline risk assessment is completed before mobilisation and reviewed daily through pre-task risk assessments. Method statements are prepared for every high-risk task.'), hazardTable(scope, 'Supervisor')),
        sec('Permits to work', permits.length ? bullets(permits.map((p) => `${p} permit, issued by the client's authorised person before work starts`)) : para('Confirm with the client whether any permit to work applies to this scope.')),
        sec('Plant and equipment', bullets(lines(v(i, 'equipment')).length ? lines(v(i, 'equipment')).map((e) => `${e} — inspected before use and recorded on the inspection register`) : ['All plant and equipment is inspected before it comes on site and before each use, and recorded on the inspection register.'])),
        sec('Competence, training and medical fitness', bullets(['Every worker holds a valid medical certificate of fitness for the work.', "Every worker completes the client's site induction before starting.", 'Task-specific training and competency certificates are kept for each worker (competency matrix).', 'Daily toolbox talks cover the day\'s hazards and controls; attendance is signed.'])),
        sec('Personal protective equipment', bullets(ppeFor(scope)), para('PPE is issued free of charge and recorded on the PPE issue register.')),
        sec('Emergency preparedness', para("We follow the client's emergency response plan. Every worker knows the assembly point and emergency number."), ...emergencyBlocks(i)),
        sec('Incident reporting', numbered(['Make the area safe and provide first aid.', 'Report the incident to the supervisor and the client immediately.', "Record it in SiteGuard the same shift and preserve the scene until released.", 'Investigate, find the root cause and implement corrective actions.', 'Report to the authorities where the law requires (OHS Act s24; MHSA on mines).'])),
        sec('Environmental management', bullets(['Keep work areas clean; separate and dispose of waste at designated points.', 'Store fuels and chemicals in bunded areas with spill kits available.', 'Control dust and noise; report any spill immediately.'])),
        sec('Monitoring and inspections', bullets(['Daily pre-task risk assessment and toolbox talk', 'Weekly SHE inspection by the safety officer', 'Monthly SHE report to the client', 'Planned task observations by supervisors'])),
        ...recordsReview(i, ['Risk assessments and method statements', 'Permits', 'Toolbox talk attendance', 'Inspection registers', 'Incident reports', 'Training and medical records'], 12),
        signOff(),
      ],
    };
  },
};

const riskAssessment: Blueprint = {
  id: 'risk-assessment', code: 'RA', name: 'Site-specific Risk Assessment', category: 'Risk assessments',
  description: 'Hazard identification and risk assessment (HIRA) with your company\'s risk matrix (5×5, 4×4 or 3×3) and controls for the job.',
  matches: /risk assessment|hira|baseline risk/i, reviewMonths: 12,
  fields: [common.site, common.scope, activityField, toolsField, matrixField,
    { id: 'steps', label: 'Main steps of the job (optional)', type: 'lines', placeholder: 'One per line, e.g. Isolate conveyor; Erect scaffold; Remove idlers…' },
    { id: 'team', label: 'Risk assessment team', type: 'text', placeholder: 'e.g. J. Dlamini (supervisor), P. Naidoo (safety officer)' }],
  guidance: 'A HIRA: every hazard linked to the job steps, realistic inherent and residual ratings on the 5×5 matrix, specific controls following the hierarchy of controls. Include at least 8 hazards.',
  build(i) {
    const scope = scopeText(i);
    const work = workText(i);
    const tools = toolsOf(i);
    const steps = lines(v(i, 'steps'));
    const n = matrixOf(i);
    const { profiles } = hazardsFor(work);
    return {
      title: 'Site-specific Risk Assessment',
      subtitle: `${scope} — ${siteLabel(i)}`,
      sections: [
        ...purposeScope(i, 'To identify the hazards of this job, assess their risks and set controls that reduce them to an acceptable level before work starts.'),
        sec('Assessment details', { type: 'fields', items: [['Task', scope], ['Site', siteLabel(i)], ['Work types identified', profiles.map((p) => p.label).join(', ') || 'General site work'], ['Assessment team', v(i, 'team', i.preparer.name)]] }),
        legalSection(['Construction Regulations, 2014, regulation 9 (risk assessment), where applicable']),
        sec('Method', para(`Each hazard is rated for likelihood (1–${n}) and consequence (1–${n}) on a ${n}×${n} matrix, before controls (inherent risk) and after controls (residual risk). Controls follow the hierarchy: elimination, substitution, engineering, administrative controls, then PPE. No task may start while a residual risk is High. Ratings are a starting point for the assessment team to confirm.`), matrixBlock(n)),
        ...(steps.length ? [sec('Job steps', numbered(steps))] : []),
        sec('Hazard identification and risk register', hazardTable(work, 'Supervisor', tools, n)),
        ...(tools.length ? [sec('Tools and equipment', { type: 'table', columns: ['Tool / equipment', 'Check before use'], widths: [1.4, 3], rows: tools.map((t) => [t.label, t.inspection]) } as Block)] : []),
        sec('Personal protective equipment', bullets(ppeFor(work, tools))),
        sec('Communication', para('This risk assessment is explained to every worker at a toolbox talk before the job starts and whenever it changes. Workers sign the attendance register to confirm they understand it.')),
        ...recordsReview(i, ['Signed risk assessment', 'Toolbox talk attendance for this assessment'], 12),
        signOff(),
      ],
    };
  },
};

const methodStatement: Blueprint = {
  id: 'method-statement', code: 'MS', name: 'Method Statement / Safe Work Procedure', category: 'Procedures',
  description: 'Step-by-step description of how the job will be done safely, with plant, PPE and permits.',
  matches: /method statement|safe work procedure|swp/i, reviewMonths: 12,
  fields: [common.site, common.scope, activityField, toolsField,
    { id: 'steps', label: 'Sequence of work', type: 'lines', placeholder: 'One step per line. Leave blank for a standard sequence.' },
    { id: 'equipment', label: 'Plant, tools and equipment', type: 'lines', placeholder: 'One per line' },
    common.supervisor],
  guidance: 'A practical method statement a supervisor can brief from: detailed sequence of work with the control at each step, plant and PPE, permits, hold points and emergency arrangements.',
  build(i) {
    const scope = scopeText(i);
    const work = workText(i);
    const { permits, profiles } = hazardsFor(work);
    const tools = toolsOf(i);
    const typedEquipment = lines(v(i, 'equipment'));
    const steps = lines(v(i, 'steps'));
    const seq = steps.length ? steps : [
      "Obtain the required permit(s) from the client's authorised person and sign on to the site register.",
      'Hold a toolbox talk on this method statement and the risk assessment; every worker signs.',
      'Inspect tools, plant and PPE; remove anything defective and tag it out.',
      'Barricade and sign the work area; confirm access and escape routes are clear.',
      ...(profiles.some((p) => ['electrical', 'machinery'].includes(p.id)) ? ['Isolate, lock out and tag every energy source; test for dead before work starts.'] : []),
      ...(profiles.some((p) => p.id === 'heights') ? ['Erect and inspect scaffolding or access equipment; confirm it is tagged safe for use.'] : []),
      'Carry out the work as planned, with the supervisor present for high-risk steps.',
      'Inspect the completed work and test where required.',
      'Remove barricades, clean up, return the area and close out the permit(s).',
    ];
    return {
      title: 'Method Statement and Safe Work Procedure',
      subtitle: `${scope} — ${siteLabel(i)}`,
      sections: [
        ...purposeScope(i, 'To describe how this job will be carried out safely, in the correct sequence, with the right controls at each step.'),
        legalSection(),
        responsibilities(i, [['Site supervisor', `${v(i, 'supervisor', 'Appointed in writing')}. Briefs the crew, controls the work and stops it if conditions change.`]]),
        sec('Plant, tools and equipment',
          ...(tools.length ? [{ type: 'table', columns: ['Tool / equipment', 'Check before use'], widths: [1.4, 3], rows: tools.map((t) => [t.label, t.inspection]) } as Block] : []),
          ...(typedEquipment.length || !tools.length ? [bullets(typedEquipment.length ? typedEquipment : ['List the plant, tools and equipment for this job here; each item is inspected before use.'])] : [])),
        sec('Personal protective equipment', bullets(ppeFor(work, tools))),
        sec('Permits and hold points', permits.length ? bullets([...permits.map((p) => `${p} permit before starting`), 'Supervisor sign-off before energy is restored or equipment returned to service']) : bullets(['Confirm with the client whether a permit to work is required', 'Supervisor sign-off at completion'])),
        sec('Sequence of work', numbered(seq)),
        sec('Key hazards and controls', hazardTable(work, 'Supervisor', tools)),
        sec('Emergency arrangements', para("Stop work, make the area safe and follow the client's emergency response plan."), ...emergencyBlocks(i)),
        ...recordsReview(i, ['Signed method statement', 'Permits', 'Toolbox talk attendance'], 12),
        signOff(),
      ],
    };
  },
};

function procedureBlueprint(id: string, code: string, name: string, profileId: string, matches: RegExp, purpose: string, steps: string[], extras: Section[] = [], legal: string[] = []): Blueprint {
  const profile = WORK_PROFILES.find((p) => p.id === profileId)!;
  return {
    id, code, name, category: 'Procedures',
    description: `${profile.label}: controls, step-by-step procedure, permit requirements and rescue arrangements.`,
    matches, reviewMonths: 12,
    fields: [common.site, { ...common.scope, required: false, placeholder: `e.g. ${profile.label.toLowerCase()} during the Shaft 3 shutdown` }, common.supervisor],
    guidance: `A ${name.toLowerCase()} for the work described. Keep the step-by-step procedure specific and complete, including permit, monitoring and rescue requirements.`,
    build(i) {
      const scope = scopeText(i) === 'the work described in this document' ? profile.label.toLowerCase() : scopeText(i);
      return {
        title: name,
        subtitle: `${siteLabel(i)}`,
        sections: [
          ...purposeScope(i, purpose),
          legalSection(legal),
          responsibilities(i, [['Site supervisor', `${v(i, 'supervisor', 'Appointed in writing')}. Ensures this procedure is followed and the permit conditions are met.`], ['Authorised / permit issuer', "The client's authorised person who issues and closes the permit."]]),
          sec('Hazards', bullets(profile.hazards)),
          sec('Controls', bullets(profile.controls)),
          sec('Procedure', numbered(steps)),
          ...extras,
          sec('Personal protective equipment', bullets(ppeFor(`${scope} ${profile.label}`))),
          sec('Emergency', ...emergencyBlocks(i)),
          ...recordsReview(i, ['Permits issued and closed', 'Atmospheric test or inspection records', 'Training records of people doing the work'], 12),
          signOff(),
        ],
      };
    },
  };
}

const hotWork = procedureBlueprint('hot-work', 'HWP', 'Hot Work Procedure', 'hot', /hot work/i,
  'To prevent fires, explosions and injuries during welding, cutting, grinding and other hot work.',
  ['Apply for a hot work permit; the issuer inspects the area before signing.', 'Remove combustibles within 11 m or cover them with fire-resistant blankets; close openings where sparks could travel.', 'Test for flammable gas where it could be present, and record the reading on the permit.', 'Place a charged fire extinguisher at the work point and appoint a trained fire watch.', 'Check cylinders, hoses, regulators and flashback arrestors; cylinders upright and chained.', 'Erect welding screens to protect people nearby from arc flash.', 'Carry out the work; the fire watch stays for the duration.', 'Fire watch continues for at least 30 minutes after work ends; inspect for smouldering.', 'Close out the permit with the issuer.'],
);
const confinedSpace = procedureBlueprint('confined-space', 'CSP', 'Confined Space Entry Procedure and Rescue Plan', 'confined', /confined space/i,
  'To make sure nobody enters a confined space until it is safe, and that anyone inside can be rescued quickly.',
  ['Identify the space and apply for a confined space entry permit.', 'Isolate, lock out and blank all inflows (product, water, steam, gas) and energy sources.', 'Ventilate the space; test the atmosphere with a calibrated gas detector for oxygen, flammable and toxic gases before entry and continuously during work.', 'Confirm rescue equipment (tripod, winch, harnesses) and the rescue team are in place before entry.', 'Post a trained standby person at the entrance who never enters; maintain communication with entrants.', 'Record everyone entering and leaving on the entry log.', 'On any alarm or change in conditions, everyone leaves immediately.', 'On completion, account for all people and equipment, remove locks and close the permit.'],
  [sec('Rescue plan', numbered(['Standby raises the alarm and calls the site emergency number.', 'Non-entry rescue first: retrieve the entrant with the winch and lifeline.', 'Entry rescue only by trained rescuers with breathing apparatus.', 'Give first aid and hand over to medical services.']))],
);
const isolation = procedureBlueprint('isolation', 'LOTO', 'Lock-out and Isolation Procedure', 'electrical', /lock-?out|isolation procedure/i,
  'To prevent injury from the unexpected start-up or release of energy while people work on plant and equipment.',
  ['Identify every energy source: electrical, mechanical, hydraulic, pneumatic, gravity, stored and process energy.', "Notify operators and the control room; obtain the client's isolation permit.", 'Stop the equipment using normal controls.', 'Isolate each source at its isolation point (authorised person only for electrical isolations).', 'Apply a personal lock and danger tag for every person working; use a multi-lock hasp where needed.', 'Release or block stored energy (discharge capacitors, bleed pressure, lower or block suspended parts).', 'Test for dead: try to start the equipment and test electrical circuits with an approved tester.', 'Carry out the work.', 'Before restoring energy, check guards are fitted, tools removed and people clear; each person removes only their own lock.', 'Restore energy and test; close the permit.'],
  [], ['Electrical Installation Regulations, 2009 (certificate of compliance for new or altered installations)'],
);
const fallProtection: Blueprint = {
  ...procedureBlueprint('fall-protection', 'FPP', 'Fall Protection Plan', 'heights', /fall protection/i,
    'To prevent falls from height and make sure anyone who falls can be rescued without delay.',
    ['Identify every place a person could fall 2 m or more, including fragile roofs and openings.', 'Eliminate the need to work at height where possible (pre-assemble at ground level).', 'Provide collective protection first: guardrails, covers, scaffolds and mobile elevating work platforms.', 'Where a fall risk remains, use a full-body harness with double lanyards, tied off 100% to an anchor rated for the purpose.', 'Inspect harnesses, lanyards and anchors before each use; record inspections.', 'Barricade the area below and tether tools to prevent dropped objects.', 'Stop work at height in high winds, lightning or poor visibility.', 'Keep rescue equipment at the work area and a trained rescuer available at all times.'],
    [sec('Rescue plan', numbered(['Raise the alarm; do not leave a suspended person alone.', 'Rescue within minutes to prevent suspension trauma, using the rescue kit or a work platform.', 'Keep the rescued person seated upright and get medical help.'])), sec('Competence', bullets(['Fall protection plan developed by a competent person', 'All workers trained in working at heights and harness use', 'Rescue team trained and practised']))],
    ['Construction Regulations, 2014, regulation 10 (fall protection), where applicable']),
};

const erp: Blueprint = {
  id: 'erp', code: 'ERP', name: 'Emergency Response Plan', category: 'Emergency',
  description: 'What to do in a fire, injury, spill or evacuation, with contacts and the assembly point.',
  matches: /emergency (response|plan|procedure)/i, reviewMonths: 12,
  fields: [common.site, common.scope,
    { id: 'emergencyNumber', label: 'Site emergency number', type: 'text', placeholder: 'Filled in from the site when available' },
    { id: 'musterPoint', label: 'Assembly point', type: 'text' },
    { id: 'hospital', label: 'Nearest hospital', type: 'text' },
    { id: 'firstAider', label: 'First aider(s)', type: 'text', placeholder: 'Name and phone' }],
  guidance: "An emergency response plan for the contractor's crew that dovetails with the client's site plan: contacts, scenarios with response steps, evacuation, rescue for the work type, drills.",
  build(i) {
    const { profiles } = hazardsFor(scopeText(i));
    const scenarios: [string, string[]][] = [
      ['Fire', ['Raise the alarm and call the emergency number.', 'Fight the fire only if trained and it is small; otherwise evacuate.', 'Evacuate to the assembly point and report for the head count.']],
      ['Serious injury', ['Make the area safe; do not become a second casualty.', 'Call the emergency number and the first aider.', 'Give first aid within your training; do not move the person unless in danger.', 'Meet and guide the ambulance or proto team.']],
      ['Spill of fuel or chemicals', ['Stop the source if safe to do so.', 'Contain the spill with the spill kit; keep people away.', 'Report to the supervisor and the client environmental officer.']],
      ['Severe weather or lightning', ['Stop work at height and outdoors; secure loose material.', 'Move to shelter until the all-clear.']],
    ];
    if (profiles.some((p) => p.id === 'heights')) scenarios.push(['Fall arrest', ['Keep the person calm and talking.', 'Rescue immediately using the rescue kit or platform.', 'Keep the person seated upright and get medical help.']]);
    if (profiles.some((p) => p.id === 'confined')) scenarios.push(['Confined space emergency', ['Standby raises the alarm; never enter without breathing apparatus.', 'Non-entry rescue using the winch and lifeline.']]);
    if (profiles.some((p) => p.id === 'electrical')) scenarios.push(['Electric shock', ['Switch off the supply or separate the person with non-conductive material.', 'Start CPR if trained and the person is not breathing; call for help.']]);
    return {
      title: 'Emergency Response Plan',
      subtitle: siteLabel(i),
      sections: [
        ...purposeScope(i, `To make sure ${i.company.name}'s people respond quickly and correctly to any emergency at ${siteLabel(i)}, in line with the client's emergency procedures.`),
        sec('Emergency contacts', ...emergencyBlocks(i), { type: 'table', columns: ['Contact', 'Number'], rows: [['Ambulance (national)', '10177'], ['Emergency from a cellphone', '112'], ['Company emergency contact', '__________'], ["Client's control room", '__________']] }),
        legalSection(['General Safety Regulations: first aid, emergency equipment and procedures']),
        sec('Raising the alarm', numbered(['Shout "Emergency!" and use the site alarm or radio.', 'Call the site emergency number: give your name, location, what happened and how many people are hurt.', 'Inform your supervisor.'])),
        ...scenarios.map(([h, steps]) => sec(`Scenario: ${h}`, numbered(steps))),
        sec('Evacuation and head count', numbered(['Stop work and make equipment safe if you can do so quickly.', 'Walk to the assembly point by the nearest safe route.', 'The supervisor counts all people against the daily register and reports anyone missing.', 'Nobody returns until the site declares it safe.'])),
        sec('Emergency equipment', bullets(['First aid box, checked monthly', 'Fire extinguishers at every work point, serviced and in date', 'Spill kit', ...(profiles.some((p) => p.id === 'heights') ? ['Fall arrest rescue kit'] : []), ...(profiles.some((p) => p.id === 'confined') ? ['Tripod, winch and breathing apparatus'] : [])])),
        sec('Drills and training', para('Every worker is inducted on this plan. A drill is held at least every six months or as the client requires; lessons learned are recorded and the plan updated.')),
        ...recordsReview(i, ['Drill records', 'First aid box and extinguisher inspection records'], 12),
        signOff(),
      ],
    };
  },
};

const APPOINTMENTS: Record<string, { ref: string; duties: string[] }> = {
  'Section 16(2) assignee (OHS Act)': { ref: 'Section 16(2) of the Occupational Health and Safety Act 85 of 1993', duties: ['Ensure the duties of the employer under the OHS Act are carried out in your area of responsibility', 'Ensure risk assessments, procedures and training are in place and followed', 'Report on health and safety performance to the Chief Executive Officer'] },
  'Construction manager': { ref: 'Regulation 8 of the Construction Regulations, 2014', duties: ['Manage all construction work on the site and ensure compliance with the Construction Regulations', 'Ensure construction supervisors are appointed and competent', 'Ensure the health and safety plan is implemented and maintained'] },
  'Construction supervisor': { ref: 'Regulation 8 of the Construction Regulations, 2014', duties: ['Supervise construction work and ensure it is done safely', 'Ensure the risk assessment and method statement are followed', 'Hold daily toolbox talks and stop unsafe work'] },
  'Safety officer': { ref: "the client's SHE specification and section 16(2) of the OHS Act", duties: ['Advise management on compliance with health and safety legislation', 'Carry out inspections, audits and incident investigations', 'Keep health and safety records up to date'] },
  'First aider': { ref: 'the General Safety Regulations (first aid)', duties: ['Give first aid within your training', 'Keep the first aid box stocked and checked', 'Record every treatment given'] },
  'Health and safety representative': { ref: 'section 17 of the Occupational Health and Safety Act 85 of 1993', duties: ['Inspect the workplace and identify hazards', 'Represent employees on health and safety matters', 'Take part in incident investigations and meetings'] },
  'Risk assessor': { ref: "regulation 9 of the Construction Regulations, 2014 and the client's standards", duties: ['Lead risk assessments before work starts and when conditions change', 'Make sure controls follow the hierarchy of controls', 'Review assessments after incidents'] },
  'Fall protection plan developer': { ref: 'regulation 10 of the Construction Regulations, 2014', duties: ['Develop and maintain the fall protection plan', 'Ensure workers are trained and rescue arrangements are in place', 'Inspect fall protection equipment'] },
};

const appointment: Blueprint = {
  id: 'appointment', code: 'APP', name: 'Legal Appointment Letter', category: 'Appointments & agreements',
  description: 'Formal written appointment with duties and an acceptance signature, e.g. s16(2), supervisor, first aider.',
  matches: /appointment/i, reviewMonths: 12,
  fields: [
    { id: 'appointmentType', label: 'Appointment', type: 'select', required: true, options: Object.keys(APPOINTMENTS) },
    { id: 'appointee', label: 'Appointee full name', type: 'text', required: true },
    { id: 'appointeeId', label: 'Employee number (optional)', type: 'text' },
    { id: 'appointedBy', label: 'Appointed by (name and title)', type: 'text', required: true, placeholder: 'e.g. S. Ndlovu, Managing Director' },
    { id: 'startDate', label: 'Effective from', type: 'date' },
    common.site],
  guidance: 'A formal appointment letter: reference to the legal basis, specific duties, authority, duration and acceptance. Keep the legal reference exactly as provided.',
  build(i) {
    const type = v(i, 'appointmentType', 'Section 16(2) assignee (OHS Act)');
    const a = APPOINTMENTS[type] ?? APPOINTMENTS['Section 16(2) assignee (OHS Act)'];
    return {
      title: `Appointment: ${type}`,
      subtitle: v(i, 'appointee', 'Appointee'),
      sections: [
        sec('Appointment', { type: 'fields', items: [['Appointee', v(i, 'appointee', '__________')], ['Employee number', v(i, 'appointeeId', '—')], ['Appointment', type], ['Legal basis', a.ref], ['Site / area', siteLabel(i)], ['Effective from', v(i, 'startDate', new Date().toISOString().slice(0, 10))]] }),
        sec('Letter', para(`Dear ${v(i, 'appointee', 'Appointee')},`), para(`In terms of ${a.ref}, you are hereby appointed as ${type} for ${i.company.name} at ${siteLabel(i)}, with effect from ${v(i, 'startDate', 'the date of signature')}. This appointment remains in force until it is withdrawn in writing or your employment ends.`)),
        sec('Duties and responsibilities', bullets([...a.duties, 'Comply with the client\'s site rules and SHE specification', 'Report incidents and unsafe conditions immediately'])),
        sec('Authority', para('You have the authority to stop any work that you consider unsafe, and to require that unsafe conditions are corrected before work continues.')),
        sec('Competence', para('You confirm that you have the training and experience needed for this appointment. The company will provide further training where needed.')),
        sec('Signatures', { type: 'signatures', roles: [`Appointed by — ${v(i, 'appointedBy', 'Name, title')}`, `Accepted by — ${v(i, 'appointee', 'Appointee')}`, 'Witness'] }),
      ],
    };
  },
};

const s37: Blueprint = {
  id: 's37-agreement', code: 'S37', name: 'Section 37(2) Agreement', category: 'Appointments & agreements',
  description: 'Written agreement between client and contractor (mandatary) on health and safety responsibilities.',
  matches: /37\s*\(?2\)?|mandatary/i, reviewMonths: 12,
  fields: [common.site, common.scope,
    { id: 'client', label: 'Client (employer)', type: 'text', placeholder: 'Filled in from the site when available' },
    { id: 'clientSignatory', label: 'Client signatory', type: 'text', placeholder: 'Name and title' },
    { id: 'contractorSignatory', label: 'Contractor signatory', type: 'text', placeholder: 'Name and title', required: true },
    { id: 'duration', label: 'Contract period', type: 'text' }],
  guidance: 'A section 37(2) agreement: parties, scope, the contractor accepting responsibility for compliance with the OHS Act for its work, specific undertakings, and signatures. Keep it clear and balanced; do not add obligations for the client beyond cooperation and information.',
  build(i) {
    return {
      title: 'Agreement in terms of Section 37(2) of the Occupational Health and Safety Act',
      subtitle: `${clientLabel(i)} and ${i.company.name}`,
      sections: [
        sec('Parties', { type: 'fields', items: [['Employer (client)', clientLabel(i)], ['Mandatary (contractor)', i.company.name], ['Contractor registration', i.company.reg || '__________'], ['COID registration', i.company.coid || '__________'], ['Site', siteLabel(i)], ['Scope of work', scopeText(i)], ['Contract period', v(i, 'duration', 'As per contract')]] }),
        sec('Background', para('Section 37(2) of the Occupational Health and Safety Act 85 of 1993 provides that an employer is not liable for the acts or omissions of a mandatary where the parties have agreed in writing on the arrangements and procedures to ensure compliance with the Act. This agreement records those arrangements.')),
        sec('The contractor agrees to', numbered([
          'Comply with the OHS Act, its regulations and, on a mine, the MHSA and its regulations, for all work it carries out.',
          "Comply with the client's SHE specification, site rules, permits and instructions.",
          'Appoint competent persons in writing, including a section 16(2) assignee, supervisors and a safety officer.',
          'Conduct risk assessments and provide method statements before work starts, and implement their controls.',
          'Ensure every employee and subcontractor is medically fit, inducted, trained and competent.',
          'Provide and maintain safe plant, tools and equipment, and PPE at no cost to its employees.',
          'Remain registered and in good standing with the Compensation Fund (COIDA) for the duration of the contract.',
          'Report all incidents to the client immediately and co-operate with investigations.',
          'Ensure subcontractors enter into equivalent agreements and comply with the same requirements.',
        ])),
        sec('The client agrees to', numbered(['Provide the contractor with its SHE specification, site rules and relevant hazard information.', 'Provide site induction and access to emergency arrangements.', 'Monitor the contractor\'s compliance and notify it of any deficiencies.'])),
        sec('General', para('This agreement forms part of the contract between the parties and remains in force until all work under the contract is complete.'), note(CONFIRM)),
        sec('Signatures', { type: 'signatures', roles: [`For the client — ${v(i, 'clientSignatory', 'Name, title')}`, `For the contractor — ${v(i, 'contractorSignatory', 'Name, title')}`, 'Witness'] }),
      ],
    };
  },
};

const toolbox: Blueprint = {
  id: 'toolbox', code: 'TBT', name: 'Toolbox Talk', category: 'Toolbox & training',
  description: 'A short, practical safety talk for the start of shift, with an attendance register to sign.',
  matches: /toolbox/i, reviewMonths: 12,
  fields: [{ id: 'topic', label: 'Topic', type: 'text', required: true, placeholder: 'e.g. Working safely at height on the gantry' }, common.site, { id: 'presenter', label: 'Presented by', type: 'text' }, { id: 'date', label: 'Date', type: 'date' }],
  guidance: 'A 10-minute toolbox talk in plain language a crew understands: why it matters, the key hazards, what we do, questions to ask. Then the attendance register.',
  build(i) {
    const topic = v(i, 'topic', 'Working safely today');
    const { hazards, controls } = hazardsFor(topic);
    return {
      title: `Toolbox Talk: ${topic}`,
      subtitle: siteLabel(i),
      sections: [
        sec('Talk details', { type: 'fields', items: [['Topic', topic], ['Site', siteLabel(i)], ['Presented by', v(i, 'presenter', i.preparer.name)], ['Date', v(i, 'date', '__________')], ['Duration', 'About 10 minutes']] }),
        sec('Why this matters', para(`Today's work involves ${topic.toLowerCase()}. People get hurt when we rush, skip a step or assume someone else checked. This talk is about making sure everyone goes home safe.`)),
        sec('What could hurt us', bullets(hazards.slice(0, 6))),
        sec('What we do about it', bullets(controls.slice(0, 7))),
        sec('Questions for the crew', bullets(['What is the most dangerous part of our job today?', 'What will you do if conditions change or something goes wrong?', 'Where is the assembly point, and who is the first aider?', 'Who can stop the job? (Everyone.)'])),
        sec('Attendance register', { type: 'table', columns: ['#', 'Name', 'Employee no.', 'Signature'], widths: [0.4, 2.4, 1.2, 2], rows: Array.from({ length: 15 }, (_, n) => [String(n + 1), '', '', '']) }),
        sec('Presenter', { type: 'signatures', roles: ['Presented by', 'Supervisor'] }),
      ],
    };
  },
};

const ppeRegister: Blueprint = {
  id: 'ppe-register', code: 'PPE', name: 'PPE Issue Register', category: 'Registers & checklists',
  description: 'Record of PPE issued to each worker, with acknowledgement signatures.',
  matches: /ppe/i, reviewMonths: 12,
  fields: [common.site, { ...common.scope, required: false }, { id: 'workers', label: 'Workers (optional)', type: 'lines', placeholder: 'One name per line; blank rows are added otherwise' }],
  guidance: 'A PPE issue register: the PPE required for the work, issue rules, and a table to record issues with signatures.',
  build(i) {
    const workers = lines(v(i, 'workers'));
    const ppe = ppeFor(scopeText(i));
    return {
      title: 'Personal Protective Equipment Issue Register',
      subtitle: siteLabel(i),
      sections: [
        sec('PPE required for this work', bullets(ppe)),
        sec('Rules', bullets(['PPE is issued free of charge and replaced when damaged, worn out or expired.', 'Workers acknowledge receipt, inspect PPE before each use and report defects.', 'PPE must be worn in all designated areas.'])),
        sec('Issue record', { type: 'table', columns: ['Date', 'Name', 'Item(s) issued', 'Size', 'Signature', 'Issued by'], widths: [1, 2, 2.4, 0.7, 1.4, 1.3], rows: (workers.length ? workers : Array.from({ length: 16 }, () => '')).map((w) => ['', w, '', '', '', '']) }),
      ],
    };
  },
};

const CHECKLISTS: Record<string, string[]> = {
  Scaffolding: ['Base plates and sole boards on firm, level ground', 'Standards plumb; ledgers and transoms secure', 'Bracing in place and undamaged', 'Platforms fully boarded, boards secured, no gaps', 'Guardrails, mid-rails and toe boards on all open sides', 'Safe access ladder secured and extending 1 m above the platform', 'Ties to the structure at required intervals', 'Scaffold tag shows safe for use and inspection date'],
  'Harness and lanyards': ['Webbing free of cuts, fraying, burns and chemical damage', 'Stitching intact', 'Buckles and D-rings undamaged and working', 'Lanyard shock absorber not deployed', 'Snap hooks lock and close properly', 'Label legible and within service life', 'Harness fits the wearer correctly'],
  'Portable electrical tools': ['Casing undamaged', 'Cable and plug undamaged, no joins or exposed conductors', 'Cable strain relief in place', 'Switch works correctly', 'Guard fitted (grinders, saws)', 'Earth leakage protection used at the supply', 'Inspection tag current'],
  Ladders: ['Stiles straight and undamaged', 'Rungs secure and clean', 'Non-slip feet in place', 'Locking bars work (step ladders)', 'Ladder tag current', 'Ladder secured at the top or footed by a second person'],
  'Fire extinguishers': ['Correct type for the fire risk', 'Pressure gauge in the green', 'Seal and pin intact', 'Hose and nozzle undamaged', 'Service date within 12 months', 'Mounted and signposted, access clear'],
  'Lifting equipment': ['Load test certificate current', 'Safe working load marked', 'Slings free of cuts, kinks and broken wires', 'Hooks have safety catches; no deformation', 'Shackles correct size with pins secured', 'Chain blocks operate smoothly; brake holds'],
  'Vehicles and mobile plant': ['Brakes and handbrake', 'Lights, indicators and hooter', 'Reverse alarm and flashing light', 'Seat belts', 'Tyres and wheel nuts', 'Fluid leaks', 'Fire extinguisher on board', "Operator's licence and authorisation valid"],
};

const inspectionChecklist: Blueprint = {
  id: 'inspection-checklist', code: 'CHK', name: 'Equipment Inspection Checklist', category: 'Registers & checklists',
  description: 'Pre-use inspection checklist for scaffolds, harnesses, tools, ladders, extinguishers, lifting gear or plant.',
  matches: /inspection (register|checklist)|roadworthiness|pre-use/i, reviewMonths: 12,
  fields: [{ id: 'equipment', label: 'Equipment', type: 'select', required: true, options: Object.keys(CHECKLISTS) }, common.site, { id: 'frequency', label: 'Inspection frequency', type: 'text', placeholder: 'e.g. Before each use and weekly' }],
  guidance: 'A pre-use inspection checklist with clear pass/fail items, defect action and sign-off.',
  build(i) {
    const eq = v(i, 'equipment', 'Scaffolding');
    const items = CHECKLISTS[eq] ?? CHECKLISTS.Scaffolding;
    return {
      title: `Inspection Checklist: ${eq}`,
      subtitle: siteLabel(i),
      sections: [
        sec('Inspection details', { type: 'fields', items: [['Equipment', eq], ['Identification / serial no.', '__________'], ['Location', siteLabel(i)], ['Frequency', v(i, 'frequency', 'Before each use and at least weekly')], ['Inspected by', '__________'], ['Date', '__________']] }),
        sec('Checklist', { type: 'table', columns: ['#', 'Check', 'OK', 'Defect', 'Comment'], widths: [0.4, 4, 0.6, 0.7, 2], rows: items.map((c, n) => [String(n + 1), c, '[ ]', '[ ]', '']) }),
        sec('If a defect is found', numbered(['Do not use the equipment.', 'Tag it "Out of service" and remove it from use.', 'Report it to the supervisor and record it here.', 'Only return it to use after repair and re-inspection.'])),
        sec('Sign-off', { type: 'signatures', roles: ['Inspected by', 'Supervisor'] }),
      ],
    };
  },
};

export const BLUEPRINTS: Blueprint[] = [hsePolicy, shePlan, riskAssessment, methodStatement, hotWork, confinedSpace, isolation, fallProtection, erp, appointment, s37, toolbox, ppeRegister, inspectionChecklist];

export const blueprintById = (id: string) => BLUEPRINTS.find((b) => b.id === id);

/** The blueprint that best produces a document for a requirement name, if any. */
export function blueprintForRequirement(name: string): Blueprint | undefined {
  return BLUEPRINTS.find((b) => b.matches.test(name));
}
