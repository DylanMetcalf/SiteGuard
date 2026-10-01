/**
 * Built-in work-type knowledge: the hazards, controls, permits and starter
 * packs that go with common kinds of mine and industrial work. It powers
 * template drafting and the assistant when no AI key is configured, and gives
 * the AI assistant a consistent vocabulary when one is.
 *
 * A practical starting point, not legal advice.
 */

/**
 * Tools and equipment a contractor can tick in a risk assessment or method statement. Each adds
 * its own hazards (with the control for each), PPE and pre-use inspection. Standard practice, not
 * legal advice: the drafts they feed are for the contractor's competent person to check and sign.
 */
export interface Tool {
  label: string;
  category: 'Hand tools' | 'Power tools' | 'Hot work' | 'Access equipment' | 'Electrical equipment' | 'Lifting equipment' | 'Plant and vehicles' | 'Other equipment';
  hazards: [hazard: string, control: string][];
  ppe: string[];
  inspection: string;
}

export const TOOLS: Tool[] = [
  { label: 'Hand tools (hammers, spanners, screwdrivers, pliers)', category: 'Hand tools', ppe: ['Safety glasses', 'Gloves suited to the task'],
    inspection: 'Handles sound and secure, no mushroomed heads or worn jaws, insulated tools rated and undamaged for electrical work',
    hazards: [['Struck by or cut by a slipping tool', 'Right tool and size for the job; tools in good condition; pull rather than push on spanners; keep hands clear of the line of force.'],
      ['Tools dropped from height', 'Tool lanyards and tool bags when working at height; barricade the area below.']] },
  { label: 'Utility knife / cutting tools', category: 'Hand tools', ppe: ['Cut-resistant gloves', 'Safety glasses'],
    inspection: 'Retractable or self-retracting blade, sharp blade, handle intact',
    hazards: [['Cuts to hands and legs', 'Self-retracting blades; cut away from the body on a stable surface; cut-resistant gloves; replace blunt blades; never leave blades exposed.']] },
  { label: 'Angle grinder', category: 'Power tools', ppe: ['Face shield over safety glasses', 'Hearing protection'],
    inspection: 'Guard fitted, disc rated for the speed and undamaged, dead-man switch working, cord and plug intact',
    hazards: [['Disc shattering and flying fragments', 'Correct disc for the material and speed; guard always fitted; stand to the side on start-up; never use a damaged disc.'],
      ['Sparks igniting nearby material', 'Hot work permit where required; remove or cover combustibles; fire extinguisher within reach; fire watch after work.']] },
  { label: 'Electric drill / impact driver', category: 'Power tools', ppe: ['Safety glasses'],
    inspection: 'Chuck and bits secure, casing undamaged, cord or battery pack intact, tagged as tested',
    hazards: [['Drill bit binding and wrist injury', 'Clamp the work piece; use the side handle; correct bit and speed; release the trigger if the bit binds.'],
      ['Drilling into hidden services', 'Scan for cables and pipes before drilling; check drawings; isolate services where they may be present.']] },
  { label: 'Circular saw', category: 'Power tools', ppe: ['Safety glasses', 'Hearing protection', 'Dust mask'],
    inspection: 'Retracting guard moves freely, blade sharp and correct for the material, riving knife fitted',
    hazards: [['Kickback and contact with the blade', 'Retracting guard working; riving knife fitted; support the work piece; keep hands clear of the cutting line.']] },
  { label: 'Jackhammer / breaker', category: 'Power tools', ppe: ['Hearing protection', 'Safety glasses', 'Dust mask', 'Anti-vibration gloves'],
    inspection: 'Tool bit secure, hoses or cord undamaged, handles and vibration dampers intact',
    hazards: [['Hand-arm vibration', 'Limit trigger time and rotate operators; anti-vibration tools and gloves; report tingling or numbness.'],
      ['Breaking into buried services', 'Service scan and drawings checked before breaking; locate by hand digging near known services.']] },
  { label: 'Arc welding machine', category: 'Hot work', ppe: ['Welding helmet with correct shade', 'Leather gauntlets and apron', 'Flame-retardant overalls'],
    inspection: 'Leads and earth clamp undamaged, connections tight, machine earthed, tagged as tested',
    hazards: [['Arc eye and UV burns', 'Welding screens around the work; correct helmet shade; warn people nearby before striking an arc.'],
      ['Welding fumes', 'Local extraction or good ventilation; respirator where fumes cannot be removed; never weld on coated or galvanised metal without extraction.']] },
  { label: 'Oxy-acetylene cutting set', category: 'Hot work', ppe: ['Cutting goggles or face shield', 'Leather gauntlets', 'Flame-retardant overalls'],
    inspection: 'Flashback arrestors fitted at both ends, hoses and regulators undamaged, leak test done, cylinders chained upright',
    hazards: [['Flashback and cylinder fire', 'Flashback arrestors at regulator and torch; leak test before use; cylinders upright and secured; valves closed when not in use.'],
      ['Burns and fire from cutting slag', 'Hot work permit; combustibles removed or covered; fire extinguisher at hand; fire watch after cutting.']] },
  { label: 'Ladder', category: 'Access equipment', ppe: [],
    inspection: 'Stiles and rungs undamaged, feet intact, locking bars working on step ladders, tagged as inspected',
    hazards: [['Falling from the ladder', 'Short-duration work only; three points of contact; set at 1:4 and secured at the top; never over-reach or stand on the top two rungs.']] },
  { label: 'Scaffold / mobile scaffold tower', category: 'Access equipment', ppe: ['Full-body harness where edge protection is incomplete'],
    inspection: 'Erected by a competent person, scaffold tag green, guardrails and toe boards complete, castors locked',
    hazards: [['Falls from the scaffold', 'Erected and inspected by a competent scaffolder; guardrails and toe boards fitted; do not use a scaffold without a green tag.'],
      ['Scaffold collapse or overturning', 'Level base and sole boards; ties or outriggers as designed; no loading beyond its rating; wheels locked before climbing.']] },
  { label: 'Mobile elevating work platform (MEWP)', category: 'Access equipment', ppe: ['Full-body harness clipped to the basket anchor'],
    inspection: 'Daily pre-use check done, emergency lowering tested, outriggers and tyres sound, operator authorised',
    hazards: [['Overturning or being thrown from the basket', 'Authorised operator only; firm level ground; outriggers deployed; harness clipped to the basket anchor.'],
      ['Crushing against overhead structures', 'Plan the route; spotter where clearance is tight; slow movement near structures.']] },
  { label: 'Portable generator', category: 'Electrical equipment', ppe: ['Hearing protection'],
    inspection: 'Earth leakage protection working, frame earthed, fuel cap tight, no leaks, tagged as tested',
    hazards: [['Electric shock from generator supply', 'Earth leakage protection tested; frame earthed; no makeshift connections; cables protected from damage.'],
      ['Exhaust fumes and fuel fires', 'Run outdoors with good ventilation; refuel only when cool and switched off; fire extinguisher nearby.']] },
  { label: 'Extension leads and distribution boxes', category: 'Electrical equipment', ppe: [],
    inspection: 'Plugs and sockets intact, no joins or taped cable, earth leakage unit tested, tagged as tested',
    hazards: [['Electric shock from damaged leads', 'Inspect before use; no joins or taped repairs; earth leakage protection; keep leads out of water and off walkways.']] },
  { label: 'Chain block / lever hoist', category: 'Lifting equipment', ppe: ['Gloves'],
    inspection: 'Load test certificate current, hooks and safety catches intact, chain not stretched or damaged',
    hazards: [['Load falling from failed lifting gear', 'Current load test certificate; rated for the load; anchored to a rated point; nobody under the load.']] },
  { label: 'Slings, shackles and lifting accessories', category: 'Lifting equipment', ppe: ['Gloves'],
    inspection: 'Colour-coded as inspected this period, working load limit marked, no cuts, kinks or deformation',
    hazards: [['Sling or shackle failure', 'Inspected and colour-coded; working load limit marked and not exceeded; correct angle and protection on sharp edges.']] },
  { label: 'Mobile crane', category: 'Lifting equipment', ppe: [],
    inspection: 'Load test certificate current, operator licensed, pre-use checks done, rigger appointed',
    hazards: [['Crane overturning', 'Lift plan with ground bearing check; outriggers fully extended on mats; load chart followed; wind limits observed.'],
      ['Contact with overhead power lines', 'Safe clearances marked; spotter; isolate lines where clearance cannot be kept.']] },
  { label: 'Forklift', category: 'Plant and vehicles', ppe: [],
    inspection: 'Daily pre-use check done, brakes, horn, lights and reverse alarm working, operator licensed',
    hazards: [['Pedestrians struck by the forklift', 'Licensed operator; separate pedestrian routes; reverse alarm and lights; speed limits in the work area.'],
      ['Load falling or forklift tipping', 'Within rated capacity; load secured and tilted back; forks low when travelling; no people on the forks.']] },
  { label: 'TLB / excavator', category: 'Plant and vehicles', ppe: [],
    inspection: 'Pre-use check done, operator licensed, buckets and quick hitch locked, reverse alarm working',
    hazards: [['People struck by the machine or bucket', 'Exclusion zone around the slew radius; banksman; operator has sight of the area; reverse alarm working.'],
      ['Striking buried services', 'Services located and marked before digging; hand digging near known services.']] },
  { label: 'Light delivery vehicle (LDV)', category: 'Plant and vehicles', ppe: [],
    inspection: 'Roadworthy, site access permit displayed, flag and beacon fitted where the site requires them',
    hazards: [['Vehicle collisions on site', 'Site speed limits; driver authorised for the site; flag and beacon as required; park in designated areas.']] },
  { label: 'Air compressor and pneumatic tools', category: 'Other equipment', ppe: ['Safety glasses', 'Hearing protection'],
    inspection: 'Pressure vessel certificate current, safety valve working, hoses and whip checks fitted',
    hazards: [['Hose whip and compressed-air injury', 'Whip checks on every coupling; release pressure before disconnecting; never point air at a person.']] },
  { label: 'High-pressure water jetter', category: 'Other equipment', ppe: ['Face shield', 'Waterproof clothing', 'Safety boots'],
    inspection: 'Trigger dead-man working, hoses rated and undamaged, lance guard fitted',
    hazards: [['High-pressure injection injury', 'Trained operator; dead-man trigger; exclusion zone; never point the lance at anyone; release pressure before changing nozzles.']] },
  { label: 'Hand tools', category: 'Other equipment', ppe: ['Gloves suited to the task'],
    inspection: 'Handles secure, no mushroomed heads or cracked shafts, insulated tools intact for electrical work',
    hazards: [['Cuts and impact injuries from hand tools', 'Right tool for the job and in good condition; carry and store safely; tool lanyards when working at height.']] },
];

