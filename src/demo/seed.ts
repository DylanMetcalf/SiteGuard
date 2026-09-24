/**
 * Seeds a self-contained demo sandbox: one host organisation, three contractor
 * organisations and demo personas for each, populated with the sample data
 * from the original MVP. Every row is flagged is_demo and shares one
 * demo_group, so sandboxes are isolated from each other and from real tenants,
 * and are deleted automatically after a few days.
 */
import { randomUUID, createHash } from 'node:crypto';
import type { Db } from '../db/pool.js';
import { one } from '../db/pool.js';
import { storage } from '../lib/storage.js';

const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const ts = (offset: number, hour = 9) => `${day(offset)}T${String(hour).padStart(2, '0')}:00:00Z`;

type Req = [string, string, string, string];

export interface DemoPersona {
  userId: string;
  name: string;
  label: string;
}

export async function seedDemo(db: Db): Promise<{ group: string; entryUserId: string; personas: DemoPersona[] }> {
  const group = randomUUID();
  const tag = group.slice(0, 8);
  const trialEnds = new Date(Date.now() + 14 * 86400_000);

  const org = async (name: string, kind: 'host' | 'contractor', extra: Record<string, string> = {}) =>
    (await one<{ id: string }>(
      db,
      `insert into organisations (name, kind, plan, subscription_status, trial_ends_at, seat_limit, is_demo, demo_group, reg_number, coid_number, trade, address)
       values ($1, $2, $3, $4, $5, 25, true, $6, $7, $8, $9, $10) returning id`,
      [name, kind, kind === 'host' ? 'host_pro' : 'contractor_pro', kind === 'host' ? 'trialing' : 'active', kind === 'host' ? trialEnds : null, group,
        extra.reg ?? '', extra.coid ?? '', extra.trade ?? '', extra.address ?? ''],
    ))!.id;
  const user = async (orgId: string, name: string, title: string, role: string, slug: string) => {
    const u = (await one<{ id: string }>(
      db,
      `insert into users (email, name, title, is_demo, email_verified_at, last_active_org_id) values ($1, $2, $3, true, now(), $4) returning id`,
      [`${slug}+${tag}@demo.siteguard.invalid`, name, title, orgId],
    ))!.id;
    await db.query('insert into memberships (org_id, user_id, role) values ($1, $2, $3)', [orgId, u, role]);
    return u;
  };

  const hostId = await org('Highveld Mining Group', 'host', { address: 'Highveld Mining Group, Emalahleni, Mpumalanga' });
  const abcId = await org('ABC Electrical Pty Ltd', 'contractor', { reg: '2014/118822/07', coid: 'COID-99381-2', trade: 'Electrical' });
  const steelId = await org('SteelWorks Fabrication cc', 'contractor', { reg: '2009/044210/23', coid: 'COID-41120-9', trade: 'Structural steel' });
  const voltId = await org('Voltrix Electrical Contractors', 'contractor', { reg: '2011/077410/07', coid: 'COID-30281-1', trade: 'HV Electrical' });

  const naledi = await user(hostId, 'Naledi Khumalo', 'Mine SHE Officer', 'reviewer', 'naledi');
  const thabo = await user(hostId, 'Thabo Mokoena', 'Group Compliance Manager', 'owner', 'thabo');
  const sipho = await user(abcId, 'Sipho Ndlovu', 'Contractor Admin', 'owner', 'sipho');
  const marie = await user(steelId, 'Marié Botha', 'Contractor Admin', 'owner', 'marie');
  const johan = await user(voltId, 'Johan Pretorius', 'Contractor Admin', 'owner', 'johan');

  const contractor = async (name: string, trade: string, contact: string, linked: string, reg: string, coid: string) =>
    (await one<{ id: string }>(
      db,
      `insert into contractors (org_id, name, trade, contact_name, linked_org_id, reg_number, coid_number) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [hostId, name, trade, contact, linked, reg, coid],
    ))!.id;
  const cAbc = await contractor('ABC Electrical Pty Ltd', 'Electrical', 'Sipho Ndlovu', abcId, '2014/118822/07', 'COID-99381-2');
  const cSteel = await contractor('SteelWorks Fabrication cc', 'Structural steel', 'Marié Botha', steelId, '2009/044210/23', 'COID-41120-9');
  const cVolt = await contractor('Voltrix Electrical Contractors', 'HV Electrical', 'Johan Pretorius', voltId, '2011/077410/07', 'COID-30281-1');

  const site = async (name: string, location: string, contractorId: string, status: string, createdOffset: number, emergency: object) =>
    (await one<{ id: string }>(
      db,
      `insert into sites (org_id, name, location, contractor_id, status, emergency, created_by, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [hostId, name, location, contractorId, status, JSON.stringify(emergency), thabo, ts(createdOffset)],
    ))!.id;
  const alpha = await site('Leeuwpan Colliery — Shaft 3 Conveyor Rewire', 'Leeuwpan Colliery, Shaft 3', cAbc, 'in_progress', -43,
    { musterPoint: 'Muster Point B, Shaft 3 headgear car park', contact: 'Mine Control Room — 013 555 0192', hospital: 'Leeuwpan Occupational Health Centre, on-site clinic (Gate 2)' });
  const beta = await site('Blesbok Chrome Mine — Perimeter Upgrade', 'Blesbok Chrome Mine, North Boundary', cSteel, 'in_progress', -21,
    { musterPoint: 'Muster Point A, main gate security office', contact: 'Mine Control Room — 013 555 0417', hospital: 'Blesbok Site Clinic, Admin Block' });
  const substation = await site('Merafe Ferrochrome — Substation Refurbishment', 'Merafe Ferrochrome Plant, Substation 2', cVolt, 'site_ready', -132,
    { musterPoint: 'Muster Point C, Substation 2 perimeter', contact: 'Plant Control Room — 013 555 0288', hospital: 'Merafe Plant Clinic, Gate 1' });
  const smelter = await site('Blesbok Chrome Mine — Smelter Bay 4 Refractory Reline', 'Blesbok Chrome Mine, Smelter Bay 4', cAbc, 'invited', -2,
    { musterPoint: 'Muster Point A, main gate security office', contact: 'Mine Control Room — 013 555 0417', hospital: 'Blesbok Site Clinic, Admin Block' });

  const reqIds: Record<string, string> = {};
  const addReqs = async (siteId: string, prefix: string, reqs: Req[]) => {
    for (const [i, [cat, name, source, why]] of reqs.entries()) {
      reqIds[`${prefix}-${i + 1}`] = (await one<{ id: string }>(
        db,
        `insert into requirements (site_id, category, name, source, why, position) values ($1, $2, $3, $4, $5, $6) returning id`,
        [siteId, cat, name, source, why, i],
      ))!.id;
    }
  };
  await addReqs(alpha, 'pa', [
    ['Company Documents', 'Letter of Good Standing (COID)', 'legal', 'Required under the Compensation for Occupational Injuries and Diseases Act before any contractor may work underground or on surface infrastructure.'],
    ['Company Documents', 'CIPC company registration', 'legal', 'Confirms the contractor is a legally registered entity.'],
    ['Company Documents', 'Public liability insurance', 'client', 'Highveld Mining Group requires cover of at least R5m for all contractors on any of its operations.'],
    ['Company Documents', 'Health & Safety policy', 'legal', 'Required under the Mine Health and Safety Act 29 of 1996 (MHSA).'],
    ['Company Documents', 'Environmental policy', 'best_practice', 'Not a legal minimum, but expected of contractors working near the discard dump.'],
    ['Personnel', 'Medical certificates of fitness — all workers', 'legal', 'Section 12/13 medical surveillance under the MHSA is required before any worker may enter a mine.'],
    ['Personnel', 'Competency certificates', 'site', 'Leeuwpan requires proof of trade competency for electrical crews working on conveyor infrastructure.'],
    ['Personnel', 'Site-specific induction', 'site', 'Every worker must complete the Leeuwpan mandatory induction before entering Shaft 3.'],
    ['Personnel', 'PPE register', 'legal', 'Records PPE issued to each worker, required under the MHSA General Administrative Regulations.'],
    ['Personnel', 'Working at heights training', 'legal', 'Required for any crew working above 1.8m on surface conveyor structures, per the MHSA Code of Practice.'],
    ['Equipment', 'Scaffolding inspection checklist', 'legal', 'Scaffolding must be inspected and tagged before use under the MHSA.'],
    ['Equipment', 'Portable electrical tool test certificates', 'legal', 'Tools must be tested and tagged under the Electrical Machinery Regulations.'],
    ['Equipment', 'Fall protection equipment register', 'legal', 'Harnesses and lanyards must be logged and inspected.'],
    ['Equipment', 'Lifting equipment certificates', 'legal', 'Required under the Driven Machinery Regulations for any hoisting on site.'],
    ['Site-Specific', 'Site-specific risk assessment (baseline & issue-based)', 'site', 'Leeuwpan requires a risk assessment covering live electrical work on the Shaft 3 conveyor drive station.'],
    ['Site-Specific', 'Method statement — conveyor rewiring', 'client', 'Requested by the mine engineer for the Shaft 3 scope.'],
    ['Site-Specific', 'Emergency response plan acknowledgement', 'site', "Confirms the contractor has read Leeuwpan's mine emergency procedures."],
    ['Project-Specific', 'Environmental impact addendum', 'project', 'Specific to work near the discard dump boundary on this project.'],
  ]);
  await addReqs(beta, 'pb', [
    ['Company Documents', 'Letter of Good Standing (COID)', 'legal', 'Required under the Compensation for Occupational Injuries and Diseases Act before any contractor may work on site.'],
    ['Company Documents', 'Public liability insurance', 'client', 'Highveld Mining Group requires cover of at least R5m for all contractors on any of its operations.'],
    ['Personnel', 'Medical certificates of fitness — all workers', 'legal', 'Section 12/13 medical surveillance under the MHSA is required before any worker may enter site.'],
    ['Personnel', 'Site-specific induction', 'site', 'Every worker must complete the Blesbok mandatory induction before entering site.'],
    ['Equipment', 'Portable electrical tool test certificates', 'legal', 'Tools must be tested and tagged under the Electrical Machinery Regulations.'],
    ['Site-Specific', 'Site-specific risk assessment', 'site', 'Covers fencing and excavation work along the north boundary.'],
  ]);
  await addReqs(substation, 'ks', [
    ['Company Documents', 'Letter of Good Standing (COID)', 'legal', 'Required under COIDA before work starts.'],
    ['Personnel', 'HV operating authorisations', 'site', 'Every person switching at Substation 2 must hold a current authorisation.'],
    ['Site-Specific', 'Switching and isolation procedure', 'site', 'Covers LOTO for the 11kV panels being refurbished.'],
  ]);
  await addReqs(smelter, 'bs4', [
    ['Company Documents', 'Letter of Good Standing (COID)', 'legal', 'Required under the Compensation for Occupational Injuries and Diseases Act before any contractor may work on site.'],
    ['Company Documents', 'Public liability insurance', 'client', 'Highveld Mining Group requires cover of at least R5m for all contractors on any of its operations.'],
    ['Personnel', 'Medical certificates of fitness — all workers', 'legal', 'Section 12/13 medical surveillance under the MHSA is required before any worker may enter site.'],
    ['Personnel', 'Site-specific induction', 'site', 'Every worker must complete the Smelter Bay 4 mandatory induction before entering the hot zone.'],
    ['Site-Specific', 'Refractory work risk assessment', 'site', 'Covers high-temperature and confined-space controls specific to the reline.'],
  ]);

  // Placeholder files so "View" works in the demo.
  const sample = async (orgId: string, name: string, by: string) => {
    const body = Buffer.from(`SAMPLE DOCUMENT — SiteGuard demo data\n\n${name}\n\nThis placeholder stands in for the real certificate or plan a contractor would upload.\n`);
    const key = `demo/${group}/${randomUUID()}.txt`;
    await storage.put(key, body, 'text/plain');
    return (await one<{ id: string }>(
      db,
      `insert into files (org_id, storage_key, filename, content_type, size_bytes, sha256, uploaded_by) values ($1, $2, $3, 'text/plain', $4, $5, $6) returning id`,
      [orgId, key, `${name.replace(/[^\w\s-]/g, '').trim()} (sample).txt`, body.length, createHash('sha256').update(body).digest('hex'), by],
    ))!.id;
  };
  const doc = async (key: string, status: string, version: string, updated: number, orgId: string, by: string, byName: string, expiry?: string, note = '') => {
    const reqId = reqIds[key];
    const name = (await one<{ name: string }>(db, 'select name from requirements where id = $1', [reqId]))!.name;
    const file = await sample(orgId, name, by);
    const d = (await one<{ id: string }>(
      db,
      `insert into documents (requirement_id, status, version, note, expiry_date, current_file_id, updated_at) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [reqId, status, version, note, expiry ?? null, file, ts(updated)],
    ))!.id;
    if (version === 'v1.1') {
      await db.query(
        `insert into document_versions (document_id, version, file_id, submitted_by, submitted_by_name, submitted_at) values ($1, 'v1.0', $2, $3, $4, $5)`,
        [d, await sample(orgId, name + ' (earlier)', by), by, byName, ts(updated - 5)],
      );
    }
    await db.query(
      `insert into document_versions (document_id, version, file_id, note, expiry_date, submitted_by, submitted_by_name, submitted_at) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [d, version, file, note, expiry ?? null, by, byName, ts(updated)],
    );
    return d;
  };
  const S = (k: string, st: string, v: string, u: number, exp?: string, note?: string) => doc(k, st, v, u, abcId, sipho, 'Sipho Ndlovu', exp, note);
  await S('pa-1', 'complete', 'v1.0', -41, day(200));
  await S('pa-2', 'complete', 'v1.0', -41);
  await S('pa-3', 'complete', 'v1.0', -41, day(150));
  await S('pa-4', 'complete', 'v1.1', -40);
  await S('pa-5', 'complete', 'v1.0', -41);
  await S('pa-6', 'complete', 'v1.0', -39, day(12), '2 of 9 workers expire within 14 days');
  await S('pa-7', 'complete', 'v1.0', -39);
  await S('pa-8', 'complete', 'v1.0', -38);
  await S('pa-9', 'complete', 'v1.0', -38, day(-6));
  await S('pa-11', 'complete', 'v1.0', -37);
  await S('pa-12', 'complete', 'v1.0', -37);
  await S('pa-13', 'complete', 'v1.0', -44, day(8), 'Harness certification expires soon');
  const pa15 = await S('pa-15', 'correction_required', 'v1.1', -5);
  await S('pa-16', 'complete', 'v1.0', -35);
  await S('pa-17', 'complete', 'v1.0', -35);
  await S('pa-18', 'awaiting_review', 'v1.0', -3);
  await doc('pb-1', 'complete', 'v1.0', -20, steelId, marie, 'Marié Botha', day(300));
  await doc('pb-2', 'complete', 'v1.0', -20, steelId, marie, 'Marié Botha', day(90));
  for (const k of ['ks-1', 'ks-2', 'ks-3']) await doc(k, 'complete', 'v2.0', -115, voltId, johan, 'Johan Pretorius', day(240));

  await db.query(
    `insert into reviews (document_id, author_id, author_name, author_role, kind, text, created_at) values ($1, $2, 'Naledi Khumalo', 'Mine SHE Officer', 'correction', $3, $4)`,
    [pa15, naledi, 'Please add controls for live electrical work on the drive station — specifically the lock-out/isolation procedure for Shaft 3.', ts(-5, 9)],
  );
  await db.query(
    `insert into approvals (site_id, approver_id, approver_name, approver_role, org_name, approved_on, version, verification_id, readiness_percent)
     values ($1, $2, 'Naledi Khumalo', 'Mine SHE Officer', 'Highveld Mining Group', $3, 'v2.0', $4, 100)`,
    [substation, naledi, day(-113), `SG-DEMO-${tag.toUpperCase()}`],
  );
  await db.query(
    `insert into site_invitations (site_id, org_id, contractor_id, token_hash, status, sent_at, responded_at, responded_by) values
       ($1, $5, $6, $7, 'accepted', $10, $10, $11),
       ($2, $5, $8, $9, 'accepted', $12, $12, $13),
       ($3, $5, $14, $15, 'accepted', $16, $16, $17),
       ($4, $5, $6, $18, 'pending', $19, null, null)`,
    [alpha, beta, substation, smelter, hostId, cAbc, randomUUID(), cSteel, randomUUID(), ts(-43), sipho, ts(-21), marie, cVolt, randomUUID(), ts(-132), johan, randomUUID(), ts(-2)],
  );
  await db.query(
    `insert into info_requests (site_id, type, title, message, due_date, requested_by, requested_by_name, requested_by_role, linked_requirement_id, created_at)
     values ($1, 'information', 'Updated Letter of Good Standing', 'Your current COID letter expires soon — please upload the renewed version ahead of the site audit.', $2, $3, 'Naledi Khumalo', 'Mine SHE Officer', $4, $5)`,
    [alpha, day(17), naledi, reqIds['pa-1'], ts(-4, 10)],
  );
  const insp = (await one<{ id: string }>(
    db,
    `insert into inspections (site_id, title, type, inspector_name, inspected_on, status) values ($1, 'Weekly scaffold & access inspection', 'Scheduled inspection', 'Naledi Khumalo', $2, 'open') returning id`,
    [alpha, day(-8)],
  ))!.id;
  await db.query(
    `insert into defects (inspection_id, description, severity, status, assigned_to, due_date) values
       ($1, 'Guardrail missing on east scaffold platform, level 2', 'high', 'resolved', 'ABC Electrical', $2),
       ($1, 'Fire extinguisher inspection tag expired in the site office', 'low', 'assigned', 'ABC Electrical', $3)`,
    [insp, day(-6), day(2)],
  );
  await db.query(
    `insert into incidents (site_id, type, occurred_on, description, immediate_actions, reported_by, reported_by_name, reported_by_role, reported_by_org_id, status, root_cause, corrective_actions, closed_at)
     values ($1, 'near_miss', $2, 'Dropped spanner from level 2 scaffold during guardrail fit — no injury, tools now lanyarded above level 1.',
             'Work paused, area cleared, tool lanyard policy briefed to crew.', $3, 'Sipho Ndlovu', 'Contractor Admin', $4, 'closed',
             'No lanyard requirement enforced above level 1 at the time.', 'Mandatory tool lanyards above level 1, added to toolbox talk.', $5)`,
    [alpha, day(-8), sipho, abcId, ts(-7, 8)],
  );
  await db.query(
    `insert into permits (site_id, type, location, description, precautions, issued_to, issued_by_name, requested_by_name, valid_from, valid_to, status, closed_by_name, closed_at, close_notes)
     values ($1, 'hot_work', 'MCC panel 3, drive station', 'Grinding and welding on bracket repair', 'Fire watch posted, extinguisher on site, area cleared of combustibles',
             'Sipho Ndlovu crew', 'Naledi Khumalo', 'Sipho Ndlovu', $2, $3, 'closed', 'Sipho Ndlovu', $4, 'Work complete, area inspected, no residual hazards.'),
            ($1, 'heights', 'Conveyor gantry, level 2', 'Cable tray installation above 1.8m', 'Harnesses inspected, exclusion zone below, rescue plan briefed',
             'Sipho Ndlovu crew', '', 'Sipho Ndlovu', null, null, 'pending', null, null, '')`,
    [alpha, ts(-5, 7), ts(-5, 16), ts(-5, 15)],
  );
  for (const [off, crew, weather, summary, incident, note] of [
    [-4, 6, 'Clear, 18°C', 'Cable pulling on conveyor drive station level 2. Isolation confirmed with mine control before start.', false, ''],
    [-5, 5, 'Overcast, light dust', 'Terminations at MCC panel 3. Held toolbox talk on isolation procedure following SHE correction.', false, ''],
    [-8, 6, 'Clear, 21°C', 'Scaffold erected for drive station access. Guardrail fitted after morning inspection flag.', true, 'Near-miss: dropped spanner from level 2, no injury. Tool lanyards now mandatory above level 1.'],
  ] as const) {
    await db.query(
      `insert into diary_entries (site_id, entry_date, author_id, author_name, crew, weather, summary, incident, incident_note) values ($1, $2, $3, 'Sipho Ndlovu', $4, $5, $6, $7, $8)`,
      [alpha, day(off), sipho, crew, weather, summary, incident, note],
    );
  }

  // Workforce: ABC's crew on Leeuwpan with per-worker certificates.
  const workers: [string, string, string][] = [
    ['Themba Dlamini', 'Electrician', 'E-104'],
    ['Lerato Molefe', 'Electrician', 'E-117'],
    ['Pieter van Wyk', 'Rigger', 'R-021'],
    ['Nomsa Zulu', 'Safety Officer', 'S-003'],
  ];
  const workerIds: string[] = [];
  for (const [i, [name, occ, emp]] of workers.entries()) {
    const w = (await one<{ id: string }>(
      db,
      `insert into workers (org_id, full_name, occupation, employee_no, id_last4) values ($1, $2, $3, $4, $5) returning id`,
      [abcId, name, occ, emp, String(4021 + i * 1111).slice(-4)],
    ))!.id;
    workerIds.push(w);
    await db.query('insert into site_workers (site_id, worker_id) values ($1, $2)', [alpha, w]);
    await db.query(
      `insert into worker_certificates (worker_id, kind, name, issuer, issued_on, expires_on, created_by_name) values
         ($1, 'medical_fitness', 'Certificate of fitness (MHSA s12/13)', 'Leeuwpan Occupational Health Centre', $2, $3, 'Sipho Ndlovu'),
         ($1, 'induction', 'Leeuwpan site induction', 'Leeuwpan Colliery', $4, $5, 'Sipho Ndlovu')`,
      [w, day(-350 + i * 20), day(i === 1 ? 9 : i === 2 ? -3 : 200), day(-40), day(325)],
    );
    if (occ === 'Electrician' || occ === 'Rigger') {
      await db.query(
        `insert into worker_certificates (worker_id, kind, name, issuer, issued_on, expires_on, created_by_name) values ($1, 'training', 'Working at heights', 'Heights Training SA', $2, $3, 'Sipho Ndlovu')`,
        [w, day(-200), day(i === 0 ? 20 : 500)],
      );
    }
  }
  await db.query(
    `insert into appointments (org_id, site_id, appointee_name, worker_id, appointment_type, legal_reference, appointed_by, start_date, created_by_name) values
       ($1, $2, 'Nomsa Zulu', $3, 'Construction supervisor', 'Construction Regulations 8(7)', 'Sipho Ndlovu', $4, 'Sipho Ndlovu'),
       ($5, $2, 'Naledi Khumalo', null, 'Safety officer', 'Appointed under the mine''s SHE management system', 'Thabo Mokoena', $6, 'Thabo Mokoena')`,
    [abcId, alpha, workerIds[3], day(-40), hostId, day(-400)],
  );
  const talk = (await one<{ id: string }>(
    db,
    `insert into toolbox_talks (site_id, org_id, topic, content, presenter_name, held_on) values ($1, $2, 'Isolation and lock-out before work on the drive station',
       'Why we isolate at the source, how to apply personal locks, and why we test before touch.', 'Nomsa Zulu', $3) returning id`,
    [alpha, abcId, day(-5)],
  ))!.id;
  // A tiny transparent PNG stands in for the demo signatures.
  const sig = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  for (const [i, w] of workerIds.slice(0, 3).entries()) {
    await db.query(`insert into toolbox_attendance (talk_id, worker_id, attendee_name, signature) values ($1, $2, $3, $4)`, [talk, w, workers[i][0], sig]);
  }

  const auditRows: [string, string | null, string, string, string, string, number][] = [
    [hostId, alpha, 'Thabo Mokoena', 'Group Compliance Manager', 'Created site', 'Leeuwpan Colliery — Shaft 3 Conveyor Rewire', -43],
    [hostId, alpha, 'Thabo Mokoena', 'Group Compliance Manager', 'Invited contractor', 'ABC Electrical Pty Ltd to Leeuwpan Shaft 3', -43],
    [abcId, alpha, 'Sipho Ndlovu', 'Contractor Admin', 'Submitted document', '5 company documents for Leeuwpan Shaft 3', -41],
    [abcId, alpha, 'Sipho Ndlovu', 'Contractor Admin', 'Submitted document', 'Site-specific method statement and emergency plan', -35],
    [hostId, alpha, 'Naledi Khumalo', 'Mine SHE Officer', 'Requested correction', 'Baseline risk assessment — live electrical work controls', -5],
    [abcId, alpha, 'Sipho Ndlovu', 'Contractor Admin', 'Submitted document', 'Environmental impact addendum for Leeuwpan Shaft 3', -3],
    [hostId, substation, 'Naledi Khumalo', 'Mine SHE Officer', 'Approved — Site Ready', 'Merafe Ferrochrome Substation Refurbishment, contractor Voltrix Electrical Contractors', -113],
  ];
  for (const [orgId, siteId, actor, role, action, detail, off] of auditRows) {
    await db.query(
      `insert into audit_events (org_id, site_id, actor_name, actor_role, action, detail, created_at) values ($1, $2, $3, $4, $5, $6, $7)`,
      [orgId, siteId, actor, role, action, detail, ts(off, 10)],
    );
  }

  return {
    group,
    entryUserId: naledi,
    personas: [
      { userId: naledi, name: 'Naledi Khumalo', label: 'Site Reviewer · Highveld Mining' },
      { userId: thabo, name: 'Thabo Mokoena', label: 'Org Owner · Highveld Mining' },
      { userId: sipho, name: 'Sipho Ndlovu', label: 'Contractor · ABC Electrical' },
      { userId: marie, name: 'Marié Botha', label: 'Contractor · SteelWorks' },
      { userId: johan, name: 'Johan Pretorius', label: 'Contractor · Voltrix' },
    ],
  };
}
