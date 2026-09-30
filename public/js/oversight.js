// The mine's oversight tools, and what the contractor sees of them:
//  - gate clearance per worker (who may enter today, and why not), with QR gate cards;
//  - monthly site audits whose findings run to closure;
//  - suspending a contractor on every site at once;
//  - validity rules (how long the mine accepts medicals, inductions, COID, insurance);
//  - safety file revisions and what changed since the last one;
//  - one request to every contractor on a site.
// Server responses fetched here are not part of the escaped bootstrap, so they go
// through escapeHtml before they reach the page.

import { api } from './api.js';
import {
  S, ICONS, on, act, render, showToast, openSheet, closeSheet, sheetHead, escapeHtml, val, printHtml,
  org, isHost, isContractor, isOrgAdmin, canReview, readOnly, contractorOf, timeAgo, todayStr, searchBox, matchSearch,
} from './core.js';

const esc = escapeHtml;
const fmtDate = (d) => d ? new Date(d + (String(d).length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

/* ---------- small fetch cache, cleared whenever the app reloads its state ---------- */
const cache = new Map();
let stamp = null;
function cached(key, url){
  if(stamp !== S.state){ cache.clear(); stamp = S.state; }
  if(!cache.has(key)){
    const entry = { data: null, error: null };
    cache.set(key, entry);
    api.get(url).then(d=>{ entry.data = d; render(); }).catch(e=>{ entry.error = e.message || 'Couldn\'t load'; render(); });
  }
  return cache.get(key);
}
/** Prints once the QR images have loaded (printHtml prints straight away). */
async function printWhenLoaded(html){
  const area = document.getElementById('printArea');
  area.innerHTML = html;
  await Promise.all([...area.querySelectorAll('img')].map(img=>img.complete ? null : new Promise(r=>{ img.onload = img.onerror = r; })));
  window.print();
}
const loading = '<div class="card"><div class="site-card-sub">Loading…</div></div>';

/* ================= Suspension ================= */
export function suspendedBanner(siteId){
  const s = S.state.sites[siteId];
  if(!s || !s.suspended) return '';
  return '<div class="notice alert-red" role="status"><strong>'+(isHost() ? 'Suspended' : 'Suspended by '+s.hostName)+'</strong> — '+s.suspended.reason
    +'<div class="site-card-sub" style="color:inherit;margin-top:4px;">Since '+fmtDate(String(s.suspended.at).slice(0,10))+(s.suspended.by?' · by '+s.suspended.by:'')+'. '
    +(isHost() ? 'Site Ready, permits and gate clearance are blocked on all your sites until you lift it (Contractors → this company).' : 'Your people won\'t be cleared at this site\'s gate, and no permits can be issued, until the site lifts it.')+'</div></div>';
}

/** Buttons for the mine's contractor profile sheet. */
export function suspendControls(c){
  if(!isHost() || !isOrgAdmin() || readOnly()) return c.suspended ? '<div class="notice alert-red" style="margin-top:12px;">Suspended: '+c.suspended.reason+'</div>' : '';
  if(c.suspended){
    return '<div class="notice alert-red" style="margin-top:12px;"><strong>Suspended on all your sites</strong> — '+c.suspended.reason+'<div class="site-card-sub" style="color:inherit;">Since '+fmtDate(String(c.suspended.at).slice(0,10))+' by '+c.suspended.by+'</div></div>'
      +'<button class="btn secondary block" data-action="contractor-unsuspend" data-id="'+c.id+'">Lift the suspension</button>'
      +'<div class="site-card-sub" style="margin-top:6px;">Sites that were Site Ready need approving again after it\'s lifted.</div>';
  }
  return '<button class="btn danger block" style="margin-top:12px;" data-action="contractor-suspend" data-id="'+c.id+'">Suspend on all my sites</button>'
    +'<div class="site-card-sub" style="margin-top:6px;">For a serious incident, an investigation or repeated non-compliance. It withdraws Site Ready, stops permits and gate clearance, and tells the contractor why.</div>';
}
on('contractor-suspend', (el)=>{
  const c = S.state.contractors[el.dataset.id];
  openSheet(sheetHead('Suspend '+c.name, 'On every one of your sites, straight away')
    +'<div class="card"><label class="field-label" for="suspendReason">Reason (the contractor sees this)</label>'
    +'<textarea id="suspendReason" rows="3" maxlength="300" placeholder="e.g. Fatality investigation at Shaft 4; suspended pending the outcome"></textarea>'
    +'<ul class="plain-list"><li>Site Ready is withdrawn on each of their files</li><li>No permits can be issued or requested</li><li>None of their workers are cleared at the gate</li><li>Everything is recorded in the audit trail</li></ul></div>'
    +'<button class="btn danger block" data-action="contractor-suspend-go" data-id="'+c.id+'">Suspend '+c.name+'</button>');
});
on('contractor-suspend-go', async (el)=>{
  const reason = val('suspendReason');
  if(reason.length < 3){ showToast('Say why — the contractor sees this'); return; }
  const ok = await act(()=>api.post('/api/contractors/'+el.dataset.id+'/suspend', { reason }), 'Contractor suspended on all your sites', el);
  if(ok) closeSheet();
});
on('contractor-unsuspend', async (el)=>{
  if(!confirm('Lift the suspension? Their files return to review; Site Ready needs approving again.')) return;
  const ok = await act(()=>api.post('/api/contractors/'+el.dataset.id+'/unsuspend'), 'Suspension lifted', el);
  if(ok) closeSheet();
});

/* ================= Gate clearance ================= */
function gateRow(w, showCompany, siteId){
  const reasons = w.cleared ? '' : '<ul class="gate-reasons">'+w.reasons.map(r=>'<li>'+esc(r)+'</li>').join('')+'</ul>';
  return '<div class="gate-row '+(w.cleared?'ok':'no')+'"><span class="gate-dot" aria-hidden="true"></span><div class="reqrow-main">'
    +'<div class="reqrow-name">'+esc(w.name)+'</div>'
    +'<div class="reqrow-meta"><span class="badge '+(w.cleared?'complete':'correction_required')+'">'+(w.cleared?ICONS.check+'Cleared':'Not cleared')+'</span>'
    +'<span class="srctag">'+[w.occupation, showCompany ? w.company : '', w.employeeNo ? 'No. '+w.employeeNo : ''].filter(Boolean).map(esc).join(' · ')+'</span>'
    +(w.cleared && w.until ? '<span class="srctag">until '+fmtDate(w.until)+'</span>' : '')+'</div>'+reasons
    +(siteId && !readOnly() && (isContractor() || canReview()) ? '<button class="linkish gate-reissue" data-action="gate-reissue" data-site="'+siteId+'" data-worker="'+esc(w.workerId)+'" data-name="'+esc(w.name)+'">Replace card</button>' : '')
    +'</div></div>';
}
function gateSummary(list){
  const ok = list.filter(w=>w.cleared).length;
  return '<div class="gate-summary"><span><b>'+ok+'</b> cleared</span><span class="'+(list.length-ok?'hot':'')+'"><b>'+(list.length-ok)+'</b> not cleared</span></div>';
}

/** People tab: who on this contractor's crew may enter this site today. */
export function gateSection(siteId){
  const e = cached('gate:'+siteId, '/api/sites/'+encodeURIComponent(siteId)+'/gate');
  let html = '<div class="section-title">Gate clearance</div>';
  if(e.error) return html + '<div class="card"><div class="site-card-sub">'+esc(e.error)+'</div></div>';
  if(!e.data) return html + loading;
  const list = e.data.workers;
  if(!list.length) return html + '<div class="card"><div class="site-card-sub">Nobody is assigned to this site yet. Each person assigned here gets a gate status: cleared only when the safety file is Site Ready and their medical and induction are valid'+(isHost()?' under your validity rules':'')+'.</div></div>';
  return html + gateSummary(list) + '<div class="card">'+list.map(w=>gateRow(w, false, siteId)).join('')+'</div>'
    + '<button class="btn secondary block" data-action="print-gate-cards" data-site="'+siteId+'">Print gate cards (QR)</button>'
    + '<div class="site-card-sub" style="margin-top:6px;">Security scans a card to see today\'s status on their phone — no login and no ID numbers are shown.</div>';
}

/** The mine's shared-site page: every crew at the gate. */
export function workplaceGateHtml(wid){
  const e = cached('wgate:'+wid, '/api/workplaces/'+encodeURIComponent(wid)+'/gate');
  if(e.error) return '<div class="card"><div class="site-card-sub">'+esc(e.error)+'</div></div>';
  if(!e.data) return loading;
  const all = e.data.workers;
  if(!all.length) return '<div class="empty"><h3>No one at the gate yet</h3><p>When contractors assign workers to this site, each person appears here as cleared or not cleared, with the reason.</p></div>';
  const f = S.gateFilter || 'all';
  const list = all.filter(w=>(f==='all' || (f==='ok') === w.cleared) && matchSearch('gate', w.name, w.company, w.occupation, w.employeeNo));
  return '<div class="site-card-sub" style="margin:4px 2px 10px;">Who may enter today. A person is cleared only when their company\'s safety file is Site Ready, the company isn\'t suspended, and their medical and induction are valid under your rules.</div>'
    + searchBox('gate', 'Search by name, company or employee number') + gateSummary(all)
    + '<div class="filter-chips">'+[['all','Everyone'],['ok','Cleared'],['no','Not cleared']].map(([k,l])=>'<button class="site-picker-chip'+(f===k?' active':'')+'" data-action="gate-filter" data-f="'+k+'">'+l+'</button>').join('')+'</div>'
    + (list.length ? '<div class="card">'+list.map(w=>gateRow(w, true)).join('')+'</div>' : '<div class="list-empty">No one matches.</div>')
    + '<button class="btn secondary block" data-action="print-gate-list" data-wp="'+wid+'">Print today\'s gate list</button>';
}
on('gate-reissue', (el)=>{
  if(!confirm('Replace '+el.dataset.name+'\'s gate card? The old card stops working straight away; print the new one.')) return;
  act(()=>api.post('/api/sites/'+encodeURIComponent(el.dataset.site)+'/gate/'+encodeURIComponent(el.dataset.worker)+'/reissue'), 'Card replaced — print the new one', el);
});
on('gate-filter', (el)=>{ S.gateFilter = el.dataset.f; S.keepScroll = true; render(); S.keepScroll = false; });

on('print-gate-cards', async (el)=>{
  const siteId = el.dataset.site, site = S.state.sites[siteId];
  let list;
  try{ list = (await api.get('/api/sites/'+encodeURIComponent(siteId)+'/gate')).workers; }catch(e){ showToast(e.message); return; }
  if(!list.length){ showToast('Nobody is assigned to this site yet'); return; }
  const company = isContractor() ? org().name : contractorOf(site).name;
  printWhenLoaded('<div class="gate-cards">'+list.map(w=>'<div class="gate-card"><div class="gc-head"><span>SITEGUARD GATE CARD</span><span>'+site.name+'</span></div>'
    +'<img class="gc-qr" alt="QR code" src="/api/sites/'+encodeURIComponent(siteId)+'/gate/'+encodeURIComponent(w.workerId)+'/qr.svg">'
    +'<div class="gc-name">'+esc(w.name)+'</div><div class="gc-sub">'+esc([w.occupation, w.employeeNo ? 'No. '+w.employeeNo : ''].filter(Boolean).join(' · '))+'</div>'
    +'<div class="gc-sub">'+company+'</div><div class="gc-foot">Scan for today\'s clearance. This card shows status held in SiteGuard; it is not a permit or proof of legal compliance.</div></div>').join('')+'</div>');
});
on('print-gate-list', async (el)=>{
  const w = (S.state.workplaces||{})[el.dataset.wp];
  let list;
  try{ list = (await api.get('/api/workplaces/'+encodeURIComponent(el.dataset.wp)+'/gate')).workers; }catch(e){ showToast(e.message); return; }
  printHtml('<h1>Gate list — '+w.name+'</h1><p>Printed '+new Date().toLocaleString('en-ZA')+' · '+list.filter(x=>x.cleared).length+' cleared of '+list.length+'</p>'
    +'<table class="print-table"><tr><th>Name</th><th>Company</th><th>Occupation</th><th>Status</th><th>Reason / valid until</th></tr>'
    +list.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.company)+'</td><td>'+esc(x.occupation)+'</td><td>'+(x.cleared?'CLEARED':'NOT CLEARED')+'</td><td>'+(x.cleared ? (x.until?'until '+fmtDate(x.until):'') : x.reasons.map(esc).join('; '))+'</td></tr>').join('')+'</table>');
});