export interface WorkProfile {
  id: string;
  label: string;
  keywords: RegExp;
  packIds: string[];
  permits: string[];
  hazards: string[];
  controls: string[];
}

export const WORK_PROFILES: WorkProfile[] = [
  {
    id: 'electrical',
    label: 'Electrical work',
    keywords: /\b(electric\w*|wiring|rewir\w*|cabl\w*|switchgear|substation|mcc|motor control|db board|distribution board|transformer|isolat\w*|live work|panel|lighting|instrumentation)\b/i,
    packIds: ['electrical'],
    permits: ['Electrical isolation'],
    hazards: ['Electric shock and electrocution', 'Arc flash and burns', 'Unexpected re-energisation', 'Stored energy in capacitors and cables'],
    controls: [
      'Isolate, lock out and tag every energy source; test for dead before touching',
      'Only authorised persons switch or isolate the supply',
      'Insulated tools and arc-rated PPE appropriate to the fault level',
      'Portable tools inspected, tested and tagged before use',
    ],
  },
  {
    id: 'heights',
    label: 'Working at heights',
    keywords: /\b(height\w*|scaffold\w*|roof\w*|ladder\w*|elevated|cherry picker|aerial|mewp|platform|headgear|tower|gantry)\b/i,
    packIds: ['heights-lifting'],
    permits: ['Work at heights'],
    hazards: ['Falls from height', 'Falling objects striking people below', 'Scaffold or platform collapse', 'Suspension trauma after a fall arrest'],
    controls: [
      'Fall protection plan in place and briefed before work starts',
      'Full-body harness with double lanyards, 100% tie-off above 2 m',
      'Scaffolds inspected and tagged by a competent person',
      'Barricade and sign the drop zone below; tools tethered',
      'Rescue plan and equipment ready at the work area',
    ],
  },
  {
    id: 'lifting',
    label: 'Lifting and rigging',
    keywords: /\b(crane\w*|lift\w*|rigg\w*|hoist\w*|sling\w*|overhead crane|mobile crane|chain block|shackle)\b/i,
    packIds: ['heights-lifting'],
    permits: ['Lifting'],
    hazards: ['Dropped or swinging loads', 'Crane overturning', 'Failure of slings or lifting gear', 'Contact with overhead power lines'],
    controls: [
      'Lift plan for every critical lift, signed by the appointed person',
      'Certified operator and rigger; lifting gear load-tested and inspected',
      'Exclusion zone under and around the load; tag lines used',
      'Ground bearing and wind speed checked before the lift',
    ],
  },
  {
    id: 'hot',
    label: 'Hot work',
    keywords: /\b(weld\w*|cutting|grind\w*|hot work|torch|oxy|brazing|flame|burning|plasma)\b/i,
    packIds: ['hot-confined'],
    permits: ['Hot work'],
    hazards: ['Fire and explosion', 'Burns and eye injuries from sparks and UV', 'Welding fumes', 'Gas cylinder failure'],
    controls: [
      'Hot work permit issued and displayed at the work area',
      'Combustibles removed or covered; fire extinguisher on hand',
      'Fire watch during and for at least 30 minutes after the work',
      'Welding screens, face shields and fume extraction',
      'Cylinders upright, chained, with flashback arrestors fitted',
    ],
  },
  {
    id: 'confined',
    label: 'Confined space entry',
    // Being near a tank isn't entering one: only entry into an enclosed space counts.
    keywords: /\b(confined|manhole\w*|silo\w*|sump\w*|culvert\w*|(?:inside|into|in|enter\w*|entry|entering|within)\s+(?:a|an|the)?\s*(?:\w+\s+)?(?:tank|vessel|silo|sump|pit|bin|chute|culvert|thickener|bunker|hopper|launder|pipe)s?)\b/i,
    packIds: ['hot-confined'],
    permits: ['Confined space'],
    hazards: ['Oxygen-deficient or toxic atmosphere', 'Engulfment by material', 'Difficult rescue of an injured person', 'Heat stress'],
    controls: [
      'Confined space permit; atmosphere tested with a calibrated gas detector before and during entry',
      'All inflows and energy sources isolated and locked out',
      'Trained standby person at the entrance at all times',
      'Rescue plan and retrieval equipment in place before entry',
    ],
  },
  {
    id: 'excavation',
    label: 'Excavation and civil works',
    keywords: /\b(excavat\w*|trench\w*|earthwork\w*|dig\w*|civil\w*|foundation\w*|concrete|backfill\w*|piling|road\w*|drain\w*|pipeline)\b/i,
    packIds: ['civil-plant'],
    permits: ['Excavation'],
    hazards: ['Collapse of excavation sides', 'Striking buried services', 'People or plant falling into the excavation', 'Water ingress'],
    controls: [
      'Services located and marked before breaking ground',
      'Sides shored, battered or benched as designed by a competent person',
      'Barricades and safe access and egress (ladders) into the excavation',
      'Spoil kept at least 1 m from the edge',
    ],
  },
  {
    id: 'plant',
    label: 'Mobile plant and vehicles',
    keywords: /\b(vehicle\w*|truck\w*|haul\w*|tlb|excavator\w*|loader\w*|forklift\w*|dozer\w*|grader\w*|plant operator|mobile plant|machine\w*|ldv|bakkie\w*)\b/i,
    packIds: ['civil-plant'],
    permits: [],
    hazards: ['Pedestrians struck by vehicles or plant', 'Rollover', 'Collisions in poor visibility or blind spots', 'Unauthorised operation'],
    controls: [
      'Only licensed, authorised operators; pre-use inspection each shift',
      'Separate pedestrian and vehicle routes; flag person where needed',
      'Reverse alarms, lights and seatbelts working',
      'Site speed limits and traffic management plan followed',
    ],
  },
  {
    id: 'machinery',
    label: 'Machinery, conveyors and mechanical maintenance',
    keywords: /\b(conveyor\w*|belt\w*|pump\w*|crusher\w*|mill\w*|gearbox\w*|mechanical|fitter\w*|maintenance|shutdown|breakdown|rotating|pulley\w*|idler\w*|valve\w*)\b/i,
    packIds: [],
    permits: ['Electrical isolation'],
    hazards: ['Entanglement in moving parts', 'Crushing and pinch points', 'Release of stored mechanical or hydraulic energy', 'Manual handling injuries'],
    controls: [
      'Machine isolated, locked out and tested before guards are removed',
      'Guards refitted and checked before restart',
      'Blocking or chocking against unexpected movement',
      'Correct lifting aids for heavy components',
    ],
  },
  {
    id: 'underground',
    label: 'Underground work',
    keywords: /\b(underground|stope\w*|decline\w*|development end|winder\w*|shaft sinking|in the shaft|down the shaft|below ground)\b/i,
    packIds: ['heights-lifting'],
    permits: [],
    hazards: ['Fall of ground', 'Poor ventilation and heat', 'Flammable gas', 'Emergency escape and self-rescue'],
    controls: [
      'Barring down and support checked before work at every face',
      'Ventilation and gas readings recorded before entry',
      'Self-contained self-rescuers issued and people trained',
      'Mine\'s code of practice for the activity followed',
    ],
  },
  {
    id: 'chemicals',
    label: 'Hazardous chemicals',
    keywords: /\b(chemical\w*|acid\w*|cyanide|solvent\w*|paint\w*|coating\w*|blast\w*|explosive\w*|diesel|fuel\w*|reagent\w*|sds|msds|asbestos|dust)\b/i,
    packIds: [],
    permits: [],
    hazards: ['Skin, eye and inhalation exposure', 'Spills to the environment', 'Fire from flammable substances'],
    controls: [
      'Safety data sheet available at the work area for every substance',
      'Chemical-resistant PPE and respiratory protection as the SDS requires',
      'Spill kit on hand; storage in bunded areas',
      'Workers trained on the substances they handle',
    ],
  },
];

