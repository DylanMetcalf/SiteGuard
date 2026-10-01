/** What each plan includes lives in one list; the app is told, the server decides. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { setup, signup, teardown } from './helpers.js';
import { PLAN_FEATURES, planWith } from '../src/lib/entitlements.js';

let app: FastifyInstance;
before(async () => { app = await setup(); });
after(teardown);

describe('entitlements', () => {
  it('names the cheapest plan that includes a feature', () => {
    assert.equal(planWith('host', 'SHARE_LINKS')?.id, 'host_pro');
    assert.equal(planWith('contractor', 'AI_GENERATION')?.id, 'contractor_starter');
    assert.equal(planWith('contractor', 'SHARE_LINKS')?.id, 'contractor_pro');
    assert.equal(planWith('contractor', 'CONTRACTOR_PROJECTS')?.id, 'contractor_starter');

    for (const list of Object.values(PLAN_FEATURES)) assert.ok(list.includes('SAFETY_FILE_BUILDER'), 'everyone can build a safety file');
  });

  it('tells the web app what the organisation has (everything when billing is off)', async () => {
    const { agent } = await signup(app, { orgName: 'Xi Civils', orgKind: 'contractor' });
    const s = await agent.state();
    assert.equal(s.org.entitlements.SHARE_LINKS, true);
    assert.equal(s.org.entitlements.SAFETY_FILE_BUILDER, true);
  });
});
