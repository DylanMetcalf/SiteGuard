/**
 * A clean demo sandbox: an empty mine (host) organisation and an empty contractor
 * organisation, each with one SHE manager persona, so someone can try SiteGuard
 * from a true first-time start on both sides without real accounts or email.
 * Rows are flagged is_demo with one demo_group like the sample sandbox, and
 * settings.cleanDemo keeps them for 30 days instead of 3.
 */
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/pool.js';
import { one } from '../db/pool.js';

export interface CleanDemoInput {
  hostName: string;
  contractorName: string;
  /** Optional second contractor, to show several contractors on one site. */
  contractorName2?: string;
  yourName: string;
}

export async function seedCleanDemo(db: Db, input: CleanDemoInput): Promise<{ group: string; entryUserId: string }> {
  const group = randomUUID();
  const tag = group.slice(0, 8);
  const org = async (name: string, kind: 'host' | 'contractor') =>
    (await one<{ id: string }>(
      db,
      `insert into organisations (name, kind, plan, subscription_status, seat_limit, is_demo, demo_group, settings)
       values ($1, $2, $3, 'active', 25, true, $4, $5) returning id`,
      [name, kind, kind === 'host' ? 'host_pro' : 'contractor_pro', group, JSON.stringify({ cleanDemo: true })],
    ))!.id;
  const user = async (orgId: string, title: string, slug: string) => {
    const u = (await one<{ id: string }>(
      db,
      `insert into users (email, name, title, is_demo, email_verified_at, last_active_org_id) values ($1, $2, $3, true, now(), $4) returning id`,
      [`${slug}+${tag}@demo.siteguard.invalid`, input.yourName, title, orgId],
    ))!.id;
    await db.query(`insert into memberships (org_id, user_id, role) values ($1, $2, 'owner')`, [orgId, u]);
    return u;
  };
  const hostId = await org(input.hostName, 'host');
  const contractorId = await org(input.contractorName, 'contractor');
  const hostUser = await user(hostId, 'SHE Manager (mine)', 'mine');
  await user(contractorId, 'SHE Manager (contractor)', 'contractor');
  if (input.contractorName2 && input.contractorName2.toLowerCase() !== input.contractorName.toLowerCase()) {
    await user(await org(input.contractorName2, 'contractor'), 'SHE Manager (contractor)', 'contractor2');
  }
  return { group, entryUserId: hostUser };
}