/* ================= Site audits ================= */
const scoreClass = (n)=> n >= 90 ? 'complete' : n >= 70 ? 'expiring' : 'correction_required';

/** Site activity tab: audits and their findings. */
export function auditsSection(siteId){
  const audits = (S.state.audits||{})[siteId] || [];
  const ro = readOnly();
  let html = '<div class="section-title">Site audits</div>';
  if(isHost() && canReview() && !ro) html += '<button class="btn primary block" data-action="new-audit" data-site="'+siteId+'" style="margin-bottom:10px;">Audit this contractor</button>';
  if(!audits.length) return html + '<div class="card"><div class="site-card-sub">'+(isHost() ? 'No audits yet. Walk the contractor\'s work area with the checklist at least every 30 days; every “no” becomes a finding they must fix and answer.' : 'No site audits yet. When the site audits your work, the score and any findings to fix appear here.')+'</div></div>';
  const open = audits.flatMap(a=>a.findings).filter(f=>f.status!=='closed');
  if(open.length) html += '<div class="notice'+(open.some(f=>f.status==='open' && f.dueOn < todayStr())?' alert-red':'')+'">'+open.length+' finding'+(open.length===1?'':'s')+' still open'+(isContractor()?' — fix each one and tell the site what was done.':'.')+'</div>';
  return html + audits.map(a=>'<div class="card checkpoint"><div class="flexbetween"><div><div class="site-card-title">Audit '+fmtDate(a.auditedOn)+'</div>'
    +'<div class="site-card-sub">'+a.auditor+' · '+a.items.length+' items checked</div></div><span class="badge '+scoreClass(a.score)+'">'+a.score+'%</span></div>'
    +(a.summary?'<div style="margin-top:8px;">'+a.summary+'</div>':'')
    +(a.findings.length ? a.findings.map(f=>findingRow(f)).join('') : '<div class="site-card-sub" style="margin-top:8px;">No findings.</div>')
    +'<button class="linkish" style="margin-top:8px;" data-action="open-audit" data-site="'+siteId+'" data-id="'+a.id+'">See the checklist</button></div>').join('');
}
function findingRow(f){
  const overdue = f.status==='open' && f.dueOn < todayStr();
  const badgeHtml = f.status==='closed' ? '<span class="badge complete">'+ICONS.check+'Closed</span>'
    : f.status==='responded' ? '<span class="badge awaiting_review">Fixed — awaiting check</span>'
    : '<span class="badge '+(overdue?'correction_required':'missing')+'">'+(overdue?'Overdue':'Open')+'</span>';
  let actions = '';
  if(!readOnly()){
    if(isContractor() && f.status!=='closed') actions = '<button class="btn secondary small" data-action="finding-respond" data-id="'+f.id+'">'+(f.status==='responded'?'Add to the response':'Say what was fixed')+'</button>';
    else if(isHost() && canReview() && f.status==='responded') actions = '<button class="btn primary small" data-action="finding-close" data-id="'+f.id+'">Close</button><button class="btn secondary small" data-action="finding-reopen" data-id="'+f.id+'">Not fixed</button>';
    else if(isHost() && canReview() && f.status==='open') actions = '<button class="btn secondary small" data-action="finding-close" data-id="'+f.id+'">Close</button>';
  }
  return '<div class="defect-row"><div class="flexbetween">'+badgeHtml+'<span class="site-card-sub">due '+fmtDate(f.dueOn)+'</span></div>'
    +'<div style="font-size:13px;margin-top:6px;">'+f.text+'</div>'
    +(f.response?'<div class="finding-response">'+f.response.replace(/\n/g,'<br>')+(f.respondedBy?'<div class="site-card-sub">— '+f.respondedBy+'</div>':'')+'</div>':'')
    +(f.status==='closed' && f.closedBy?'<div class="site-card-sub" style="margin-top:4px;">Closed by '+f.closedBy+' '+timeAgo(f.closedAt)+'</div>':'')
    +(actions?'<div class="row-actions">'+actions+'</div>':'')+'</div>';
}

