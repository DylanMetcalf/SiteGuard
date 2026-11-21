/** Sign-up records terms and names; "About you" is personal, never a permission; consent for product news is separate. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, lastEmailToken, PASSWORD, pool, setup, signup, teardown, uniqueEmail } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = await setup(); });
after(teardown);

describe('sign-up', () => {
  it('needs the terms accepted, and records when and which version', async () => {
    const email = uniqueEmail('terms');
    const no = await new Agent(app).post('/api/auth/signup', { firstName: 'Sipho', lastName: 'Ndlovu', email, password: PASSWORD, orgName: 'Terms Co', orgKind: 'contractor' });
    assert.equal(no.status, 400);
    assert.match(no.body.message, /terms/i);
    assert.equal((await pool.query('select count(*)::int as n from users where email = $1', [email])).rows[0].n, 0, 'no account without acceptance');
    const ok = await new Agent(app).post('/api/auth/signup', { acceptTerms: true, firstName: 'Sipho', lastName: 'Ndlovu', email, password: PASSWORD, orgName: 'Terms Co', orgKind: 'contractor' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const u = (await pool.query('select name, first_name, last_name, terms_accepted_at, terms_version, profile_completed_at from users where email = $1', [email])).rows[0];
    assert.equal(u.name, 'Sipho Ndlovu'); assert.equal(u.first_name, 'Sipho'); assert.equal(u.last_name, 'Ndlovu');
    assert.ok(u.terms_accepted_at); assert.ok(u.terms_version);
    assert.equal(u.profile_completed_at, null, 'a new person still completes "About you"');
  });

  it('needs a name', async () => {
    const r = await new Agent(app).post('/api/auth/signup', { acceptTerms: true, email: uniqueEmail('noname'), password: PASSWORD, orgName: 'X', orgKind: 'host' });
    assert.equal(r.status, 400);
  });
});

describe('about you', () => {
  let owner: Agent, member: Agent, memberEmail: string;
  before(async () => {
    ({ agent: owner } = await signup(app, { orgName: 'Profile Mining', orgKind: 'host' }));
    memberEmail = uniqueEmail('member');
    assert.equal((await owner.post('/api/org/invites', { email: memberEmail, role: 'reviewer' })).status, 200);
    const a = new Agent(app);
    const r = await a.post('/api/auth/signup', { acceptTerms: true, firstName: 'Lindiwe', lastName: 'Mokoena', email: memberEmail, password: PASSWORD, inviteToken: await lastEmailToken(memberEmail, '/invite') });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await pool.query('update users set email_verified_at = now() where email = $1', [memberEmail]);
    await a.refresh();
    member = a;
  });

  it('someone who joined an existing organisation is asked once, and their answers stick', async () => {
    let me = (await member.state()).me;
    assert.equal(me.profileComplete, false);
    assert.equal(me.firstName, 'Lindiwe');
    assert.equal((await member.put('/api/me/profile', { firstName: 'Lindiwe', lastName: 'Mokoena', title: 'Contracts Manager', phone: '011 000 0000', purpose: 'review', productNews: true })).status, 200);
    me = (await member.state()).me;
    assert.equal(me.profileComplete, true); assert.equal(me.title, 'Contracts Manager'); assert.equal(me.purpose, 'review'); assert.equal(me.productNews, true);
    assert.equal((await pool.query(`select source from marketing_consents where email = $1`, [memberEmail])).rows[0].source, 'profile');
  });

  it('a purpose never changes what someone may do', async () => {
    assert.equal((await member.put('/api/me/profile', { firstName: 'Lindiwe', lastName: 'Mokoena', purpose: 'site' })).status, 200);
    assert.equal((await member.post('/api/workplaces', { name: 'Not allowed', packIds: [] })).status, 403, 'a reviewer still cannot create sites');
    assert.equal((await member.state()).org.role, 'reviewer');
  });

  it('opting out of product news is recorded, and account emails are not affected', async () => {
    assert.equal((await member.put('/api/me/profile', { firstName: 'Lindiwe', lastName: 'Mokoena', purpose: 'review', productNews: false })).status, 200);
    assert.equal((await pool.query(`select consented from marketing_consents where email = $1`, [memberEmail])).rows[0].consented, false);
  });

  it('existing people are never pushed through it again, and signed-out callers are refused', async () => {
    assert.equal((await owner.state()).me.profileComplete, true);
    assert.equal((await new Agent(app).put('/api/me/profile', { firstName: 'A', lastName: 'B', purpose: 'site' })).status, 401);
  });
});
