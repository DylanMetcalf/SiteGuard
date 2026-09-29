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
    id: 'general-mine',
    name: 'General safety file — mine (MHSA)',
    description: 'A complete contractor safety file for work on a mine: company documents, MHSA appointments, people, plans, equipment and registers.',
    items: [
      item('Company Documents', 'Safety file index', 'client', 'A contents page so the mine, an auditor or an inspector can find any document quickly.'),
      item('Company Documents', 'Letter of Good Standing (COID)', 'legal', 'Proves workers are covered for injury compensation (COIDA). No work may start without a valid letter.'),
      item('Company Documents', 'CIPC company registration', 'legal', 'Confirms the contractor is a legally registered company.'),
      item('Company Documents', 'Public liability insurance', 'client', 'Covers damage or injury to third parties caused by the contractor\'s work.'),
      item('Company Documents', 'Tax compliance status (SARS PIN)', 'client', 'Procurement needs a valid tax compliance status before paying a contractor.'),
      item('Company Documents', 'Health & Safety policy', 'legal', 'Top management\'s signed commitment to health, safety and environment.'),
      item('Company Documents', 'Signed scope of work and contractor appointment', 'client', 'Defines exactly what work the contractor was appointed in writing to do on the mine.'),
      item('Company Documents', 'Organogram and key contacts', 'client', 'Who is responsible for what, and who to call — including after hours.'),
      item('Legal Appointments', 'Contractor manager appointment (MHSA s7(4))', 'legal', 'Names the manager legally responsible for the contractor\'s work on the mine (MHSA s7(4) with the mine\'s regulations).'),
      item('Legal Appointments', 'Supervisor and safety officer appointments', 'legal', 'Written appointments of the contractor\'s supervisors and safety officer as the mine\'s regulations require.'),
      item('Legal Appointments', 'First aider appointments and certificates', 'best_practice', 'Trained first aid on hand for the size of the crew.'),
      item('Legal Appointments', 'Health and safety representatives', 'legal', 'Elected representatives who inspect and raise health and safety concerns (MHSA Chapter 3).'),
      item('Personnel', 'Employee list with ID copies', 'client', 'Controls site access and shows who is working, and who to contact in an emergency.'),
      item('Personnel', 'Medical certificates of fitness — all workers', 'legal', 'Every worker must be medically fit for the job before entering the mine (MHSA s12/13; entry, periodic and exit).'),
      item('Personnel', 'Site-specific induction — all workers', 'site', 'No one enters the mine before the mine\'s induction on its hazards.'),
      item('Personnel', 'Competency / training matrix', 'best_practice', 'Proves each worker is trained and authorised for the tasks and machines they use.'),
      item('Plans & Procedures', 'Contractor SHE plan', 'site', 'How the contractor will meet the mine\'s SHE specification for this scope.'),
      item('Plans & Procedures', 'Baseline risk assessment', 'legal', 'Identifies hazards and sets controls before work starts (MHSA s11).'),
      item('Plans & Procedures', 'Method statement / safe work procedure', 'best_practice', 'Step-by-step instructions for doing each high-risk task safely.'),
      item('Plans & Procedures', 'Emergency response plan acknowledgement', 'site', 'Everyone knows what to do and who to call in a fire, injury or other emergency.'),
      item('Plans & Procedures', 'Acknowledgement of the mine\'s codes of practice', 'site', 'Proves the crew knows and signed for the mine\'s own codes of practice and standards.'),
      item('Plans & Procedures', 'Incident reporting and investigation procedure', 'best_practice', 'Incidents are reported quickly and investigated so they don\'t happen again.'),
      item('Equipment', 'Equipment, plant and tools register', 'client', 'Every item brought onto the mine, so it can be inspected and signed off by the mine\'s engineering.'),
      item('Equipment', 'PPE issue register', 'best_practice', 'Proves each worker was issued the correct protective equipment, free of charge.'),
      item('Equipment', 'Hazardous chemicals register and safety data sheets', 'best_practice', 'Chemicals on site with their safety data sheets for safe handling and first aid.'),
      item('Registers & Records', 'Toolbox talk and safety meeting records', 'best_practice', 'Shows the crew is briefed on daily hazards and issues are discussed.'),
      item('Registers & Records', 'Incident and injury register', 'best_practice', 'A record of all injuries and incidents for reporting and trend tracking.'),
      item('Registers & Records', 'Inspection registers (ladders, fire, electrical)', 'best_practice', 'Shows the required regular inspections actually happened.'),
    ],
  },
  {
    id: 'general-construction',
    name: 'General safety file — construction (Construction Regulations 2014)',
    description: 'A complete contractor health and safety file for construction work: what the Construction Regulations and the OHS Act call for.',
    items: [
      item('Company Documents', 'Safety file index', 'client', 'A contents page so the client, principal contractor or inspector can find any document quickly.'),
      item('Company Documents', 'Letter of Good Standing (COID)', 'legal', 'Proves workers are covered for injury compensation; required before work starts (Construction Regulations 2014 reg 7).'),
      item('Company Documents', 'CIPC company registration', 'legal', 'Confirms the contractor is a legally registered company.'),
      item('Company Documents', 'Public liability insurance', 'client', 'Covers damage or injury to third parties caused by the contractor\'s work.'),
      item('Company Documents', 'Health & Safety policy', 'legal', 'Top management\'s signed commitment to health, safety and environment.'),
      item('Company Documents', 'Section 37(2) agreement', 'legal', 'The written agreement in which the contractor accepts OHS Act responsibility for its people (OHS Act s37(2)).'),
      item('Company Documents', 'Signed scope of work and contractor appointment', 'legal', 'The contractor must be appointed in writing for its scope (Construction Regulations 2014 reg 7).'),
      item('Legal Appointments', 'CEO and section 16(2) appointment', 'legal', 'The CEO delegates health and safety duties in writing to a named manager (OHS Act s16(2)).'),
      item('Legal Appointments', 'Construction manager and supervisor appointments', 'legal', 'Named, competent people accountable for safety on site (Construction Regulations 2014 reg 8).'),
      item('Legal Appointments', 'Health and safety officer appointment and registration', 'legal', 'A competent, registered safety officer supports the site (Construction Regulations 2014 reg 8).'),
      item('Legal Appointments', 'Risk assessor and fall protection plan developer appointments', 'legal', 'Only competent, appointed people may do risk assessments and fall protection plans (regs 9 and 10).'),
      item('Legal Appointments', 'Health and safety representatives', 'legal', 'Elected representatives who inspect and raise concerns (OHS Act s17).'),
      item('Legal Appointments', 'First aider appointments and certificates', 'best_practice', 'Trained first aid on hand for the size of the crew.'),
      item('Personnel', 'Employee list with ID copies', 'client', 'Controls site access and shows who is working.'),
      item('Personnel', 'Medical certificates of fitness — all workers', 'legal', 'Every worker must have a valid certificate of fitness for their job (Construction Regulations 2014 reg 7).'),
      item('Personnel', 'Site-specific induction — all workers', 'legal', 'No one may enter site before induction on its hazards; records kept on site (reg 7).'),
      item('Personnel', 'Competency / training matrix', 'best_practice', 'Proves each worker is qualified for their tasks and machines.'),
      item('Personnel', 'Operator licences and authorisations', 'legal', 'Only trained, authorised people may operate vehicles and mobile plant (reg 23).'),
      item('Plans & Procedures', 'Contractor health and safety plan', 'legal', 'How the contractor will meet the client\'s health and safety specification (reg 7).'),
      item('Plans & Procedures', 'Baseline risk assessment', 'legal', 'Identifies hazards and sets controls before work starts (reg 9).'),
      item('Plans & Procedures', 'Method statement / safe work procedure', 'best_practice', 'Step-by-step instructions for each high-risk task.'),
      item('Plans & Procedures', 'Fall protection plan', 'legal', 'Required wherever people work at height, and kept up to date (reg 10).'),
      item('Plans & Procedures', 'Emergency response plan acknowledgement', 'best_practice', 'Everyone knows what to do in an emergency.'),
      item('Equipment', 'Equipment, plant and tools register', 'client', 'Every item on site so it can be inspected and controlled.'),
      item('Equipment', 'Pre-use inspection records (vehicles and plant)', 'legal', 'Daily checks catch defects before a machine is used (reg 23).'),
      item('Equipment', 'PPE issue register', 'best_practice', 'Proves each worker was issued the correct protective equipment.'),
      item('Equipment', 'Hazardous chemicals register and safety data sheets', 'best_practice', 'Chemicals on site with their safety data sheets.'),
      item('Registers & Records', 'Toolbox talk records', 'best_practice', 'Shows the crew is briefed on daily hazards.'),
      item('Registers & Records', 'Incident and injury register', 'best_practice', 'A record of all injuries and incidents.'),
      item('Registers & Records', 'Audit reports and corrective actions', 'legal', 'The principal contractor audits each contractor at least every 30 days; findings are tracked to closure (reg 7).'),
      item('Registers & Records', 'Subcontractor list and agreements', 'legal', 'A current list of all subcontractors on site and their agreements (reg 7).'),
    ],
  },
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