let checklist = null;
on('new-audit', async (el)=>{
  const siteId = el.dataset.site;
  try{ checklist = checklist || (await api.get('/api/audit-checklist')).items; }catch(e){ showToast(e.message); return; }
  S.auditDraft = { siteId, items: checklist.map(text=>({ text, result: '' })) };
  drawAuditSheet();
});
function drawAuditSheet(){
  const d = S.auditDraft, site = S.state.sites[d.siteId];
  openSheet(sheetHead('Site audit', contractorOf(site).name+' · '+site.name)
    +'<div class="site-card-sub" style="margin-bottom:8px;">Mark each item. Every “No” needs a note and becomes a finding the contractor must fix (due in 7 days unless you change it). “N/A” items don\'t count towards the score.</div>'
    +'<label class="field-label" for="auditDate">Date of the audit</label><input type="date" id="auditDate" value="'+todayStr()+'" max="'+todayStr()+'">'
    +'<div id="auditItems">'+d.items.map((it,i)=>auditItemHtml(it,i)).join('')+'</div>'
    +'<button class="btn secondary small" data-action="audit-add-item" style="margin:8px 0;">+ Add an item</button>'
    +'<label class="field-label" for="auditSummary">Overall comments (optional)</label><textarea id="auditSummary" rows="3" placeholder="e.g. Good housekeeping; fire safety gap at the workshop"></textarea>'
    +'<button class="btn primary block" style="margin-top:12px;" data-action="audit-save">Save audit and notify the contractor</button>');
}
function auditItemHtml(it, i){
  const custom = it.custom;
  return '<div class="audit-item" data-i="'+i+'">'
    +(custom ? '<input type="text" class="audit-text" data-i="'+i+'" placeholder="What did you check?" value="'+esc(it.text)+'">' : '<div class="audit-q">'+esc(it.text)+'</div>')
    +'<div class="seg" role="radiogroup" aria-label="'+esc(it.text||'Item')+'">'+[['yes','Yes'],['no','No'],['na','N/A']].map(([v,l])=>'<button type="button" role="radio" aria-checked="'+(it.result===v)+'" class="seg-btn '+v+(it.result===v?' on':'')+'" data-action="audit-mark" data-i="'+i+'" data-v="'+v+'">'+l+'</button>').join('')+'</div>'
    +(it.result==='no' ? '<input type="text" class="audit-note" data-i="'+i+'" placeholder="What was wrong? (the contractor sees this)" value="'+esc(it.note||'')+'"><label class="site-card-sub">Fix by <input type="date" class="audit-due" data-i="'+i+'" value="'+(it.dueOn||new Date(Date.now()+7*864e5).toISOString().slice(0,10))+'" min="'+todayStr()+'"></label>' : '')
    +'</div>';
}
function captureAudit(){
  const d = S.auditDraft;
  document.querySelectorAll('.audit-text').forEach(n=>{ d.items[+n.dataset.i].text = n.value.trim(); });
  document.querySelectorAll('.audit-note').forEach(n=>{ d.items[+n.dataset.i].note = n.value.trim(); });
  document.querySelectorAll('.audit-due').forEach(n=>{ d.items[+n.dataset.i].dueOn = n.value; });
}
function redrawItems(){
  const box = document.getElementById('auditItems');
  if(box) box.innerHTML = S.auditDraft.items.map((it,i)=>auditItemHtml(it,i)).join('');
}
on('audit-mark', (el)=>{ captureAudit(); const it = S.auditDraft.items[+el.dataset.i]; it.result = it.result===el.dataset.v ? '' : el.dataset.v; redrawItems(); });
on('audit-add-item', ()=>{ captureAudit(); S.auditDraft.items.push({ text:'', result:'', custom:true }); redrawItems(); });
on('audit-save', async (el)=>{
  captureAudit();
  const d = S.auditDraft;
  const items = d.items.filter(it=>it.result && it.text).map(it=>({ text: it.text, result: it.result, note: it.note||'', ...(it.result==='no' && it.dueOn ? { dueOn: it.dueOn } : {}) }));
  if(!items.some(it=>it.result!=='na')){ showToast('Mark at least one item Yes or No'); return; }
  const missing = items.find(it=>it.result==='no' && !it.note);
  if(missing){ showToast('Say what was wrong for “'+missing.text+'”'); return; }
  const r = await act(()=>api.post('/api/sites/'+d.siteId+'/audits', { auditedOn: val('auditDate') || undefined, items, summary: val('auditSummary') }), null, el);
  if(r){ closeSheet(); S.auditDraft = null; showToast('Audit saved: '+r.score+'%'+(r.findings?' · '+r.findings+' finding'+(r.findings===1?'':'s')+' sent to the contractor':'')); }
});
on('open-audit', (el)=>{
  const a = ((S.state.audits||{})[el.dataset.site]||[]).find(x=>x.id===el.dataset.id);
  if(!a) return;
  openSheet(sheetHead('Audit '+fmtDate(a.auditedOn), a.auditor+' · score '+a.score+'%')
    +'<div class="card">'+a.items.map(it=>'<div class="kv"><span>'+it.text+(it.note?'<div class="site-card-sub">'+it.note+'</div>':'')+'</span><strong class="audit-res '+it.result+'">'+({yes:'Yes',no:'No',na:'N/A'})[it.result]+'</strong></div>').join('')+'</div>'
    +(a.summary?'<div class="card"><div class="site-card-sub">'+a.summary+'</div></div>':''));
});
function noteSheet(title, sub, placeholder, action, id, button){
  openSheet(sheetHead(title, sub)+'<div class="card"><label class="field-label" for="findingNote">Note</label><textarea id="findingNote" rows="4" maxlength="1000" placeholder="'+placeholder+'"></textarea></div>'
    +'<button class="btn primary block" data-action="'+action+'" data-id="'+id+'">'+button+'</button>');
}
on('finding-respond', (el)=>noteSheet('What was fixed?', 'The site checks your response and closes the finding.', 'e.g. Extinguisher replaced and serviced on 30 Sep; tag attached (photo in the diary)', 'finding-respond-go', el.dataset.id, 'Send to the site'));
on('finding-reopen', (el)=>noteSheet('Not fixed', 'The finding goes back to the contractor with your note.', 'e.g. The service tag is not signed', 'finding-reopen-go', el.dataset.id, 'Send back'));
on('finding-respond-go', async (el)=>{ if(val('findingNote').length < 3){ showToast('Say what was done'); return; } if(await act(()=>api.post('/api/findings/'+el.dataset.id+'/respond', { note: val('findingNote') }), 'Sent to the site', el)) closeSheet(); });
on('finding-reopen-go', async (el)=>{ if(val('findingNote').length < 3){ showToast('Say why it isn\'t fixed'); return; } if(await act(()=>api.post('/api/findings/'+el.dataset.id+'/reopen', { note: val('findingNote') }), 'Finding reopened', el)) closeSheet(); });
on('finding-close', (el)=>act(()=>api.post('/api/findings/'+el.dataset.id+'/close'), 'Finding closed', el));

