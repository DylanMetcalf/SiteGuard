// The COMVERA platform console (/manager). Everything comes from /api/manager; nothing here is a shortcut
// around the server's checks (the server decides who may do what, and asks for proof on risky actions).
// No inline handlers: elements carry data-action and one delegated listener handles them.
import { api, setCsrf } from './api.js';

const root = document.getElementById('mg');
const modalRoot = document.getElementById('mgModal');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const d = (v) => (v ? new Date(v).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const dt = (v) => (v ? new Date(v).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const ago = (v) => {
  if (!v) return 'never';
  const m = Math.round((Date.now() - new Date(v).getTime()) / 60000);
  return m < 2 ? 'just now' : m < 90 ? m + ' min ago' : m < 2880 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago';
};
const rands = (c) => 'R' + (Number(c || 0) / 100).toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const mb = (b) => { const n = Number(b || 0); return n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB'; };
const DOC_STATUS = { complete: 'Approved', missing: 'Missing', expiring: 'Expiring', awaiting_review: 'Awaiting review', correction_required: 'Correction required' };
const FLAG_LABEL = { suspicious: 'Suspicious', suspected_bot: 'Suspected bot', spam: 'Spam', duplicate: 'Duplicate', under_investigation: 'Under investigation' };
const CLASS_LABEL = { customer: 'Customer', internal_test: 'Internal test', development: 'Development', demo: 'Demo' };
const plural = (n, w) => n + ' ' + w + (Number(n) === 1 ? '' : 's');
const kindLabel = (k) => (k === 'host' ? 'Mine / site' : 'Contractor');

const ICON = {
  home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>', alert: '<path d="M12 3l10 18H2L12 3zM12 10v5M12 18h.01"/>', shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/>',
  inbox: '<path d="M3 13l3-8h12l3 8v6H3v-6zM3 13h5l1 3h6l1-3h5"/>', org: '<path d="M4 21V7l8-4 8 4v14M9 21v-6h6v6M8 10h.01M12 10h.01M16 10h.01"/>', people: '<path d="M16 20v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7M21 20v-2a4 4 0 00-3-3.9M16 3.1a3.5 3.5 0 010 6.8"/>',
  tag: '<path d="M3 12V3h9l9 9-9 9-9-9zM7.5 7.5h.01"/>', gift: '<path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7c-2 0-4-1-4-3s3-2 4 3zM12 7c2 0 4-1 4-3s-3-2-4 3z"/>',
  check: '<path d="M5 12l5 5L20 7"/>', log: '<path d="M4 4h16v16H4zM8 9h8M8 13h8M8 17h5"/>',
};
const icon = (n) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[n] + '</svg>';

const S = {
  view: 'overview', orgId: null, userId: null, tab: 'overview', ticket: null, nav: false, plans: null, badges: {}, me: null,
  f: { orgs: { q: '', kind: '', status: '', cls: '', billing: '', flagged: '', page: 0 }, users: { q: '', orgId: '', orgName: '', role: '', verified: '', status: '', cls: '', flagged: '', page: 0 } },
};
let toastTimer;
function toast(msg) {
  let t = document.getElementById('mgToast');
  if (!t) { t = document.createElement('div'); t.id = 'mgToast'; t.className = 'toast-mx'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.display = 'none'; }, 4500);
}
const val = (id) => (document.getElementById(id) ? document.getElementById(id).value.trim() : '');

/* ---------- small building blocks ---------- */
const pill = (text, tone = '') => '<span class="pill ' + tone + '">' + esc(text) + '</span>';
const statusPill = (s) => (s === 'active' ? pill('Active', 'ok') : s === 'suspended' ? pill('Suspended', 'warn') : pill('Deactivated', 'bad'));
const classPill = (c) => (c && c !== 'customer' ? pill(CLASS_LABEL[c] || c, 'info') : '');
const flagPill = (f) => (f ? pill('⚑ ' + (FLAG_LABEL[f] || f), 'warn') : '');
const panel = (title, body, extra = '') => '<div class="panel">' + (title ? '<div class="ph"><span>' + title + '</span>' + extra + '</div>' : '') + '<div class="pb">' + body + '</div></div>';
const empty = (title, text) => '<div class="empty"><b>' + esc(title) + '</b>' + esc(text || '') + '</div>';
const li = (t, m, right, attrs = '') => '<div class="li' + (attrs ? ' go' : '') + '" ' + attrs + '><div style="min-width:0"><div class="t">' + t + '</div>' + (m ? '<div class="m">' + m + '</div>' : '') + '</div>' + (right ? '<div class="acts" style="display:flex;gap:6px;flex-wrap:wrap;flex:none">' + right + '</div>' : '') + '</div>';
const kpi = (n, label, sub, attrs = '') => (attrs ? '<button class="kpi" ' + attrs + '>' : '<div class="kpi">') + '<b>' + esc(n) + '</b><span>' + label + '</span>' + (sub ? '<small>' + sub + '</small>' : '') + (attrs ? '</button>' : '</div>');
const menu = (label, items) => '<div class="menu"><button class="b" data-action="menu" aria-haspopup="true">' + label + ' ▾</button><div class="menu-pop" role="menu">'
  + items.map((i) => (i === '-' ? '<div class="menu-sep"></div>' : '<button class="menu-item' + (i.red ? ' red' : '') + '" role="menuitem" ' + i.attrs + '>' + esc(i.label) + (i.hint ? '<small>' + esc(i.hint) + '</small>' : '') + '</button>')).join('') + '</div></div>';
const field = (id, label, type = 'text', extra = '') => '<div class="fld"><label for="' + id + '">' + label + '</label><input type="' + type + '" id="' + id + '" ' + extra + '></div>';

/* ---------- dialogs: every risky action asks here, with the reason and proof the server requires ---------- */
let dialogDone = null;
function closeDialog(result = false) { modalRoot.innerHTML = ''; const f = dialogDone; dialogDone = null; if (f) f(result); }
function dialog({ title, lead = '', html = '', fields = [], confirm = 'Confirm', danger = false, run = null }) {
  return new Promise((resolve) => {
    dialogDone = resolve;
    const f = fields.map((x) => {
      const id = 'mf-' + x.id, ex = (x.autocomplete ? ' autocomplete="' + x.autocomplete + '"' : ' autocomplete="off"') + (x.placeholder ? ' placeholder="' + esc(x.placeholder) + '"' : '') + (x.inputmode ? ' inputmode="' + x.inputmode + '"' : '');
      const ctl = x.options ? '<select id="' + id + '">' + x.options.map(([v, l]) => '<option value="' + esc(v) + '">' + esc(l) + '</option>').join('') + '</select>'
        : x.textarea ? '<textarea id="' + id + '" maxlength="300"' + ex + '></textarea>' : '<input id="' + id + '" type="' + (x.type || 'text') + '"' + ex + '>';
      return '<div class="fld"><label for="' + id + '">' + esc(x.label) + '</label>' + ctl + (x.hint ? '<div class="hint">' + esc(x.hint) + '</div>' : '') + '</div>';
    }).join('');
    modalRoot.innerHTML = '<div class="scrim" data-action="dlg-scrim"><div class="dlg" role="dialog" aria-modal="true" aria-labelledby="dlgT"><h3 id="dlgT">' + esc(title) + '</h3>'
      + (lead ? '<p class="lead">' + lead + '</p>' : '') + html + '<div id="dlgErr"></div>' + f
      + '<div class="acts"><button class="b ghost" data-action="dlg-cancel">' + (run ? 'Cancel' : 'Close') + '</button>' + (run ? '<button class="b ' + (danger ? 'danger' : 'primary') + '" data-action="dlg-ok" id="dlgOk">' + esc(confirm) + '</button>' : '') + '</div></div></div>';
    const first = modalRoot.querySelector('input,textarea,select,.b'); if (first) first.focus();
    dialog.run = run; dialog.fields = fields;
  });
}
async function dialogSubmit() {
  const ok = document.getElementById('dlgOk'); if (!ok || ok.disabled) return;
  const vals = {}; for (const x of dialog.fields) { const el = document.getElementById('mf-' + x.id); vals[x.id] = el ? (x.type === 'password' ? el.value : el.value.trim()) : ''; }
  const missing = dialog.fields.find((x) => x.required !== false && !x.options && !vals[x.id]);
  const err = document.getElementById('dlgErr');
  if (missing) { err.innerHTML = '<div class="err" role="alert">Please fill in: ' + esc(missing.label) + '.</div>'; return; }
  ok.disabled = true; err.innerHTML = '';
  try { await dialog.run(vals); closeDialog(true); } catch (e) { ok.disabled = false; err.innerHTML = '<div class="err" role="alert">' + esc(e.message || 'That did not work.') + '</div>'; }
}
const proofFields = () => [
  { id: 'password', label: 'Your password', type: 'password', autocomplete: 'current-password' },
  { id: 'code', label: 'A code from your authenticator app', inputmode: 'numeric', hint: 'Use a code you have not used since signing in: wait for the next one, or use a recovery code.', autocomplete: 'one-time-code' },
];

/* ---------- sign-in and second step ---------- */
const logoDark = '<a class="logo" href="/manager"><img src="/brand/comvera-logo-light.svg" alt="COMVERA" class="lt"><img src="/brand/comvera-logo-dark.svg" alt="" class="dk"></a>';
const signShell = (inner) => '<div class="sign"><a class="logo" href="/manager" aria-label="COMVERA"><img src="/brand/comvera-logo-light.svg" alt="COMVERA"></a>' + inner + '</div>';
const errBox = (m) => (m ? '<div class="err" role="alert" style="background:var(--red-bg);color:var(--red);padding:10px 12px;border-radius:9px;font-size:13.5px;margin-bottom:12px;">' + esc(m) + '</div>' : '');
function loginView(msg) {
  root.innerHTML = signShell('<h1>Platform console</h1><p class="lead">Sign in with your COMVERA account. You will be asked for a code from your authenticator app next.</p>' + errBox(msg)
    + field('mgEmail', 'Email', 'email', 'autocomplete="username" inputmode="email"') + field('mgPass', 'Password', 'password', 'autocomplete="current-password"')
    + '<button class="b primary" style="width:100%;justify-content:center" data-action="login">Continue</button>');
  const e = document.getElementById('mgEmail'); if (e) e.focus();
}
function codeView(msg) {
  root.innerHTML = signShell('<h1>Enter your code</h1><p class="lead">Open your authenticator app and type the 6-digit code for COMVERA. Lost your phone? Use one of your recovery codes.</p>' + errBox(msg)
    + field('mgCode', 'Code', 'text', 'autocomplete="one-time-code" inputmode="numeric" maxlength="20"')
    + '<button class="b primary" style="width:100%;justify-content:center" data-action="verify">Sign in</button>');
  const e = document.getElementById('mgCode'); if (e) e.focus();
}
async function setupView(msg) {
  let s;
  try { s = await api.post('/api/manager/mfa/setup'); } catch (e) { return loginView(e.message); }
  root.innerHTML = signShell('<h1>Set up your second step</h1><p class="lead">The console needs a code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy or 1Password) every time you sign in.</p>' + errBox(msg)
    + '<ol style="padding-left:18px;font-size:14px;line-height:1.6;margin:0 0 10px;"><li>In the app choose <strong>Add account</strong>, then <strong>Enter a setup key</strong>.</li><li>Name it COMVERA and type this key:</li></ol>'
    + '<div class="codebox">' + esc(s.secret.replace(/(.{4})/g, '$1 ').trim()) + '</div>'
    + '<p class="lead" style="font-size:13px">On a phone you can also <a href="' + esc(s.otpauth) + '">open it in your authenticator app</a>.</p>'
    + field('mgCode', 'Then type the 6-digit code it shows', 'text', 'autocomplete="one-time-code" inputmode="numeric" maxlength="6"')
    + '<button class="b primary" style="width:100%;justify-content:center" data-action="enable">Turn on</button>');
}
function recoveryView(codes) {
  root.innerHTML = signShell('<h1>Save your recovery codes</h1><p class="lead">Each code works once if you lose your phone. They are shown <strong>only now</strong>. Keep them somewhere safe and offline.</p>'
    + '<div class="codes">' + codes.map((c) => '<div>' + esc(c) + '</div>').join('') + '</div>'
    + '<button class="b" style="width:100%;justify-content:center;margin-bottom:8px" data-action="print">Print</button><button class="b primary" style="width:100%;justify-content:center" data-action="saved">I have saved them</button>');
}

/* ---------- the console frame ---------- */
const NAV = [
  ['WORK', [['overview', 'Overview', 'home'], ['attention', 'Needs attention', 'alert', 'attention'], ['review', 'Account review', 'shield', 'review'], ['inbox', 'Support inbox', 'inbox', 'inbox']]],
  ['ACCOUNTS', [['customers', 'Customers', 'org'], ['people', 'People', 'people']]],
  ['BUSINESS', [['pricing', 'Prices', 'tag'], ['promos', 'Promo codes', 'gift']]],
  ['SYSTEM', [['setup', 'Setup checklist', 'check'], ['log', 'Activity log', 'log']]],
];
const activeNav = () => (S.view === 'customer' ? 'customers' : S.view === 'person' ? 'people' : S.view === 'support' ? 'customers' : S.view);
function frame(head, body) {
  const on = activeNav();
  const side = '<aside class="mx-side" aria-label="Console sections"><a class="mx-logo" href="/manager" aria-label="COMVERA"><img src="/brand/comvera-logo-dark.svg" alt="COMVERA"></a><div class="mx-role">Platform owner</div>'
    + NAV.map(([g, items]) => '<div class="mx-group">' + g + '</div>' + items.map(([v, l, ic, bk]) => '<button class="mx-link' + (on === v ? ' on' : '') + '" data-action="nav" data-view="' + v + '"' + (on === v ? ' aria-current="page"' : '') + '>' + icon(ic) + l
      + (bk && S.badges[bk] ? '<span class="n">' + S.badges[bk] + '</span>' : '') + '</button>').join('')).join('')
    + '<div class="mx-foot"><b>' + esc(S.me ? S.me.email : '') + '</b><button data-action="signout">Sign out</button></div></aside>';
  root.innerHTML = '<div class="mx' + (S.nav ? ' nav-open' : '') + '"><div class="mx-bar"><img src="/brand/comvera-logo-dark.svg" alt="COMVERA"><button data-action="toggle-nav" aria-expanded="' + !!S.nav + '">Menu</button></div>'
    + side + '<main class="mx-main" id="main">' + head + body + '</main></div>';
}
const head = (title, sub, acts = '', back = '') => (back || '') + '<div class="mx-head"><div><h1>' + title + '</h1>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>' + (acts ? '<div class="acts">' + acts + '</div>' : '') + '</div>';
const page = (title, sub, body, acts = '') => frame(head(title, sub, acts), body);
const loading = () => frame('', '<div class="empty">Loading…</div>');

/* ---------- overview ---------- */
async function overview() {
  const [o, setup] = await Promise.all([api.get('/api/manager/overview'), api.get('/api/manager/setup')]);
  const a = o.accounts, st = (s) => (o.status.find((x) => x.s === s) || { n: 0 }).n;
  const kind = (k) => o.orgs.find((x) => x.kind === k) || { total: 0, last7: 0 };
  const flagsDue = [
    [a.flagged, 'Flagged for review', 'review', 'red'], [a.unverified, 'Awaiting email confirmation', 'people-unverified'], [a.deletionsScheduled, 'Deletion scheduled', 'review', 'red'],
    [o.email.failed, 'Emails failed', 'attention'], [o.pastDue, 'Payments overdue', 'attention', 'red'], [o.payments.failed14, 'Payments failed', 'attention'], [o.openInbox, 'Support items open', 'inbox'],
  ].filter((x) => Number(x[0]) > 0);
  const need = flagsDue.length
    ? '<div class="need"><span class="lbl">Needs you</span>' + flagsDue.map(([n, l, go, red]) => '<button class="chip ' + (red || '') + '" data-action="go" data-go="' + go + '"><b>' + n + '</b>' + l + '</button>').join('') + '</div>'
    : '<div class="need calm">✓ Nothing needs you right now.</div>';
  const todo = setup.items.filter((i) => ['todo', 'attention'].includes(i.status)).length, doneN = setup.items.filter((i) => i.status === 'done').length;
  frame(head('Overview', 'Real customers only. Internal test and demo accounts are kept out of these numbers.'),
    need
    + '<h2>Customers</h2><div class="kpis">'
    + kpi(a.orgs, 'Customer organisations', '+' + (kind('host').last7 + kind('contractor').last7) + ' this week', 'data-action="go" data-go="customers"')
    + kpi(a.activeHosts, 'Active mines and sites', '', 'data-action="go" data-go="customers-host"')
    + kpi(a.activeContractors, 'Active contractors', '', 'data-action="go" data-go="customers-contractor"')
    + kpi(o.users.total, 'Registered people', '+' + o.users.last7 + ' this week · ' + o.users.active7 + ' active in 7 days', 'data-action="go" data-go="people"')
    + kpi(a.pendingInvites, 'Invitations waiting', '')
    + kpi(a.internalTest, 'Internal test accounts', '', 'data-action="go" data-go="customers-test"') + '</div>'
    + '<h2>Recent</h2><div class="cols">'
    + panel('New registrations', a.orgs ? o.recentOrgs.map((x) => li(esc(x.name) + ' ' + pill(kindLabel(x.kind)), 'Registered ' + ago(x.at), '', 'data-action="open-org" data-id="' + x.id + '" role="button" tabindex="0"')).join('') || empty('No customers yet') : empty('No customers yet', 'Invite two or three friendly mines and contractors to start.'))
    + panel('Recently active', o.recentlyActive.length ? o.recentlyActive.map((x) => li(esc(x.name) + ' ' + pill(kindLabel(x.kind)), 'Last seen ' + ago(x.at), '', 'data-action="open-org" data-id="' + x.id + '" role="button" tabindex="0"')).join('') : empty('Nobody has signed in yet'))
    + '</div><div class="cols" style="margin-top:16px">'
    + panel('Recent activity by you', o.recentActions.length ? '<div class="feed">' + o.recentActions.map((x) => '<div class="li"><span class="dot"></span><div style="flex:1;min-width:0"><div class="t">' + esc(x.action) + '</div><div class="m">' + esc(x.detail) + ' · ' + esc(x.by) + ' · ' + ago(x.at) + '</div></div></div>').join('') + '</div>' : empty('No actions yet'),
      '<button class="b ghost sm" data-action="go" data-go="log">All activity</button>')
    + panel('Setup checklist', '<div style="padding-top:10px"><div style="font-weight:600">' + doneN + ' of ' + setup.items.length + ' done' + (todo ? ' · <span style="color:var(--red)">' + todo + ' need you</span>' : '') + '</div>'
      + '<div class="bar-prog"><i style="width:' + Math.round((doneN / setup.items.length) * 100) + '%"></i></div>'
      + '<p style="color:var(--grey);font-size:13.5px">Each item explains why it matters and where to do it.</p><button class="b primary sm" data-action="go" data-go="setup">Open the checklist</button></div>')
    + '</div><h2>Billing</h2><div class="kpis">'
    + kpi(st('trialing'), 'On trial') + kpi(st('active'), 'Paying') + kpi(o.pastDue, 'Payment overdue') + kpi(rands(o.payments.paid30), 'Confirmed payments, 30 days')
    + kpi(o.email.failed, 'Emails failed, 30 days') + kpi(o.email.sent7, 'Emails sent, 7 days') + '</div>'
    + (o.paidPlans.length ? '<div style="margin-top:16px">' + panel('Paying customers by plan', o.paidPlans.map((p) => li(esc(p.plan), '', '<b>' + p.n + '</b>')).join('')) + '</div>' : ''));
}

/* ---------- customers ---------- */
const filterBar = (f, which) => '<div class="bar"><input type="search" id="fq" placeholder="' + (which === 'orgs' ? 'Search company, person or email' : 'Search name or email') + '" value="' + esc(f.q) + '" data-enter="apply-' + which + '" aria-label="Search">'
  + (which === 'orgs' ? '<select id="fk" data-change="apply-orgs" aria-label="Type"><option value="">All types</option><option value="host"' + (f.kind === 'host' ? ' selected' : '') + '>Mines / sites</option><option value="contractor"' + (f.kind === 'contractor' ? ' selected' : '') + '>Contractors</option></select>'
    : '<select id="fr" data-change="apply-users" aria-label="Role"><option value="">Any role</option>' + ['owner', 'admin', 'reviewer', 'member'].map((r) => '<option' + (f.role === r ? ' selected' : '') + '>' + r + '</option>').join('') + '</select>'
      + '<select id="fv" data-change="apply-users" aria-label="Email"><option value="">Any email status</option><option value="yes"' + (f.verified === 'yes' ? ' selected' : '') + '>Email confirmed</option><option value="no"' + (f.verified === 'no' ? ' selected' : '') + '>Not confirmed</option></select>')
  + '<select id="fs" data-change="apply-' + which + '" aria-label="Status"><option value="">Any status</option>' + [['active', 'Active'], ['suspended', 'Suspended'], ['deactivated', 'Deactivated']].map(([v, l]) => '<option value="' + v + '"' + (f.status === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>'
  + '<select id="fc" data-change="apply-' + which + '" aria-label="Account type"><option value="">Customers and tests</option>' + [['customer', 'Customers only'], ['internal_test', 'Internal test'], ['development', 'Development'], ['demo', 'Demo']].map(([v, l]) => '<option value="' + v + '"' + (f.cls === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>'
  + '<button class="chip' + (f.flagged ? ' on' : '') + '" data-action="toggle-flagged" data-which="' + which + '">⚑ Flagged</button><button class="b primary" data-action="apply-' + which + '">Search</button></div>'
  + (which === 'users' && f.orgId ? '<div class="bar"><span class="pill info">In ' + esc(f.orgName || 'organisation') + ' <button class="b ghost sm" style="padding:0 0 0 6px" data-action="clear-org-filter" aria-label="Remove filter">×</button></span></div>' : '');
const pager = (f, more, which) => (f.page > 0 || more ? '<div class="bar" style="justify-content:flex-end;margin-top:12px"><button class="b sm" data-action="pg-' + which + '" data-d="-1"' + (f.page ? '' : ' disabled') + '>Previous</button><span style="color:var(--grey);font-size:13px">Page ' + (f.page + 1) + '</span><button class="b sm" data-action="pg-' + which + '" data-d="1"' + (more ? '' : ' disabled') + '>Next</button></div>' : '');

async function customers() {
  const f = S.f.orgs;
  const r = await api.get('/api/manager/orgs?' + new URLSearchParams({ q: f.q, kind: f.kind, status: f.status, cls: f.cls, billing: f.billing, flagged: f.flagged, page: f.page }));
  const rows = r.orgs.map((o) => '<tr class="go" data-action="open-org" data-id="' + o.id + '" tabindex="0" role="button"><td data-l="Organisation"><div class="nm">' + esc(o.name) + '</div><div class="mut">' + kindLabel(o.kind) + ' · joined ' + d(o.createdAt) + '</div></td>'
    + '<td data-l="Status">' + statusPill(o.status) + ' ' + flagPill(o.flagKind) + ' ' + classPill(o.class) + (o.deletionScheduled ? ' ' + pill('Deletion scheduled', 'bad') : '') + '</td>'
    + '<td data-l="Plan">' + esc(o.planName || o.plan) + '<div class="mut">' + esc(o.billing) + (o.billing === 'trialing' ? ' until ' + d(o.trialEndsAt) : '') + '</div></td>'
    + '<td data-l="People">' + o.members + '<div class="mut">' + o.verified + ' confirmed</div></td>'
    + '<td data-l="Contents">' + plural(o.workplaces, 'site') + ' · ' + plural(o.files, 'file') + '</td><td data-l="Last active">' + ago(o.lastActive) + '</td></tr>').join('');
  frame(head('Customers', 'Every registered organisation. Open one to see its people, sites and contractors, and to manage its account.'),
    filterBar(f, 'orgs') + '<div class="panel scroll">' + (rows ? '<table class="tbl"><thead><tr><th>Organisation</th><th>Status</th><th>Plan</th><th>People</th><th>Contents</th><th>Last active</th></tr></thead><tbody>' + rows + '</tbody></table>'
      : empty('No organisations match', 'Try clearing a filter.')) + '</div>' + pager(f, r.more, 'orgs'));
}

async function customer() {
  const r = await api.get('/api/manager/orgs/' + S.orgId);
  const o = r.org;
  const people = await api.get('/api/manager/users?orgId=' + S.orgId);
  if (!S.plans) { try { S.plans = (await api.get('/api/pricing')).plans; } catch { S.plans = []; } }
  const isDemo = o.class === 'demo', open = o.status === 'active';
  const items = [];
  if (!isDemo) {
    items.push(o.flagKind ? { label: 'Clear the flag', attrs: 'data-action="org-unflag"' } : { label: 'Flag for review…', hint: 'A note for you. Blocks nothing.', attrs: 'data-action="org-flag"' });
    items.push({ label: o.class === 'customer' ? 'Mark as internal test…' : 'Mark as a real customer', hint: o.class === 'customer' ? 'Leaves your customer counts.' : '', attrs: 'data-action="org-class" data-to="' + (o.class === 'customer' ? 'internal_test' : 'customer') + '"' });
    items.push('-');
    if (open) { items.push({ label: 'Suspend…', hint: 'Switches access off. Reversible.', attrs: 'data-action="org-status" data-to="suspended"' }); items.push({ label: 'Deactivate…', hint: 'Closes the account. Data is kept.', attrs: 'data-action="org-status" data-to="deactivated"' }); }
    else items.push({ label: 'Reactivate…', attrs: 'data-action="org-status" data-to="active"' });
    items.push('-');
    items.push({ label: 'Delete permanently…', hint: 'A protected process. Cannot be undone.', red: true, attrs: 'data-action="org-delete"' });
  }
  const acts = (isDemo ? '' : open ? '<button class="b" data-action="org-status" data-to="suspended">Suspend</button>' : '<button class="b primary" data-action="org-status" data-to="active">Reactivate</button>') + (items.length ? menu('Actions', items) : '');
  const banners = (!open ? '<div class="ban ' + (o.status === 'suspended' ? 'warn' : 'bad') + '"><span><b>' + (o.status === 'suspended' ? 'Suspended' : 'Deactivated') + '</b> on ' + d(o.statusChangedAt) + ' by ' + esc(o.statusChangedBy || '') + ': ' + esc(o.statusReason) + '. Nobody in this organisation can sign in or use it.</span></div>' : '')
    + (o.flagKind ? '<div class="ban warn"><span><b>⚑ ' + esc(FLAG_LABEL[o.flagKind]) + '</b> since ' + d(o.flaggedAt) + ': ' + esc(o.flagReason) + '</span></div>' : '')
    + (r.deletion ? '<div class="ban bad"><span><b>Permanent deletion is scheduled</b> by ' + esc(r.deletion.requestedBy) + '. Earliest date: <b>' + d(r.deletion.scheduledFor) + '</b>. Reason: ' + esc(r.deletion.reason) + '</span><span class="acts"><button class="b sm" data-action="org-delete-cancel">Cancel deletion</button>'
      + '<button class="b danger sm" data-action="org-delete-run"' + (new Date(r.deletion.scheduledFor) > new Date() ? ' disabled title="The waiting period is not over"' : '') + '>Delete now…</button></span></div>' : '');
  const tabs = [['overview', 'Overview'], ['people', 'People (' + people.users.length + ')'], ['sites', 'Sites and contractors'], ['billing', 'Billing'], ['activity', 'Activity and support']];
  let body = '';
  if (S.tab === 'overview') {
    body = '<div class="cols">' + panel('Details', '<dl class="kv" style="padding:12px 0 0"><dt>Type</dt><dd>' + kindLabel(o.kind) + '</dd><dt>Account type</dt><dd>' + esc(CLASS_LABEL[o.class]) + '</dd><dt>Registered</dt><dd>' + d(o.createdAt) + '</dd>'
      + '<dt>Last active</dt><dd>' + ago(o.lastActive) + '</dd><dt>Registration no.</dt><dd>' + esc(o.regNumber || '—') + '</dd><dt>Trade</dt><dd>' + esc(o.trade || '—') + '</dd><dt>Plan</dt><dd>' + esc(o.planName || o.plan) + ' · ' + esc(o.billing) + (o.billing === 'trialing' ? ' until ' + d(o.trialEndsAt) : '') + '</dd></dl>')
      + panel('Verification and invitations', '<dl class="kv" style="padding:12px 0 0"><dt>People</dt><dd>' + people.users.length + ' (' + people.users.filter((u) => u.verified).length + ' confirmed their email)</dd>'
        + '<dt>User invitations</dt><dd>' + r.invites.users + ' waiting</dd><dt>Site invitations</dt><dd>' + r.invites.sites + ' waiting</dd><dt>Open sites</dt><dd>' + r.sites.length + '</dd><dt>Contractors</dt><dd>' + r.contractors.length + '</dd></dl>') + '</div>';
  } else if (S.tab === 'people') {
    body = '<div class="panel scroll">' + (people.users.length ? '<table class="tbl"><thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Last seen</th></tr></thead><tbody>' + people.users.map((u) => '<tr class="go" data-action="open-person" data-id="' + u.id + '" tabindex="0" role="button"><td data-l="Person"><div class="nm">' + esc(u.name) + '</div><div class="mut">' + esc(u.email) + '</div></td>'
      + '<td data-l="Role">' + esc((u.orgs.find((m) => m.id === S.orgId) || {}).role || '') + '</td><td data-l="Status">' + statusPill(u.status) + ' ' + (u.verified ? pill('Email confirmed', 'ok') : pill('Not confirmed', 'warn')) + ' ' + flagPill(u.flagKind) + '</td><td data-l="Last seen">' + ago(u.lastSeen) + '</td></tr>').join('') + '</tbody></table>' : empty('No people')) + '</div>';
  } else if (S.tab === 'sites') {
    body = '<div class="cols">' + panel('Sites (' + r.sites.length + ')', r.sites.length ? r.sites.map((s) => li(esc(s.name), esc(s.location || '') + ' · created ' + d(s.createdAt))).join('') : empty(o.kind === 'host' ? 'No sites yet' : 'Contractors file under the mine that invites them', ''))
      + panel('Contractors (' + r.contractors.length + ')', r.contractors.length ? r.contractors.map((c) => li(esc(c.name), (c.linkedName ? 'Joined as ' + esc(c.linkedName) : 'Has not joined yet') + ' · ' + c.files + ' site file' + (c.files === 1 ? '' : 's'),
        c.linkedOrgId ? '<button class="b sm" data-action="open-org" data-id="' + c.linkedOrgId + '">Open</button>' : '')).join('') : empty('No contractors'))
      + '</div><p style="color:var(--grey);font-size:13px;margin-top:12px">Names only. Requirements, documents and activity are visible only while the customer has switched on support access.</p>';
  } else if (S.tab === 'billing') {
    const plans = S.plans.filter((p) => p.kind === o.kind).concat(o.kind === 'host' ? [{ planId: 'host_enterprise', name: 'Enterprise' }] : []);
    body = panel('Plan and billing', '<dl class="kv" style="padding:12px 0 0"><dt>Plan</dt><dd>' + esc(o.planName || o.plan) + ' · ' + esc(o.billing) + (o.billing === 'trialing' ? ' until ' + d(o.trialEndsAt) : '') + (o.periodEnd ? ' · renews ' + d(o.periodEnd) : '') + ' · ' + o.seatLimit + ' seats</dd>'
      + '<dt>Given plan</dt><dd>' + (o.grantPlan ? esc(o.grantPlan) + (o.grantUntil ? ' until ' + d(o.grantUntil) : ', no end date') + ' (' + esc(o.grantSource || '') + ')' : 'None') + '</dd>'
      + '<dt>Subscription</dt><dd>' + (o.hasPaystackSubscription ? 'Paystack' : o.hasStripeSubscription ? 'Stripe' : 'None') + '</dd></dl>'
      + '<div class="bar" style="padding:0 0 4px"><select id="trialDays" aria-label="Days"><option value="7">+7 days</option><option value="14">+14 days</option><option value="30">+30 days</option></select><button class="b sm" data-action="extend-trial">Extend the trial</button></div>'
      + '<div class="bar" style="padding:0"><select id="giveplan" aria-label="Plan"><option value="">Remove any given plan</option>' + plans.map((p) => '<option value="' + esc(p.planId) + '">' + esc(p.name) + '</option>').join('') + '</select>'
      + '<input type="date" id="giveuntil" aria-label="Until (optional)"><input type="text" id="givenote" maxlength="100" placeholder="Note, e.g. pilot partner"><button class="b sm" data-action="give-plan">Give plan</button></div>')
      + '<h2>Payments</h2>' + panel('', r.payments.length ? r.payments.map((p) => li(rands(p.amountCents) + ' · ' + esc(p.kind) + ' · ' + esc(p.planId), esc(p.status) + (p.failureReason ? ' — ' + esc(p.failureReason) : '') + ' · ' + dt(p.paidAt || p.createdAt) + ' · ref ' + esc(p.reference))).join('') : empty('No payments yet'));
  } else {
    const g = r.supportAccess;
    body = '<div class="cols">'
      + panel('Support access', g ? '<div class="ban ok" style="margin-top:12px"><span><b>Active</b> until ' + dt(g.expiresAt) + '. Allowed by ' + esc(g.grantedBy) + (g.reason ? ': ' + esc(g.reason) : '') + '.</span></div>'
          + '<p style="color:var(--grey);font-size:13.5px">Opens a read-only view of sites, requirement and document names with their status, and recent activity. Never file contents. You will be asked for a reason, which is recorded for you and in the customer’s own audit trail.</p><button class="b primary" data-action="open-support">Open the read-only view…</button>'
        : '<p style="color:var(--grey);font-size:14px;padding-top:10px">Not switched on. To see inside this account, ask their admin to open <b>Settings → Support access</b> and allow it for a few hours. It ends by itself, and they can end it sooner.</p>')
      + panel('Last active', '<p style="padding-top:10px;font-size:14px">' + (o.lastActive ? ago(o.lastActive) + ' (' + dt(o.lastActive) + ')' : 'Nobody has signed in.') + '</p>') + '</div>'
      + '<h2>What you have done for this customer</h2>' + panel('', r.actions.length ? r.actions.map((a) => li(esc(a.action), esc(a.detail) + ' · ' + esc(a.by) + ' · ' + dt(a.at))).join('') : empty('Nothing yet'));
  }
  frame(head(esc(o.name), kindLabel(o.kind) + ' · registered ' + d(o.createdAt) + '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">' + statusPill(o.status) + flagPill(o.flagKind) + classPill(o.class) + '</div>', acts,
    '<button class="mx-back" data-action="go" data-go="customers">← All customers</button>'),
  banners + '<div class="tabs" role="tablist">' + tabs.map(([k, l]) => '<button class="tab' + (S.tab === k ? ' on' : '') + '" role="tab" aria-selected="' + (S.tab === k) + '" data-action="tab" data-tab="' + k + '">' + l + '</button>').join('') + '</div>' + body);
}

async function supportView() {
  const r = await api.get('/api/manager/orgs/' + S.orgId + '/support-view?reason=' + encodeURIComponent(S.supportReason || ''));
  frame(head(esc(r.org.name) + ' — read-only view', 'Allowed by the customer until ' + dt(r.grantExpiresAt) + '. This look is recorded. File contents are never shown.', '<button class="b" data-action="open-org" data-id="' + S.orgId + '">End the view</button>'),
    '<div class="ban info"><span>Reason you gave: <b>' + esc(S.supportReason) + '</b></span></div>'
    + panel('Sites and files', r.sites.length ? '<div class="scroll"><table class="tbl"><thead><tr><th>Name</th><th>Owner / contractor</th><th>Status</th><th>Requirements</th><th>Approved</th><th>Waiting</th><th>Corrections</th></tr></thead><tbody>'
      + r.sites.map((s) => '<tr><td data-l="Name">' + esc(s.name) + '</td><td data-l="Owner">' + esc(s.ownerName) + (s.contractorName ? ' / ' + esc(s.contractorName) : '') + '</td><td data-l="Status">' + esc(s.status) + '</td><td data-l="Requirements">' + s.requirements + '</td><td data-l="Approved">' + s.approved + '</td><td data-l="Waiting">' + s.waiting + '</td><td data-l="Corrections">' + s.corrections + '</td></tr>').join('') + '</tbody></table></div>' : empty('No sites'))
    + '<h2>Requirements and documents (names and status only)</h2>' + panel('', r.documents.length ? '<div class="scroll"><table class="tbl"><thead><tr><th>Site</th><th>Document</th><th>Status</th><th>Version</th><th>Expires</th></tr></thead><tbody>'
      + r.documents.map((x) => '<tr><td data-l="Site">' + esc(x.siteName) + '</td><td data-l="Document">' + esc(x.name) + (x.optional ? ' ' + pill('optional') : '') + '<div class="mut">' + esc(x.category) + '</div></td><td data-l="Status">' + esc(DOC_STATUS[x.status] || x.status) + '</td><td data-l="Version">' + esc(x.version ?? '') + '</td><td data-l="Expires">' + d(x.expiryDate) + '</td></tr>').join('') + '</tbody></table></div>' : empty('Nothing filed'))
    + '<h2>Recent activity</h2>' + panel('', r.recentActivity.length ? r.recentActivity.map((a) => li(esc(a.action), esc(a.detail) + ' · ' + esc(a.who) + ' (' + esc(a.role) + ') · ' + dt(a.at))).join('') : empty('No activity')));
}

/* ---------- people ---------- */
async function people() {
  const f = S.f.users;
  const r = await api.get('/api/manager/users?' + new URLSearchParams({ q: f.q, orgId: f.orgId, role: f.role, verified: f.verified, status: f.status, cls: f.cls, flagged: f.flagged, page: f.page }));
  const rows = r.users.map((u) => '<tr class="go" data-action="open-person" data-id="' + u.id + '" tabindex="0" role="button"><td data-l="Person"><div class="nm">' + esc(u.name) + '</div><div class="mut">' + esc(u.email) + '</div></td>'
    + '<td data-l="Organisation">' + (u.orgs.map((m) => esc(m.name) + ' <span class="mut">' + esc(m.role) + '</span>').join('<br>') || '—') + '</td>'
    + '<td data-l="Status">' + statusPill(u.status) + ' ' + (u.verified ? pill('Email confirmed', 'ok') : pill('Not confirmed', 'warn')) + ' ' + flagPill(u.flagKind) + ' ' + classPill(u.class) + '</td>'
    + '<td data-l="Last seen">' + ago(u.lastSeen) + '</td><td data-l="Joined">' + d(u.createdAt) + '</td></tr>').join('');
  frame(head('People', 'Everyone who has registered. Search by name or email, and filter by organisation, role or status.'),
    filterBar(f, 'users') + '<div class="panel scroll">' + (rows ? '<table class="tbl"><thead><tr><th>Person</th><th>Organisation</th><th>Status</th><th>Last seen</th><th>Joined</th></tr></thead><tbody>' + rows + '</tbody></table>' : empty('Nobody matches', 'Try clearing a filter.')) + '</div>' + pager(f, r.more, 'users'));
}

async function person() {
  const r = await api.get('/api/manager/users/' + S.userId);
  const u = r.user, protectedAcct = u.platformOwner || u.class === 'demo';
  const items = [];
  if (!protectedAcct) {
    items.push(u.flagKind ? { label: 'Clear the flag', attrs: 'data-action="user-unflag"' } : { label: 'Flag as suspicious…', hint: 'A note for you. Blocks nothing.', attrs: 'data-action="user-flag"' });
    items.push({ label: u.class === 'customer' ? 'Mark as a test user' : 'Mark as a real customer', attrs: 'data-action="user-class" data-to="' + (u.class === 'customer' ? 'internal_test' : 'customer') + '"' });
    items.push('-');
    items.push({ label: 'Send a password reset email', attrs: 'data-action="user-reset-email"' });
    if (u.mfa) items.push({ label: 'Reset two-step sign-in…', attrs: 'data-action="user-reset-mfa"' });
    items.push({ label: 'End all their sessions', hint: u.sessions + ' open', attrs: 'data-action="user-revoke"' });
    items.push('-');
    if (u.status === 'active') { items.push({ label: 'Suspend…', hint: 'Reversible.', attrs: 'data-action="user-status" data-to="suspended"' }); items.push({ label: 'Deactivate…', attrs: 'data-action="user-status" data-to="deactivated"' }); }
    else items.push({ label: 'Reactivate…', attrs: 'data-action="user-status" data-to="active"' });
    items.push({ label: 'Delete permanently…', hint: 'Only after 14 days deactivated.', red: true, attrs: 'data-action="user-delete"' });
  }
  frame(head(esc(u.name), esc(u.email) + '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">' + statusPill(u.status) + (u.verifiedAt ? pill('Email confirmed', 'ok') : pill('Email not confirmed', 'warn')) + flagPill(u.flagKind) + classPill(u.class) + (u.mfa ? pill('Two-step on', 'sage') : '') + (u.platformOwner ? pill('Platform owner', 'info') : '') + '</div>',
    items.length ? menu('Actions', items) : '', '<button class="mx-back" data-action="go" data-go="people">← All people</button>'),
  (u.status !== 'active' ? '<div class="ban ' + (u.status === 'suspended' ? 'warn' : 'bad') + '"><span><b>' + (u.status === 'suspended' ? 'Suspended' : 'Deactivated') + '</b> on ' + d(u.statusChangedAt) + ' by ' + esc(u.statusChangedBy || '') + ': ' + esc(u.statusReason) + '</span></div>' : '')
  + (u.flagKind ? '<div class="ban warn"><span><b>⚑ ' + esc(FLAG_LABEL[u.flagKind]) + '</b> since ' + d(u.flaggedAt) + ': ' + esc(u.flagReason) + '</span></div>' : '')
  + (u.platformOwner ? '<div class="ban info"><span>This is a platform owner address. It is managed in the server settings, so it cannot be changed here.</span></div>' : '')
  + '<div class="cols">' + panel('Account', '<dl class="kv" style="padding:12px 0 0"><dt>Registered</dt><dd>' + d(u.createdAt) + '</dd><dt>Email</dt><dd>' + (u.verifiedAt ? 'Confirmed ' + d(u.verifiedAt) : 'Not confirmed') + '</dd><dt>Last seen</dt><dd>' + ago(u.lastSeen) + '</dd>'
    + '<dt>Open sessions</dt><dd>' + u.sessions + '</dd><dt>Two-step sign-in</dt><dd>' + (u.mfa ? 'On' : 'Off') + '</dd><dt>Sign-in</dt><dd>' + (u.locked ? 'Locked after failed attempts' : u.failedLogins + ' failed attempts') + '</dd><dt>Job title</dt><dd>' + esc(u.title || '—') + '</dd><dt>Phone</dt><dd>' + esc(u.phone || '—') + '</dd></dl>')
  + panel('Organisations', r.orgs.length ? r.orgs.map((o) => li(esc(o.name) + ' ' + pill(kindLabel(o.kind)) + ' ' + statusPill(o.status), esc(o.role) + ' · joined ' + d(o.joinedAt), '', 'data-action="open-org" data-id="' + o.id + '" role="button" tabindex="0"')).join('') : empty('Not in any organisation'))
  + '</div><h2>What you have done for this person</h2>' + panel('', r.actions.length ? r.actions.map((a) => li(esc(a.action), esc(a.detail) + ' · ' + esc(a.by) + ' · ' + dt(a.at))).join('') : empty('Nothing yet')));
}

/* ---------- review queue: suggestions only, never an automatic action ---------- */
async function review() {
  const r = await api.get('/api/manager/review');
  const orgBtn = (id) => '<button class="b sm" data-action="open-org" data-id="' + id + '">Open</button>';
  const userBtn = (id) => '<button class="b sm" data-action="open-person" data-id="' + id + '">Open</button>';
  frame(head('Account review', 'Flagged accounts and lists that may need a look. These are only suggestions: nothing here is changed automatically, and nothing is ever deleted without you.'),
    (r.scheduled.length ? '<h2>Deletions scheduled</h2>' + panel('', r.scheduled.map((s) => li(esc(s.name), 'By ' + esc(s.requestedBy) + ' · earliest ' + d(s.scheduledFor) + ' · ' + esc(s.reason), orgBtn(s.orgId))).join('')) : '')
    + '<h2>Flagged organisations (' + r.flaggedOrgs.length + ')</h2>' + panel('', r.flaggedOrgs.length ? r.flaggedOrgs.map((o) => li(esc(o.name) + ' ' + flagPill(o.flagKind) + ' ' + statusPill(o.status), esc(o.flagReason) + ' · ' + d(o.flaggedAt), orgBtn(o.id))).join('') : empty('None flagged'))
    + '<h2>Flagged people (' + r.flaggedUsers.length + ')</h2>' + panel('', r.flaggedUsers.length ? r.flaggedUsers.map((u) => li(esc(u.name) + ' ' + flagPill(u.flagKind) + ' ' + statusPill(u.status), esc(u.email) + ' · ' + esc(u.flagReason), userBtn(u.id))).join('') : empty('None flagged'))
    + '<h2>Never confirmed their email, after 3 days (' + r.unverified.length + ')</h2>' + panel('', r.unverified.length ? r.unverified.map((u) => li(esc(u.name), esc(u.email) + ' · registered ' + d(u.createdAt), userBtn(u.id))).join('') : empty('None'))
    + '<h2>Organisations with the same name (' + r.duplicates.length + ')</h2>' + panel('', r.duplicates.length ? r.duplicates.map((g) => g.orgs.map((o) => li(esc(o.name) + ' ' + pill(kindLabel(o.kind)) + ' ' + statusPill(o.status), 'Registered ' + d(o.createdAt), orgBtn(o.id))).join('')).join('<div style="border-top:2px solid var(--grey-line)"></div>') : empty('No duplicates'))
    + '<h2>Abandoned: nothing created and nobody signed in for 30 days (' + r.abandoned.length + ')</h2>' + panel('', r.abandoned.length ? r.abandoned.map((o) => li(esc(o.name) + ' ' + pill(kindLabel(o.kind)), 'Registered ' + d(o.createdAt), orgBtn(o.id))).join('') : empty('None')));
}

/* ---------- needs attention, inbox, log ---------- */
async function attention() {
  const a = await api.get('/api/manager/attention');
  const org = (id, name) => '<a href="#" data-action="open-org" data-id="' + id + '">' + esc(name) + '</a>';
  frame(head('Needs attention', 'Emails, payments and trials that are stuck or about to go wrong.'),
    panel('Emails that failed to send (' + a.failedEmails.length + ')', a.failedEmails.length ? a.failedEmails.map((e) => li(esc(e.to) + ' — ' + esc(e.subject), esc(e.error) + ' · ' + e.attempts + ' attempts · ' + dt(e.at), '<button class="b sm" data-action="requeue" data-id="' + e.id + '">Send again</button>')).join('') : empty('None'))
    + '<div style="height:16px"></div>' + panel('Payment overdue (' + a.pastDue.length + ')', a.pastDue.length ? a.pastDue.map((o) => li(org(o.id, o.name), esc(o.plan) + ' · period ended ' + d(o.periodEnd))).join('') : empty('None'))
    + '<div style="height:16px"></div>' + panel('Payments that failed or are stuck (' + a.payments.length + ')', a.payments.length ? a.payments.map((p) => li(org(p.orgId, p.name) + ' · ' + rands(p.amountCents), esc(p.status) + ' · ' + esc(p.kind) + (p.failureReason ? ' — ' + esc(p.failureReason) : '') + ' · ' + dt(p.at))).join('') : empty('None'))
    + '<div style="height:16px"></div>' + panel('Trials ending within 3 days (' + a.trialsEnding.length + ')', a.trialsEnding.length ? a.trialsEnding.map((o) => li(org(o.id, o.name), kindLabel(o.kind) + ' · ends ' + dt(o.trialEndsAt))).join('') : empty('None')));
}
async function inbox() {
  const r = await api.get('/api/manager/inbox');
  frame(head('Support inbox', 'Problems and ideas from inside the app, and enquiries from the contact page. Unhandled first.'),
    panel('', r.items.length ? r.items.map((i) => li(pill(i.source === 'feedback' ? i.topic : 'enquiry · ' + i.topic) + ' ' + esc(i.name || i.email || 'Anonymous') + (i.company ? ' — ' + esc(i.company) : ''),
      esc(i.message) + '<br>' + (i.email ? esc(i.email) + ' · ' : '') + dt(i.at) + (i.handledAt ? ' · <b>handled ' + d(i.handledAt) + '</b>' + (i.note ? ': ' + esc(i.note) : '') : ''),
      (i.orgId ? '<button class="b sm" data-action="open-org" data-id="' + i.orgId + '">Customer</button>' : '') + (i.handledAt ? '' : '<button class="b sm primary" data-action="handle" data-source="' + i.source + '" data-id="' + i.id + '">Mark handled</button>'))).join('') : empty('Nothing here', 'New feedback and enquiries will appear here.')));
}
async function log() {
  const r = await api.get('/api/manager/actions');
  frame(head('Activity log', 'Everything done from this console, newest first. It cannot be edited or deleted.'),
    '<div class="panel scroll"><table class="tbl"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Customer</th><th>Detail</th></tr></thead><tbody>'
    + r.actions.map((a) => '<tr><td data-l="When">' + dt(a.at) + '</td><td data-l="Who">' + esc(a.by) + '</td><td data-l="What">' + esc(a.action) + '</td><td data-l="Customer">' + esc(a.orgName || '') + '</td><td data-l="Detail"><span class="mut">' + esc(a.detail) + '</span></td></tr>').join('') + '</tbody></table></div>');
}

/* ---------- prices, promo codes ---------- */
async function pricing() {
  const r = await api.get('/api/admin/pricing');
  frame(head('Prices', 'What the public pricing page shows, and what customers are charged when payments run through Paystack. Leave the price empty to show “Contact us”. A change applies to new subscriptions; existing ones keep their price.'),
    r.plans.map((p) => '<div style="margin-bottom:14px">' + panel(esc(p.name) + ' ' + pill(kindLabel(p.kind)),
      '<div class="bar" style="padding-top:12px"><input type="number" min="0" step="1" id="pr-' + p.planId + '" value="' + (p.priceCents === null ? '' : p.priceCents / 100) + '" placeholder="Price in rand (blank = contact us)" aria-label="Price in rand">'
      + '<input type="text" id="pe-' + p.planId + '" value="' + esc(p.per) + '" maxlength="40" aria-label="Per" style="max-width:160px"><select id="pv-' + p.planId + '" aria-label="Visibility"><option value="1"' + (p.visible ? ' selected' : '') + '>Shown on the website</option><option value="0"' + (p.visible ? '' : ' selected') + '>Hidden</option></select></div>'
      + '<div class="fld"><label for="ph-' + p.planId + '">What is included (one point per line, up to 8)</label><textarea id="ph-' + p.planId + '" rows="4" style="width:100%;font:500 14px var(--font-body);color:var(--ink);background:var(--paper-raised);border:1px solid var(--grey-line);border-radius:9px;padding:10px 12px">' + esc(p.highlights.join('\n')) + '</textarea></div>'
      + '<button class="b sm primary" data-action="save-price" data-plan="' + p.planId + '" data-blurb="' + esc(p.blurb || '') + '" data-currency="' + esc(p.currency) + '">Save</button>') + '</div>').join(''));
}
async function promos() {
  const r = await api.get('/api/admin/promos');
  const plans = (S.plans || (S.plans = (await api.get('/api/pricing')).plans)).filter((p) => p.planId !== 'host_enterprise');
  frame(head('Promo codes', 'Free or discounted access for partners, family and testers. They type the code under Plan and billing.'),
    panel('Create a code', '<div class="bar" style="padding-top:12px"><input id="pc-code" maxlength="40" placeholder="CODE e.g. PARTNER2026" autocapitalize="characters" aria-label="Code"><select id="pc-plan" aria-label="Plan">' + plans.map((p) => '<option value="' + esc(p.planId) + '">' + esc(p.name) + '</option>').join('') + '</select></div>'
      + '<div class="bar"><input id="pc-days" type="number" min="1" max="3650" placeholder="Lasts for (days, blank = no end)" aria-label="Days"><input id="pc-max" type="number" min="1" placeholder="How many companies (blank = any)" aria-label="Limit"><input id="pc-desc" maxlength="200" placeholder="Note" aria-label="Note"></div>'
      + '<p style="color:var(--grey);font-size:13px">100% off. A partial discount needs a matching Stripe coupon, so it is not offered here.</p><button class="b primary sm" data-action="create-promo">Create code</button>')
    + '<div style="height:16px"></div>' + panel('Codes', r.promos.length ? r.promos.map((c) => li('<code>' + esc(c.code) + '</code> ' + pill(c.plan) + (c.active ? '' : ' ' + pill('off', 'warn')),
      esc(c.description || '') + ' ' + (c.durationDays ? c.durationDays + ' days' : 'no end date') + ' · used ' + c.redemptions + (c.maxRedemptions ? ' of ' + c.maxRedemptions : ''),
      '<button class="b sm" data-action="toggle-promo" data-id="' + c.id + '" data-on="' + (c.active ? '0' : '1') + '">' + (c.active ? 'Switch off' : 'Switch on') + '</button>')).join('') : empty('No codes yet')));
}

/* ---------- setup checklist: every item explains itself and does something ---------- */
async function setup() {
  const { items } = await api.get('/api/manager/setup');
  const doneN = items.filter((i) => i.status === 'done').length;
  const group = (title, list) => (list.length ? '<h2>' + title + ' (' + list.length + ')</h2><div class="panel">' + list.map((i) => {
    const mark = i.status === 'done' ? '✓' : i.status === 'optional' ? '' : '!';
    const side = (i.go ? '<button class="b sm" data-action="go" data-go="' + i.go.view + '">' + esc(i.go.label) + '</button>' : '')
      + (!i.auto ? (i.status === 'done' ? '<button class="b sm ghost" data-action="tick" data-id="' + i.id + '" data-done="0">Undo</button>' : '<button class="b sm primary" data-action="tick" data-id="' + i.id + '" data-done="1">Mark as done</button>') : '');
    return '<div class="ck ' + i.status + '"><span class="mark" aria-hidden="true">' + mark + '</span><div class="body"><div class="t">' + esc(i.title) + ' <span class="pill ' + (i.auto ? '' : 'info') + '" style="margin-left:6px">' + (i.auto ? 'Checked automatically' : 'You tick this') + '</span></div>'
      + '<div class="d">' + esc(i.detail) + '</div><details><summary>Why it matters and how to do it</summary><p class="why"><b>Why:</b> ' + esc(i.why) + '</p><p class="how"><b>How:</b> ' + esc(i.how) + '</p></details></div><div class="side">' + side + '</div></div>';
  }).join('') + '</div>' : '');
  frame(head('Setup checklist', 'What is switched on, and what still needs doing. Items marked “Checked automatically” update by themselves when the setting changes; the rest you tick yourself.',
    '<button class="b" data-action="go" data-go="setup">Re-check</button>'),
  '<div class="panel pad"><b>' + doneN + ' of ' + items.length + ' done</b><div class="bar-prog"><i style="width:' + Math.round((doneN / items.length) * 100) + '%"></i></div></div>'
    + group('Needs you', items.filter((i) => ['attention', 'todo'].includes(i.status))) + group('Do these yourself', items.filter((i) => i.status === 'manual'))
    + group('Optional for now', items.filter((i) => i.status === 'optional')) + group('Done', items.filter((i) => i.status === 'done')));
}

const VIEWS = { overview, attention, review, inbox, customers, customer, people, person, pricing, promos, setup, log, support: supportView };
async function loadBadges() {
  try { S.badges = await api.get('/api/manager/badges'); } catch { /* the badges are a convenience */ }
}
async function show(view = S.view) {
  S.view = view; S.nav = false;
  await loadBadges();
  loading();
  try { await VIEWS[view](); window.scrollTo(0, 0); } catch (e) { handleError(e); }
}
function handleError(e) {
  if (e.code === 'mfa_required' || e.status === 401) return start();
  toast(e.message || 'Something went wrong');
  if (/Loading/.test(root.textContent)) frame('', '<div class="ban bad">' + esc(e.message) + '</div>');
}
const reload = () => show(S.view);

/* ---------- start: where is this person in the sign-in? ---------- */
async function start(msg) {
  let b;
  try { b = await api.get('/api/bootstrap'); } catch { return loginView('Cannot reach COMVERA. Check your connection.'); }
  setCsrf(b.csrfToken);
  if (!b.authenticated) return loginView(msg);
  let me;
  try { me = await api.get('/api/manager/me'); } catch {
    root.innerHTML = signShell('<h1>No access</h1><p class="lead">This account is not a COMVERA platform owner. Sign out and use the right account.</p><button class="b" data-action="signout">Sign out</button>');
    return;
  }
  S.me = me;
  if (!me.enrolled) return setupView(msg);
  if (!me.verified) return codeView(msg);
  show(S.view);
}

/* ---------- actions ---------- */
const flagKinds = Object.entries(FLAG_LABEL);
const GO = {
  customers: () => { S.f.orgs = { ...S.f.orgs, kind: '', cls: '', flagged: '', page: 0 }; return show('customers'); },
  'customers-host': () => { S.f.orgs = { q: '', kind: 'host', status: '', cls: 'customer', billing: '', flagged: '', page: 0 }; return show('customers'); },
  'customers-contractor': () => { S.f.orgs = { q: '', kind: 'contractor', status: '', cls: 'customer', billing: '', flagged: '', page: 0 }; return show('customers'); },
  'customers-test': () => { S.f.orgs = { q: '', kind: '', status: '', cls: 'internal_test', billing: '', flagged: '', page: 0 }; return show('customers'); },
  people: () => { S.f.users = { q: '', orgId: '', orgName: '', role: '', verified: '', status: '', cls: '', flagged: '', page: 0 }; return show('people'); },
  'people-unverified': () => { S.f.users = { q: '', orgId: '', orgName: '', role: '', verified: 'no', status: '', cls: 'customer', flagged: '', page: 0 }; return show('people'); },
};
const org = () => ({ id: S.orgId });
const doPost = (url, body) => api.post(url, body || {});

async function orgStatus(to) {
  const r = await api.get('/api/manager/orgs/' + S.orgId);
  const name = r.org.name;
  const label = { suspended: 'Suspend', deactivated: 'Deactivate', active: 'Reactivate' }[to];
  const lead = { suspended: 'Everyone in <b>' + esc(name) + '</b> is signed out now and cannot sign in until you reactivate it. Nothing is removed.',
    deactivated: 'Closes <b>' + esc(name) + '</b>. Everyone is signed out and cannot sign in. All records are kept, and you can reactivate it later.', active: 'Lets everyone in <b>' + esc(name) + '</b> sign in again.' }[to];
  await dialog({ title: label + ' ' + name + '?', lead, confirm: label, danger: to !== 'active',
    fields: [{ id: 'reason', label: 'Reason (recorded in the log and the customer’s own audit trail)', textarea: true }].concat(to === 'active' ? [] : [{ id: 'confirmName', label: 'Type the organisation’s name to confirm', placeholder: name }]),
    run: async (v) => { const x = await doPost('/api/manager/orgs/' + S.orgId + '/status', { status: to, reason: v.reason, confirmName: v.confirmName || '' }); toast(label + 'd. ' + (x.sessionsEnded ? x.sessionsEnded + ' session(s) ended.' : '')); } });
  reload();
}

const impactHtml = (p) => {
  const i = p.impact, r = i.removed, row = (k, v, gone) => '<div class="' + (gone ? 'gone' : '') + '"><span class="k">' + k + '</span><span>' + v + '</span></div>';
  return '<div class="impact">' + row('People', i.people.total + ' (' + plural(i.people.removed, 'account') + ' deleted, ' + i.people.kept + ' only lose this membership)', true)
    + row('Sites', '<b>' + r.sites + '</b>', true) + row('Contractor files', '<b>' + r.contractorFiles + '</b>', true) + (r.clientRecords ? row('Client records', '<b>' + r.clientRecords + '</b>', true) : '')
    + row('Documents', '<b>' + r.documents + '</b> filed · <b>' + r.studioDocuments + '</b> written in Studio', true) + row('Stored files erased', '<b>' + r.files + '</b> (' + mb(r.bytes) + ')', true)
    + row('Exchanges, pending invitations', r.exchanges + ', ' + r.pendingInvites, true) + row('Their audit trail', '<b>' + r.auditEvents + '</b> entries removed', true)
    + row('Contractor relationships', i.relationships.contractorsLinkedFromThisOrganisation + ' contractors lose their link to this mine; ' + i.relationships.sitesAtOtherOrganisationsKeepTheirRecordsButLoseTheLink + ' site file(s) at other organisations lose the link to this company', false)
    + row('Kept', i.kept.paymentRecords + ' payment record(s) in a permanent ledger, and the log of what you did', false) + row('Reversible', '<b>No</b>', true) + '</div>';
};
async function orgDelete() {
  const p = await api.get('/api/manager/orgs/' + S.orgId + '/deletion-preview');
  if (p.blockers.length) {
    await dialog({ title: 'Not ready to delete', lead: 'Permanent deletion is the last step, after an account is closed.', html: '<ul style="padding-left:18px;font-size:14px;line-height:1.6">' + p.blockers.map((b) => '<li>' + esc(b) + '</li>').join('') + '</ul>' });
    return;
  }
  await dialog({ title: 'Schedule permanent deletion of ' + p.org.name, lead: 'Nothing is deleted today. It is scheduled for <b>' + p.waitDays + ' days</b> from now, you can cancel any time before then, and you will need to confirm again with a fresh code.',
    html: impactHtml(p), confirm: 'Schedule deletion', danger: true,
    fields: [{ id: 'reason', label: 'Reason', textarea: true }, { id: 'confirmName', label: 'Type the organisation’s name to confirm', placeholder: p.org.name }].concat(proofFields()),
    run: async (v) => { await doPost('/api/manager/orgs/' + S.orgId + '/deletion/schedule', v); toast('Deletion scheduled'); } });
  reload();
}
async function orgDeleteRun() {
  const p = await api.get('/api/manager/orgs/' + S.orgId + '/deletion-preview');
  await dialog({ title: 'Delete ' + p.org.name + ' permanently?', lead: 'This cannot be undone. Files are erased from storage.', html: impactHtml(p), confirm: 'Delete permanently', danger: true,
    fields: [{ id: 'confirmName', label: 'Type the organisation’s name to confirm', placeholder: p.org.name }].concat(proofFields()),
    run: async (v) => { const x = await doPost('/api/manager/orgs/' + S.orgId + '/deletion/execute', v); toast('Deleted. ' + x.people + ' people and ' + x.files + ' files removed.'); } })
    .then((ok) => { if (ok) { S.orgId = null; show('customers'); } });
}
async function userStatus(to) {
  const r = await api.get('/api/manager/users/' + S.userId); const u = r.user;
  const label = { suspended: 'Suspend', deactivated: 'Deactivate', active: 'Reactivate' }[to];
  await dialog({ title: label + ' ' + u.name + '?', lead: to === 'active' ? 'Lets them sign in again.' : 'They are signed out now and cannot sign in. Their records are kept. The rest of their organisation is not affected.', confirm: label, danger: to !== 'active',
    fields: [{ id: 'reason', label: 'Reason', textarea: true }].concat(to === 'active' ? [] : [{ id: 'confirmEmail', label: 'Type their email address to confirm', placeholder: u.email }]),
    run: async (v) => { await doPost('/api/manager/users/' + S.userId + '/status', { status: to, reason: v.reason, confirmEmail: v.confirmEmail || '' }); toast(label + 'd'); } });
  reload();
}

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-action]');
  const open = document.querySelector('.menu.open');
  if (open && (!el || el.dataset.action !== 'menu')) open.classList.remove('open');
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'open-org' && el.tagName === 'A') ev.preventDefault();
  try {
    if (a === 'dlg-scrim') { if (ev.target === el) closeDialog(false); return; }
    if (a === 'dlg-cancel') return closeDialog(false);
    if (a === 'dlg-ok') return dialogSubmit();
    if (a === 'menu') { const m = el.closest('.menu'); const was = m.classList.contains('open'); document.querySelectorAll('.menu.open').forEach((x) => x.classList.remove('open')); if (!was) m.classList.add('open'); return; }
    if (a === 'toggle-nav') { S.nav = !S.nav; document.querySelector('.mx').classList.toggle('nav-open', S.nav); el.setAttribute('aria-expanded', String(S.nav)); return; }
    if (a === 'login') {
      el.disabled = true; let r;
      try { r = await api.post('/api/auth/login', { email: val('mgEmail'), password: document.getElementById('mgPass').value }); } catch (e) { el.disabled = false; return loginView(e.message); }
      if (r && r.mfaRequired) { S.ticket = r.ticket; return codeView(); }
      return start();
    }
    if (a === 'verify') {
      el.disabled = true;
      try {
        const r = S.ticket ? await api.post('/api/auth/login/mfa', { ticket: S.ticket, code: val('mgCode') }) : await api.post('/api/manager/mfa/verify', { code: val('mgCode') });
        S.ticket = null; if (r.usedRecoveryCode) toast('Recovery code used. It will not work again.');
      } catch (e) { if (/expired/i.test(e.message)) { S.ticket = null; return loginView(e.message); } return codeView(e.message); }
      return start();
    }
    if (a === 'enable') { el.disabled = true; try { const r = await api.post('/api/manager/mfa/enable', { code: val('mgCode') }); return recoveryView(r.recoveryCodes); } catch (e) { el.disabled = false; return toast(e.message); } }
    if (a === 'print') return window.print();
    if (a === 'saved') return start();
    if (a === 'signout') { try { await api.post('/api/auth/logout'); } catch { /* already out */ } S.me = null; return start(); }
    if (a === 'nav') { S.orgId = null; S.userId = null; S.tab = 'overview'; return show(el.dataset.view); }
    if (a === 'go') { const g = el.dataset.go; S.orgId = null; S.userId = null; if (GO[g]) return GO[g](); return show(g); }
    if (a === 'tab') { S.tab = el.dataset.tab; return show('customer'); }
    if (a === 'open-org') { S.orgId = el.dataset.id; S.tab = 'overview'; return show('customer'); }
    if (a === 'open-person') { S.userId = el.dataset.id; return show('person'); }
    if (a === 'apply-orgs') { S.f.orgs = { q: val('fq'), kind: val('fk'), status: val('fs'), cls: val('fc'), billing: S.f.orgs.billing, flagged: S.f.orgs.flagged, page: 0 }; return show('customers'); }
    if (a === 'apply-users') { S.f.users = { ...S.f.users, q: val('fq'), role: val('fr'), verified: val('fv'), status: val('fs'), cls: val('fc'), page: 0 }; return show('people'); }
    if (a === 'toggle-flagged') { const f = S.f[el.dataset.which === 'orgs' ? 'orgs' : 'users']; f.flagged = f.flagged ? '' : '1'; f.page = 0; return show(el.dataset.which === 'orgs' ? 'customers' : 'people'); }
    if (a === 'clear-org-filter') { S.f.users.orgId = ''; S.f.users.orgName = ''; return show('people'); }
    if (a === 'pg-orgs') { S.f.orgs.page = Math.max(0, S.f.orgs.page + Number(el.dataset.d)); return show('customers'); }
    if (a === 'pg-users') { S.f.users.page = Math.max(0, S.f.users.page + Number(el.dataset.d)); return show('people'); }

    // ----- organisation actions
    if (a === 'org-status') return orgStatus(el.dataset.to);
    if (a === 'org-flag' || a === 'user-flag') {
      const isOrg = a === 'org-flag', base = isOrg ? '/api/manager/orgs/' + S.orgId : '/api/manager/users/' + S.userId;
      await dialog({ title: 'Flag for review', lead: 'A flag is a note for you. It does not block anyone or remove anything.', confirm: 'Flag',
        fields: [{ id: 'kind', label: 'What is it?', options: flagKinds }, { id: 'reason', label: 'Why (what did you notice?)', textarea: true }],
        run: async (v) => { await doPost(base + '/flag', v); toast('Flagged'); } });
      return reload();
    }
    if (a === 'org-unflag') { await doPost('/api/manager/orgs/' + S.orgId + '/unflag'); toast('Flag cleared'); return reload(); }
    if (a === 'user-unflag') { await doPost('/api/manager/users/' + S.userId + '/unflag'); toast('Flag cleared'); return reload(); }
    if (a === 'org-class' || a === 'user-class') {
      const to = el.dataset.to, base = a === 'org-class' ? '/api/manager/orgs/' + S.orgId : '/api/manager/users/' + S.userId;
      await doPost(base + '/class', { class: to }); toast(to === 'customer' ? 'Marked as a real customer' : 'Marked as an internal test'); return reload();
    }
    if (a === 'org-delete') return orgDelete();
    if (a === 'org-delete-run') return orgDeleteRun();
    if (a === 'org-delete-cancel') { await dialog({ title: 'Cancel the deletion?', lead: 'The organisation stays closed. You can reactivate it afterwards.', confirm: 'Cancel deletion', run: async () => { await doPost('/api/manager/orgs/' + S.orgId + '/deletion/cancel'); toast('Deletion cancelled'); } }); return reload(); }
    if (a === 'extend-trial') { await doPost('/api/manager/orgs/' + S.orgId + '/extend-trial', { days: Number(val('trialDays')) }); toast('Trial extended'); return reload(); }
    if (a === 'give-plan') {
      const plan = val('giveplan'); await api.post('/api/admin/orgs/' + S.orgId + '/grant', { plan: plan || null, until: val('giveuntil') || null, note: val('givenote') });
      toast(plan ? 'Plan given' : 'Given plan removed'); return reload();
    }
    if (a === 'open-support') {
      const ok = await dialog({ title: 'Open the read-only view', lead: 'Shows names and statuses, never file contents. The reason is recorded for you and in the customer’s own audit trail.', confirm: 'Open',
        fields: [{ id: 'reason', label: 'Why do you need to look?', placeholder: 'e.g. Helping with a stuck document request' }],
        run: async (v) => { S.supportReason = v.reason; } });
      if (ok) return show('support'); return;
    }

    // ----- people actions
    if (a === 'user-status') return userStatus(el.dataset.to);
    if (a === 'user-revoke') { const x = await doPost('/api/manager/users/' + S.userId + '/revoke-sessions'); toast(x.sessionsEnded + ' session(s) ended'); return reload(); }
    if (a === 'user-reset-email') { await dialog({ title: 'Send a password reset email?', lead: 'The link goes only to that person’s own address.', confirm: 'Send', run: async () => { await doPost('/api/manager/users/' + S.userId + '/reset-email'); toast('Reset email queued'); } }); return; }
    if (a === 'user-reset-mfa') {
      await dialog({ title: 'Reset two-step sign-in?', lead: 'Only after confirming who they are, for example with a call to a number you already have. They are signed out and emailed.', confirm: 'Reset', danger: true,
        fields: [{ id: 'reason', label: 'How did you confirm it is them?', textarea: true }], run: async (v) => { await doPost('/api/manager/users/' + S.userId + '/reset-mfa', { reason: v.reason }); toast('Reset; they have been emailed'); } });
      return reload();
    }
    if (a === 'user-delete') {
      const r = await api.get('/api/manager/users/' + S.userId); const u = r.user;
      const ok = await dialog({ title: 'Delete ' + u.name + ' permanently?', lead: 'Their account and memberships are removed, and their name is removed from audit entries. This cannot be undone. Only possible 14 days after deactivation, and never for the only person in an organisation.',
        confirm: 'Delete permanently', danger: true, fields: [{ id: 'confirmEmail', label: 'Type their email address to confirm', placeholder: u.email }].concat(proofFields()),
        run: async (v) => { await doPost('/api/manager/users/' + S.userId + '/delete', v); toast('Person deleted'); } });
      if (ok) { S.userId = null; show('people'); } return;
    }

    // ----- everything else
    if (a === 'tick') { await doPost('/api/manager/setup/' + el.dataset.id, { done: el.dataset.done === '1' }); return reload(); }
    if (a === 'save-price') {
      const id = el.dataset.plan, raw = val('pr-' + id);
      await api.put('/api/admin/pricing/' + id, { priceCents: raw === '' ? null : Math.round(Number(raw) * 100), currency: el.dataset.currency || 'ZAR', per: val('pe-' + id) || 'month', blurb: el.dataset.blurb || null,
        highlights: document.getElementById('ph-' + id).value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 8), visible: val('pv-' + id) === '1' });
      return toast('Saved');
    }
    if (a === 'create-promo') {
      await api.post('/api/admin/promos', { code: val('pc-code'), plan: val('pc-plan'), description: val('pc-desc'), percentOff: 100, durationDays: val('pc-days') ? Number(val('pc-days')) : null, maxRedemptions: val('pc-max') ? Number(val('pc-max')) : null });
      toast('Code created'); return show('promos');
    }
    if (a === 'toggle-promo') { await api.post('/api/admin/promos/' + el.dataset.id + '/active', { active: el.dataset.on === '1' }); return show('promos'); }
    if (a === 'requeue') { await api.post('/api/manager/emails/' + el.dataset.id + '/requeue'); toast('Queued to send again'); return show('attention'); }
    if (a === 'handle') {
      await dialog({ title: 'Mark as handled', confirm: 'Mark handled', fields: [{ id: 'note', label: 'What did you do? (optional)', textarea: true, required: false }],
        run: async (v) => { await api.post('/api/manager/inbox/' + el.dataset.source + '/' + el.dataset.id + '/handle', { note: v.note }); } });
      return show('inbox');
    }
  } catch (e) { handleError(e); }
});
document.addEventListener('change', (ev) => { const el = ev.target.closest('[data-change]'); if (el) document.querySelector('[data-action="' + el.dataset.change + '"]')?.click(); });
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') { if (modalRoot.innerHTML) return closeDialog(false); document.querySelector('.menu.open')?.classList.remove('open'); }
  if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') {
    if (modalRoot.innerHTML) { ev.preventDefault(); return dialogSubmit(); }
    const en = ev.target.dataset.enter;
    const btn = en ? root.querySelector('[data-action="' + en + '"]') : root.querySelector('[data-action="login"],[data-action="verify"],[data-action="enable"]');
    if (btn && !btn.disabled) btn.click();
  }
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('tr.go,.li.go')) { ev.preventDefault(); ev.target.click(); }
});

start();
