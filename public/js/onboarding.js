// Guided set-up (before the app opens), the "confirm your email" page, and the waiting page for people whose
// admin has not finished set-up yet. Every answer is saved on the server step by step, so leaving and coming back
// picks up where you were. The server, not this page, decides when the app opens.
import { api } from './api.js';
import { S, ICONS, escapeHtml, on, render, reload, showToast } from './core.js';
import { openUploadSheet, invalidateDocstore } from './docstore.js';
import { loadPacks } from './sheets.js';

const ob = () => (S.ob ??= { data: null, step: null, err: '', docs: null, packs: null });
const v = (id) => (document.getElementById(id) ? document.getElementById(id).value.trim() : '');
const brand = '<div class="ob-brand"><div class="brand-mark"></div><span>COMVERA</span></div>';

export async function loadOnboarding(){
  const o = ob();
  o.data = await api.get('/api/onboarding');
  try{ o.docs = (await api.get('/api/org-docs')).documents; }catch{ o.docs = []; }
  if(!o.step || !o.data.steps.some((s) => s.id === o.step)) o.step = (o.data.steps.find((s) => !s.done) || o.data.steps[o.data.steps.length - 1]).id;
  if(o.data.org.kind === 'host' && !o.packs){ try{ o.packs = await loadPacks(); }catch{ o.packs = []; } }
  return o;
}
const redraw = () => { render(); };

/* ---------- pages shown instead of the app ---------- */
export function renderVerifyGate(){
  return '<div class="ob-wrap">' + brand + '<div class="card ob-narrow"><h1>Confirm your email address</h1>'
    + '<p>We sent a link to <strong>' + S.boot.me.email + '</strong>. Open it on this device to continue setting up COMVERA.</p>'
    + '<p class="site-card-sub">Can’t find it? Check your spam folder, or ask for a new link. Links work for 24 hours.</p>'
    + '<button class="btn primary block" data-action="resend-verification">Send the link again</button>'
    + '<button class="btn secondary block" style="margin-top:8px;" data-action="ob-recheck">I have confirmed it</button>'
    + '<button class="btn ghost block" style="margin-top:8px;" data-action="auth-signout">Sign out</button></div></div>';
}
export function renderOnboardingWait(){
  return '<div class="ob-wrap">' + brand + '<div class="card ob-narrow"><h1>Almost ready</h1><p>An administrator of <strong>' + S.boot.org.name + '</strong> is still setting up COMVERA. You will be able to start as soon as they finish.</p>'
    + '<button class="btn secondary block" data-action="ob-recheck">Check again</button><button class="btn ghost block" style="margin-top:8px;" data-action="auth-signout">Sign out</button></div></div>';
}