/* ================= Validity rules (mine settings) ================= */
const RULES = [
  ['medical', 'Certificates of fitness (medicals)', 'from the date the medical was issued'],
  ['induction', 'Site inductions', 'from the date of the induction'],
  ['goodStanding', 'Letter of Good Standing (COID)', 'from the day it is submitted'],
  ['insurance', 'Public liability insurance', 'from the day it is submitted'],
];
export function validityCard(){
  if(!isHost()) return '';
  const r = org().validityRules || {};
  const ro = readOnly() || !isOrgAdmin();
  const opts = (k)=>'<option value="">Use the date on the document</option>'+[3,6,12,24,36].map(m=>'<option value="'+m+'"'+(r[k]===m?' selected':'')+'>'+m+' months</option>').join('');
  return '<div class="section-title">Validity rules</div><div class="card">'
    +'<div class="site-card-sub" style="margin-bottom:6px;">How long your sites accept these documents. Contractors see the rule when they submit; gate clearance and Site Ready use it. The earlier of the rule and the date on the document applies. Medical and induction rules take effect at the gate straight away; COID and insurance rules apply to documents submitted from now on.</div>'
    + RULES.map(([k,l,h])=>'<label class="field-label" for="vr_'+k+'">'+l+'</label><select id="vr_'+k+'" class="field"'+(ro?' disabled':'')+'>'+opts(k)+'</select><div class="site-card-sub">Counted '+h+'.</div>').join('')
    +(ro?'':'<button class="btn primary block" style="margin-top:12px;" data-action="save-validity">Save validity rules</button>')+'</div>';
}
on('save-validity', (el)=>{
  const body = {};
  RULES.forEach(([k])=>{ const v = val('vr_'+k); body[k] = v ? Number(v) : null; });
  return act(()=>api.put('/api/org/validity-rules', body), 'Validity rules saved', el);
});