const GENERAL_HAZARDS = ['Slips, trips and falls on uneven ground', 'Manual handling injuries', 'Heat, dust and noise exposure', 'Fatigue'];
const GENERAL_CONTROLS = [
  'Site induction completed by every worker',
  'Daily pre-task risk assessment and toolbox talk before work starts',
  'PPE as a minimum: hard hat, safety boots, reflective vest, eye and hearing protection',
  'Housekeeping maintained and work area barricaded',
];

/**
 * The specific controls for each hazard, so a risk register never pairs a
 * hazard with an unrelated control.
 */
export const HAZARD_CONTROLS: Record<string, string> = {
  'Electric shock and electrocution': 'Isolate, lock out and test for dead before work; only authorised persons switch; insulated tools; earth leakage protection on portable supplies.',
  'Arc flash and burns': 'De-energise wherever possible; arc-rated PPE and face shield for the fault level; keep a safe approach distance; switching by authorised persons only.',
  'Unexpected re-energisation': 'Personal lock and danger tag for every worker at each isolation point; isolation permit; try-start before work.',
  'Stored energy in capacitors and cables': 'Discharge and earth capacitors and cables; test for dead; wait the rated discharge time.',
  'Falls from height': 'Fall protection plan; guardrails or scaffold as first choice; full-body harness with double lanyards, 100% tie-off above 2 m; trained workers.',
  'Falling objects striking people below': 'Barricade and sign the drop zone; toe boards; tools tethered; no work directly above others.',
  'Scaffold or platform collapse': 'Scaffold erected by competent erectors on firm ground; inspected and tagged before use and weekly; load limits displayed.',
  'Suspension trauma after a fall arrest': 'Rescue plan and rescue kit at the work area; trained rescuer on site; rescue within minutes; never work at height alone.',
  'Dropped or swinging loads': 'Lift plan; exclusion zone under the load; tag lines; nobody under suspended loads.',
  'Crane overturning': 'Ground bearing checked; outriggers fully extended on pads; load charts followed; wind speed monitored.',
  'Failure of slings or lifting gear': 'Load-tested and tagged lifting gear; pre-use inspection; correct SWL and sling angles; damaged gear removed from use.',
  'Contact with overhead power lines': 'Survey for power lines; safe clearance distances; spotter; isolation of the line where clearance cannot be kept.',
  'Fire and explosion': 'Hot work permit; combustibles removed or covered within 11 m; gas test where flammables may be present; extinguisher and fire watch.',
  'Burns and eye injuries from sparks and UV': 'Welding screens; welding helmet, gauntlets and flame-retardant clothing; people nearby shielded.',
  'Welding fumes': 'Local exhaust ventilation or work in open air; respirator where ventilation is inadequate.',
  'Gas cylinder failure': 'Cylinders upright and chained; flashback arrestors fitted; hoses inspected; valves closed when not in use.',
  'Oxygen-deficient or toxic atmosphere': 'Confined space permit; atmosphere tested with a calibrated gas detector before and during entry; forced ventilation.',
  'Engulfment by material': 'All inflows isolated, blanked and locked; material levels controlled; no entry above bridged material.',
  'Difficult rescue of an injured person': 'Rescue plan and equipment (tripod, winch, lifeline) in place before entry; trained standby person at the entrance.',
  'Heat stress': 'Work-rest cycles; drinking water available; heat-stress monitoring; acclimatised workers.',
  'Collapse of excavation sides': 'Sides shored, battered or benched as designed by a competent person; daily inspection; spoil kept 1 m from the edge.',
  'Striking buried services': 'Services located and marked before breaking ground; hand-dig near services; excavation permit.',
  'People or plant falling into the excavation': 'Barricades and signage around the excavation; stop blocks for plant; safe access ladders.',
  'Water ingress': 'Dewatering pumps; monitor weather; inspect after rain before re-entry.',
  'Pedestrians struck by vehicles or plant': 'Traffic management plan; separate pedestrian routes; flag person; high-visibility clothing.',
  'Rollover': 'Operators trained and licensed; seat belts worn; slopes and edges assessed; ROPS fitted.',
  'Collisions in poor visibility or blind spots': 'Reverse alarms and lights; spotter when reversing; site speed limits.',
  'Unauthorised operation': 'Only authorised operators; keys controlled; pre-use inspection signed each shift.',
  'Entanglement in moving parts': 'Machine isolated and locked out before guards are removed; guards refitted before restart; no loose clothing.',
  'Crushing and pinch points': 'Blocking or chocking against movement; hands-free tools where possible; clear communication between workers.',
  'Release of stored mechanical or hydraulic energy': 'Bleed pressure and release tension before work; block suspended parts; test for zero energy.',
  'Manual handling injuries': 'Mechanical lifting aids; team lifts for heavy items; training in safe lifting.',
  'Fall of ground': 'Barring down and support checked before work; entry examination by a competent person.',
  'Poor ventilation and heat': 'Ventilation and gas readings recorded before entry; work stopped if limits are exceeded.',
  'Flammable gas': 'Continuous gas monitoring; flameproof equipment; withdraw people when limits are reached.',
  'Emergency escape and self-rescue': 'Self-contained self-rescuers issued and trained; escape routes known and signposted.',
  'Skin, eye and inhalation exposure': 'Safety data sheet at the work area; chemical-resistant PPE and respiratory protection as specified.',
  'Spills to the environment': 'Bunded storage; spill kit on hand; spills reported and cleaned up immediately.',
  'Fire from flammable substances': 'Flammables stored away from ignition sources; no smoking; extinguisher on hand.',
  'Slips, trips and falls on uneven ground': 'Good housekeeping; walkways kept clear; adequate lighting.',
  'Manual handling': 'Mechanical aids for heavy loads; team lifts; safe lifting training.',
  'Heat, dust and noise exposure': 'Drinking water and shade; dust suppression; hearing protection above 85 dB(A).',
  'Fatigue': 'Shift length and rest breaks managed; supervisors watch for fatigue; no driving when fatigued.',
};

/** The work profiles that match a free-text description, most specific first. */
export function matchProfiles(text: string): WorkProfile[] {
  return WORK_PROFILES.filter((p) => p.keywords.test(text));
}

/** Starter packs recommended for a description: the baseline plus any add-ons. */
export function recommendPacks(text: string): string[] {
  const ids = new Set(['baseline']);
  for (const p of matchProfiles(text)) for (const id of p.packIds) ids.add(id);
  return [...ids];
}

export function hazardsFor(text: string): { profiles: WorkProfile[]; hazards: string[]; controls: string[]; permits: string[] } {
  const profiles = matchProfiles(text);
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    profiles,
    hazards: uniq([...profiles.flatMap((p) => p.hazards), ...GENERAL_HAZARDS]),
    controls: uniq([...profiles.flatMap((p) => p.controls), ...GENERAL_CONTROLS]),
    permits: uniq(profiles.flatMap((p) => p.permits)),
  };
}
