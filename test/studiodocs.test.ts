/**
 * Uploaded documents as required submissions, permanent delete, folders, and document style (colours,
 * monochrome, industry). Every write is also tried by the wrong role and by another organisation.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, PDF, lastEmailToken, pool, setup, signup, teardown, uniqueEmail } from './helpers.js';
import { storage } from '../src/lib/storage.js';
import { documentColours, brandingOf } from '../src/lib/studio/generate.js';
import { BLUEPRINTS, tailorLegalForIndustry } from '../src/lib/studio/blueprints.js';

let app: FastifyInstance;
let mine: Agent, staff: Agent, reviewer: Agent, contractor: Agent, late: Agent, stranger: Agent, otherMine: Agent;
let wp = '', code = '', otherWp = '', tplId = '';
const upload = (a: Agent, meta: Record<string, unknown>, filename = 'template.pdf') => {
  const b = '----sd' + Math.random().toString(16).slice(2);
  const payload = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(meta)}\r\n`),
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`), PDF, Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  return a.req('POST', '/api/org-docs', payload, { 'content-type': `multipart/form-data; boundary=${b}` });
};
const invite = async (owner: Agent, role: string) => {
  const email = uniqueEmail(role);
  await owner.post('/api/org/invites', { email, role });
  return (await signup(app, { orgName: '', orgKind: 'host', email, inviteToken: await lastEmailToken(email, '/invite') })).agent;
};
const reqFor = async (a: Agent, name: string) => {
  const st = (await a.state()).state;
  for (const list of Object.values(st.requirements) as { id: string; name: string; template: { id: string; name: string } | null }[][]) {
    const r = list.find((x) => x.name === name); if (r) return r;
  }
  return null;
};

before(async () => {
  app = await setup();
  ({ agent: mine } = await signup(app, { orgName: 'Template Mining', orgKind: 'host' }));
  staff = await invite(mine, 'member');
  reviewer = await invite(mine, 'reviewer');
  wp = (await mine.post('/api/workplaces', { name: 'Hot Shaft', packIds: [] })).body.id;
  code = (await mine.state()).state.workplaces[wp].code;
  ({ agent: contractor } = await signup(app, { orgName: 'Template Welding', orgKind: 'contractor' }));
  assert.equal((await contractor.post('/api/sites/join', { code })).status, 200);
  ({ agent: late } = await signup(app, { orgName: 'Late Joiners', orgKind: 'contractor' }));
  ({ agent: stranger } = await signup(app, { orgName: 'Stranger Rigging', orgKind: 'contractor' }));
  ({ agent: otherMine } = await signup(app, { orgName: 'Other Template Mine', orgKind: 'host' }));
  otherWp = (await otherMine.post('/api/workplaces', { name: 'Theirs', packIds: [] })).body.id;
});
after(teardown);

describe('mine marks an upload as a required submission', () => {
  it('only the mine’s admins can, and the template stays private until then', async () => {
    tplId = (await upload(mine, { name: 'Hot Work Permit Form', docType: 'template', scope: 'site', workplaceId: wp })).body.id;
    assert.equal((await contractor.get(`/api/org-docs/${tplId}/file`)).status, 404, 'internal until required');
    assert.equal((await staff.post(`/api/org-docs/${tplId}/require`, { workplaceId: wp })).status, 403);
    assert.equal((await otherMine.post(`/api/org-docs/${tplId}/require`, { workplaceId: otherWp })).status, 404);
    assert.ok([403, 404].includes((await contractor.post(`/api/org-docs/${tplId}/require`, { workplaceId: wp })).status));
    assert.equal((await mine.post(`/api/org-docs/${tplId}/require`, { workplaceId: otherWp })).status, 404, 'not another mine’s site');
    const medical = (await upload(mine, { name: 'Medical Records', visibility: 'restricted' })).body.id;
    assert.equal((await mine.post(`/api/org-docs/${medical}/require`, { workplaceId: wp })).status, 409, 'a restricted document is never shared by accident');
    assert.equal((await pool.query('select visibility from org_documents where id = $1', [medical])).rows[0].visibility, 'restricted');
  });

  it('becomes a requirement in every contractor’s file, with the template to download, complete and submit', async () => {
    const r = await mine.post(`/api/org-docs/${tplId}/require`, { workplaceId: wp, category: 'Permits' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.contractorsUpdated, 1);
    assert.equal((await mine.post(`/api/org-docs/${tplId}/require`, { workplaceId: wp })).status, 409, 'not twice');
    const req = await reqFor(contractor, 'Hot Work Permit Form');
    assert.ok(req, 'in the contractor’s file');
    assert.equal(req!.template!.id, tplId);
    assert.equal((await contractor.get(`/api/org-docs/${tplId}/file?download=1`)).status, 200, 'the template downloads');
    assert.equal((await stranger.get(`/api/org-docs/${tplId}/file`)).status, 404);
    // fill it in and submit it through the normal flow
    assert.equal((await contractor.upload(`/api/documents/${req!.id}/file`, 'completed-permit.pdf', PDF)).status, 200);
    const sub = await contractor.post(`/api/documents/${req!.id}/submit`, {});
    assert.equal(sub.status, 200, JSON.stringify(sub.body));
    const minesView = (await mine.state()).state.documents[req!.id];
    assert.equal(minesView.status, 'awaiting_review', 'the mine reviews it as usual');
    const detail = (await mine.get(`/api/org-docs/${tplId}`)).body;
    assert.equal(detail.requiredAt[0].name, 'Hot Shaft');
  });

  it('contractors who join later get it too', async () => {
    assert.equal((await late.post('/api/sites/join', { code })).status, 200);
    const req = await reqFor(late, 'Hot Work Permit Form');
    assert.equal(req?.template?.id, tplId);
  });
});

describe('deleting uploaded documents', () => {
  it('is refused for Site Staff, other organisations and other people’s uploads', async () => {
    const own = (await upload(reviewer, { name: 'Reviewer Notes' })).body.id;
    const owners = (await upload(mine, { name: 'Owner Policy' })).body.id;
    assert.equal((await staff.del(`/api/org-docs/${owners}`)).status, 403);
    assert.equal((await contractor.del(`/api/org-docs/${owners}`)).status, 404);
    assert.equal((await otherMine.del(`/api/org-docs/${owners}`)).status, 404);
    assert.equal((await reviewer.del(`/api/org-docs/${owners}`)).status, 403, 'not someone else’s upload');
    assert.equal((await reviewer.del(`/api/org-docs/${own}`)).status, 200, 'your own is fine');
    assert.equal((await mine.del(`/api/org-docs/${owners}`)).status, 200, 'an owner may');
  });

  it('erases the stored file and every version, and a requirement made from it keeps working without the template', async () => {
    const key = (await pool.query(`select f.storage_key from org_documents d join files f on f.id = d.current_file_id where d.id = $1`, [tplId])).rows[0].storage_key;
    const r = await mine.del(`/api/org-docs/${tplId}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.filesErased, 1);
    await assert.rejects(storage.read(key));
    assert.equal((await pool.query('select 1 from org_document_versions where document_id = $1', [tplId])).rowCount, 0);
    const req = await reqFor(contractor, 'Hot Work Permit Form');
    assert.ok(req, 'the requirement and its submission stay');
    assert.equal(req!.template, null);
    assert.equal((await contractor.get(`/api/org-docs/${tplId}/file`)).status, 404);
    const docs = (await contractor.state()).state.documents[req!.id];
    assert.equal(docs.status, 'awaiting_review', 'the contractor’s submission is untouched');
  });
});

describe('folders', () => {
  let folder = '', docId = '';
  it('a mine makes folders for its sites and contractors; links must be its own', async () => {
    const f = await mine.post('/api/doc-folders', { name: 'Hot Shaft', workplaceId: wp });
    assert.equal(f.status, 200, JSON.stringify(f.body)); folder = f.body.id;
    assert.equal((await mine.post('/api/doc-folders', { name: 'Hot Shaft' })).status, 409);
    assert.equal((await mine.post('/api/doc-folders', { name: 'Theirs', workplaceId: otherWp })).status, 404);
    const contractorRow = (await mine.state()).state.sites[Object.keys((await mine.state()).state.sites)[0]].contractorId;
    assert.equal((await mine.post('/api/doc-folders', { name: 'Welding Co', contractorId: contractorRow })).status, 200);
    assert.equal((await mine.post('/api/doc-folders', { name: 'Both', workplaceId: wp, contractorId: contractorRow })).status, 400);
    assert.equal((await otherMine.post('/api/doc-folders', { name: 'Steal', contractorId: contractorRow })).status, 404);
    assert.equal((await staff.post('/api/doc-folders', { name: 'Staff folder' })).status, 403);
  });

  it('a contractor makes a folder for the site it works on, never for the mine’s own records', async () => {
    const st = await contractor.state();
    const siteId = Object.keys(st.state.sites)[0];
    assert.equal((await contractor.post('/api/doc-folders', { name: 'Template Mining — Hot Shaft', siteId })).status, 200);
    assert.equal((await contractor.post('/api/doc-folders', { name: 'Mine site', workplaceId: wp })).status, 404);
    assert.equal((await stranger.post('/api/doc-folders', { name: 'Not mine', siteId })).status, 404);
  });

  it('documents move in and out; deleting a folder keeps its documents', async () => {
    docId = (await upload(mine, { name: 'Shaft Plan', folderId: folder })).body.id;
    let list = (await mine.get('/api/org-docs')).body.documents;
    assert.equal(list.find((d: { id: string }) => d.id === docId).folderId, folder);
    assert.equal((await mine.get('/api/doc-folders')).body.folders.find((f: { id: string }) => f.id === folder).documents, 1);
    assert.equal((await otherMine.post(`/api/org-docs/${docId}/folder`, { folderId: null })).status, 404);
    const theirFolder = (await otherMine.post('/api/doc-folders', { name: 'Their folder' })).body.id;
    assert.equal((await mine.post(`/api/org-docs/${docId}/folder`, { folderId: theirFolder })).status, 404, 'not into another organisation’s folder');
    assert.equal((await mine.del(`/api/doc-folders/${folder}`)).status, 200);
    list = (await mine.get('/api/org-docs')).body.documents;
    assert.equal(list.find((d: { id: string }) => d.id === docId).folderId, null, 'document kept');
  });
});

describe('document style and industry', () => {
  it('only admins change it; it is saved and shown', async () => {
    assert.equal((await staff.patch('/api/org/branding', { monochrome: true })).status, 403);
    assert.equal((await mine.patch('/api/org/branding', { accentColor: 'red' })).status, 400);
    assert.equal((await mine.patch('/api/org/branding', { accentColor: '#6E9C80', monochrome: true, industry: 'quarrying' })).status, 200);
    const b = (await mine.state()).org.branding;
    assert.equal(b.accentColor, '#6E9C80'); assert.equal(b.monochrome, true); assert.equal(b.industry, 'quarrying');
  });

  it('monochrome uses black and greys and the greyscale logo; colour mode uses the brand colours', () => {
    const base = { brandColor: '#B8430F', accentColor: '#6E9C80', monochrome: false, industry: 'mining' as const, docPrefix: 'X', logoFileId: 'colour-logo', logoMonoFileId: 'grey-logo' };
    assert.deepEqual(documentColours(base), { brandColor: '#B8430F', accentColor: '#6E9C80', logoFileId: 'colour-logo' });
    const mono = documentColours({ ...base, monochrome: true });
    assert.equal(mono.logoFileId, 'grey-logo');
    for (const c of [mono.brandColor, mono.accentColor!]) { const [r, g, bl] = [1, 3, 5].map((i) => c.slice(i, i + 2)); assert.ok(r === g && g === bl, c + ' is grey'); }
    assert.equal(documentColours({ ...base, monochrome: true, logoMonoFileId: null }).logoFileId, null, 'no grey logo: company name instead of a colour logo');
  });

  it('legal references follow the industry and nothing is invented', () => {
    const bp = BLUEPRINTS.find((x) => x.build({ values: {}, company: { name: 'X' }, preparer: { name: 'Y' } }).sections.some((s) => s.heading === 'Legal and other requirements'))!;
    const content = bp.build({ values: {}, company: { name: 'X' }, preparer: { name: 'Y' } });
    const legal = (c: typeof content) => c.sections.find((s) => s.heading === 'Legal and other requirements')!.blocks.flatMap((b) => (b.type === 'bullets' ? b.items : []));
    const mining = legal(tailorLegalForIndustry(content, 'mining'));
    assert.ok(mining.includes('Mine Health and Safety Act 29 of 1996 (MHSA) and its regulations'));
    const quarry = legal(tailorLegalForIndustry(content, 'quarrying'));
    assert.ok(quarry.some((x) => /quarries are mines/.test(x)));
    const building = legal(tailorLegalForIndustry(content, 'construction'));
    assert.ok(!building.some((x) => /MHSA/.test(x)));
    assert.ok(building.includes('Construction Regulations, 2014'));
    const energy = legal(tailorLegalForIndustry(content, 'energy'));
    assert.ok(!energy.some((x) => /MHSA|Construction Regulations/.test(x)));
    assert.ok(energy.some((x) => /Occupational Health and Safety Act/.test(x)), 'OHS Act always applies');
    assert.equal(legal(content).length - mining.length, 0, 'mining keeps every line');
  });

  it('a generated document for a construction contractor leaves the MHSA out', async () => {
    assert.equal((await contractor.patch('/api/org/branding', { industry: 'construction' })).status, 200);
    const cat = (await contractor.get('/api/studio/blueprints')).body.blueprints;
    const bp = BLUEPRINTS.find((x) => cat.some((c: { id: string }) => c.id === x.id) && x.build({ values: {}, company: { name: 'X' }, preparer: { name: 'Y' } }).sections.some((s) => s.heading === 'Legal and other requirements'))!;
    const r = await contractor.post('/api/studio/documents', { blueprintId: bp.id, values: { scope: 'Scaffold erection for a new office block', topic: 'Working at heights' } });
    assert.equal(r.status, 200, JSON.stringify(r.body) + ' ' + bp.id);
    const content = (await pool.query('select content from generated_documents where id = $1', [r.body.id])).rows[0].content;
    const text = JSON.stringify(content.sections.find((s: { heading: string }) => s.heading === 'Legal and other requirements'));
    assert.doesNotMatch(text, /Mine Health and Safety Act/);
    assert.match(text, /Construction Regulations, 2014/);
    void brandingOf;
  });

  it('the greyscale logo upload is admin-only and replaced when the colour logo changes', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const r = await mine.req('POST', '/api/org/logo?variant=mono', Buffer.concat([
      Buffer.from('------l\r\nContent-Disposition: form-data; name="file"; filename="grey.png"\r\nContent-Type: image/png\r\n\r\n'), png, Buffer.from('\r\n------l--\r\n')]), { 'content-type': 'multipart/form-data; boundary=----l' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok((await mine.state()).org.branding.logoMonoFileId);
    assert.equal((await staff.req('POST', '/api/org/logo?variant=mono', Buffer.from('x'), { 'content-type': 'multipart/form-data; boundary=----l' })).status, 403);
  });
});
