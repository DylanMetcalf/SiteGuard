/**
 * Plan capacity, counted the same way everywhere it is checked or shown.
 *
 * A site subscription covers one physical site: each active workplace is a site, and a mine's
 * contractor files that sit outside any workplace together count as one more. A contractor plan
 * covers a number of connected sites: its own files at clients' sites and its own projects, but
 * never a file a subscribing site is sponsoring (the site pays for that one).
 */
import type { Db } from '../db/pool.js';
import { many, one } from '../db/pool.js';
import { sponsoredSiteIds } from './sponsorship.js';
import { HttpError } from './errors.js';

export async function hostSitesInUse(db: Db, orgId: string): Promise<number> {
  return Number((await one<{ n: number }>(
    db,
    `select (select count(*) from workplaces where org_id = $1 and archived_at is null)
          + (select case when exists (select 1 from sites where org_id = $1 and status <> 'declined' and workplace_id is null) then 1 else 0 end) as n`,
    [orgId],
  ))!.n);
}

/** Whether adding a contractor file outside a workplace would use up another site. */
export async function hasLooseFiles(db: Db, orgId: string): Promise<boolean> {
  return !!(await one(db, `select 1 from sites where org_id = $1 and status <> 'declined' and workplace_id is null limit 1`, [orgId]));
}

async function contractorFileIds(db: Db, orgId: string): Promise<string[]> {
  const rows = await many<{ id: string }>(
    db,
    `select s.id from sites s join contractors c on c.id = s.contractor_id
      where c.linked_org_id = $1 and s.status not in ('declined', 'invited')`,
    [orgId],
  );
  return rows.map((r) => r.id);
}

export async function contractorSitesInUse(db: Db, orgId: string): Promise<number> {
  const ids = await contractorFileIds(db, orgId);
  const sponsored = await sponsoredSiteIds(db, ids);
  return ids.filter((id) => !sponsored.has(id)).length;
}

/** Files at sites that currently sponsor this contractor: free, and not counted against the plan. */
export async function contractorSponsoredSites(db: Db, orgId: string): Promise<number> {
  const ids = await contractorFileIds(db, orgId);
  const sponsored = await sponsoredSiteIds(db, ids);
  return ids.filter((id) => sponsored.has(id)).length;
}

/** Worker records on file (people on site; they are not logins and never use a seat). */
export async function activeWorkers(db: Db, orgId: string): Promise<number> {
  return Number((await one<{ n: number }>(db, 'select count(*) as n from workers where org_id = $1 and active', [orgId]))?.n ?? 0);
}

export function siteLimitError(limit: number) {
  return new HttpError(402, 'site_limit', `Your subscription covers ${limit} site${limit === 1 ? '' : 's'}. Each further site needs its own subscription (or Enterprise for a group): contact COMVERA, or archive a site you no longer use.`);
}
