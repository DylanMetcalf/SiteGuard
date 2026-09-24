/**
 * Built-in requirement starter packs. A site copies the items it picks, so
 * later changes to a pack never alter an existing site's requirements.
 *
 * These are a practical starting point for contractors on South African mines
 * and industrial sites — not legal advice. Every item stays editable per site,
 * and customers should confirm their list with their SHE / legal advisers.
 */

export type Source = 'legal' | 'client' | 'site' | 'project' | 'company' | 'best_practice' | 'platform';

export interface TemplateItem {
  category: string;
  name: string;
  source: Source;
  why: string;
}

export interface TemplatePack {
  id: string;
  name: string;
  description: string;
  items: TemplateItem[];
}

const item = (category: string, name: string, source: Source, why: string): TemplateItem => ({ category, name, source, why });

export const TEMPLATE_PACKS: TemplatePack[] = [
  {
    id: 'baseline',
    name: 'Contractor baseline',
    description: 'What most mines and industrial sites ask of every contractor before work starts.',
    items: [
      item('Company Documents', 'Letter of Good Standing (COID)', 'legal', 'Confirms the contractor is registered and paid up under the Compensation for Occupational Injuries and Diseases Act.'),
      item('Company Documents', 'CIPC company registration', 'legal', 'Confirms the contractor is a legally registered entity.'),
      item('Company Documents', 'Public liability insurance', 'client', 'Proof of cover at the amount the site requires for all contractors.'),
      item('Company Documents', 'Tax compliance status (SARS PIN)', 'client', 'Most procurement departments require a valid tax compliance status before a contractor is paid.'),
      item('Company Documents', 'Health & Safety policy', 'legal', 'The contractor\'s signed SHE policy, as required for employers under health and safety legislation.'),
      item('Company Documents', 'Contractor SHE plan', 'site', 'How the contractor will manage health and safety for this scope, aligned to the site\'s SHE specification.'),
      item('Personnel', 'Medical certificates of fitness — all workers', 'legal', 'Medical surveillance (MHSA sections 12/13 on mines) is required before any worker may enter site.'),
      item('Personnel', 'Site-specific induction — all workers', 'site', 'Every worker must complete the site\'s mandatory induction before starting work.'),
      item('Personnel', 'Competency / training matrix', 'site', 'Shows that each worker is trained and competent for the tasks they will perform.'),
      item('Personnel', 'Legal appointments (supervisors, safety officer)', 'legal', 'Signed appointment letters for the people accountable for health and safety on this scope.'),
      item('Personnel', 'PPE issue register', 'legal', 'Records the PPE issued to each worker.'),
      item('Site-Specific', 'Baseline risk assessment', 'legal', 'Identifies the hazards of this scope and the controls that will be in place.'),
      item('Site-Specific', 'Method statement / safe work procedure', 'site', 'Step-by-step description of how the work will be done safely.'),
      item('Site-Specific', 'Emergency response plan acknowledgement', 'site', 'Confirms the contractor has read and understood the site\'s emergency procedures.'),
    ],
  },
  {
    id: 'electrical',
    name: 'Electrical work',
    description: 'Add for electrical installation, maintenance or isolation work.',
    items: [
      item('Personnel', 'Electrician trade test / competency certificates', 'site', 'Proof that people doing electrical work are qualified for it.'),
      item('Personnel', 'Switching and isolation authorisations', 'site', 'Only authorised people may switch or isolate the site\'s electrical supply.'),
      item('Equipment', 'Portable electrical tool test certificates', 'legal', 'Portable tools must be inspected, tested and tagged before use.'),
      item('Site-Specific', 'Lock-out / isolation procedure', 'site', 'How energy sources will be isolated, locked and tested before work begins.'),
      item('Site-Specific', 'Electrical Certificate of Compliance (on completion)', 'legal', 'Required for new or altered electrical installations.'),
    ],
  },
  {
    id: 'heights-lifting',
    name: 'Working at heights & lifting',
    description: 'Add for scaffolding, work above ground level, cranes or rigging.',
    items: [
      item('Personnel', 'Working at heights training', 'legal', 'Required for anyone working where they could fall from height.'),
      item('Personnel', 'Rigger / crane operator competency', 'legal', 'Lifting operations must be carried out by competent, certified operators and riggers.'),
      item('Site-Specific', 'Fall protection plan', 'legal', 'How falls will be prevented and how a fallen worker will be rescued.'),
      item('Equipment', 'Scaffolding inspection register', 'legal', 'Scaffolds must be inspected and tagged by a competent person before use and regularly thereafter.'),
      item('Equipment', 'Harness and lanyard inspection register', 'legal', 'Fall arrest equipment must be logged and inspected before use.'),
      item('Equipment', 'Lifting equipment load test certificates', 'legal', 'Cranes, slings and other lifting equipment must be tested and certified.'),
    ],
  },
  {
    id: 'hot-confined',
    name: 'Hot work & confined spaces',
    description: 'Add for welding, cutting or grinding, or entry into tanks, vessels and other confined spaces.',
    items: [
      item('Site-Specific', 'Hot work procedure', 'site', 'Controls for welding, cutting and grinding, including permits and fire watch.'),
      item('Equipment', 'Fire extinguisher service records', 'best_practice', 'Extinguishers at the work area must be serviced and in date.'),
      item('Site-Specific', 'Confined space entry procedure', 'legal', 'Entry into confined spaces requires a documented procedure, permit and standby person.'),
      item('Site-Specific', 'Confined space rescue plan', 'site', 'How an incapacitated worker will be rescued from the space.'),
      item('Equipment', 'Gas detector calibration certificates', 'site', 'Atmospheres must be tested with calibrated instruments before and during entry.'),
    ],
  },
  {
    id: 'civil-plant',
    name: 'Civil works & mobile plant',
    description: 'Add for excavation, earthworks, or operating vehicles and mobile machinery on site.',
    items: [
      item('Site-Specific', 'Excavation risk assessment and support design', 'legal', 'Excavations need a competent assessment of collapse risk and how sides will be supported.'),
      item('Personnel', 'Competent person for excavations — appointment', 'legal', 'A competent person must be appointed to supervise excavation work.'),
      item('Personnel', 'Plant operator licences / competency', 'legal', 'Operators of mobile machinery must be trained and authorised for each machine type.'),
      item('Equipment', 'Vehicle and plant roadworthiness / inspection records', 'site', 'Vehicles and plant brought onto site must be inspected and fit for purpose.'),
      item('Project-Specific', 'Environmental management plan', 'project', 'How dust, spills, waste and disturbance will be controlled for this scope.'),
    ],
  },
];

/** Items from the chosen packs, in pack order, without duplicate names. */
export function itemsFromPacks(packIds: string[], exclude: Iterable<string> = []): TemplateItem[] {
  const seen = new Set([...exclude].map((n) => n.trim().toLowerCase()));
  const out: TemplateItem[] = [];
  for (const pack of TEMPLATE_PACKS) {
    if (!packIds.includes(pack.id)) continue;
    for (const it of pack.items) {
      const key = it.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(it);
    }
  }
  return out;
}
