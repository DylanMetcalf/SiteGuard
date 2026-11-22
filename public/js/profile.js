// "About you": the personal part of sign-up, shared by the set-up wizard, the short page an invited person sees before
// the app opens, and Account settings. The purpose shapes the first screen and suggestions only; it never grants a role.
import { api } from './api.js';
import { S, escapeHtml, on, reload, showToast } from './core.js';

const PURPOSES = {
  host: [['site', 'Manage a site or project', 'Set what contractors must provide and track who is ready'], ['contractors', 'Manage contractors', 'Invite contractors and follow their documents'],
    ['review', 'Review compliance evidence', 'Check and approve what contractors submit'], ['invited', 'I was invited to join', 'Someone at my company or a site asked me to join']],
  contractor: [['documents', 'Manage my company’s compliance documents', 'Keep documents current and build safety files for sites'], ['invited', 'I was invited to join', 'Someone at my company or a site asked me to join']],
  consultant: [['clients', 'Look after client companies', 'Keep several companies’ safety files in order'], ['documents', 'Manage my own company’s documents', 'My company’s registration, insurance and policies']],
};
export function purposeOptions(){
  const o = (S.boot && S.boot.org) || {};
  return o.isConsultant ? PURPOSES.consultant : o.kind === 'host' ? PURPOSES.host : PURPOSES.contractor;
}
export function defaultPurpose(invited){
  const opts = purposeOptions(), me = (S.boot && S.boot.me) || {};
  if(me.purpose && opts.some(([k]) => k === me.purpose)) return me.purpose;
  return invited ? 'invited' : opts[0][0];
}
const split = (name) => { const p = String(name || '').trim().split(/\s+/); return [p[0] || '', p.slice(1).join(' ')]; };

/** The fields. Values come from the escaped bootstrap (me), so they are safe to interpolate. */
export function profileFields(opts = {}){
  const me = (S.boot && S.boot.me) || {};
  const [f0, l0] = split(me.name);
  const first = me.firstName || f0, last = me.lastName || l0, chosen = opts.purpose || defaultPurpose(opts.invited);
  const fld = (id, label, value, extra) => '<label class="field-label" for="' + id + '">' + label + '</label><input type="text" id="' + id + '" value="' + (value || '') + '" ' + (extra || '') + '>';
  return '<div class="ob-two"><div>' + fld('obFirst', 'First name', first, 'maxlength="100" autocomplete="given-name"') + '</div><div>' + fld('obLast', 'Last name (optional)', last, 'maxlength="100" autocomplete="family-name"') + '</div></div>'
    + fld('obTitle', 'Job title (optional)', me.title, 'maxlength="120" placeholder="e.g. SHE Officer, Contracts Manager"')
    + fld('obMePhone', 'Work phone (optional)', me.phone, 'maxlength="60" inputmode="tel" autocomplete="tel"')
    + '<fieldset class="ob-purpose"><legend class="field-label">How would you like to use COMVERA?</legend>'
    + purposeOptions().map(([k, t, sub]) => '<label class="ob-choice' + (k === chosen ? ' on' : '') + '"><input type="radio" name="obPurpose" value="' + k + '"' + (k === chosen ? ' checked' : '') + '><span><b>' + t + '</b><small>' + sub + '</small></span></label>').join('')
    + '</fieldset><p class="site-card-sub">This only decides what we show you first. What you can do is set by your organisation’s admins.</p>'
    + '<label class="ob-consent"><input type="checkbox" id="obNews"' + (me.productNews ? ' checked' : '') + '> Email me occasional COMVERA product news (optional). Account and compliance emails are sent either way.</label>';
}
export function readProfile(){
  const v = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const p = document.querySelector('input[name="obPurpose"]:checked');
  const news = document.getElementById('obNews');
  return { firstName: v('obFirst'), lastName: v('obLast'), title: v('obTitle'), phone: v('obMePhone'), purpose: p ? p.value : '', productNews: news ? news.checked : undefined };
}
export async function saveProfile(){
  const b = readProfile();
  if(!b.firstName) throw new Error('Enter your first name.');
  if(!b.purpose) throw new Error('Choose how you will use COMVERA.');
  await api.put('/api/me/profile', b);
  // Keep the local copy current (escaped, like the bootstrap it came from) so later steps and forms show what was saved.
  const me = S.boot && S.boot.me;
  if(me){
    const e = escapeHtml;
    Object.assign(me, { firstName: e(b.firstName), lastName: e(b.lastName), name: e([b.firstName, b.lastName].filter(Boolean).join(' ')), title: e(b.title), phone: e(b.phone), purpose: e(b.purpose), productNews: !!b.productNews, profileComplete: true });
  }
}

/** Shown once to someone who joined an existing organisation, before the app opens. */
export function renderProfileGate(err){
  const o = S.boot.org || {};
  return '<div class="ob-wrap"><div class="ob-brand"><div class="brand-mark"></div><span>COMVERA</span></div><div class="card ob-narrow">'
    + '<h1>Welcome to ' + (o.name || 'COMVERA') + '</h1><p>One quick step: tell your colleagues who you are. It takes less than a minute.</p>'
    + (err ? '<div class="notice" role="alert" style="background:var(--red-bg);color:var(--red);">' + escapeHtml(err) + '</div>' : '')
    + profileFields({ invited: true })
    + '<button class="btn primary block" style="margin-top:14px;" data-action="profile-gate-save">Continue</button>'
    + '<button class="btn ghost block" style="margin-top:8px;" data-action="auth-signout">Sign out and finish later</button></div></div>';
}
let gateBusy = false;
on('profile-gate-save', async (el) => {
  if(gateBusy) return;
  gateBusy = true; el.disabled = true;
  try{ await saveProfile(); await reload(); showToast('Welcome to COMVERA.'); }
  catch(e){ S.profileErr = e.message; const app = document.getElementById('app'); if(app) app.innerHTML = renderProfileGate(e.message); }
  finally{ gateBusy = false; }
});
document.addEventListener('change', (e) => {
  if(e.target && e.target.name === 'obPurpose') document.querySelectorAll('.ob-purpose .ob-choice').forEach((l) => l.classList.toggle('on', l.contains(e.target)));
});
