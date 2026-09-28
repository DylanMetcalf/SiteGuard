/** The assistant and drafting without an AI key: rules-based answers, template drafts, and scoping. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, setup, signup, teardown, uniqueEmail } from './helpers.js';
import { recommendPacks } from '../src/lib/knowledge.js';

let app: FastifyInstance;
let host: Agent;
let otherHost: Agent;
let contractor: Agent;

const ask = (a: Agent, content: string) => a.post('/api/assistant', { messages: [{ role: 'user', content }] });

before(async () => {
  app = await setup();
  host = (await signup(app, { orgName: 'Delta Mining', orgKind: 'host' })).agent;
  otherHost = (await signup(app, { orgName: 'Epsilon Platinum', orgKind: 'host' })).agent;
  contractor = (await signup(app, { orgName: 'Weld Right', orgKind: 'contractor' })).agent;
  await host.post('/api/sites', { name: 'Kriel Conveyor Refurb', newContractor: { name: 'Sparky', email: uniqueEmail('sparky') }, templatePackIds: ['baseline'] });
});
after(teardown);

describe('knowledge', () => {
  it('matches work descriptions to starter packs', () => {
    assert.deepEqual(recommendPacks('general cleaning'), ['baseline']);
    assert.deepEqual(recommendPacks('Rewiring the MCC and welding brackets').sort(), ['baseline', 'electrical', 'hot-confined']);
    assert.ok(recommendPacks('scaffolding at the headgear').includes('heights-lifting'));
    assert.ok(recommendPacks('trench for a new pipeline').includes('civil-plant'));
  });
});

describe('assistant (no AI key)', () => {
  it('answers a requirements question and offers a site proposal to host admins', async () => {
    const r = await ask(host, 'What does the safety file need for electrical work and welding at Tweefontein Colliery in Mpumalanga?');
    assert.equal(r.status, 200);
    assert.equal(r.body.mode, 'offline');
    assert.match(r.body.reply, /Letter of Good Standing/);
    assert.match(r.body.reply, /Hot work/);
    const card = r.body.cards.find((c: any) => c.type === 'site_proposal');
    assert.ok(card, 'site proposal card');
    assert.deepEqual([...card.packIds].sort(), ['baseline', 'electrical', 'hot-confined']);
    assert.equal(card.name, 'Tweefontein Colliery');
    assert.equal(card.location, 'Mpumalanga');
  });

  it('gives contractors a checklist rather than a site proposal', async () => {
    const r = await ask(contractor, 'What documents do I need for welding inside a tank?');
    assert.equal(r.status, 200);
    assert.ok(!r.body.cards.some((c: any) => c.type === 'site_proposal'));
    const list = r.body.cards.find((c: any) => c.type === 'checklist');
    assert.ok(list.items.some((i: any) => /Confined space entry procedure/.test(i.name)));
  });

  it('reports only the caller\'s own sites', async () => {
    const mine = await ask(host, 'Which of my sites are behind?');
    assert.match(mine.body.reply, /Kriel Conveyor Refurb/);
    assert.ok(mine.body.cards.some((c: any) => c.type === 'open_site'));
    const theirs = await ask(otherHost, 'Which of my sites are behind?');
    assert.doesNotMatch(theirs.body.reply, /Kriel/);
    assert.deepEqual(theirs.body.cards, []);
    // The contractor hasn't accepted an invitation, so it sees nothing either.
    const c = await ask(contractor, 'How are my sites doing?');
    assert.doesNotMatch(c.body.reply, /Kriel/);
  });

  it('offers a draft when asked to write a document', async () => {
    const r = await ask(contractor, 'Draft a method statement for replacing idlers on conveyor 3');
    const card = r.body.cards.find((c: any) => c.type === 'draft');
    assert.equal(card.docType, 'Method statement');
    assert.equal(card.brief, 'Replacing idlers on conveyor 3');
  });

  it('validates the conversation and requires a session', async () => {
    assert.equal((await host.post('/api/assistant', { messages: [{ role: 'assistant', content: 'hi' }] })).status, 400);
    assert.equal((await host.post('/api/assistant', { messages: [] })).status, 400);
    assert.equal((await new Agent(app).post('/api/assistant', { messages: [{ role: 'user', content: 'hi' }] })).status, 401);
  });
});

describe('template drafting (no AI key)', () => {
  it('drafts a document from the job description', async () => {
    const r = await contractor.post('/api/ai/draft', { type: 'Site-specific risk assessment', brief: 'Welding new brackets on the thickener walkway' });
    assert.equal(r.status, 200);
    assert.equal(r.raw.headers['x-draft-mode'], 'template');
    const text = r.raw.body;
    assert.match(text, /SITE-SPECIFIC RISK ASSESSMENT/);
    assert.match(text, /Company: Weld Right/);
    assert.match(text, /Fire and explosion/);
    assert.match(text, /Hot work/);
    assert.match(text, /reviewed and completed by a competent person/);
  });

  it('rejects unknown document types', async () => {
    assert.equal((await contractor.post('/api/ai/draft', { type: 'Poem', brief: 'x' })).status, 400);
  });
});

describe('assistant and compliance agent together', () => {
  it('answers "what needs my attention" from the agent\'s findings', async () => {
    await host.post('/api/sites', { name: 'Empty Site', newContractor: { name: 'Sparky', email: uniqueEmail('sparky2') } });
    await host.post('/api/agent/run');
    const r = await ask(host, 'What needs my attention today?');
    assert.match(r.body.reply, /Empty Site has no required documents/);
    assert.equal(r.status, 200);
    assert.match(r.body.reply, /most urgent first/);
    assert.ok(r.body.cards.some((c: any) => c.type === 'open_site'));
    const other = await ask(otherHost, 'What needs my attention today?');
    assert.match(other.body.reply, /Nothing needs attention/);
  });
});

describe('support', () => {
  it('stores problem reports from signed-in users only', async () => {
    const r = await host.post('/api/feedback', { kind: 'problem', message: 'Upload button does nothing', context: { view: 'sites/compliance' } });
    assert.equal(r.status, 200);
    const { pool } = await import('./helpers.js');
    const row = (await pool.query(`select kind, message, context from feedback order by created_at desc limit 1`)).rows[0];
    assert.equal(row.message, 'Upload button does nothing');
    assert.equal(row.context.view, 'sites/compliance');
    assert.equal((await new Agent(app).post('/api/feedback', { message: 'hello there' })).status, 401);
  });

  it('accepts browser error reports', async () => {
    assert.equal((await new Agent(app).post('/api/client-errors', { message: 'TypeError: x is undefined', url: '/' })).status, 200);
  });
});
