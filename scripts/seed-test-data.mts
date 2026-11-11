/**
 * Creates a small, made-up world on a LOCAL server for manual testing, the walkthrough and the bots: a mine with a site,
 * documents, a folder and a required form, plus a contractor that has joined the site. Synthetic data only; localhost only.
 *   BASE_URL=http://localhost:3000 DATABASE_URL=… npx tsx scripts/seed-test-data.mts
 * Prints the sign-in details. (It marks the addresses as confirmed straight in the local database.)
 */
import { Bot, PDF, PW, db, tag } from './bots-lib.mts';

const mine = new Bot('seedmine'); const con = new Bot('seedcon');
for (const [b, kind, org] of [[mine, 'host', 'Demo Mine ' + tag], [con, 'contractor', 'Demo Contractor ' + tag]] as const) {
  const r = await b.signup(org, kind); if (r.status !== 200) throw new Error(`sign-up failed: ${r.status} ${r.text}`);
  await b.finishSetup();
}
const wp = (await mine.post('/api/workplaces', { name: 'Demo Shaft 1', packIds: ['baseline'] })).json.id as string;
const code = (await mine.get('/api/bootstrap')).json.state.workplaces[wp].code as string;
await con.post('/api/sites/join', { code });
const ids: string[] = [];
for (const [name, vis] of [['Site safety policy', 'contractors'], ['Emergency plan', 'internal'], ['Hot work permit form', 'contractors']] as const)
  ids.push((await mine.upload('/api/org-docs', name.toLowerCase().replace(/ /g, '-') + '.pdf', PDF, { name, visibility: vis, scope: 'site', workplaceId: wp })).json.id);
await mine.post('/api/doc-folders', { name: 'Permits', workplaceId: wp });
await mine.post(`/api/org-docs/${ids[2]}/require`, { workplaceId: wp, name: 'Hot work permit form' });
console.log(`Made-up accounts (password for both: ${PW})\n  Mine:       ${mine.email}\n  Contractor: ${con.email}\n  Site code:  ${code}`);
await db.end();
