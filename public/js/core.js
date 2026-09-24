// Shared state, helpers and UI primitives.
//
// Security note: every string that arrives from the server is HTML-escaped
// once, on arrival (see deepEscape). The render code builds HTML strings, so
// data typed by another organisation can never inject markup into this page.
// Never unescape state values into innerHTML.

import { api, setCsrf } from './api.js';

export const S = {
  boot: null,          // full /api/bootstrap response (escaped)
  state: null,         // boot.state — shaped like the original MVP's state object
  nav: 'dashboard',
  activeSiteId: null,
  siteTab: 'compliance',
  focusSiteId: null,
  openReq: null,
  verifySiteId: null,
  docCentreFilter: 'all',
  safetyFilter: 'action',
  auditFilter: { from: '', to: '', siteId: '' },
  auditRows: null,
  docSelectMode: false,
  selectedDocs: [],
  moreView: null,
  live: false,
  authView: null,      // which signed-out screen is showing
  authContext: {},     // token etc. from an emailed link
};

/* ============ ESCAPING ============ */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]); }
export function deepEscape(v) {
  if (typeof v === 'string') return escapeHtml(v);
  if (Array.isArray(v)) return v.map(deepEscape);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = deepEscape(v[k]);
    return out;
  }
  return v;
}
/** For the rare non-HTML use of an escaped value (e.g. confirm()). */
export function unescapeHtml(s) {
  const t = document.createElement('textarea');
  t.innerHTML = s ?? '';
  return t.value;
}

