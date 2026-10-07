/**
 * Public privacy notice and terms of use. They describe what the software
 * actually does with data; the legal wording is deliberately left as a draft
 * for the operator's attorney (see docs/LAUNCH_GUIDE.md). Nothing here claims
 * a certification or a legal position COMVERA has not been given.
 */
import type { FastifyInstance } from 'fastify';
import { config, features } from '../config.js';
import { esc, page } from './share.js';

const DRAFT = `<div class="card" style="border-color:var(--red)"><strong>Draft — awaiting legal review.</strong>
<p class="sub" style="margin:4px 0 0">This page describes how the COMVERA software handles information. The operator of this service must have it reviewed by an attorney (including for POPIA) before relying on it.</p></div>`;

const FOOT = 'COMVERA keeps records and shows their status. It does not certify legal compliance and is not legal advice. <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · <a href="/">Home</a>';

const contact = () =>
  config.SUPPORT_EMAIL
    ? `<a href="mailto:${esc(config.SUPPORT_EMAIL)}">${esc(config.SUPPORT_EMAIL)}</a>`
    : 'the operator of this service (contact details to be added)';

function privacy(): string {
  const processors = [
    'Hosting and database provider (where the service runs).',
    'File storage provider for uploaded documents.',
    features.email ? 'Email delivery provider for invitations, reminders and notifications.' : null,
    features.billing ? 'Stripe, for subscriptions and card payments. COMVERA never sees or stores card numbers.' : null,
    features.ai ? 'Anthropic, for AI drafting and reading expiry dates, called from the server only, when someone uses an AI feature. API keys are never sent to the browser.' : null,
  ].filter(Boolean);
  return `${DRAFT}
<div class="card"><h1>Privacy notice</h1><p class="sub">How COMVERA handles personal information</p>
<h3>Who is responsible</h3>
<p>Each organisation (a mine, principal employer or contractor) decides what it records about its own people and projects, and is responsible for that information. The operator of this COMVERA service processes it on their behalf. Questions: ${contact()}.</p>
<h3>What is recorded</h3>
<ul>
<li><strong>Accounts:</strong> name, email address, job title and phone number if given, and a securely hashed password (never stored in readable form).</li>
<li><strong>Company details:</strong> registration, COID and VAT numbers, address and trade, entered by the organisation.</li>
<li><strong>Workers:</strong> name, employee number, occupation and phone. Only the <em>last four digits</em> of an ID number are kept. Medicals, inductions, training certificates and signed attendance registers that the employer uploads or records.</li>
<li><strong>Safety file documents</strong> uploaded or generated for a site or project, with their review history.</li>
<li><strong>Activity:</strong> an audit trail of who did what and when, which cannot be edited; sign-in sessions (with IP address and browser) so accounts can be protected.</li>
</ul>
<h3>Why</h3>
<p>To keep contractor safety files and site records, show their status to the parties working together on a site, send reminders before documents expire, and keep a trustworthy history of changes.</p>
<h3>Who can see it</h3>
<p>Only members of the organisation that owns the record, and — for a site file — the mine and the contractor on that file. Gate pages show names and clearance only, never ID numbers or certificates. Share links are created deliberately, expire, and can be revoked.</p>
<h3>Service providers</h3><ul>${processors.map((p) => `<li>${p}</li>`).join('')}</ul>
<h3>Security</h3>
<p>Every request is checked on the server against the caller's organisation and role. In production, data travels only over HTTPS. Sign-in attempts are rate-limited and accounts lock after repeated failures.</p>
<h3>Your choices</h3>
<p>An organisation's administrator can download a copy of the organisation's data (More → Organisation settings → Download our data), correct records, and remove members. To ask for access to, correction of, or deletion of your personal information, contact your organisation's administrator or ${contact()}. Records needed for the audit trail may have to be kept; the operator will explain what can be removed.</p>
<h3>To be completed by the operator</h3>
<ul><li>Legal entity name, registration and Information Officer details.</li><li>Retention periods for each kind of record.</li><li>Where the data is hosted, and any cross-border transfer basis.</li><li>How to lodge a complaint with the Information Regulator.</li></ul>
</div>`;
}

function terms(): string {
  return `${DRAFT}
<div class="card"><h1>Terms of use</h1><p class="sub">The basics of using COMVERA</p>
<h3>What COMVERA is</h3>
<p>Software for keeping contractor safety files, site records and their review history. It shows the status of the records held in it.</p>
<h3>What COMVERA is not</h3>
<ul>
<li>It does not certify legal compliance and is not legal advice. Requirement lists are a starting point that each organisation must check for its own sites.</li>
<li>Documents drafted with templates or AI are drafts. A competent person must check, sign and take responsibility for them.</li>
<li>"Site Ready", gate clearance and readiness percentages reflect the records in COMVERA and the approvals given by the people using it.</li>
</ul>
<h3>Your responsibilities</h3>
<ul><li>Keep your sign-in details private and invite only people who should have access.</li><li>Upload only information you are entitled to share, and keep it accurate.</li><li>Use share links with care: anyone with the link can view what it shows until it expires or is revoked.</li></ul>
<h3>Plans and payment</h3>
<p>${features.billing ? 'Paid plans are billed through Stripe. You can change or cancel your plan under Plan &amp; billing.' : 'Billing is not switched on for this service.'}</p>
<h3>To be completed by the operator</h3>
<ul><li>Legal entity, governing law and dispute resolution.</li><li>Service levels, liability limits and termination.</li><li>Fees, refunds and notice periods.</li></ul>
</div>`;
}

export default async function legalRoutes(app: FastifyInstance) {
  const send = (title: string, body: () => string) => async (_req: unknown, reply: import('fastify').FastifyReply) =>
    reply.type('text/html').header('cache-control', 'public, max-age=300').send(page(title, body(), FOOT));
  app.get('/privacy', send('Privacy notice', privacy));
  app.get('/terms', send('Terms of use', terms));
}