/* ================= Safety file revisions ================= */
export function revisionsLink(siteId){
  return '<button class="linkish revisions-link" data-action="open-revisions" data-site="'+siteId+'">Revisions and what changed</button>';
}
on('open-revisions', async (el)=>{
  const siteId = el.dataset.site;
  let r;
  try{ r = await api.get('/api/sites/'+encodeURIComponent(siteId)+'/safety-file/revisions'); }catch(e){ showToast(e.message); return; }
  const ch = r.changesSinceLatest;
  const label = { added:'Added', removed:'Removed', changed:'Changed' };
  openSheet(sheetHead('Safety file revisions', S.state.sites[siteId].name)
    +(r.revisions.length ? (ch.length
        ? '<div class="notice"><strong>'+ch.length+' change'+(ch.length===1?'':'s')+' since Rev '+r.revisions[0].number+'.</strong> Download the file again to issue Rev '+(r.revisions[0].number+1)+'.</div><div class="card">'+ch.map(c=>'<div class="kv"><span>'+esc(c.name)+'<div class="site-card-sub">'+esc(c.section)+'</div></span><strong class="chg '+c.kind+'">'+label[c.kind]+'<div class="site-card-sub" style="font-weight:400;">'+esc(c.detail)+'</div></strong></div>').join('')+'</div>'
        : '<div class="notice alert-green">Rev '+r.revisions[0].number+' is up to date — nothing has changed since it was compiled.</div>')
      : '<div class="notice">No revision yet. The first time the safety file is downloaded, SiteGuard records it as Rev 1.</div>')
    +(r.revisions.length ? '<div class="section-title">History</div><div class="card">'+r.revisions.map(v=>'<div class="kv"><span>Rev '+v.number+'<div class="site-card-sub">'+esc(v.by)+'</div></span><strong>'+new Date(v.at).toLocaleString('en-ZA')+'<div class="site-card-sub" style="font-weight:400;">'+v.documents+' document'+(v.documents===1?'':'s')+(v.changes!==null?' · '+v.changes+' change'+(v.changes===1?'':'s'):'')+'</div></strong></div>').join('')+'</div>' : '')
    +'<a class="btn primary block" href="/api/sites/'+encodeURIComponent(siteId)+'/safety-file.pdf" download>Download the current safety file</a>'
    +'<div class="site-card-sub" style="margin-top:6px;">A new revision is recorded only when something in the file changed, so downloading twice doesn\'t create a new revision.</div>');
});