/* ============ ICONS ============ */
export const ICONS = {
  dashboard:'<svg class="ic" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.6"/><rect x="13" y="3" width="8" height="5" rx="1" stroke="currentColor" stroke-width="1.6"/><rect x="13" y="10" width="8" height="11" rx="1" stroke="currentColor" stroke-width="1.6"/><rect x="3" y="13" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.6"/></svg>',
  sites:'<svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M12 2 3 7v3c0 6 4 9.5 9 12 5-2.5 9-6 9-12V7l-9-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  passport:'<svg class="ic" viewBox="0 0 24 24" fill="none"><rect x="4" y="3" width="16" height="18" rx="2" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="10" r="2.4" stroke="currentColor" stroke-width="1.6"/><path d="M8 16.5c.7-1.7 2.2-2.5 4-2.5s3.3.8 4 2.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  audit:'<svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M4 5h16M4 12h16M4 19h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="20" cy="19" r="1.4" fill="currentColor"/></svg>',
  more:'<svg class="ic" viewBox="0 0 24 24" fill="none"><circle cx="5" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="19" cy="12" r="1.7" fill="currentColor"/></svg>',
  verify:'<svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M3 8 12 4l9 4v5c0 5-3.6 8-9 11-5.4-3-9-6-9-11V8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 12.3l2.2 2.2L15.5 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  people:'<svg class="ic" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="17" cy="9" r="2.3" stroke="currentColor" stroke-width="1.6"/><path d="M16 14.6c2.2.1 3.8 1.4 4.5 4.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  hardhat:'<svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M4 16a8 8 0 0 1 16 0" stroke="currentColor" stroke-width="1.6"/><path d="M10 8.5V6h4v2.5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M2.5 16h19v2.5h-19z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  card:'<svg class="ic" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M3 10h18" stroke="currentColor" stroke-width="1.6"/></svg>',
  gear:'<svg class="ic" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  link:'<svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  alert:'<svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M12 3 2 20h20L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 10v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>',
  emergency:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 3 2 20h20L12 3Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 10v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>',
  plus:'<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  sparkle:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  bell:'<svg class="ic" viewBox="0 0 24 24" fill="none"><path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 18.5a2 2 0 0 0 4 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  search:'<svg class="ic" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.7"/><path d="m20 20-3.8-3.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  chevron:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="m9 6 6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check:'<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 12.5 10 17 19 7" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cross:'<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  up:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="m6 15 6-6 6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/* ============ LABELS ============ */
export const SOURCE_LABEL = {legal:'Legal requirement', client:'Client requirement', site:'Site requirement', project:'Project requirement', company:'Company requirement', best_practice:'Best practice', platform:'Platform recommendation'};
export const STATUS_LABEL = {complete:'Complete', missing:'Missing', expiring:'Expiring', expired:'Expired', awaiting_review:'Awaiting review', correction_required:'Correction required'};
export const INCIDENT_TYPES = [
  {id:'near_miss', label:'Near miss', color:'var(--blue)'},
  {id:'first_aid', label:'First aid case', color:'var(--amber)'},
  {id:'medical_treatment', label:'Medical treatment case', color:'var(--amber)'},
  {id:'lost_time', label:'Lost time injury', color:'var(--red)'},
  {id:'fatality', label:'Fatality', color:'var(--red)'},
  {id:'property_damage', label:'Property damage', color:'var(--grey)'},
  {id:'environmental', label:'Environmental incident', color:'var(--amber)'},
];
export function incidentTypeInfo(id){ return INCIDENT_TYPES.find(t=>t.id===id) || {label:id, color:'var(--grey)'}; }
export const PERMIT_TYPES = [
  {id:'hot_work', label:'Hot work'},
  {id:'heights', label:'Working at heights'},
  {id:'confined_space', label:'Confined space entry'},
  {id:'excavation', label:'Excavation'},
  {id:'lifting', label:'Lifting operation'},
  {id:'electrical_isolation', label:'Electrical isolation / LOTO'},
];
export function permitTypeInfo(id){ return PERMIT_TYPES.find(t=>t.id===id) || {label:id}; }
export const LIBRARY_TYPES = [
  {id:'good-standing', category:'Company Documents', name:'Letter of Good Standing (COID)', source:'legal', why:'Reusable across every site — most sites require this before work starts.'},
  {id:'insurance', category:'Company Documents', name:'Public liability insurance', source:'client', why:'Most sites require at least R5m cover; keep one current copy here.'},
  {id:'she-policy', category:'Company Documents', name:'Health & Safety policy', source:'legal', why:'Required under the MHSA for every site you work on.'},
  {id:'environmental-policy', category:'Company Documents', name:'Environmental policy', source:'best_practice', why:'Increasingly expected by sites working near environmentally sensitive areas.'},
];
export const CERT_KINDS = {medical_fitness:'Medical fitness', induction:'Site induction', competency:'Competency', training:'Training', other:'Other'};
export const APPOINTMENT_PRESETS = [
  {type:'Chief Executive Officer (accountable person)', ref:'OHS Act s16(1)'},
  {type:'Assigned person (delegated CEO duties)', ref:'OHS Act s16(2)'},
  {type:'Construction manager', ref:'Construction Regulations 8(1)'},
  {type:'Construction supervisor', ref:'Construction Regulations 8(7)'},
  {type:'Safety officer', ref:''},
  {type:'Other statutory appointment', ref:''},
];

/* ============ ROLE HELPERS ============ */
export const org = () => S.boot.org;
export const role = () => S.boot.org.uiRole; // admin | reviewer | viewer | contractor
export const isContractor = () => S.boot.org.kind === 'contractor';
export const isHost = () => S.boot.org.kind === 'host';
export const isOrgAdmin = () => ['owner','admin'].includes(S.boot.org.role);
export const canReview = () => isHost() && ['owner','admin','reviewer'].includes(S.boot.org.role);
export const canEdit = () => !(isHost() && S.boot.org.role === 'member');
export const readOnly = () => S.boot.org.standing === 'lapsed';
export const myName = () => S.boot.me.name;
export const myRoleLabel = () => S.boot.me.roleLabel;
export const myContractorId = () => S.boot.myContractorId;
export const isDemoMode = () => !!S.boot.org.isDemo;

/* ============ DATES & READINESS (ported from the MVP) ============ */
export function todayStr(){ return new Date().toISOString().slice(0,10); }
export function daysUntil(dateStr){
  if(!dateStr) return null;
  const d = new Date(dateStr+'T00:00:00');
  if(isNaN(d)) return null;
  return Math.round((d - new Date(new Date().toDateString())) / 86400000);
}
export function effectiveStatus(doc){
  if(!doc || !doc.status) return 'missing';
  if((doc.status==='complete' || doc.status==='expiring') && doc.expiryDate){
    const days = daysUntil(doc.expiryDate);
    if(days!==null){
      if(days<0) return 'expired';
      if(days<=30) return 'expiring';
      return 'complete';
    }
  }
  return doc.status;
}
export function certStatus(c){
  const days = daysUntil(c.expiresOn);
  if(days===null) return 'complete';
  if(days<0) return 'expired';
  if(days<=30) return 'expiring';
  return 'complete';
}
export function permitEffectiveStatus(p){
  if(p.status==='closed') return 'closed';
  if(p.status==='pending') return 'pending';
  if(p.validTo && p.validTo < new Date().toISOString()) return 'expired';
  return 'active';
}
export function openSafetyIssues(siteId){
  const incidents = (S.state.incidents[siteId] || []).filter(inc=>inc.status!=='closed');
  const severeIncidents = incidents.filter(inc=>inc.type==='lost_time' || inc.type==='fatality');
  const expiredPermits = (S.state.permits[siteId] || []).filter(p=>permitEffectiveStatus(p)==='expired');
  return { incidents, severeIncidents, expiredPermits, count: incidents.length + expiredPermits.length };
}
export function orgOpenSafetyIssuesCount(){
  return Object.keys(S.state.sites).reduce((sum, id)=> sum + openSafetyIssues(id).count, 0);
}
export function computeReadiness(siteId){
  const reqs = S.state.requirements[siteId] || [];
  const items = reqs.map(req=>{
    const doc = S.state.documents[req.id] || {status:'missing'};
    return {req, doc, status: effectiveStatus(doc)};
  });
  const total = items.length;
  const counts = {complete:0, missing:0, expiring:0, expired:0, awaiting_review:0, correction_required:0};
  items.forEach(it=> counts[it.status] = (counts[it.status]||0)+1 );
  const percent = total? Math.round((counts.complete/total)*100) : 0;
  return {items, total, counts, percent};
}
export function siteSubmissionStatus(siteId){
  const {counts, total} = computeReadiness(siteId);
  if(!total) return 'no_requirements';
  if(counts.correction_required || counts.expired) return 'changes_required';
  if(counts.awaiting_review) return 'under_review';
  if(counts.missing===0 && counts.expiring===0) return 'ready_to_approve';
  return 'in_progress';
}
export function statusLabelForSubmission(s){
  return {changes_required:'Changes required', under_review:'Under review', ready_to_approve:'Ready to approve', in_progress:'In progress', no_requirements:'No requirements set yet'}[s]||s;
}
export function gaugeColor(pct){
  if(pct>=90) return 'var(--green)';
  if(pct>=60) return 'var(--orange)';
  return 'var(--red)';
}
export function gauge(pct, size){
  size = size||52;
  const r=(size-8)/2, c=2*Math.PI*r, off=c*(1-pct/100);
  const col=gaugeColor(pct);
  return '<div class="gauge" style="width:'+size+'px;height:'+size+'px;">'
    +'<svg width="'+size+'" height="'+size+'" aria-hidden="true"><circle cx="'+size/2+'" cy="'+size/2+'" r="'+r+'" fill="none" stroke="var(--grey-line)" stroke-width="4"/>'
    +'<circle cx="'+size/2+'" cy="'+size/2+'" r="'+r+'" fill="none" stroke="'+col+'" stroke-width="4" stroke-linecap="round" stroke-dasharray="'+c+'" stroke-dashoffset="'+off+'"/></svg>'
    +'<span style="color:'+col+'">'+pct+'%</span></div>';
}
export function badge(status){
  return '<span class="badge '+status+'"><dot></dot>'+STATUS_LABEL[status]+'</span>';
}
export function timeAgo(ts){
  if(!ts) return '';
  const d = new Date(ts);
  if(isNaN(d)) return ts;
  return d.toLocaleDateString('en-ZA',{day:'numeric',month:'short',year:'numeric'});
}
export function dateTime(ts){ return ts ? new Date(ts).toLocaleString('en-ZA') : '—'; }
export function initials(name){
  return unescapeHtml(name).split(' ').filter(Boolean).map(w=>w[0]).slice(0,2).join('').toUpperCase();
}
export function libraryReqId(contractorId, typeId){ return 'lib:'+contractorId+':'+typeId; }
export function findReq(reqId){
  if(reqId && reqId.indexOf('lib:')===0){
    const typeId = reqId.split(':')[2];
    const t = LIBRARY_TYPES.find(x=>x.id===typeId);
    return t ? Object.assign({id:reqId}, t) : null;
  }
  for(const siteId in S.state.requirements){
    const found = S.state.requirements[siteId].find(r=>r.id===reqId);
    if(found) return found;
  }
  return null;
}
export function siteIdForReq(reqId){
  if(reqId && reqId.indexOf('lib:')===0) return null;
  for(const siteId in S.state.requirements){
    if(S.state.requirements[siteId].some(r=>r.id===reqId)) return siteId;
  }
  return null;
}
export function contractorOf(site){ return S.state.contractors[site.contractorId] || {name:'Contractor', id:site.contractorId}; }

/* ============ UI PRIMITIVES ============ */
let toastTimer = null;
export function showToast(msg){
  document.querySelectorAll('.toast').forEach(t=>t.remove());
  const el = document.createElement('div');
  el.className='toast'; el.setAttribute('role','status'); el.textContent=msg;
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>el.remove(), 3200);
}
export function openSheet(innerHtml){
  closeSheet();
  const overlay = document.createElement('div');
  overlay.className='overlay';
  overlay.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">'+innerHtml+'</div>';
  overlay.addEventListener('click', (e)=>{ if(e.target===overlay) closeSheet(); });
  document.body.appendChild(overlay);
  const first = overlay.querySelector('[autofocus]');
  if(first) setTimeout(()=>first.focus(), 30);
  return overlay;
}
export function closeSheet(){ document.querySelectorAll('.overlay:not(.tutorial)').forEach(o=>o.remove()); S.openReq = null; }
export function sheetEl(){ return document.querySelector('.overlay .sheet'); }
export function sheetHead(title, sub){
  return '<div class="sheet-head"><div><h3>'+title+'</h3>'+(sub?'<div class="site-card-sub">'+sub+'</div>':'')+'</div><button class="sheet-close" data-action="close-sheet" aria-label="Close">'+ICONS.cross+'</button></div>';
}
/** Reads a trimmed field value from the open sheet (or document). */
export function val(id){ const el = document.getElementById(id); return el ? (el.type==='checkbox' ? el.checked : el.value.trim()) : ''; }

/* ============ ACTIONS & DATA ============ */
export const actions = {};
export function on(name, fn){ actions[name] = fn; }

let renderFn = ()=>{};
export function setRender(fn){ renderFn = fn; }
export function render(){ renderFn(); }

export async function reload(){
  const raw = await api.get('/api/bootstrap');
  setCsrf(raw.csrfToken);
  S.boot = deepEscape(raw);
  S.state = S.boot.state || null;
  render();
  return S.boot;
}

/**
 * Runs a server action, then refreshes from the server. Returns the result,
 * or undefined if it failed (after telling the user why).
 */
export async function act(fn, okMsg, btn){
  if(btn){ btn.disabled = true; }
  try{
    const result = await fn();
    await reload();
    if(okMsg) showToast(okMsg);
    return result === undefined ? true : result;
  }catch(e){
    showToast(e.message || 'Something went wrong');
    if(e.status===401){ await reload().catch(()=>{}); }
    return undefined;
  }finally{
    if(btn && btn.isConnected) btn.disabled = false;
  }
}

/* ============ PRINT ============ */
export function printHtml(html){
  document.getElementById('printArea').innerHTML = html;
  window.print();
}
