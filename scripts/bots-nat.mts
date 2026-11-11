/**
 * COMVERA bot swarm, scenario "one shared address": a whole shift of workers behind one office or site router (one public
 * IP), which is how many mines connect. Run against a server WITHOUT TRUST_PROXY, so every bot looks like the same visitor.
 * It measures how many ordinary people the per-address rate limits turn away in a minute. Synthetic data, localhost only.
 */
import { writeFileSync } from 'node:fs';
import { BASE, REPORT, check, db, rows, tag, PW } from './bots-lib.mts';

const N = Number(process.env.BOTS_PEOPLE || 40);
const post = (path: string, body: unknown, cookie = '') => fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
const people = Array.from({ length: N }, (_, i) => `shift${i}.${tag}@example.com`);

// invited sign-ups (they carry a valid invitation) must also get through from one shared address
{
  const { sha256 } = await import('../src/lib/security.ts');
  const owner = await post('/api/auth/signup', { name: 'Mine Owner', email: `mineowner.${tag}@example.com`, password: PW, orgName: `Shift Mine ${tag}`, orgKind: 'host' });
  const orgId = (await db.query(`select m.org_id from memberships m join users u on u.id = m.user_id where u.email = $1`, [`mineowner.${tag}@example.com`])).rows[0]?.org_id;
  let invOk = 0, invBlocked = 0;
  for (let i = 0; i < 30 && orgId; i++) {
    const tok = `inv-${tag}-${i}`;
    await db.query(`insert into user_invites (org_id, email, role, token_hash, invited_by, expires_at) select $1, $2, 'member', $3, u.id, now() + interval '1 day' from users u where u.email = $4`, [orgId, `staff${i}.${tag}@example.com`, sha256(tok), `mineowner.${tag}@example.com`]);
    const r = await post('/api/auth/signup', { name: 'Staff ' + i, email: `staff${i}.${tag}@example.com`, password: PW, inviteToken: tok });
    if (r.status === 200) invOk++; else if (r.status === 429) invBlocked++;
  }
  console.log(`Invited sign-ups from one address: ${invOk}/30 accepted, ${invBlocked} turned away`);
  check('nat', 'a site induction can register 30 invited staff from one shared address', owner.status === 200 && invBlocked === 0, `${invBlocked} of 30 turned away`);
}
// everyone is registered in the database first (a mine's staff were invited earlier; this scenario is about sign-in)
let created = 0, signupBlocked = 0;
for (const [i, email] of people.entries()) {
  const r = await post('/api/auth/signup', { name: 'Worker ' + i, email, password: PW, orgName: `Shift Co ${i} ${tag}`, orgKind: 'contractor' });
  if (r.status === 200) created++; else if (r.status === 429) signupBlocked++;
}
console.log(`Sign-up from one address: ${created}/${N} accepted, ${signupBlocked} turned away by the limit`);
// Plain sign-up creates a new COMPANY, so 40 of them from one address in a minute is abuse, not a shift: the tight limit is intended.
check('nat', 'plain company sign-up stays limited per address (anti-spam)', signupBlocked > 0, 'no limit applied');

await db.query(`update users set email_verified_at = now() where email like $1 or email like $2`, [`shift%.${tag}@example.com`, `staff%.${tag}@example.com`]);
let ok = 0, blocked = 0;
const loginPeople = [...people.slice(0, created), ...Array.from({ length: 30 }, (_, i) => `staff${i}.${tag}@example.com`)];
for (const email of loginPeople) {
  const r = await post('/api/auth/login', { email, password: PW });
  if (r.status === 200) ok++; else if (r.status === 429) blocked++;
}
console.log(`Sign-in from one address: ${ok}/${loginPeople.length} signed in, ${blocked} turned away by the limit`);
check('nat', `a shift of ${loginPeople.length} people can sign in within a minute from one shared address`, blocked === 0, `${blocked} of ${loginPeople.length} were turned away`);

const failed = rows.filter((r) => !r.ok);
writeFileSync(REPORT, JSON.stringify({ created, signupBlocked, ok, blocked, failed }, null, 2));
await db.end();
process.exit(failed.length ? 1 : 0);
