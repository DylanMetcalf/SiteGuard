// The manager portal (/manager): sign-in with a second step, then customers, what needs attention,
// the support inbox and the action log. Everything comes from /api/manager; nothing here is a
// shortcut around the server's checks. No inline handlers: buttons carry data-action.
import { api, setCsrf } from './api.js';

const root = document.getElementById('mg');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const d = (v) => (v ? new Date(v).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const dt = (v) => (v ? new Date(v).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const ago = (v) => {
  if (!v) return 'never';
  const m = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  return m < 2 ? 'just now' : m < 90 ? m + ' min ago' : m < 2880 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago';
};
const rands = (c) => 'R' + (Number(c || 0) / 100).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const STATUS = { complete: 'Approved', missing: 'Missing', expiring: 'Expiring', awaiting_review: 'Awaiting review', correction_required: 'Correction required' };
const card = (title, body) => (title ? '<div class="section-title">' + title + '</div>' : '') + '<div class="card">' + body + '</div>';
const row = (main, meta, actions, attrs = '') =>
  '<div class="mg-row' + (attrs ? ' click' : '') + '" ' + attrs + '><div class="mg-main"><div class="mg-name">' + main + '</div>' + (meta ? '<div class="mg-meta">' + meta + '</div>' : '') + '</div>' + (actions ? '<div class="mg-actions">' + actions + '</div>' : '') + '</div>';
const none = (t) => '<div class="mg-meta" style="padding:6px 0;">' + t + '</div>';

const S = { view: 'overview', orgId: null, support: null, filters: { q: '', kind: '', status: '' }, plans: null };
let toastTimer;
function toast(msg) {
  let t = document.getElementById('mgToast');
  if (!t) { t = document.createElement('div'); t.id = 'mgToast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
}
const top = (signedIn) => '<div class="mg-top"><div class="mg-brand"><img src="/icons/icon.svg" alt="">COMVERA <small>Manager</small></div>'
  + (signedIn ? '<button class="btn secondary small" data-action="signout">Sign out</button>' : '') + '</div>';
const field = (id, label, type = 'text', extra = '') => '<label class="field-label" for="' + id + '">' + label + '</label><input type="' + type + '" id="' + id + '" ' + extra + '>';
const val = (id) => (document.getElementById(id) ? document.getElementById(id).value.trim() : '');

/* ---------- sign-in and second step ---------- */
function loginView(msg) {
  root.innerHTML = top(false) + '<div class="mg-narrow"><h1>Manager sign-in</h1><div class="mg-sub">Use your COMVERA account. You will be asked for a code from your authenticator app next.</div>'
    + '<div class="card">' + (msg ? '<div class="notice" role="alert">' + esc(msg) + '</div>' : '')
    + field('mgEmail', 'Email', 'email', 'autocomplete="username" inputmode="email"') + field('mgPass', 'Password', 'password', 'autocomplete="current-password"')
    + '<button class="btn primary block" style="margin-top:12px;" data-action="login">Continue</button></div></div>';
  const e = document.getElementById('mgEmail'); if (e) e.focus();
}
function codeView(msg) {
  root.innerHTML = top(true) + '<div class="mg-narrow"><h1>Enter your code</h1><div class="mg-sub">Open your authenticator app and type the 6-digit code for COMVERA. Lost your phone? Use one of your recovery codes instead.</div>'
    + '<div class="card">' + (msg ? '<div class="notice" role="alert">' + esc(msg) + '</div>' : '')
    + field('mgCode', 'Code', 'text', 'autocomplete="one-time-code" inputmode="numeric" maxlength="20"')
    + '<button class="btn primary block" style="margin-top:12px;" data-action="verify">Sign in</button></div></div>';
  const e = document.getElementById('mgCode'); if (e) e.focus();
}
async function setupView(msg) {
  let s;
  try { s = await api.post('/api/manager/mfa/setup'); } catch (e) { return loginView(e.message); }
  const spaced = s.secret.replace(/(.{4})/g, '$1 ').trim();
  root.innerHTML = top(true) + '<div class="mg-narrow"><h1>Set up your second step</h1><div class="mg-sub">The manager portal needs a code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy or 1Password) every time you sign in.</div>'
    + '<div class="card">' + (msg ? '<div class="notice" role="alert">' + esc(msg) + '</div>' : '')
    + '<ol style="padding-left:18px;font-size:13.5px;line-height:1.6;margin:0 0 10px;"><li>In the app choose <strong>Add account</strong>, then <strong>Enter a setup key</strong>.</li><li>Name it COMVERA and type this key (letters, not case sensitive):</li></ol>'
    + '<div class="mg-code">' + esc(spaced) + '</div>'
    + '<div class="mg-meta" style="margin:6px 0 10px;">On a phone you can also <a href="' + esc(s.otpauth) + '">open it in your authenticator app</a>.</div>'
    + field('mgCode', 'Then type the 6-digit code it shows', 'text', 'autocomplete="one-time-code" inputmode="numeric" maxlength="6"')
    + '<button class="btn primary block" style="margin-top:12px;" data-action="enable">Turn on</button></div></div>';
}
function recoveryView(codes) {
  root.innerHTML = top(true) + '<div class="mg-narrow"><h1>Save your recovery codes</h1><div class="mg-sub">Each code works once if you lose your phone. They are shown <strong>only now</strong>. Store them somewhere safe and offline (a password manager or a printed page in a safe), not in email or chat.</div>'
    + '<div class="card"><div class="mg-codes">' + codes.map((c) => '<div>' + esc(c) + '</div>').join('') + '</div>'
    + '<button class="btn secondary block" data-action="print">Print</button><button class="btn primary block" style="margin-top:8px;" data-action="saved">I have saved them</button></div></div>';
}

/* ---------- the portal ---------- */
const NAV = [['overview', 'Overview'], ['customers', 'Customers'], ['attention', 'Needs attention'], ['inbox', 'Support inbox'], ['log', 'Activity log']];
function shell(body) {
  root.innerHTML = top(true) + '<nav class="mg-nav" aria-label="Manager sections">'
    + NAV.map(([v, l]) => '<button class="btn secondary small' + (S.view === v || (v === 'customers' && S.view === 'customer') ? ' on' : '') + '" data-action="nav" data-view="' + v + '">' + l + '</button>').join('') + '</nav>' + body;
}
const tile = (n, l, warn) => '<div class="mg-tile' + (warn && Number(n) > 0 ? ' warn' : '') + '"><b>' + esc(n) + '</b><span>' + l + '</span></div>';

async function overview() {
  const o = await api.get('/api/manager/overview');
  const kind = (k) => o.orgs.find((x) => x.kind === k) || { total: 0, last7: 0 };
  const st = (s) => (o.status.find((x) => x.s === s) || { n: 0 }).n;
  const ex = (s) => (o.exchanges.find((x) => x.status === s) || { n: 0 }).n;
  shell('<h1>Overview</h1><div class="mg-sub">Counts only. Real customers; demo and test accounts are left out.</div>'
    + '<div class="section-title">Customers</div><div class="mg-tiles">'
    + tile(kind('host').total, 'Mines / sites (+' + kind('host').last7 + ' this week)') + tile(kind('contractor').total, 'Contractors (+' + kind('contractor').last7 + ' this week)')
    + tile(o.users.total, 'People (+' + o.users.last7 + ' this week)') + tile(o.users.active7, 'Active in 7 days')
    + tile(st('trialing'), 'On trial') + tile(st('active'), 'Paying') + tile(o.pastDue, 'Payment overdue', true) + tile(rands(o.payments.paid30), 'Confirmed payments, 30 days') + '</div>'
    + '<div class="section-title">What has been created</div><div class="mg-tiles">'
    + tile(o.content.workplaces, 'Sites open') + tile(o.content.files, 'Contractor files') + tile(o.content.projects, 'Contractor projects') + tile(o.content.documentsFiled, 'Documents filed')
    + tile(o.content.studioDocs, 'Studio documents written') + tile(o.content.templates, 'Site templates') + tile(ex('requested') + ex('submitted'), 'Exchanges open') + tile(ex('approved'), 'Exchanges approved') + '</div>'
    + '<div class="section-title">Health</div><div class="mg-tiles">'
    + tile(o.email.failed, 'Emails failed (30 days)', true) + tile(o.email.pending, 'Emails waiting') + tile(o.email.sent7, 'Emails sent (7 days)') + tile(o.payments.failed14, 'Payments failed (14 days)', true) + tile(o.openInbox, 'Open support items', true) + '</div>'
    + (o.paidPlans.length ? card('Paying customers by plan', o.paidPlans.map((p) => row(esc(p.plan), '', '<b>' + p.n + '</b>')).join('')) : ''));
}

async function customers() {
  const f = S.filters;
  const q = new URLSearchParams({ q: f.q, kind: f.kind, status: f.status });
  const r = await api.get('/api/manager/orgs?' + q);
  shell('<h1>Customers</h1><div class="mg-filters"><input type="search" id="fq" placeholder="Search company or email" value="' + esc(f.q) + '">'
    + '<select id="fk"><option value="">All types</option><option value="host"' + (f.kind === 'host' ? ' selected' : '') + '>Mines / sites</option><option value="contractor"' + (f.kind === 'contractor' ? ' selected' : '') + '>Contractors</option></select>'
    + '<select id="fs"><option value="">Any status</option>' + ['trialing', 'active', 'past_due', 'canceled', 'free'].map((s) => '<option' + (f.status === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>'
    + '<button class="btn primary" data-action="filter">Search</button></div>'
    + card('', r.orgs.length ? r.orgs.map((o) => row(esc(o.name) + ' <span class="srctag">' + (o.kind === 'host' ? 'Mine / site' : 'Contractor') + '</span>',
      esc(o.plan) + ' · ' + esc(o.status) + (o.status === 'trialing' ? ' until ' + d(o.trialEndsAt) : '') + ' · ' + o.members + ' people · ' + o.workplaces + ' sites · ' + o.files + ' files · active ' + ago(o.lastActive) + ' · joined ' + d(o.createdAt),
      '', 'data-action="open-org" data-id="' + o.id + '" role="button" tabindex="0"')).join('') : none('No customers match.')));
}

async function customer() {
  const r = await api.get('/api/manager/orgs/' + S.orgId);
  const o = r.org, c = r.counts, st = c.documentsByStatus;
  if (!S.plans) { try { S.plans = (await api.get('/api/pricing')).plans; } catch { S.plans = []; } }
  const plans = S.plans.filter((p) => p.kind === o.kind).concat(o.kind === 'host' ? [{ planId: 'host_enterprise', name: 'Enterprise' }] : []);
  shell('<button class="btn ghost small" data-action="nav" data-view="customers">← All customers</button>'
    + '<h1 style="margin-top:8px;">' + esc(o.name) + '</h1><div class="mg-sub">' + (o.kind === 'host' ? 'Mine / site' : 'Contractor') + ' · joined ' + d(o.createdAt) + '</div>'
    + card('Plan and billing',
      row('Plan', esc(o.planName) + ' · ' + esc(o.status) + (o.status === 'trialing' ? ' until ' + d(o.trialEndsAt) : '') + (o.periodEnd ? ' · renews ' + d(o.periodEnd) : '') + ' · ' + o.seatLimit + ' seats'
        + (o.grantPlan ? '<br>Given plan: ' + esc(o.grantPlan) + (o.grantUntil ? ' until ' + d(o.grantUntil) : ', no end date') + ' (' + esc(o.grantSource || '') + ')' : '')
        + ' · ' + (o.hasPaystackSubscription ? 'Paystack subscription' : o.hasStripeSubscription ? 'Stripe subscription' : 'no subscription'))
      + '<div class="mg-filters" style="margin-top:10px;"><select id="trialDays"><option value="7">+7 days</option><option value="14">+14 days</option><option value="30">+30 days</option></select><button class="btn secondary small" data-action="extend-trial">Extend trial</button></div>'
      + '<div class="mg-filters"><select id="giveplan"><option value="">Remove any given plan</option>' + plans.map((p) => '<option value="' + esc(p.planId) + '">' + esc(p.name) + '</option>').join('') + '</select>'
      + '<input type="date" id="giveuntil" aria-label="Until (optional)"><input type="text" id="givenote" maxlength="100" placeholder="Note (e.g. pilot partner)"><button class="btn secondary small" data-action="give-plan">Give plan</button></div>')
    + card('What they have (counts only)',
      '<div class="mg-tiles">' + tile(c.workplaces, 'Sites') + tile(c.sites, 'Contractor files') + tile(c.projects, 'Projects') + tile(c.studio, 'Studio documents') + tile(c.libraryDocs, 'Company documents') + tile(c.exchanges, 'Exchanges') + tile(c.templates, 'Site templates') + tile(c.safetyFiles, 'Safety file versions') + '</div>'
      + '<div class="mg-meta">Documents: ' + Object.keys(STATUS).map((k) => (st[k] || 0) + ' ' + STATUS[k].toLowerCase()).join(' · ') + '</div>')
    + card('People', r.members.map((m) => row(esc(m.name) + ' <span class="srctag">' + esc(m.role) + '</span>',
      esc(m.email) + ' · ' + (m.verified ? 'email confirmed' : '<b>email not confirmed</b>') + ' · last seen ' + ago(m.lastSeen) + (m.emailProblem ? ' · <b>emails to them are failing</b>' : ''),
      '<button class="btn secondary small" data-action="reset-email" data-id="' + m.id + '" data-email="' + esc(m.email) + '">Send reset email</button>')).join(''))
    + card('Payments', r.payments.length ? r.payments.map((p) => row(rands(p.amountCents) + ' · ' + esc(p.kind) + ' · ' + esc(p.planId), esc(p.status) + (p.failureReason ? ' — ' + esc(p.failureReason) : '') + ' · ' + dt(p.paidAt || p.createdAt) + ' · ref ' + esc(p.reference))).join('') : none('No online payments yet.'))
    + card('Support access',
      r.supportAccess ? '<div class="mg-banner">The customer has allowed support access until ' + dt(r.supportAccess.expiresAt) + ' (by ' + esc(r.supportAccess.grantedBy) + (r.supportAccess.reason ? ': ' + esc(r.supportAccess.reason) : '') + ').</div>'
        + '<button class="btn primary" data-action="open-support">Open read-only account view</button><div class="mg-meta" style="margin-top:6px;">Shows sites, requirement and document names with their status, and recent activity. Never file contents. Each look is logged here and in the customer’s own activity history.</div>'
        : none('Not switched on. To see inside this account, ask their admin to open <strong>Settings → Support access</strong> and allow it for a few hours.'))
    + card('What you have done for this customer', r.actions.length ? r.actions.map((a) => row(esc(a.action), esc(a.detail) + ' · ' + esc(a.by) + ' · ' + dt(a.at))).join('') : none('Nothing yet.')));
}

async function supportView() {
  const r = await api.get('/api/manager/orgs/' + S.orgId + '/support-view');
  shell('<button class="btn ghost small" data-action="open-org" data-id="' + S.orgId + '">← Back to ' + esc(r.org.name) + '</button>'
    + '<h1 style="margin-top:8px;">' + esc(r.org.name) + ' — read-only view</h1><div class="mg-banner">Allowed by the customer until ' + dt(r.grantExpiresAt) + '. This look has been recorded. File contents are never shown.</div>'
    + card('Sites and files', r.sites.length ? '<div class="mg-scroll"><table class="mg-t"><tr><th>Name</th><th>Owner / contractor</th><th>Status</th><th>Requirements</th><th>Approved</th><th>Waiting</th><th>Corrections</th></tr>'
      + r.sites.map((s) => '<tr><td>' + esc(s.name) + '</td><td>' + esc(s.ownerName) + (s.contractorName ? ' / ' + esc(s.contractorName) : '') + '</td><td>' + esc(s.status) + '</td><td>' + s.requirements + '</td><td>' + s.approved + '</td><td>' + s.waiting + '</td><td>' + s.corrections + '</td></tr>').join('') + '</table></div>' : none('None.'))
    + card('Requirements and documents (names and status only)', r.documents.length ? '<div class="mg-scroll"><table class="mg-t"><tr><th>Site</th><th>Document</th><th>Status</th><th>Version</th><th>Expires</th><th>Updated</th></tr>'
      + r.documents.map((x) => '<tr><td>' + esc(x.siteName) + '</td><td>' + esc(x.name) + (x.optional ? ' <span class="srctag">optional</span>' : '') + '<div class="mg-meta">' + esc(x.category) + '</div></td><td>' + esc(STATUS[x.status] || x.status) + '</td><td>' + esc(x.version ?? '—') + '</td><td>' + d(x.expiryDate) + '</td><td>' + d(x.updatedAt) + '</td></tr>').join('') + '</table></div>' : none('None.'))
    + card('Recent activity', r.recentActivity.map((a) => row(esc(a.action), esc(a.detail) + ' · ' + esc(a.who) + ' (' + esc(a.role) + ') · ' + dt(a.at))).join('')));
}

async function attention() {
  const a = await api.get('/api/manager/attention');
  const org = (id, name) => '<a href="#" data-action="open-org" data-id="' + id + '">' + esc(name) + '</a>';
  shell('<h1>Needs attention</h1><div class="mg-sub">Things that are stuck or about to go wrong.</div>'
    + card('Emails that failed to send (' + a.failedEmails.length + ')', a.failedEmails.length ? a.failedEmails.map((e) => row(esc(e.to) + ' — ' + esc(e.subject), esc(e.error) + ' · ' + e.attempts + ' attempts · ' + dt(e.at), '<button class="btn secondary small" data-action="requeue" data-id="' + e.id + '">Try again</button>')).join('') : none('None. Good.'))
    + card('Payment overdue (' + a.pastDue.length + ')', a.pastDue.length ? a.pastDue.map((o) => row(org(o.id, o.name), esc(o.plan) + ' · period ended ' + d(o.periodEnd))).join('') : none('None.'))
    + card('Payments that failed or are stuck (' + a.payments.length + ')', a.payments.length ? a.payments.map((p) => row(org(p.orgId, p.name) + ' · ' + rands(p.amountCents), esc(p.status) + ' · ' + esc(p.kind) + (p.failureReason ? ' — ' + esc(p.failureReason) : '') + ' · ' + dt(p.at))).join('') : none('None.'))
    + card('Trials ending within 3 days (' + a.trialsEnding.length + ')', a.trialsEnding.length ? a.trialsEnding.map((o) => row(org(o.id, o.name), (o.kind === 'host' ? 'Mine / site' : 'Contractor') + ' · ends ' + dt(o.trialEndsAt))).join('') : none('None.'))
    + card('Signed up but never started (' + a.noActivity.length + ')', a.noActivity.length ? a.noActivity.map((o) => row(org(o.id, o.name), (o.kind === 'host' ? 'Mine / site' : 'Contractor') + ' · joined ' + d(o.createdAt) + ' · no site or file yet')).join('') : none('None.'))
    + card('Never confirmed their email (' + a.unverifiedUsers.length + ')', a.unverifiedUsers.length ? a.unverifiedUsers.map((u) => row(esc(u.name), esc(u.email) + ' · joined ' + d(u.createdAt), '<button class="btn secondary small" data-action="reset-email" data-id="' + u.id + '" data-email="' + esc(u.email) + '">Send reset email</button>')).join('') : none('None.'))
    + card('Support inbox', row(a.openInbox.feedback + ' feedback and ' + a.openInbox.enquiries + ' enquiries waiting', '', '<button class="btn secondary small" data-action="nav" data-view="inbox">Open</button>')));
}

async function inbox() {
  const r = await api.get('/api/manager/inbox');
  shell('<h1>Support inbox</h1><div class="mg-sub">Problems and ideas from inside the app, and enquiries from the contact page. Unhandled first.</div>'
    + card('', r.items.length ? r.items.map((i) => row(
      '<span class="srctag">' + (i.source === 'feedback' ? i.topic : 'enquiry · ' + esc(i.topic)) + '</span> ' + esc(i.name || i.email || 'Anonymous') + (i.company ? ' — ' + esc(i.company) : ''),
      esc(i.message) + '<br>' + (i.email ? esc(i.email) + ' · ' : '') + dt(i.at) + (i.handledAt ? ' · <b>handled ' + d(i.handledAt) + '</b>' + (i.note ? ': ' + esc(i.note) : '') : ''),
      (i.orgId ? '<button class="btn ghost small" data-action="open-org" data-id="' + i.orgId + '">Customer</button>' : '')
      + (i.handledAt ? '' : '<button class="btn secondary small" data-action="handle" data-source="' + i.source + '" data-id="' + i.id + '">Mark handled</button>'))).join('') : none('Nothing here.')));
}

async function log() {
  const r = await api.get('/api/manager/actions');
  shell('<h1>Activity log</h1><div class="mg-sub">Everything done from the manager portal, newest first. It cannot be edited or deleted.</div>'
    + card('', '<div class="mg-scroll"><table class="mg-t"><tr><th>When</th><th>Who</th><th>What</th><th>Customer</th><th>Detail</th></tr>'
      + r.actions.map((a) => '<tr><td>' + dt(a.at) + '</td><td>' + esc(a.by) + '</td><td>' + esc(a.action) + '</td><td>' + esc(a.orgName || '') + '</td><td>' + esc(a.detail) + '</td></tr>').join('') + '</table></div>'));
}

const VIEWS = { overview, customers, customer, support: supportView, attention, inbox, log };
async function show(view = S.view) {
  S.view = view;
  shell('<div class="mg-sub" style="padding:30px 0;text-align:center;">Loading…</div>');
  try { await VIEWS[view](); } catch (e) { handleError(e); }
}
function handleError(e) {
  if (e.code === 'mfa_required') return start();
  if (e.status === 401) return start();
  toast(e.message || 'Something went wrong');
  if (document.querySelector('.mg-sub') && /Loading/.test(root.textContent)) shell('<div class="notice" role="alert">' + esc(e.message) + '</div>');
}

/* ---------- start: where is this person in the sign-in? ---------- */
async function start(msg) {
  let b;
  try { b = await api.get('/api/bootstrap'); } catch { return loginView('Cannot reach COMVERA. Check your connection.'); }
  setCsrf(b.csrfToken);
  if (!b.authenticated) return loginView(msg);
  let me;
  try { me = await api.get('/api/manager/me'); } catch (e) {
    root.innerHTML = top(true) + '<div class="mg-narrow"><h1>No access</h1><div class="mg-sub">This account is not a COMVERA platform admin. Sign out and use the right account.</div></div>';
    return;
  }
  if (!me.enrolled) return setupView(msg);
  if (!me.verified) return codeView(msg);
  show(S.view);
}

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'open-org' && el.tagName === 'A') ev.preventDefault();
  try {
    if (a === 'login') {
      el.disabled = true;
      try { await api.post('/api/auth/login', { email: val('mgEmail'), password: document.getElementById('mgPass').value }); } catch (e) { el.disabled = false; return loginView(e.message); }
      return start();
    }
    if (a === 'verify') {
      el.disabled = true;
      try { const r = await api.post('/api/manager/mfa/verify', { code: val('mgCode') }); if (r.usedRecoveryCode) toast('Recovery code used. Make a note: it will not work again.'); } catch (e) { return codeView(e.message); }
      return start();
    }
    if (a === 'enable') {
      el.disabled = true;
      try { const r = await api.post('/api/manager/mfa/enable', { code: val('mgCode') }); return recoveryView(r.recoveryCodes); } catch (e) { el.disabled = false; return toast(e.message); }
    }
    if (a === 'print') return window.print();
    if (a === 'saved') return start();
    if (a === 'signout') { try { await api.post('/api/auth/logout'); } catch { /* already out */ } return start(); }
    if (a === 'nav') { S.orgId = null; return show(el.dataset.view); }
    if (a === 'filter') { S.filters = { q: val('fq'), kind: val('fk'), status: val('fs') }; return show('customers'); }
    if (a === 'open-org') { S.orgId = el.dataset.id; return show('customer'); }
    if (a === 'open-support') return show('support');
    if (a === 'extend-trial') { await api.post('/api/manager/orgs/' + S.orgId + '/extend-trial', { days: Number(val('trialDays')) }); toast('Trial extended'); return show('customer'); }
    if (a === 'give-plan') {
      const plan = val('giveplan');
      await api.post('/api/admin/orgs/' + S.orgId + '/grant', { plan: plan || null, until: val('giveuntil') || null, note: val('givenote') });
      toast(plan ? 'Plan given' : 'Given plan removed'); return show('customer');
    }
    if (a === 'reset-email') {
      if (!confirm('Send a password reset email to ' + el.dataset.email + '? The link goes to that person only.')) return;
      await api.post('/api/manager/users/' + el.dataset.id + '/reset-email'); return toast('Reset email queued');
    }
    if (a === 'requeue') { await api.post('/api/manager/emails/' + el.dataset.id + '/requeue'); toast('Queued to send again'); return show('attention'); }
    if (a === 'handle') {
      const note = prompt('Note (optional): what did you do?') ?? null;
      if (note === null) return;
      await api.post('/api/manager/inbox/' + el.dataset.source + '/' + el.dataset.id + '/handle', { note });
      return show('inbox');
    }
  } catch (e) { handleError(e); }
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') {
    const btn = root.querySelector('[data-action="login"],[data-action="verify"],[data-action="enable"],[data-action="filter"]');
    if (btn && !btn.disabled) btn.click();
  }
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('.mg-row.click')) { ev.preventDefault(); ev.target.click(); }
});

start();