/** The guided set-up. As a gate (before the app) or, later, inside the app to revisit answers. */
export function renderOnboarding(inApp){
  const o = ob();
  if(!o.data){ loadOnboarding().then(redraw).catch((e) => { o.err = e.message; redraw(); }); return '<div class="ob-wrap">' + (inApp ? '' : brand) + '<div class="empty"><p>Loading set-up…</p></div></div>'; }
  const d = o.data, steps = d.steps, cur = steps.find((s) => s.id === o.step) || steps[0], idx = steps.indexOf(cur);
  const req = steps.filter((s) => s.need === 'required'), doneReq = req.filter((s) => s.done).length;
  const label = { required: 'Required', recommended: 'Recommended', optional: 'Optional' };
  const nav = '<ol class="ob-steps">' + steps.map((s, i) => '<li><button class="ob-step' + (s.id === cur.id ? ' on' : '') + (s.done ? ' done' : '') + '" data-action="ob-go" data-step="' + s.id + '">'
    + '<span class="ob-dot">' + (s.done ? '✓' : i + 1) + '</span><span><b>' + s.title + '</b><small>' + (s.done ? 'Done' : label[s.need]) + '</small></span></button></li>').join('') + '</ol>';
  const head = inApp ? '<div class="view-head"><h1>Organisation set-up</h1><p>Your answers from setting up COMVERA. Change anything here.</p></div>'
    : brand + '<div class="ob-intro"><h1>Let’s set up ' + escapeHtml(d.org.name) + '</h1><p>' + (d.org.kind === 'host' ? 'A few minutes now means contractors know exactly what you need from day one.' : 'A few minutes now means every site sees a complete, professional company profile.')
      + ' Everything is saved as you go.</p><div class="ob-progress"><i style="width:' + Math.round((doneReq / req.length) * 100) + '%"></i></div><div class="site-card-sub">' + doneReq + ' of ' + req.length + ' required steps done</div></div>';
  const canEdit = d.canEdit;
  const body = '<div class="card ob-card"><div class="ob-card-head"><span class="badge ' + (cur.done ? 'complete' : cur.need === 'required' ? 'missing' : 'grey') + '">' + (cur.done ? 'Done' : label[cur.need]) + '</span><h2>' + cur.title + '</h2><p class="site-card-sub">' + cur.why + '</p></div>'
    + (o.err ? '<div class="notice" role="alert" style="background:var(--red-bg);color:var(--red);">' + escapeHtml(o.err) + '</div>' : '')
    + (canEdit ? stepBody(cur.id, d) : '<p>Only an owner or admin can change these answers.</p>')
    + '<div class="ob-foot">' + (idx > 0 ? '<button class="btn secondary" data-action="ob-go" data-step="' + steps[idx - 1].id + '">Back</button>' : '<span></span>')
    + (canEdit ? '<button class="btn primary" data-action="ob-save" data-step="' + cur.id + '">' + (idx < steps.length - 1 ? 'Save and continue' : 'Save') + '</button>' : '') + '</div></div>';
  const finish = inApp ? '' : '<div class="card ob-finish">' + (d.canComplete ? '<div><b>Everything required is done.</b><div class="site-card-sub">Optional steps can be done now or later from More → Organisation set-up.</div></div><button class="btn primary" data-action="ob-complete">Open COMVERA</button>'
    : '<div><b>Still to do before COMVERA opens</b><div class="site-card-sub">' + d.missing.map(escapeHtml).join(' · ') + '</div></div><button class="btn primary" disabled>Open COMVERA</button>') + '</div>';
  return '<div class="ob-wrap' + (inApp ? ' in-app' : '') + '">' + head + '<div class="ob-grid"><nav aria-label="Set-up steps">' + nav + '</nav><div>' + body + finish + '</div></div>'
    + (inApp ? '' : '<div style="text-align:center;margin-top:16px;"><button class="btn ghost small" data-action="auth-signout">Sign out and continue later</button></div>') + '</div>';
}

