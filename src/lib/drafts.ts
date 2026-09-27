/**
 * Template drafting: builds a structured first draft from the job description
 * without calling an AI model. Used when no AI key is configured, or when the
 * organisation's plan doesn't include AI drafting.
 */
import type { DraftInput } from './ai.js';
import { hazardsFor } from './knowledge.js';

const today = () => new Date().toISOString().slice(0, 10);
const list = (xs: string[]) => xs.map((x) => `  - ${x}`).join('\n');
const numbered = (xs: string[]) => xs.map((x, i) => `  ${i + 1}. ${x}`).join('\n');
const SIGN_OFF = `SIGN-OFF
  Prepared by: ______________________  Signature: __________  Date: ________
  Reviewed by (competent person): ______________________  Signature: __________  Date: ________
  Approved by (site / client representative): ______________________  Signature: __________  Date: ________`;
const FOOTER = 'This is a template draft generated from the job description. It must be reviewed and completed by a competent person before use.';

function header(input: DraftInput, title: string): string {
  const lines = [
    `Company: ${input.company.name}`,
    input.company.reg && `Registration: ${input.company.reg}`,
    input.company.coid && `COID: ${input.company.coid}`,
    input.company.address && `Address: ${input.company.address}`,
    `Prepared by: ${input.preparer.name}${input.preparer.title ? ` (${input.preparer.title})` : ''}`,
    input.preparer.phone && `Phone: ${input.preparer.phone}`,
    input.preparer.email && `Email: ${input.preparer.email}`,
    `Date: ${today()}`,
    'Revision: 0 (draft)',
  ].filter(Boolean);
  return [title.toUpperCase(), '', ...lines].join('\n');
}

export function templateDraft(input: DraftInput): string {
  const brief = input.brief.trim() || 'General site work';
  const { profiles, hazards, controls, permits } = hazardsFor(brief);
  const kinds = profiles.length ? profiles.map((p) => p.label).join(', ') : 'General site work';
  const scope = `SCOPE OF WORK\n  ${brief}\n  Work types identified: ${kinds}`;
  const permitLine = permits.length ? `Permits required: ${permits.join(', ')}.` : 'Permits: confirm with the site whether any permit to work applies.';

  switch (input.type) {
    case 'Site-specific risk assessment': {
      const rows = hazards.map((h, i) => {
        const control = controls[i % controls.length];
        return `  ${i + 1}. Hazard: ${h}\n     Risk before controls: High / Medium / Low (circle)\n     Controls: ${control}\n     Residual risk: ______   Responsible: ______________`;
      });
      return [
        header(input, 'Site-specific risk assessment'),
        '',
        scope,
        '',
        'METHOD\n  Hazards identified for this scope, rated before and after controls. Review daily and whenever the task, crew or conditions change.',
        '',
        'HAZARD REGISTER',
        rows.join('\n\n'),
        '',
        `ADDITIONAL CONTROLS\n${list(controls)}`,
        '',
        `PERMITS\n  ${permitLine}`,
        '',
        'LEGAL FRAMEWORK\n  Mine Health and Safety Act 29 of 1996 (on mines) or the Occupational Health and Safety Act 85 of 1993 and its regulations, and the site\'s own SHE specification.',
        '',
        SIGN_OFF,
        '',
        FOOTER,
      ].join('\n');
    }
    case 'Method statement':
      return [
        header(input, 'Method statement / safe work procedure'),
        '',
        scope,
        '',
        'RESPONSIBILITIES\n  Supervisor: ______________ — plans the work, briefs the crew, stops unsafe work.\n  Safety officer: ______________ — checks controls and permits are in place.\n  Every worker — follows this procedure and stops work if it becomes unsafe.',
        '',
        `PLANT, EQUIPMENT AND PPE\n  List the tools, plant and PPE for this job. Minimum PPE: hard hat, safety boots, reflective vest, eye and hearing protection.`,
        '',
        'SEQUENCE OF WORK',
        numbered([
          'Obtain the permit(s) and sign on to the site register.',
          'Hold a toolbox talk covering this method statement and the risk assessment.',
          'Inspect tools and equipment; remove anything defective.',
          'Barricade and sign the work area.',
          ...(permits.length ? [`Apply the ${permits.join(' / ').toLowerCase()} permit controls before starting.`] : []),
          'Carry out the work: describe each step here.',
          'Inspect the completed work; remove barricades only when safe.',
          'Clean up, close out the permit(s) and hand back the area.',
        ]),
        '',
        `KEY HAZARDS AND CONTROLS\n${list(hazards.slice(0, 6).map((h, i) => `${h} — ${controls[i % controls.length]}`))}`,
        '',
        'EMERGENCY\n  Follow the site emergency response plan. Know the assembly point, emergency number and nearest first-aider before starting.',
        '',
        SIGN_OFF,
        '',
        FOOTER,
      ].join('\n');
    case 'Toolbox talk record':
      return [
        header(input, 'Toolbox talk'),
        '',
        `TOPIC\n  Working safely on: ${brief}`,
        '',
        `WHAT COULD HURT US TODAY\n${list(hazards.slice(0, 5))}`,
        '',
        `HOW WE STAY SAFE\n${list(controls.slice(0, 6))}`,
        '',
        `PERMITS\n  ${permitLine}`,
        '',
        'QUESTIONS TO ASK THE CREW\n  - What is the most dangerous part of today\'s job?\n  - What will you do if something changes or goes wrong?\n  - Who do you tell if you see something unsafe?',
        '',
        'ATTENDANCE\n  Record attendance and signatures in SiteGuard (Toolbox talks) or below.\n  Name ______________________  Signature __________\n  Name ______________________  Signature __________',
        '',
        FOOTER,
      ].join('\n');
    case 'Emergency response plan':
      return [
        header(input, 'Emergency response plan'),
        '',
        scope,
        '',
        'EMERGENCY CONTACTS\n  Site emergency number: ______________\n  Ambulance / Proto team: ______________\n  Company emergency contact: ______________',
        '',
        'ASSEMBLY POINT\n  Location: ______________  Head count by: ______________',
        '',
        'FORESEEABLE EMERGENCIES',
        list([...hazards.slice(0, 4), 'Fire', 'Medical emergency', 'Severe weather']),
        '',
        'RESPONSE STEPS',
        numbered([
          'Stop work and make the area safe if you can do so without risk.',
          'Raise the alarm and call the site emergency number.',
          'Give first aid only if trained; do not move an injured person unless in danger.',
          'Evacuate to the assembly point and report for the head count.',
          'Do not re-enter until the site declares the area safe.',
          'Report the incident in SiteGuard as soon as possible.',
        ]),
        '',
        'RESCUE\n  Describe how a person would be rescued for this scope (e.g. from height or a confined space) and the equipment kept at the work area.',
        '',
        SIGN_OFF,
        '',
        FOOTER,
      ].join('\n');
    default:
      return [
        header(input, 'Daily site diary'),
        '',
        scope,
        '',
        'DATE: ________  WEATHER: ________  CREW ON SITE: ________',
        '',
        'WORK DONE TODAY\n  ______________________________________________',
        '',
        'PERMITS OPEN / CLOSED\n  ______________________________________________',
        '',
        `SAFETY CHECKS\n${list(controls.slice(0, 5).map((c) => `[ ] ${c}`))}`,
        '',
        'INCIDENTS / NEAR MISSES\n  None / details: ______________________________',
        '',
        'PLANNED FOR TOMORROW\n  ______________________________________________',
        '',
        'Supervisor: ______________________  Signature: __________',
        '',
        FOOTER,
      ].join('\n');
  }
}