/* ================= One request to every contractor on a site ================= */
on('wp-request-all', (el)=>{
  const w = S.state.workplaces[el.dataset.id];
  const files = Object.values(S.state.sites).filter(s=>s.workplaceId===w.id && s.status!=='declined');
  if(!files.length){ showToast('No contractors on this site yet'); return; }
  openSheet(sheetHead('Request from contractors', w.name)
    +'<div class="card"><label class="field-label" for="rqTitle">What do you need?</label><input type="text" id="rqTitle" maxlength="300" placeholder="e.g. Updated Letter of Good Standing">'
    +'<label class="field-label" for="rqReq">Linked requirement (optional)</label><select id="rqReq" class="field"><option value="">None</option>'+w.requirements.map(r=>'<option>'+r.name+'</option>').join('')+'</select>'
    +'<label class="field-label" for="rqMsg">Message</label><textarea id="rqMsg" rows="3" placeholder="e.g. Please upload the new letter by 30 November."></textarea>'
    +'<label class="field-label" for="rqDue">Due date</label><input type="date" id="rqDue" min="'+todayStr()+'"></div>'
    +'<div class="section-title">Send to</div><div class="card">'
    +files.map(f=>'<label class="toggle-row"><span>'+contractorOf(f).name+'</span><input type="checkbox" class="rq-site" value="'+f.id+'" checked></label>').join('')+'</div>'
    +'<button class="btn primary block" data-action="wp-request-send" data-id="'+w.id+'">Send request</button>');
});
on('wp-request-send', async (el)=>{
  const title = val('rqTitle');
  if(!title){ showToast('Say what you need'); return; }
  const siteIds = [...document.querySelectorAll('.rq-site:checked')].map(x=>x.value);
  if(!siteIds.length){ showToast('Choose at least one contractor'); return; }
  const r = await act(()=>api.post('/api/workplaces/'+el.dataset.id+'/requests', { type:'document', title, message: val('rqMsg'), dueDate: val('rqDue') || undefined, requirementName: val('rqReq') || undefined, siteIds }), null, el);
  if(r){ closeSheet(); showToast('Request sent to '+r.sent+' contractor'+(r.sent===1?'':'s')); }
});