const fld = (id, label, value, extra = '') => '<label class="field-label" for="' + id + '">' + label + '</label><input type="text" id="' + id + '" value="' + escapeHtml(value || '') + '" ' + extra + '>';
function stepBody(id, d){
  const a = d.answers || {}, c = a.contact || {};
  if(id === 'organisation') return fld('obName', d.org.kind === 'host' ? 'Organisation name' : 'Company name', d.org.name, 'maxlength="200" autocomplete="organization"')
    + fld('obReg', 'Company registration number (optional)', d.org.regNumber, 'maxlength="60" placeholder="e.g. 2015/123456/07"')
    + fld('obAddr', 'Physical address (optional)', d.org.address, 'maxlength="400"')
    + fld('obPhone', 'Main phone number', a.phone, 'maxlength="40" inputmode="tel" autocomplete="tel"');
  if(id === 'contact') return fld('obCName', 'Name', c.name, 'maxlength="120" autocomplete="name"') + fld('obCRole', 'Role (optional)', c.role, 'maxlength="120" placeholder="e.g. SHE Manager"')
    + fld('obCPhone', 'Phone', c.phone, 'maxlength="40" inputmode="tel"') + fld('obCEmail', 'Email', c.email, 'maxlength="200" inputmode="email"')
    + '<p class="site-card-sub">A phone number or an email is enough. To invite colleagues, use More → Team &amp; roles once set-up is done.</p>';
  if(id === 'services'){
    const inds = ['Mining', 'Quarrying', 'Construction', 'Energy', 'Manufacturing', 'Petrochemical', 'Other'];
    return fld('obTrade', 'Main trade', d.org.trade, 'maxlength="200" placeholder="e.g. Scaffolding and access"')
      + '<label class="field-label" for="obServices">Services and capabilities (optional)</label><textarea id="obServices" rows="3" maxlength="1000" placeholder="e.g. Scaffold erection, rope access, confined-space entry">' + escapeHtml(a.services || '') + '</textarea>'
      + '<div class="field-label">Industries you work in (optional)</div><div class="ob-chips">' + inds.map((x) => '<label class="ob-chip"><input type="checkbox" class="obInd" value="' + x + '"' + ((a.industries || []).includes(x) ? ' checked' : '') + '> ' + x + '</label>').join('') + '</div>';
  }
  if(id === 'site'){
    const list = d.workplaces.length ? '<div class="card" style="margin-bottom:12px;">' + d.workplaces.map((w) => '<div class="menu-row" style="cursor:default;"><div class="qa-icon">' + ICONS.sites + '</div><div style="flex:1;"><div class="qa-title">' + escapeHtml(w.name) + '</div><div class="qa-sub">' + escapeHtml(w.location || '') + '</div></div></div>').join('') + '</div>' : '';
    const packs = (ob().packs || []).filter((p) => p.audience !== 'contractor');
    return list + '<div class="section-title" style="margin-top:0;">' + (d.workplaces.length ? 'Add another site (optional)' : 'Add your site') + '</div>'
      + fld('obSite', 'Site name', '', 'maxlength="300" placeholder="e.g. Kathu North Mine"') + fld('obLoc', 'Location (optional)', '', 'maxlength="300" placeholder="Town or GPS"')
      + (packs.length ? '<div class="field-label">What should contractors provide? (optional, you can change it later)</div><div class="ob-packs">' + packs.map((p) => '<label class="ob-chip"><input type="checkbox" class="obPack" value="' + p.id + '"> ' + p.name + '</label>').join('') + '</div>' : '')
      + '<button class="btn secondary" style="margin-top:10px;" data-action="ob-add-site">' + ICONS.plus + ' Add site</button>';
  }
  if(id === 'areas'){
    if(!d.workplaces.length) return '<p>Add a site first.</p>';
    return d.workplaces.map((w) => '<div class="section-title" style="margin-top:6px;">' + escapeHtml(w.name) + '</div><div class="ob-chips">'
      + (w.areas.length ? w.areas.map((ar) => '<span class="ob-chip on">' + escapeHtml(ar.name) + ' <small>' + (ar.kind === 'department' ? 'department' : 'area') + '</small><button class="ob-x" data-action="ob-del-area" data-wp="' + w.id + '" data-id="' + ar.id + '" aria-label="Remove ' + escapeHtml(ar.name) + '">×</button></span>').join('') : '<span class="site-card-sub">None yet.</span>')
      + '</div><div class="ob-inline"><input type="text" id="obArea-' + w.id + '" maxlength="120" placeholder="e.g. Plant, Shaft 2, Engineering" aria-label="Department or area name"><select id="obAreaKind-' + w.id + '" aria-label="Kind"><option value="area">Area</option><option value="department">Department</option></select>'
      + '<button class="btn secondary small" data-action="ob-add-area" data-wp="' + w.id + '">Add</button></div>').join('')
      + '<button class="btn ghost small" style="margin-top:12px;" data-action="ob-skip" data-step="areas">' + (d.answers.areasSkipped ? 'Marked as not needed' : 'We don’t need departments or areas') + '</button>';
  }
  if(id === 'documents'){
    const ans = (d.answers || {}).documents || '';
    const opt = (val, t, sub) => '<label class="ob-choice' + (ans === val ? ' on' : '') + '"><input type="radio" name="obDocs" value="' + val + '"' + (ans === val ? ' checked' : '') + '><span><b>' + t + '</b><small>' + sub + '</small></span></label>';
    const docs = ob().docs || [];
    return opt('yes', 'Yes, we have documents to upload', d.org.kind === 'host' ? 'Policies, procedures, induction packs, emergency plans, site rules, templates' : 'Registration, insurance, policies, risk assessments, certificates, training records')
      + opt('no', 'No, we don’t have any yet', 'COMVERA’s Document Studio can create them with you later')
      + opt('later', 'Not sure, I’ll do this later', 'You can upload any time from Document Studio')
      + (ans === 'yes' ? '<div class="ob-upload"><button class="btn primary" data-action="ob-upload">' + ICONS.upload + ' Upload documents</button>'
        + (docs.length ? '<div class="card" style="margin-top:10px;">' + docs.map((x) => '<div class="menu-row" style="cursor:default;"><div class="qa-icon">' + ICONS.passport + '</div><div style="flex:1;"><div class="qa-title">' + escapeHtml(x.name) + '</div><div class="qa-sub">' + escapeHtml(x.filename || '') + '</div></div></div>').join('') + '</div>' : '<p class="site-card-sub">Nothing uploaded yet. Uploading is optional.</p>') + '</div>' : '');
  }
  if(id === 'connect') return '<p>If a site gave you a site code, enter it to join that site now.</p>' + fld('obCode', 'Site code', '', 'maxlength="20" autocapitalize="characters" placeholder="e.g. KTH-4821"')
    + '<div class="ob-inline"><button class="btn secondary" data-action="ob-join">Join the site</button><button class="btn ghost" data-action="ob-skip" data-step="connect">' + (d.answers.connectSkipped ? 'Marked as later' : 'No code yet, skip') + '</button></div>';
  return '';
}

async function save(step){
  const o = ob(); o.err = '';
  const body = {
    organisation: () => ({ name: v('obName'), regNumber: v('obReg'), address: v('obAddr'), phone: v('obPhone') }),
    contact: () => ({ name: v('obCName'), role: v('obCRole'), phone: v('obCPhone'), email: v('obCEmail') }),
    services: () => ({ trade: v('obTrade'), services: v('obServices'), industries: [...document.querySelectorAll('.obInd:checked')].map((x) => x.value) }),
    documents: () => { const c = document.querySelector('input[name="obDocs"]:checked'); return c ? { answer: c.value } : null; },
  }[step];
  if(body){
    const b = body();
    if(!b){ o.err = 'Choose one of the answers.'; return redraw(); }
    await api.put('/api/onboarding/' + step, b);
  }
  if(step === 'site' && v('obSite')) await addSite();
  await loadOnboarding();
  const steps = o.data.steps, i = steps.findIndex((s) => s.id === step);
  if(steps.find((s) => s.id === step).done || !body) o.step = (steps[i + 1] || steps[i]).id;
  redraw(); window.scrollTo(0, 0);
}
async function addSite(){
  const name = v('obSite');
  if(!name){ ob().err = 'Give the site a name.'; return; }
  await api.post('/api/workplaces', { name, location: v('obLoc'), packIds: [...document.querySelectorAll('.obPack:checked')].map((x) => x.value) });
  showToast('Site added');
}
const guard = (fn) => async (el) => { try{ await fn(el); }catch(e){ ob().err = e.message; redraw(); } };
on('ob-go', (el) => { const o = ob(); o.step = el.dataset.step; o.err = ''; redraw(); window.scrollTo(0, 0); });
on('ob-save', guard((el) => save(el.dataset.step)));
on('ob-add-site', guard(async () => { await addSite(); await loadOnboarding(); redraw(); }));
on('ob-add-area', guard(async (el) => {
  const wp = el.dataset.wp, name = v('obArea-' + wp);
  if(!name) throw new Error('Type a name for the department or area.');
  await api.post('/api/workplaces/' + wp + '/areas', { name, kind: v('obAreaKind-' + wp) || 'area' });
  ob().err = ''; await loadOnboarding(); redraw();
}));
on('ob-del-area', guard(async (el) => { await api.del('/api/workplaces/' + el.dataset.wp + '/areas/' + el.dataset.id); await loadOnboarding(); redraw(); }));
on('ob-skip', guard(async (el) => { await api.put('/api/onboarding/' + el.dataset.step, { skipped: true }); await loadOnboarding(); redraw(); }));
on('ob-join', guard(async () => { const code = v('obCode'); if(!code) throw new Error('Enter the site code.'); await api.post('/api/sites/join', { code }); showToast('Joined the site'); await loadOnboarding(); redraw(); }));
on('ob-upload', () => {
  const d = ob().data;
  openUploadSheet({ workplaces: d.workplaces, onUploaded: async () => { invalidateDocstore(); await loadOnboarding(); } });
});
on('ob-complete', guard(async () => {
  await api.post('/api/onboarding/complete');
  S.ob = null; S.nav = 'dashboard';
  await reload();
  showToast('You’re set up. Welcome to COMVERA.');
}));
on('ob-recheck', async () => { try{ await reload(); }catch(e){ showToast(e.message); } });
document.addEventListener('change', (e) => { if(e.target && e.target.name === 'obDocs'){ const o = ob(); if(o.data){ o.data.answers = { ...(o.data.answers || {}), documents: e.target.value }; redraw(); } } });
