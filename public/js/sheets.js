// Bottom sheets (details and forms) and the actions they trigger.

import { api } from './api.js';
import {
  S, ICONS, SOURCE_LABEL, INCIDENT_TYPES, PERMIT_TYPES, LIBRARY_TYPES, CERT_KINDS, APPOINTMENT_PRESETS,
  org, isContractor, isHost, isOrgAdmin, canReview, canEdit, readOnly, myName, myContractorId,
  computeReadiness, effectiveStatus, certStatus, badge, timeAgo, dateTime, todayStr, daysUntil, incidentTypeInfo, permitTypeInfo,
  permitEffectiveStatus, findReq, siteIdForReq, libraryReqId, contractorOf, escapeHtml, unescapeHtml, deepEscape,
  on, act, reload, render, showToast, openSheet, closeSheet, sheetEl, sheetHead, val,
} from './core.js';
import { permitBadge, DASHBOARD_WIDGETS, dashboardLayout, workerSummary, appointmentRow } from './views.js';

const refreshSheet = (html) => { const el = sheetEl(); if(el) el.innerHTML = html; };

/* ============ TASKS (notification feed) ============ */
export function computeTasks(){
  if(!S.state) return [];
  const tasks = [];
  const sites = Object.values(S.state.sites);
  const relevant = sites.filter(s=>s.status!=='invited' && s.status!=='declined');
  if(isContractor() && isOrgAdmin()){
    sites.filter(s=>s.status==='invited').forEach(s=>tasks.push({priority:'high', title:'Respond to invitation: '+s.name, sub:s.hostName, siteId:s.id, kind:'site'}));
  }
  relevant.forEach(site=>{
    (S.state.requirements[site.id]||[]).forEach(req=>{
      const doc = S.state.documents[req.id] || {status:'missing'};
      const eff = effectiveStatus(doc);
      if(eff==='expired') tasks.push({priority:'high', title:req.name+' has expired', sub:site.name, reqId:req.id, siteId:site.id});
      else if(eff==='correction_required') tasks.push({priority:'high', title:'Correction needed: '+req.name, sub:site.name, reqId:req.id, siteId:site.id});
      else if(eff==='awaiting_review' && canReview()) tasks.push({priority:'medium', title:'Review: '+req.name, sub:site.name+' · '+contractorOf(site).name, reqId:req.id, siteId:site.id});
      else if(eff==='missing' && isHost() && site.status==='in_progress') tasks.push({priority:'low', title:req.name+' not yet submitted', sub:site.name+' · '+contractorOf(site).name, reqId:req.id, siteId:site.id});
      else if(eff==='missing' && isContractor()) tasks.push({priority:'medium', title:'Submit: '+req.name, sub:site.name, reqId:req.id, siteId:site.id});
      else if(eff==='expiring') tasks.push({priority:'medium', title:req.name+' expires '+timeAgo(doc.expiryDate), sub:site.name, reqId:req.id, siteId:site.id});
      else if(eff==='complete' && doc.expiryDate){
        const days = daysUntil(doc.expiryDate);
        if(days!==null && days>30 && days<=60) tasks.push({priority:'low', title:req.name+' renews in about '+days+' days', sub:site.name+' · get ahead of it', reqId:req.id, siteId:site.id});
      }
    });
    (S.state.incidents[site.id]||[]).forEach(inc=>{
      if(inc.status==='closed' || !canReview()) return;
      const severe = inc.type==='lost_time' || inc.type==='fatality';
      tasks.push({priority: severe?'high':'medium', title:(inc.status==='investigating'?'Continue investigation: ':'Investigate: ')+incidentTypeInfo(inc.type).label, sub:site.name+' · reported '+timeAgo(inc.date), incidentId:inc.id, siteId:site.id});
    });
    (S.state.permits[site.id]||[]).forEach(p=>{
      const eff = permitEffectiveStatus(p);
      if(eff==='pending' && canReview()) tasks.push({priority:'medium', title:'Issue permit: '+permitTypeInfo(p.type).label, sub:site.name+' · '+p.location, permitId:p.id, siteId:site.id});
      else if(eff==='expired') tasks.push({priority:'high', title:'Expired permit needs closing: '+permitTypeInfo(p.type).label, sub:site.name+' · '+p.location, permitId:p.id, siteId:site.id});
    });
  });
  if(isContractor()){
    LIBRARY_TYPES.forEach(t=>{
      const reqId = libraryReqId(myContractorId(), t.id);
      const eff = effectiveStatus(S.state.documents[reqId] || {status:'missing'});
      if(eff==='expired') tasks.push({priority:'high', title:t.name+' has expired', sub:'Document library', reqId, siteId:null});
      else if(eff==='expiring') tasks.push({priority:'medium', title:t.name+' expires '+timeAgo(S.state.documents[reqId].expiryDate), sub:'Document library', reqId, siteId:null});
    });
  }
  Object.values(S.state.workers||{}).forEach(w=>{
    if(!w.active || !w.own) return;
    w.certificates.forEach(c=>{
      const st = certStatus(c);
      if(st==='expired') tasks.push({priority:'high', title:w.name+'\'s '+c.name+' has expired', sub:'Workforce', workerId:w.id});
      else if(st==='expiring') tasks.push({priority:'medium', title:w.name+'\'s '+c.name+' expires '+timeAgo(c.expiresOn), sub:'Workforce', workerId:w.id});
    });
  });
  Object.values(S.state.requests||{}).forEach(req=>{
    const site = S.state.sites[req.siteId];
    if(!site) return;
    if(isContractor()){
      if(req.status==='completed' || req.status==='submitted') return;
      const overdue = req.dueDate && req.dueDate < todayStr();
      tasks.push({priority: overdue?'high':'medium', title:req.title+(overdue?' — overdue':''), sub:site.name+' · requested by '+req.requestedBy, requestId:req.id, siteId:req.siteId});
    } else if(req.status==='submitted' && canReview()){
      tasks.push({priority:'medium', title:'Review response: '+req.title, sub:contractorOf(site).name, requestId:req.id, siteId:req.siteId});
    }
  });
  const order = {high:0, medium:1, low:2};
  return tasks.sort((a,b)=>order[a.priority]-order[b.priority]);
}

function renderTasksSheet(filter){
  let tasks = computeTasks();
  if(filter && filter!=='all') tasks = tasks.filter(t=>t.priority===filter);
  const label = {high:'Needs attention now', medium:'Coming up', low:'Stay ahead', all:'Tasks'}[filter||'all'];
  let body = sheetHead(label, tasks.length+' item'+(tasks.length===1?'':'s'));
  if(!tasks.length) return body + '<div class="empty"><h3>All clear</h3><p>Nothing needs your attention here.</p></div>';
  const dotColor = {high:'var(--red)', medium:'var(--amber)', low:'var(--green)'};
  return body + tasks.slice(0,150).map((t,i)=>'<button class="qa-item" data-action="task-goto" data-i="'+i+'" data-filter="'+(filter||'all')+'">'
    +'<div class="qa-icon" style="background:'+dotColor[t.priority]+';color:#fff;" aria-label="'+t.priority+' priority">●</div>'
    +'<div><div class="qa-title">'+t.title+'</div><div class="qa-sub">'+t.sub+'</div></div></button>').join('');
}
on('open-tasks', (el)=>openSheet(renderTasksSheet(el.dataset.filter)));
on('task-goto', (el)=>{
  let tasks = computeTasks();
  if(el.dataset.filter!=='all') tasks = tasks.filter(t=>t.priority===el.dataset.filter);
  const t = tasks[parseInt(el.dataset.i,10)];
  closeSheet();
  if(!t) return;
  if(t.kind==='site'){ S.nav='sites'; S.activeSiteId=t.siteId; render(); return; }
  if(t.requestId){ openRequest(t.requestId); return; }
  if(t.incidentId){ openSheet(renderIncidentDetailSheet(t.siteId, t.incidentId)); return; }
  if(t.permitId){ openSheet(renderPermitDetailSheet(t.siteId, t.permitId)); return; }
  if(t.workerId){ openSheet(renderWorkerSheet(t.workerId)); return; }
  if(t.siteId){ S.activeSiteId = t.siteId; S.nav='sites'; S.siteTab='compliance'; }
  else S.nav='passport';
  render();
  if(t.reqId) openReqSheet(t.reqId);
});

/* ============ GENERIC ============ */
on('close-sheet', ()=>closeSheet());

/* ============ QUICK ACTIONS ============ */
function activeSites(){ return Object.values(S.state.sites).filter(s=>s.status!=='invited' && s.status!=='declined'); }
function renderQuickActions(){
  const items = [];
  if(isContractor()){
    items.push({icon:ICONS.sites, title:'Work on a safety file', sub:'Open the requirements for one of your sites', action:'safetyfile'});
    items.push({icon:ICONS.passport, title:'Upload to your documents', sub:'Attach a file to a requirement or your company library', action:'upload'});
    items.push({icon:ICONS.sparkle, title:'Draft a document with AI', sub:'Risk assessment, method statement, toolbox talk…', action:'ai-draft'});
    items.push({icon:ICONS.audit, title:'Log today\'s site diary', sub:'Crew, conditions, work done', action:'diary'});
    items.push({icon:ICONS.hardhat, title:'Record a toolbox talk', sub:'Capture attendance with signatures', action:'toolbox'});
    items.push({icon:ICONS.alert, title:'Report an incident', sub:'Near miss to fatality', action:'incident'});
  } else {
    if(isOrgAdmin()) items.push({icon:ICONS.sites, title:'Add a site', sub:'Start compliance tracking and invite a contractor', action:'add-site'});
    if(canReview()) items.push({icon:ICONS.passport, title:'Request a document', sub:'Ask a contractor for a specific file or piece of information', action:'request'});
    if(canReview()) items.push({icon:ICONS.audit, title:'Log inspection', sub:'Record a scheduled inspection or spot check', action:'inspection'});
    items.push({icon:ICONS.alert, title:'Report an incident', sub:'Near miss to fatality', action:'incident'});
    items.push({icon:ICONS.audit, title:'Log site diary', sub:'Crew, conditions, work done', action:'diary'});
    items.push({icon:ICONS.verify, title:'Verify a record', sub:'Check a Site Ready verification', action:'verify'});
  }
  if(readOnly()) return sheetHead('Quick actions') + '<div class="notice">Your organisation is read-only until a plan is chosen.</div>';
  return sheetHead('Quick actions') + items.map(it=>'<button class="qa-item" data-action="qa" data-qa="'+it.action+'"><div class="qa-icon">'+it.icon+'</div><div><div class="qa-title">'+it.title+'</div><div class="qa-sub">'+it.sub+'</div></div></button>').join('');
}
on('open-fab', ()=>openSheet(renderQuickActions()));

const PURPOSE = {
  safetyfile: (id)=>{ S.activeSiteId=id; S.nav='sites'; S.siteTab='compliance'; render(); },
  upload: (id)=>{ S.activeSiteId=id; S.nav='sites'; S.siteTab='compliance'; render(); showToast('Tap a requirement to attach a file'); },
  diary: (id)=>openSheet(renderNewDiarySheet(id)),
  toolbox: (id)=>openSheet(renderNewToolboxSheet(id)),
  incident: (id)=>openSheet(renderReportIncidentSheet(id)),
  inspection: (id)=>openSheet(renderNewInspectionSheet(id)),
  request: (id)=>openSheet(renderRequestSheet(id)),
};
function pickSite(purpose){
  const sites = activeSites();
  if(sites.length===1){ closeSheet(); PURPOSE[purpose](sites[0].id); return; }
  if(!sites.length){ closeSheet(); showToast(isContractor()?'No active sites yet — you\'ll see this once a site invites you.':'No active sites yet.'); return; }
  openSheet(sheetHead('Choose a site') + sites.map(s=>'<button class="qa-item" data-action="pick-site" data-purpose="'+purpose+'" data-site="'+s.id+'"><div class="qa-icon">'+ICONS.sites+'</div><div><div class="qa-title">'+s.name+'</div><div class="qa-sub">'+s.location+'</div></div></button>').join(''));
}
on('pick-site', (el)=>{ closeSheet(); PURPOSE[el.dataset.purpose](el.dataset.site); });
on('qa', (el)=>{
  const a = el.dataset.qa;
  if(a==='ai-draft'){ openSheet(renderAIDraftSheet()); return; }
  if(a==='verify'){ closeSheet(); S.nav='more'; S.moreView='verify'; render(); return; }
  if(a==='add-site'){ openNewSite(); return; }
  pickSite(a);
});

/* ============ REQUIREMENT / DOCUMENT ============ */
export function openReqSheet(reqId){ S.openReq = reqId; openSheet(renderReqSheet(reqId)); S.openReq = reqId; }
on('open-req', (el)=>openReqSheet(el.dataset.req));

function renderReqSheet(reqId){
  const req = findReq(reqId);
  if(!req) return sheetHead('Not found') + '<p class="site-card-sub">This requirement is no longer available.</p>';
  const doc = S.state.documents[reqId] || {status:'missing'};
  const eff = effectiveStatus(doc);
  const thread = S.state.reviews[reqId] || [];
  const siteId = siteIdForReq(reqId);
  const site = siteId ? S.state.sites[siteId] : null;
  const ro = readOnly();

  let body = sheetHead(req.name, req.category + (site?' · '+site.name:''));
  body += '<div style="margin:10px 0;">'+badge(eff)+' <span class="srctag" style="margin-left:6px;">'+SOURCE_LABEL[req.source]+'</span></div>';
  if(req.why) body += '<p style="font-size:13.5px;color:var(--ink-soft);">'+req.why+'</p>';
  if(doc.version){
    body += '<div class="divider"></div><div class="site-card-sub">Version '+doc.version+' · updated '+timeAgo(doc.updatedAt)+'</div>';
    if(doc.expiryDate) body += '<div class="site-card-sub">'+(eff==='expired'?'Expired ':'Expires ')+timeAgo(doc.expiryDate)+'</div>';
    if(doc.note) body += '<div class="site-card-sub" style="margin-top:4px;">'+doc.note+'</div>';
  }
  if(doc.assetUrl){
    body += '<div class="card checkpoint" style="margin-top:10px;display:flex;align-items:center;justify-content:space-between;gap:8px;">'
      +'<span style="font-size:13px;overflow:hidden;text-overflow:ellipsis;">📎 '+doc.assetName+(doc.aiDrafted?' <span class="srctag">AI draft</span>':'')+'</span>'
      +'<a class="btn secondary small" href="'+doc.assetUrl+'" target="_blank" rel="noopener">View</a></div>';
  }
  if(doc.history && doc.history.length){
    body += '<details style="margin-top:8px;"><summary style="font-size:12.5px;color:var(--grey);cursor:pointer;">Version history ('+doc.history.length+' earlier)</summary>'
      + doc.history.slice().reverse().map(h=>'<div class="reqrow" style="padding:8px 0;"><div class="reqrow-main"><div class="reqrow-name" style="font-size:13px;">'+h.version+'</div>'
        +'<div class="reqrow-meta">'+(h.updatedAt||'')+(h.submittedBy?' · '+h.submittedBy:'')+(h.note?' · '+h.note:'')+(h.assetUrl?' · <a href="'+h.assetUrl+'" target="_blank" rel="noopener">view</a>':'')+'</div></div></div>').join('')+'</details>';
  }
  if(thread.length){
    body += '<div class="thread">' + thread.map(t=>'<div class="thread-item"><div class="thread-who">'+t.author+' <span class="thread-role">· '+t.role+(t.kind==='correction'?' · correction':'')+'</span></div>'
      +'<div class="thread-text">'+t.text+'</div><div class="thread-ts">'+dateTime(t.ts)+'</div></div>').join('') + '</div>';
  }
  body += '<div class="divider"></div>';

  if(isContractor()){
    if(ro){ body += '<p class="site-card-sub">Read-only — your organisation needs an active plan to submit.</p>'; }
    else if(eff==='awaiting_review'){ body += '<p class="site-card-sub">Submitted — waiting on reviewer sign-off.</p>'; }
    else if(eff==='complete' && !reqId.startsWith('lib:')){ body += '<p class="site-card-sub">This requirement is complete.</p>'; }
    else {
      const renewing = eff==='expiring' || (eff==='complete' && reqId.startsWith('lib:'));
      body += '<label class="field-label" for="fileInput">'+(renewing?'Upload the renewed document':'Attach file')+'</label>'
        +'<input type="file" id="fileInput" accept="application/pdf,image/*,.docx,.xlsx,.txt" data-action-change="attach-file" data-req="'+reqId+'" style="font-size:12.5px;">'
        +'<div class="site-card-sub" id="attachStatus" style="margin-top:4px;">'+(doc.pendingFileName?'Attached: '+doc.pendingFileName+' (not yet submitted)':'PDF, photo, Word or Excel, up to 20MB.'+(S.boot.features.ai?' Photos and PDFs of certificates are scanned for an expiry date.':''))+'</div>'
        +'<label class="field-label" for="expiryInput">Expiry date'+(S.boot.features.ai?' (auto-detected where possible)':'')+'</label><input type="date" id="expiryInput" value="'+(doc.expiryDate&&eff!=='expired'&&!renewing?doc.expiryDate:'')+'">'
        +'<label class="field-label" for="submitNote">Notes (optional)</label><textarea id="submitNote" placeholder="Add any context for the reviewer…"></textarea>'
        +'<button class="btn orange block" style="margin-top:10px;" data-action="submit-req" data-req="'+reqId+'"'+(doc.pendingFileId?'':' disabled')+' id="submitReqBtn">'+(reqId.startsWith('lib:')?'Save to library':eff==='missing'?'Submit for review':'Resubmit for review')+'</button>';
      if(reqId.startsWith('lib:') && doc.assetUrl) body += '<button class="btn danger block" style="margin-top:8px;" data-action="withdraw-doc" data-req="'+reqId+'">Remove from library</button>';
    }
  } else if(canReview() && !ro){
    if((eff==='awaiting_review' || eff==='correction_required') && doc.assetUrl){
      body += '<button class="btn orange block" data-action="approve-req" data-req="'+reqId+'" style="margin-bottom:8px;">Approve</button>'
        +'<label class="field-label" for="correctionNote">Request correction</label><textarea id="correctionNote" placeholder="What needs to change?"></textarea>'
        +'<button class="btn secondary block" style="margin-top:8px;" data-action="correct-req" data-req="'+reqId+'">Request correction</button>';
    } else if(eff==='missing') body += '<p class="site-card-sub">Not yet submitted by the contractor.</p>';
    else if(eff==='expired') body += '<p class="site-card-sub">This document has lapsed — the contractor needs to submit a current copy before it counts toward readiness again.</p>';
    else body += '<p class="site-card-sub">This requirement is complete.</p>';
  } else {
    body += '<p class="site-card-sub">Viewing only.</p>';
  }
  if(site && !ro && !reqId.startsWith('lib:')){
    body += '<label class="field-label" for="commentText">Add a comment</label><textarea id="commentText" placeholder="Visible to both '+(isContractor()?site.hostName:contractorOf(site).name)+' and your team"></textarea>'
      +'<button class="btn secondary small" style="margin-top:6px;" data-action="comment-req" data-req="'+reqId+'">Post comment</button>';
  }
  if(isHost() && isOrgAdmin() && !ro && !doc.version && site){
    body += '<div class="divider"></div><button class="btn danger small" data-action="remove-requirement" data-req="'+reqId+'">Remove this requirement</button>';
  }
  return body;
}
const docUrl = (reqId, op) => '/api/documents/'+encodeURIComponent(reqId)+(op?'/'+op:'');

on('attach-file', async (el)=>{
  const f = el.files && el.files[0];
  if(!f) return;
  const reqId = el.dataset.req;
  const status = document.getElementById('attachStatus');
  if(f.size > 20*1024*1024){ showToast('File is too large (20MB max)'); el.value=''; return; }
  if(status) status.textContent = 'Uploading '+f.name+'…';
  try{
    const r = await api.upload(docUrl(reqId,'file'), f);
    if(status) status.textContent = 'Attached: '+f.name+(r.detectedExpiry?' — expiry detected: '+timeAgo(r.detectedExpiry):'');
    if(r.detectedExpiry){ const exp = document.getElementById('expiryInput'); if(exp) exp.value = r.detectedExpiry; showToast('Expiry date detected: '+timeAgo(r.detectedExpiry)); }
    const btn = document.getElementById('submitReqBtn'); if(btn) btn.disabled = false;
    reload().catch(()=>{});
  }catch(e){ if(status) status.textContent = e.message; showToast(e.message); el.value=''; }
});
on('submit-req', async (el)=>{
  const reqId = el.dataset.req;
  const ok = await act(()=>api.post(docUrl(reqId,'submit'), { note: val('submitNote'), expiryDate: val('expiryInput') }), reqId.startsWith('lib:')?'Saved to your library':'Submitted for review', el);
  if(ok) closeSheet();
});
on('approve-req', async (el)=>{ if(await act(()=>api.post(docUrl(el.dataset.req,'approve')), 'Approved', el)) closeSheet(); });
on('correct-req', async (el)=>{
  const text = val('correctionNote');
  if(!text){ document.getElementById('correctionNote').focus(); return; }
  if(await act(()=>api.post(docUrl(el.dataset.req,'correction'), { text }), 'Correction requested', el)) closeSheet();
});
on('comment-req', async (el)=>{
  const text = val('commentText');
  if(!text){ document.getElementById('commentText').focus(); return; }
  if(await act(()=>api.post(docUrl(el.dataset.req,'comment'), { text }), 'Comment posted', el)) refreshSheet(renderReqSheet(el.dataset.req));
});
on('withdraw-doc', async (el)=>{
  if(!confirm('Remove this document? Earlier versions stay in the history.')) return;
  if(await act(()=>api.del(docUrl(el.dataset.req)), 'Removed', el)) closeSheet();
});
on('remove-requirement', async (el)=>{
  if(!confirm('Remove this requirement from the site?')) return;
  if(await act(()=>api.del('/api/requirements/'+el.dataset.req), 'Requirement removed', el)) closeSheet();
});

on('open-why', (el)=>{
  const {counts, total, percent} = computeReadiness(el.dataset.site);
  const rows = [['complete','Complete','var(--green)'],['awaiting_review','Awaiting review','var(--blue)'],['expiring','Expiring','var(--amber)'],['expired','Expired','var(--red)'],['correction_required','Correction required','var(--red)'],['missing','Missing','var(--red)']];
  openSheet(sheetHead('Why '+percent+'%?', 'Based on '+total+' requirements for this site')
    + rows.map(([key,label,color])=>'<div class="breakdown-row"><span style="color:'+color+';font-weight:600;">'+label+'</span><span>'+(counts[key]||0)+'</span></div>').join('')
    +'<div class="divider"></div><p class="site-card-sub">Readiness = complete requirements ÷ total requirements for this site. Documents that are expiring, awaiting review or under correction all count against readiness until resolved.</p>');
});
on('open-emergency', (el)=>{
  const site = S.state.sites[el.dataset.site];
  const e = site.emergency || {};
  openSheet(sheetHead('Emergency information', site.name)
    +'<div class="ecard"><div class="elabel">Muster point</div><div class="eval">'+(e.musterPoint||'Not yet configured')+'</div></div>'
    +'<div class="ecard"><div class="elabel">Emergency contact</div><div class="eval">'+(e.contact||'Not yet configured')+'</div></div>'
    +'<div class="ecard"><div class="elabel">Nearest medical facility</div><div class="eval">'+(e.hospital||'Not yet configured')+'</div></div>'
    +(isHost() && isOrgAdmin() && !readOnly() ? '<button class="btn secondary block" data-action="edit-site" data-site="'+site.id+'">Edit emergency information</button>' : ''));
});

/* ============ DIARY / INSPECTIONS / DEFECTS ============ */
function renderNewDiarySheet(siteId){
  return sheetHead('Log today\'s entry', S.state.sites[siteId].name)
    +'<label class="field-label" for="diaryCrew">Workers on site</label><input type="number" id="diaryCrew" min="0" value="1">'
    +'<label class="field-label" for="diaryWeather">Weather / conditions</label><input type="text" id="diaryWeather" placeholder="e.g. Clear, 20°C">'
    +'<label class="field-label" for="diarySummary">Work summary</label><textarea id="diarySummary" placeholder="What happened on site today?"></textarea>'
    +'<div class="toggle-row"><label for="diaryIncidentFlag">Incident or near-miss to report?</label><input type="checkbox" id="diaryIncidentFlag" data-action-change="diary-flag"></div>'
    +'<div id="diaryIncidentWrap" style="display:none;"><label class="field-label" for="diaryIncidentNote">Incident note</label><textarea id="diaryIncidentNote" placeholder="What happened, and what was done about it? (Serious events should also be reported in the incident register.)"></textarea></div>'
    +'<button class="btn orange block" style="margin-top:12px;" data-action="save-diary" data-site="'+siteId+'">Save entry</button>';
}
on('new-diary', (el)=>openSheet(renderNewDiarySheet(el.dataset.site)));
on('diary-flag', (el)=>{ document.getElementById('diaryIncidentWrap').style.display = el.checked ? 'block' : 'none'; });
on('save-diary', async (el)=>{
  const summary = val('diarySummary');
  if(!summary){ document.getElementById('diarySummary').focus(); return; }
  const incident = document.getElementById('diaryIncidentFlag').checked;
  if(await act(()=>api.post('/api/sites/'+el.dataset.site+'/diary', { crew: parseInt(val('diaryCrew'),10)||0, weather: val('diaryWeather'), summary, incident, incidentNote: val('diaryIncidentNote') }), incident?'Entry saved — incident flagged':'Diary entry saved', el)) closeSheet();
});

function renderNewInspectionSheet(siteId){
  return sheetHead('Log inspection', S.state.sites[siteId].name)
    +'<label class="field-label" for="inspTitle">Title</label><input type="text" id="inspTitle" placeholder="e.g. Weekly PPE spot check">'
    +'<label class="field-label" for="inspType">Type</label><input type="text" id="inspType" value="Scheduled inspection">'
    +((S.state.settings||{}).inspectxEnabled?'<label class="field-label" for="inspRef">InspectX reference (optional)</label><input type="text" id="inspRef">':'')
    +'<button class="btn orange block" style="margin-top:12px;" data-action="save-inspection" data-site="'+siteId+'">Save inspection</button>';
}
on('new-inspection', (el)=>openSheet(renderNewInspectionSheet(el.dataset.site)));
on('save-inspection', async (el)=>{
  const title = val('inspTitle');
  if(!title){ document.getElementById('inspTitle').focus(); return; }
  if(await act(()=>api.post('/api/sites/'+el.dataset.site+'/inspections', { title, type: val('inspType')||'Inspection', externalRef: val('inspRef') }), 'Inspection logged', el)) closeSheet();
});
on('new-defect', (el)=>{
  const site = S.state.sites[el.dataset.site];
  openSheet(sheetHead('Log defect')
    +'<label class="field-label" for="defDesc">Description</label><textarea id="defDesc" placeholder="What did you find?"></textarea>'
    +'<label class="field-label" for="defSev">Severity</label><select id="defSev" class="field"><option value="high">High</option><option value="medium" selected>Medium</option><option value="low">Low</option></select>'
    +'<label class="field-label" for="defAssignee">Assigned to</label><input type="text" id="defAssignee" value="'+contractorOf(site).name+'">'
    +'<label class="field-label" for="defDue">Due date</label><input type="date" id="defDue">'
    +'<button class="btn orange block" style="margin-top:12px;" data-action="save-defect" data-id="'+el.dataset.id+'">Log defect</button>');
});
on('save-defect', async (el)=>{
  const description = val('defDesc');
  if(!description){ document.getElementById('defDesc').focus(); return; }
  if(await act(()=>api.post('/api/inspections/'+el.dataset.id+'/defects', { description, severity: val('defSev'), assignedTo: (val('defAssignee')), dueDate: val('defDue') }), 'Defect logged and assigned', el)) closeSheet();
});

/* ============ INCIDENTS ============ */
function renderReportIncidentSheet(siteId){
  return sheetHead('Report an incident', S.state.sites[siteId].name)
    +'<label class="field-label" for="incType">Type</label><select id="incType" class="field">'+INCIDENT_TYPES.map(t=>'<option value="'+t.id+'">'+t.label+'</option>').join('')+'</select>'
    +'<label class="field-label" for="incDate">Date</label><input type="date" id="incDate" value="'+todayStr()+'" max="'+todayStr()+'">'
    +'<label class="field-label" for="incPerson">Person(s) involved (optional)</label><input type="text" id="incPerson" placeholder="Name, or leave blank">'
    +'<label class="field-label" for="incDescription">What happened?</label><textarea id="incDescription" placeholder="Describe what happened, where, and how it was discovered"></textarea>'
    +'<label class="field-label" for="incActions">Immediate actions taken</label><textarea id="incActions" placeholder="First aid given, area isolated, work stopped, etc."></textarea>'
    +'<button class="btn danger block" style="margin-top:12px;" data-action="save-incident" data-site="'+siteId+'">Report incident</button>'
    +'<div class="notice" style="margin-top:10px;">Serious incidents (lost time injury, fatality) may carry statutory reporting obligations (e.g. Section 11/24 under the MHSA) outside of SiteGuard — this logs your internal record and alerts the site team, it doesn\'t submit anything to a regulator.</div>';
}
on('report-incident', (el)=>openSheet(renderReportIncidentSheet(el.dataset.site)));
on('save-incident', async (el)=>{
  const description = val('incDescription');
  if(!description){ document.getElementById('incDescription').focus(); return; }
  if(await act(()=>api.post('/api/sites/'+el.dataset.site+'/incidents', { type: val('incType'), date: val('incDate'), person: val('incPerson'), description, actions: val('incActions') }), 'Incident logged', el)) closeSheet();
});
function renderIncidentDetailSheet(siteId, incidentId){
  const inc = (S.state.incidents[siteId]||[]).find(i=>i.id===incidentId);
  if(!inc) return sheetHead('Not found');
  const t = incidentTypeInfo(inc.type);
  let body = '<div class="sheet-head"><div><h3 style="color:'+t.color+';">'+t.label+'</h3><div class="site-card-sub">'+S.state.sites[siteId].name+' · '+timeAgo(inc.date)+'</div></div><button class="sheet-close" data-action="close-sheet" aria-label="Close">'+ICONS.cross+'</button></div>'
    +'<p style="font-size:13.5px;color:var(--ink-soft);">'+inc.description+'</p>'
    +(inc.person?'<div class="site-card-sub" style="margin-top:6px;">Person(s) involved: '+inc.person+'</div>':'')
    +'<div class="site-card-sub" style="margin-top:4px;">Immediate actions: '+(inc.immediateActions||'None recorded')+'</div>'
    +'<div class="site-card-sub" style="margin-top:4px;">Reported by '+inc.reportedBy+', '+inc.reportedByRole+'</div><div class="divider"></div>';
  if(inc.rootCause || inc.correctiveActions){
    body += '<div class="site-card-sub"><strong style="color:var(--ink);">Root cause:</strong> '+(inc.rootCause||'Not yet recorded')+'</div>'
      +'<div class="site-card-sub" style="margin-top:4px;"><strong style="color:var(--ink);">Corrective actions:</strong> '+(inc.correctiveActions||'Not yet recorded')+'</div><div class="divider"></div>';
  }
  if(inc.status==='closed') body += '<p class="site-card-sub">Closed '+timeAgo(inc.closedAt)+'.</p>';
  else if(canReview() && !readOnly()){
    body += '<label class="field-label" for="incRootCause">Root cause</label><textarea id="incRootCause" placeholder="What actually caused this?">'+(inc.rootCause||'')+'</textarea>'
      +'<label class="field-label" for="incCorrective">Corrective actions</label><textarea id="incCorrective" placeholder="What will prevent it happening again?">'+(inc.correctiveActions||'')+'</textarea>'
      +'<div style="display:flex;gap:8px;margin-top:10px;"><button class="btn secondary" style="flex:1;" data-action="save-investigation" data-id="'+incidentId+'">Save notes</button>'
      +'<button class="btn orange" style="flex:1;" data-action="save-investigation" data-id="'+incidentId+'" data-close="1">Close out</button></div>';
  } else body += '<p class="site-card-sub">Investigation in progress — the site team closes this out.</p>';
  return body;
}
on('open-incident', (el)=>openSheet(renderIncidentDetailSheet(el.dataset.site, el.dataset.id)));
on('save-investigation', async (el)=>{
  const close = el.dataset.close==='1';
  const body = { rootCause: (val('incRootCause')), correctiveActions: (val('incCorrective')), close };
  if(await act(()=>api.patch('/api/incidents/'+el.dataset.id, body), close?'Incident closed':'Investigation notes saved', el)) closeSheet();
});

/* ============ PERMITS ============ */
function renderNewPermitSheet(siteId){
  const requesting = isContractor();
  return sheetHead(requesting?'Request a permit':'Issue a permit', S.state.sites[siteId].name)
    +'<label class="field-label" for="permitType">Permit type</label><select id="permitType" class="field">'+PERMIT_TYPES.map(t=>'<option value="'+t.id+'">'+t.label+'</option>').join('')+'</select>'
    +'<label class="field-label" for="permitLocation">Location / work area</label><input type="text" id="permitLocation" placeholder="e.g. Conveyor drive station, level 2">'
    +'<label class="field-label" for="permitDescription">Description of work</label><textarea id="permitDescription" placeholder="What work is being done, and by whom"></textarea>'
    +'<label class="field-label" for="permitPrecautions">Precautions / controls in place</label><textarea id="permitPrecautions" placeholder="Isolation confirmed, fire watch posted, gas tested, etc."></textarea>'
    +'<label class="field-label" for="permitIssuedTo">Issued to (person/crew)</label><input type="text" id="permitIssuedTo" placeholder="e.g. Crew supervisor name">'
    +'<label class="field-label" for="permitFrom">Valid from</label><input type="datetime-local" id="permitFrom">'
    +'<label class="field-label" for="permitTo">Valid to</label><input type="datetime-local" id="permitTo">'
    +'<button class="btn orange block" style="margin-top:12px;" data-action="save-permit" data-site="'+siteId+'">'+(requesting?'Submit request':'Issue permit')+'</button>';
}
const localToIso = (v) => v ? new Date(v).toISOString() : '';
on('new-permit', (el)=>openSheet(renderNewPermitSheet(el.dataset.site)));
on('save-permit', async (el)=>{
  const location = val('permitLocation');
  if(!location){ document.getElementById('permitLocation').focus(); return; }
  const body = { type: val('permitType'), location, description: val('permitDescription'), precautions: val('permitPrecautions'), issuedTo: val('permitIssuedTo'), validFrom: localToIso(val('permitFrom')), validTo: localToIso(val('permitTo')) };
  if(await act(()=>api.post('/api/sites/'+el.dataset.site+'/permits', body), isContractor()?'Permit requested — the site has been notified':'Permit issued', el)) closeSheet();
});
function renderPermitDetailSheet(siteId, permitId){
  const p = (S.state.permits[siteId]||[]).find(x=>x.id===permitId);
  if(!p) return sheetHead('Not found');
  const eff = permitEffectiveStatus(p);
  let body = sheetHead(permitTypeInfo(p.type).label, p.location+' · '+S.state.sites[siteId].name)
    +'<div style="margin:8px 0;">'+permitBadge(eff)+'</div>'
    +'<p style="font-size:13.5px;color:var(--ink-soft);">'+(p.description||'No description')+'</p>'
    +'<div class="site-card-sub" style="margin-top:6px;">Precautions: '+(p.precautions||'None recorded')+'</div>'
    +'<div class="site-card-sub" style="margin-top:4px;">Issued to: '+(p.issuedTo||'—')+(p.issuedBy?' · Issued by '+p.issuedBy:'')+(p.requestedBy?' · Requested by '+p.requestedBy:'')+'</div>'
    +(p.validFrom||p.validTo?'<div class="site-card-sub" style="margin-top:4px;">Valid '+dateTime(p.validFrom)+' to '+dateTime(p.validTo)+'</div>':'')
    +'<div class="divider"></div>';
  if(readOnly()) return body;
  if(eff==='pending' && canReview()){
    body += '<label class="field-label" for="permitIssueFrom">Valid from</label><input type="datetime-local" id="permitIssueFrom">'
      +'<label class="field-label" for="permitIssueTo">Valid to</label><input type="datetime-local" id="permitIssueTo">'
      +'<button class="btn orange block" style="margin-top:10px;" data-action="issue-permit" data-id="'+permitId+'">Issue this permit</button>'
      +'<button class="btn secondary block" style="margin-top:8px;" data-action="close-permit" data-id="'+permitId+'" data-refuse="1">Refuse request</button>';
  } else if(eff==='pending'){
    body += '<p class="site-card-sub">Waiting on the site to issue this permit.</p>'
      +(isContractor()?'<button class="btn secondary block" style="margin-top:8px;" data-action="close-permit" data-id="'+permitId+'" data-refuse="1">Withdraw request</button>':'');
  } else if(eff==='closed'){
    body += '<p class="site-card-sub">Closed by '+p.closedBy+', '+dateTime(p.closedAt)+(p.closeNotes?' — '+p.closeNotes:'')+'</p>';
  } else {
    // Anyone on either side may close out a live permit once the work is made safe.
    body += '<label class="field-label" for="permitCloseNotes">Close-out notes</label><textarea id="permitCloseNotes" placeholder="Work complete, area made safe, isolation removed, etc."></textarea>'
      +'<button class="btn secondary block" style="margin-top:10px;" data-action="close-permit" data-id="'+permitId+'">Close out permit</button>';
  }
  return body;
}
on('open-permit', (el)=>openSheet(renderPermitDetailSheet(el.dataset.site, el.dataset.id)));
on('issue-permit', async (el)=>{
  if(await act(()=>api.post('/api/permits/'+el.dataset.id+'/issue', { validFrom: localToIso(val('permitIssueFrom')), validTo: localToIso(val('permitIssueTo')) }), 'Permit issued', el)) closeSheet();
});
on('close-permit', async (el)=>{
  const refuse = el.dataset.refuse==='1';
  if(await act(()=>api.post('/api/permits/'+el.dataset.id+'/close', { notes: refuse ? (isContractor()?'Request withdrawn':'Request refused') : val('permitCloseNotes') }), refuse?'Request closed':'Permit closed out', el)) closeSheet();
});

/* ============ AI DRAFTING (via the server proxy) ============ */
const DRAFT_TYPES = ['Site-specific risk assessment','Method statement','Toolbox talk record','Emergency response plan','Daily site diary template'];
function renderAIDraftSheet(){
  if(!S.boot.features.ai){
    return sheetHead('Draft with AI') + '<p class="site-card-sub">'+(S.boot.features.aiConfigured
      ? 'AI drafting is included in '+(isContractor()?'Contractor Pro':'Site Professional')+'.'+(isOrgAdmin()?' You can upgrade under More → Plan &amp; billing.':' Ask an admin to upgrade.')
      : 'AI drafting isn\'t configured on this server.')+'</p>';
  }
  return sheetHead('Draft a document with AI')
    +'<label class="field-label" for="draftType">Document type</label><select id="draftType" class="field">'+DRAFT_TYPES.map(t=>'<option>'+t+'</option>').join('')+'</select>'
    +'<label class="field-label" for="draftBrief">Tell it about the job</label><textarea id="draftBrief" placeholder="e.g. Rewiring the conveyor drive station at Shaft 3, live electrical work involved"></textarea>'
    +'<div class="site-card-sub" style="margin-top:4px;">Your company details from Organisation settings go into the header. Drafting runs on SiteGuard\'s server — no API key in your browser.</div>'
    +'<button class="btn orange block" style="margin-top:10px;" data-action="generate-draft">Generate draft</button>'
    +'<div id="draftOutput"></div>';
}
let draftAbort = null;
async function streamDraft(type, brief, onText){
  draftAbort = new AbortController();
  return api.stream('/api/ai/draft', { type, brief }, onText, draftAbort.signal);
}
on('ai-draft', ()=>openSheet(renderAIDraftSheet()));
on('generate-draft', async (el)=>{
  const out = document.getElementById('draftOutput');
  el.disabled = true; el.textContent = 'Drafting…';
  out.innerHTML = '<div class="ai-output" id="draftText" aria-live="polite">Thinking…</div>';
  try{
    const text = await streamDraft(val('draftType'), (val('draftBrief')), (t)=>{ const d = document.getElementById('draftText'); if(d) d.textContent = t; });
    S.lastDraft = text;
    out.innerHTML = '<div class="ai-output" id="draftText">'+escapeHtml(text)+'</div>'
      +(isContractor()
        ? '<label class="field-label" for="draftTarget">Save to library</label><select id="draftTarget" class="field">'+LIBRARY_TYPES.map(t=>'<option value="'+t.id+'">'+t.name+'</option>').join('')+'</select>'
          +'<button class="btn secondary block" style="margin-top:8px;" data-action="save-draft">Save to library</button>'
        : '')
      +'<button class="btn secondary block" style="margin-top:8px;" data-action="copy-draft">Copy text</button>';
    el.style.display = 'none';
  }catch(e){
    out.innerHTML = '<p class="site-card-sub">Couldn\'t generate a draft: '+escapeHtml(e.message)+'</p>';
    el.disabled = false; el.textContent = 'Generate draft';
  }
});
on('copy-draft', async ()=>{ try{ await navigator.clipboard.writeText(S.lastDraft||''); showToast('Copied'); }catch{ showToast('Copy failed — select the text instead'); } });
on('save-draft', async (el)=>{
  const typeId = val('draftTarget');
  const t = LIBRARY_TYPES.find(x=>x.id===typeId);
  const slot = libraryReqId(myContractorId(), typeId);
  el.disabled = true; el.textContent = 'Saving…';
  const blob = new Blob([S.lastDraft||''], {type:'text/plain'});
  const ok = await act(async ()=>{
    await api.upload(docUrl(slot,'file'), blob, unescapeHtml(t.name).replace(/[^\w\s()-]/g,'')+' (AI draft).txt');
    await api.post(docUrl(slot,'submit'), { note:'AI draft — review before use', aiDrafted:true });
  }, 'Saved to your document library', el);
  if(ok) closeSheet(); else { el.disabled=false; el.textContent='Save to library'; }
});

/* ============ REQUESTS ============ */
function renderRequestSheet(siteId){
  const site = S.state.sites[siteId];
  const reqs = S.state.requirements[siteId]||[];
  return sheetHead('Request document or feedback', site.name+' · '+contractorOf(site).name)
    +'<label class="field-label" for="reqType">Type</label><select id="reqType" class="field"><option value="document">Request a document</option><option value="information">Request information</option><option value="feedback">Request feedback</option></select>'
    +'<label class="field-label" for="reqLinked">Link to an existing requirement (optional)</label><select id="reqLinked" class="field"><option value="">Not linked to a requirement</option>'+reqs.map(r=>'<option value="'+r.id+'">'+r.name+'</option>').join('')+'</select>'
    +'<label class="field-label" for="reqTitle">Title</label><input type="text" id="reqTitle" placeholder="e.g. Updated Letter of Good Standing">'
    +'<label class="field-label" for="reqMessage">Message</label><textarea id="reqMessage" placeholder="What exactly do you need, and why?"></textarea>'
    +'<label class="field-label" for="reqDue">Due date</label><input type="date" id="reqDue" min="'+todayStr()+'">'
    +'<button class="btn orange block" style="margin-top:12px;" data-action="save-request" data-site="'+siteId+'">Send request</button>'
    +'<div class="site-card-sub" style="margin-top:8px;">'+contractorOf(site).name+' is emailed straight away.</div>';
}
on('save-request', async (el)=>{
  const title = val('reqTitle');
  if(!title){ document.getElementById('reqTitle').focus(); return; }
  if(await act(()=>api.post('/api/sites/'+el.dataset.site+'/requests', { type: val('reqType'), title, message: val('reqMessage'), dueDate: val('reqDue'), linkedReqId: val('reqLinked') }), 'Request sent', el)) closeSheet();
});
function renderRequestDetailSheet(requestId){
  const req = S.state.requests[requestId];
  if(!req) return sheetHead('Not found');
  const site = S.state.sites[req.siteId];
  let body = sheetHead(req.title, site.name+' · '+({document:'Document request',information:'Information request',feedback:'Feedback request'})[req.type])
    +'<div style="margin:8px 0;"><span class="badge '+(req.status==='completed'?'complete':'awaiting_review')+'">'+({requested:'Requested',viewed:'Viewed',submitted:'Responded',completed:'Completed'})[req.status]+'</span>'
    +(req.dueDate?' <span class="srctag">due '+req.dueDate+'</span>':'')+'</div>'
    +'<p style="font-size:13.5px;color:var(--ink-soft);">'+(req.message||'')+'</p>'
    +'<div class="site-card-sub" style="margin-top:6px;">Requested by '+req.requestedBy+', '+req.requestedByRole+' · '+timeAgo(req.createdAt)+'</div>';
  if(req.linkedReqId) body += '<div class="card checkpoint" style="margin-top:10px;cursor:pointer;" data-action="open-req" data-req="'+req.linkedReqId+'"><div class="site-card-sub">Linked requirement — tap to open'+(isContractor()?' and attach the file there':'')+'</div></div>';
  if(req.response) body += '<div class="divider"></div><div class="thread"><div class="thread-item"><div class="thread-who">Response</div><div class="thread-text">'+req.response+'</div><div class="thread-ts">'+dateTime(req.respondedAt)+'</div></div></div>';
  body += '<div class="divider"></div>';
  if(readOnly()) return body;
  if(isContractor() && req.status!=='completed' && !req.linkedReqId){
    body += '<label class="field-label" for="requestResponse">Your response</label><textarea id="requestResponse" placeholder="Reply, or note how this was handled…"></textarea>'
      +'<button class="btn orange block" style="margin-top:10px;" data-action="respond-request" data-id="'+requestId+'">Submit response</button>';
  } else if(canReview() && req.status==='submitted'){
    body += '<button class="btn orange block" data-action="complete-request" data-id="'+requestId+'">Mark completed</button>';
  } else if(!isContractor() && req.status!=='completed'){
    body += '<p class="site-card-sub">Waiting on '+contractorOf(site).name+'.</p>';
  } else if(isContractor() && req.linkedReqId && req.status!=='completed'){
    body += '<p class="site-card-sub">This request is tied to a requirement — submitting the document there answers it.</p>';
  } else body += '<p class="site-card-sub">Completed.</p>';
  return body;
}
function openRequest(id){
  openSheet(renderRequestDetailSheet(id));
  const req = S.state.requests[id];
  if(isContractor() && req && req.status==='requested') api.post('/api/requests/'+id+'/viewed').then(()=>reload()).catch(()=>{});
}
on('open-request', (el)=>openRequest(el.dataset.id));
on('respond-request', async (el)=>{
  const text = val('requestResponse');
  if(!text){ document.getElementById('requestResponse').focus(); return; }
  if(await act(()=>api.post('/api/requests/'+el.dataset.id+'/respond', { text }), 'Response sent', el)) closeSheet();
});
on('complete-request', async (el)=>{ if(await act(()=>api.post('/api/requests/'+el.dataset.id+'/complete'), 'Marked completed', el)) closeSheet(); });

/* ============ SITES (host admin) ============ */
function contractorFields(prefix){
  const contractors = Object.values(S.state.contractors);
  return (contractors.length
      ? '<label class="field-label" for="'+prefix+'Contractor">Contractor</label><select id="'+prefix+'Contractor" class="field" data-action-change="toggle-new-contractor" data-prefix="'+prefix+'"><option value="__new">+ Add a new contractor…</option>'+contractors.map(c=>'<option value="'+c.id+'">'+c.name+'</option>').join('')+'</select>'
      : '<div class="site-card-sub" style="margin:4px 0 2px;">No contractors yet — enter their details and we\'ll email them an invitation.</div>')
    +'<div id="'+prefix+'NewContractor">'
    +'<label class="field-label" for="'+prefix+'CName">Contractor company name</label><input type="text" id="'+prefix+'CName" placeholder="e.g. ABC Electrical Pty Ltd">'
    +'<label class="field-label" for="'+prefix+'CEmail">Contact email — the invitation goes here</label><input type="email" id="'+prefix+'CEmail" placeholder="safety@abcelectrical.co.za">'
    +'<label class="field-label" for="'+prefix+'CContact">Contact person</label><input type="text" id="'+prefix+'CContact" placeholder="e.g. Site foreman name">'
    +'<label class="field-label" for="'+prefix+'CTrade">Trade</label><input type="text" id="'+prefix+'CTrade" placeholder="e.g. Electrical"></div>';
}
function readContractor(prefix){
  const sel = document.getElementById(prefix+'Contractor');
  if(sel && sel.value !== '__new') return { contractorId: sel.value };
  const name = (val(prefix+'CName'));
  if(!name){ document.getElementById(prefix+'CName').focus(); return null; }
  const email = val(prefix+'CEmail');
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){
    // Without an address nobody is invited and the site waits forever.
    showToast('Enter the contractor\'s email — that\'s where the invitation goes');
    document.getElementById(prefix+'CEmail').focus();
    return null;
  }
  return { newContractor: { name, email: val(prefix+'CEmail'), contact: (val(prefix+'CContact')), trade: (val(prefix+'CTrade')) } };
}
on('toggle-new-contractor', (el)=>{ document.getElementById(el.dataset.prefix+'NewContractor').style.display = el.value==='__new' ? '' : 'none'; });
/* ---- requirement starter packs ---- */
let packsCache = null;
async function loadPacks(){
  if(!packsCache) packsCache = deepEscape((await api.get('/api/requirement-templates')).packs);
  return packsCache;
}
/** Checkbox list of starter packs; counts show only requirements the site doesn't already have. */
function packPicker(packs, checked, existingNames){
  const have = new Set((existingNames||[]).map(n=>n.toLowerCase()));
  return packs.map(p=>{
    const fresh = p.items.filter(i=>!have.has(i.name.toLowerCase()));
    return '<div class="plan-card" style="padding:10px 12px;"><label class="flexbetween" style="gap:10px;cursor:pointer;">'
      +'<span><span class="site-card-title" style="font-size:14px;">'+p.name+'</span>'
      +'<span class="site-card-sub" style="display:block;">'+p.description+' · '+(fresh.length===p.items.length?p.items.length+' documents':fresh.length+' new of '+p.items.length)+'</span></span>'
      +'<input type="checkbox" class="pack-box" value="'+p.id+'"'+(checked.includes(p.id)?' checked':'')+(fresh.length?'':' disabled')+' aria-label="'+p.name+'"></label>'
      +'<details style="margin-top:6px;"><summary class="site-card-sub" style="cursor:pointer;">What\'s included</summary>'
      + p.items.map(i=>'<div class="site-card-sub" style="padding:3px 0;'+(have.has(i.name.toLowerCase())?'text-decoration:line-through;':'')+'">'+i.category+' — '+i.name+'</div>').join('')
      +'</details></div>';
  }).join('');
}
const checkedPacks = () => [...document.querySelectorAll('.pack-box:checked')].map(b=>b.value);
const PACK_NOTE = '<div class="site-card-sub" style="margin:6px 0 2px;">A starting point, not legal advice — every requirement stays editable for this site. Confirm the final list with your SHE advisor.</div>';

function renderNewSiteSheet(packs){
  const templates = Object.values(S.state.sites).filter(s=>(S.state.requirements[s.id]||[]).length);
  return sheetHead('Add a site')
    +'<label class="field-label" for="newSiteName">Site / project name</label><input type="text" id="newSiteName" placeholder="e.g. Tweefontein Shaft — Pump Station Upgrade">'
    +'<label class="field-label" for="newSiteLocation">Location</label><input type="text" id="newSiteLocation" placeholder="e.g. North Pit, Tweefontein">'
    + contractorFields('ns')
    +'<div class="section-title">Documents required from the contractor</div>'
    + packPicker(packs, ['baseline'], []) + PACK_NOTE
    +(templates.length ? '<label class="field-label" for="newSiteTemplate">Also copy from an existing site</label><select id="newSiteTemplate" class="field"><option value="">Don\'t copy</option>'+templates.map(s=>'<option value="'+s.id+'">'+s.name+'</option>').join('')+'</select>' : '')
    +'<button class="btn orange block" style="margin-top:12px;" data-action="save-site">Create site and invite contractor</button>';
}
async function openNewSite(){
  try{ openSheet(renderNewSiteSheet(await loadPacks())); }
  catch(e){ showToast(e.message); }
}
on('new-site', ()=>openNewSite());
on('save-site', async (el)=>{
  const name = val('newSiteName');
  if(!name){ document.getElementById('newSiteName').focus(); return; }
  const c = readContractor('ns'); if(!c) return;
  const r = await act(()=>api.post('/api/sites', { name, location: val('newSiteLocation'), templateSiteId: val('newSiteTemplate') || undefined, templatePackIds: checkedPacks(), ...c }), 'Site created — invitation sent', el);
  if(r){ closeSheet(); S.activeSiteId = r.id; S.nav='sites'; S.siteTab='compliance'; render(); }
});
on('apply-packs', async (el)=>{
  const siteId = el.dataset.site;
  let packs;
  try{ packs = await loadPacks(); }catch(e){ showToast(e.message); return; }
  const existing = (S.state.requirements[siteId]||[]).map(r=>unescapeHtml(r.name));
  openSheet(sheetHead('Add a starter pack', S.state.sites[siteId].name)
    + packPicker(packs, existing.length ? [] : ['baseline'], existing.map(escapeHtml)) + PACK_NOTE
    +'<button class="btn orange block" style="margin-top:12px;" data-action="save-packs" data-site="'+siteId+'">Add to this site</button>');
});
on('save-packs', async (el)=>{
  const packIds = checkedPacks();
  if(!packIds.length){ showToast('Choose at least one pack'); return; }
  const r = await act(()=>api.post('/api/sites/'+el.dataset.site+'/requirements/apply-packs', { packIds }), null, el);
  if(r){ closeSheet(); showToast(r.added ? r.added+' requirement'+(r.added===1?'':'s')+' added' : 'Nothing new to add — the site already has those'); }
});
on('edit-site', (el)=>{
  const s = S.state.sites[el.dataset.site], e = s.emergency || {};
  openSheet(sheetHead('Edit site')
    +'<label class="field-label" for="esName">Name</label><input type="text" id="esName" value="'+s.name+'">'
    +'<label class="field-label" for="esLocation">Location</label><input type="text" id="esLocation" value="'+s.location+'">'
    +'<div class="section-title">Emergency information</div>'
    +'<label class="field-label" for="esMuster">Muster point</label><input type="text" id="esMuster" value="'+(e.musterPoint||'')+'">'
    +'<label class="field-label" for="esContact">Emergency contact</label><input type="text" id="esContact" value="'+(e.contact||'')+'">'
    +'<label class="field-label" for="esHospital">Nearest medical facility</label><input type="text" id="esHospital" value="'+(e.hospital||'')+'">'
    +'<button class="btn orange block" style="margin-top:12px;" data-action="save-site-edit" data-site="'+s.id+'">Save</button>');
});
on('save-site-edit', async (el)=>{
  const u = val;
  if(await act(()=>api.patch('/api/sites/'+el.dataset.site, { name:u('esName'), location:u('esLocation'), emergency:{ musterPoint:u('esMuster'), contact:u('esContact'), hospital:u('esHospital') } }), 'Site updated', el)) closeSheet();
});
on('add-requirement', (el)=>{
  const cats = [...new Set(Object.values(S.state.requirements).flat().map(r=>r.category))];
  openSheet(sheetHead('Add a requirement', S.state.sites[el.dataset.site].name)
    +'<label class="field-label" for="arCategory">Category</label><input type="text" id="arCategory" list="arCats" placeholder="e.g. Personnel"><datalist id="arCats">'+cats.map(c=>'<option value="'+c+'">').join('')+'</datalist>'
    +'<label class="field-label" for="arName">Document required</label><input type="text" id="arName" placeholder="e.g. Working at heights training">'
    +'<label class="field-label" for="arSource">Why it\'s required</label><select id="arSource" class="field">'+Object.entries(SOURCE_LABEL).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')+'</select>'
    +'<label class="field-label" for="arWhy">Explanation for the contractor</label><textarea id="arWhy" placeholder="e.g. Required for any crew working above 1.8m, per the MHSA Code of Practice."></textarea>'
    +'<button class="btn orange block" style="margin-top:12px;" data-action="save-requirement" data-site="'+el.dataset.site+'">Add requirement</button>');
});
on('save-requirement', async (el)=>{
  const u = val;
  if(!u('arCategory')){ document.getElementById('arCategory').focus(); return; }
  if(!u('arName')){ document.getElementById('arName').focus(); return; }
  if(await act(()=>api.post('/api/sites/'+el.dataset.site+'/requirements', { category:u('arCategory'), name:u('arName'), source:val('arSource'), why:u('arWhy') }), 'Requirement added', el)){
    ['arName','arWhy'].forEach(id=>{ const f=document.getElementById(id); if(f) f.value=''; });
    showToast('Requirement added — add another or close');
  }
});
on('reassign-site', (el)=>openSheet(sheetHead('Assign a contractor', S.state.sites[el.dataset.site].name) + contractorFields('ra')
  +'<button class="btn orange block" style="margin-top:12px;" data-action="save-reassign" data-site="'+el.dataset.site+'">Send invitation</button>'));
on('save-reassign', async (el)=>{
  const c = readContractor('ra'); if(!c) return;
  if(await act(()=>api.post('/api/sites/'+el.dataset.site+'/reassign', c), 'Invitation sent', el)) closeSheet();
});
on('edit-contractor', (el)=>{
  const c = S.state.contractors[el.dataset.id];
  openSheet(sheetHead('Contractor details', c.linked?'This company is on SiteGuard':'Not yet joined')
    +'<label class="field-label" for="ecName">Company name</label><input type="text" id="ecName" value="'+c.name+'">'
    +'<label class="field-label" for="ecTrade">Trade</label><input type="text" id="ecTrade" value="'+(c.trade||'')+'">'
    +'<label class="field-label" for="ecContact">Contact person</label><input type="text" id="ecContact" value="'+(c.contact||'')+'">'
    +'<label class="field-label" for="ecEmail">Contact email</label><input type="email" id="ecEmail" value="'+(c.contactEmail||'')+'">'
    +'<label class="field-label" for="ecReg">Registration number</label><input type="text" id="ecReg" value="'+(c.reg||'')+'">'
    +'<label class="field-label" for="ecCoid">COID number</label><input type="text" id="ecCoid" value="'+(c.coid||'')+'">'
    +'<button class="btn orange block" style="margin-top:12px;" data-action="save-contractor" data-id="'+c.id+'">Save</button>');
});
on('save-contractor', async (el)=>{
  const u = val;
  if(await act(()=>api.patch('/api/contractors/'+el.dataset.id, { name:u('ecName'), trade:u('ecTrade'), contact:u('ecContact'), email:val('ecEmail'), reg:u('ecReg'), coid:u('ecCoid') }), 'Contractor updated', el)) closeSheet();
});

/* ============ SHARE LINKS ============ */
on('new-share-link', (el)=>{
  const site = S.state.sites[el.dataset.site];
  openSheet(sheetHead('Share outside '+org().name, site.name)
    +'<label class="field-label" for="shareKind">What to share</label><select id="shareKind" class="field">'
      +'<option value="site_readiness">Readiness status only — percentage, approval and verification</option>'
      +'<option value="safety_file"'+(isContractor()?' selected':'')+'>Safety file — requirement register and the submitted documents</option></select>'
    +'<label class="field-label" for="shareDays">Link expires after</label><select id="shareDays" class="field"><option value="1">1 day</option><option value="7">7 days</option><option value="14" selected>14 days</option><option value="30">30 days</option><option value="90">90 days</option></select>'
    +'<label class="field-label" for="shareLabel">Who is it for? (optional, for your records)</label><input type="text" id="shareLabel" placeholder="e.g. DMRE inspector, principal contractor">'
    +'<button class="btn orange block" style="margin-top:12px;" data-action="create-share-link" data-site="'+site.id+'">Create link</button>'
    +'<div id="shareResult"></div>'
    +'<div class="notice" style="margin-top:12px;">Anyone with the link can view it until it expires — no sign-in. You can revoke it any time under More → External share links, and you\'ll see how often it was opened.</div>');
});
on('create-share-link', async (el)=>{
  el.disabled = true;
  try{
    const r = await api.post('/api/share-links', { siteId: el.dataset.site, kind: val('shareKind'), days: parseInt(val('shareDays'),10), label: (val('shareLabel')) });
    document.getElementById('shareResult').innerHTML = '<div class="copy-box"><input type="text" id="shareUrl" readonly value="'+escapeHtml(r.url)+'"><button class="btn secondary small" data-action="copy-share">Copy</button></div>'
      +'<div class="site-card-sub" style="margin-top:6px;">This is the only time the full link is shown — copy it now.</div>';
    el.style.display = 'none';
    reload().catch(()=>{});
  }catch(e){ showToast(e.message); el.disabled = false; }
});
on('copy-share', async ()=>{ const u = document.getElementById('shareUrl'); try{ await navigator.clipboard.writeText(u.value); showToast('Link copied'); }catch{ u.select(); } });

/* ============ WORKFORCE ============ */
function renderWorkerSheet(workerId, siteId){
  const w = S.state.workers[workerId];
  if(!w) return sheetHead('Not found');
  const editable = w.own && canEdit() && !readOnly();
  let body = sheetHead(w.name, (w.occupation||'Worker')+(w.own?'':' · '+w.orgName))
    +'<div class="kv"><span>Employee no.</span><span>'+(w.employeeNo||'—')+'</span></div>'
    +'<div class="kv"><span>ID (last 4)</span><span>'+(w.idLast4?'••••'+w.idLast4:'—')+'</span></div>'
    +(w.phone?'<div class="kv"><span>Phone</span><span>'+w.phone+'</span></div>':'')
    +'<div class="kv"><span>Sites</span><span>'+(w.siteIds.map(id=>S.state.sites[id]?S.state.sites[id].name:'').filter(Boolean).join(', ')||'None')+'</span></div>';
  const s = workerSummary(w);
  if(s.noMedical) body += '<div class="notice" style="background:var(--red-bg);color:var(--red);margin-top:10px;">No medical certificate of fitness on file.</div>';
  body += '<div class="section-title">Certificates</div>';
  body += w.certificates.length ? w.certificates.map(c=>{
    const st = certStatus(c);
    return '<div class="cert-row"><div><div style="font-weight:600;">'+c.name+'</div><div class="site-card-sub">'+CERT_KINDS[c.kind]+(c.issuer?' · '+c.issuer:'')+(c.expiresOn?' · '+(st==='expired'?'expired ':'valid to ')+timeAgo(c.expiresOn):' · no expiry')+(c.restrictions?' · restrictions: '+c.restrictions:'')+'</div></div>'
      +'<div style="display:flex;gap:6px;align-items:center;">'+badge(st)+(c.fileUrl?'<a class="btn secondary small" href="'+c.fileUrl+'" target="_blank" rel="noopener">View</a>':'')
      +(editable?'<button class="btn danger small" data-action="delete-cert" data-id="'+c.id+'" data-worker="'+w.id+'" aria-label="Remove">'+ICONS.cross+'</button>':'')+'</div></div>';
  }).join('') : '<div class="site-card-sub">No certificates recorded.</div>';
  if(editable){
    body += '<div class="section-title">Add a certificate</div>'
      +'<label class="field-label" for="certKind">Type</label><select id="certKind" class="field">'+Object.entries(CERT_KINDS).map(([k,v])=>'<option value="'+k+'">'+v+'</option>').join('')+'</select>'
      +'<label class="field-label" for="certName">Name</label><input type="text" id="certName" placeholder="e.g. Certificate of fitness (MHSA s12/13), Working at heights">'
      +'<label class="field-label" for="certIssuer">Issued by</label><input type="text" id="certIssuer" placeholder="e.g. Occupational medical practitioner, training provider">'
      +'<div style="display:flex;gap:8px;"><div style="flex:1;"><label class="field-label" for="certIssued">Issued</label><input type="date" id="certIssued"></div><div style="flex:1;"><label class="field-label" for="certExpires">Expires</label><input type="date" id="certExpires"></div></div>'
      +'<label class="field-label" for="certRestrictions">Restrictions (optional)</label><input type="text" id="certRestrictions" placeholder="e.g. Not fit for work at heights">'
      +'<label class="field-label" for="certFile">Copy of the certificate (optional)</label><input type="file" id="certFile" accept="application/pdf,image/*" style="font-size:12.5px;">'
      +'<button class="btn orange block" style="margin-top:10px;" data-action="save-cert" data-worker="'+w.id+'">Add certificate</button>'
      +'<div class="divider"></div>'
      +(siteId && w.siteIds.includes(siteId) && isContractor() ? '<button class="btn secondary block" data-action="unassign-worker" data-worker="'+w.id+'" data-site="'+siteId+'">Remove from '+S.state.sites[siteId].name+'</button>' : '')
      +'<button class="btn secondary block" style="margin-top:8px;" data-action="edit-worker" data-worker="'+w.id+'">Edit details</button>'
      +'<button class="btn '+(w.active?'danger':'secondary')+' block" style="margin-top:8px;" data-action="toggle-worker" data-worker="'+w.id+'" data-active="'+(w.active?'0':'1')+'">'+(w.active?'Mark as no longer working for us':'Reactivate')+'</button>';
  }
  return body;
}
on('open-worker', (el)=>openSheet(renderWorkerSheet(el.dataset.worker, el.dataset.site)));
function workerForm(w){
  w = w || {};
  return '<label class="field-label" for="wName">Full name</label><input type="text" id="wName" value="'+(w.name||'')+'">'
    +'<label class="field-label" for="wOcc">Occupation</label><input type="text" id="wOcc" value="'+(w.occupation||'')+'" placeholder="e.g. Electrician, Rigger, Safety officer">'
    +'<label class="field-label" for="wEmp">Employee number (optional)</label><input type="text" id="wEmp" value="'+(w.employeeNo||'')+'">'
    +'<label class="field-label" for="wId">Last 4 characters of ID / passport (optional)</label><input type="text" id="wId" maxlength="4" value="'+(w.idLast4||'')+'" inputmode="text">'
    +'<div class="site-card-sub" style="margin-top:4px;">SiteGuard deliberately doesn\'t store full ID numbers (POPIA) — the last 4 are enough to match someone at the gate.</div>'
    +'<label class="field-label" for="wPhone">Phone (optional)</label><input type="tel" id="wPhone" value="'+(w.phone||'')+'">';
}
const readWorker = () => ({ fullName: (val('wName')), occupation: (val('wOcc')), employeeNo: (val('wEmp')), idLast4: val('wId'), phone: val('wPhone') });
on('new-worker', ()=>openSheet(sheetHead('Add a worker') + workerForm() + '<button class="btn orange block" style="margin-top:12px;" data-action="save-worker">Add worker</button>'));
on('save-worker', async (el)=>{
  const b = readWorker();
  if(!b.fullName){ document.getElementById('wName').focus(); return; }
  const r = await act(()=>api.post('/api/workers', b), 'Worker added — now record their certificates', el);
  if(r) openSheet(renderWorkerSheet(r.id));
});
on('edit-worker', (el)=>{ const w = S.state.workers[el.dataset.worker]; openSheet(sheetHead('Edit worker') + workerForm(w) + '<button class="btn orange block" style="margin-top:12px;" data-action="update-worker" data-worker="'+w.id+'">Save</button>'); });
on('update-worker', async (el)=>{ if(await act(()=>api.patch('/api/workers/'+el.dataset.worker, readWorker()), 'Saved', el)) openSheet(renderWorkerSheet(el.dataset.worker)); });
on('toggle-worker', async (el)=>{ if(await act(()=>api.patch('/api/workers/'+el.dataset.worker, { active: el.dataset.active==='1' }), 'Saved', el)) openSheet(renderWorkerSheet(el.dataset.worker)); });
on('save-cert', async (el)=>{
  const name = (val('certName'));
  if(!name){ document.getElementById('certName').focus(); return; }
  const f = document.getElementById('certFile').files[0];
  const ok = await act(async ()=>{
    const fileId = f ? (await api.upload('/api/uploads', f)).fileId : undefined;
    await api.post('/api/workers/'+el.dataset.worker+'/certificates', { kind: val('certKind'), name, issuer: (val('certIssuer')), issuedOn: val('certIssued'), expiresOn: val('certExpires'), restrictions: (val('certRestrictions')), fileId });
  }, 'Certificate recorded', el);
  if(ok) openSheet(renderWorkerSheet(el.dataset.worker));
});
on('delete-cert', async (el)=>{
  if(!confirm('Remove this certificate record?')) return;
  if(await act(()=>api.del('/api/certificates/'+el.dataset.id), 'Removed', el)) openSheet(renderWorkerSheet(el.dataset.worker));
});
on('assign-worker', (el)=>{
  const siteId = el.dataset.site;
  const assigned = new Set((S.state.siteWorkers||{})[siteId]||[]);
  const available = Object.values(S.state.workers).filter(w=>w.own && w.active && !assigned.has(w.id));
  openSheet(sheetHead('Assign workers', S.state.sites[siteId].name)
    + (available.length ? available.map(w=>{ const s = workerSummary(w); return '<label class="toggle-row" style="cursor:pointer;"><span>'+w.name+' <span class="site-card-sub">'+(w.occupation||'')+(s.noMedical?' · no medical':s.worst!=='complete'?' · certificate '+s.worst:'')+'</span></span><input type="checkbox" class="assign-box" value="'+w.id+'"></label>'; }).join('')
        +'<button class="btn orange block" style="margin-top:12px;" data-action="save-assign" data-site="'+siteId+'">Assign selected</button>'
      : '<p class="site-card-sub">Everyone active is already on this site.</p>')
    +'<button class="btn secondary block" style="margin-top:8px;" data-action="new-worker">+ Add a new worker</button>');
});
on('save-assign', async (el)=>{
  const ids = [...document.querySelectorAll('.assign-box:checked')].map(b=>b.value);
  if(!ids.length){ showToast('Select at least one worker'); return; }
  if(await act(async ()=>{ for(const workerId of ids) await api.post('/api/sites/'+el.dataset.site+'/workers', { workerId }); }, ids.length+' assigned', el)) closeSheet();
});
on('unassign-worker', async (el)=>{ if(await act(()=>api.del('/api/sites/'+el.dataset.site+'/workers/'+el.dataset.worker), 'Removed from site', el)) closeSheet(); });

/* ============ APPOINTMENTS ============ */
on('new-appointment', (el)=>{
  const siteId = el.dataset.site || '';
  const workers = Object.values(S.state.workers||{}).filter(w=>w.own && w.active);
  openSheet(sheetHead('Record an appointment')
    +'<label class="field-label" for="apPreset">Appointment</label><select id="apPreset" class="field" data-action-change="appointment-preset">'+APPOINTMENT_PRESETS.map((p,i)=>'<option value="'+i+'">'+p.type+(p.ref?' — '+p.ref:'')+'</option>').join('')+'</select>'
    +'<label class="field-label" for="apType">Title</label><input type="text" id="apType" value="'+APPOINTMENT_PRESETS[0].type+'">'
    +'<label class="field-label" for="apRef">Legal reference</label><input type="text" id="apRef" value="'+APPOINTMENT_PRESETS[0].ref+'" placeholder="e.g. MHSA s7(4), OHS Act s16(2)">'
    +'<label class="field-label" for="apName">Appointee</label><input type="text" id="apName" list="apWorkers" placeholder="Full name"><datalist id="apWorkers">'+workers.map(w=>'<option value="'+w.name+'">').join('')+'</datalist>'
    +'<label class="field-label" for="apBy">Appointed by</label><input type="text" id="apBy" value="'+myName()+'">'
    +'<label class="field-label" for="apSite">Applies to</label><select id="apSite" class="field"><option value="">Whole organisation</option>'+Object.values(S.state.sites).filter(s=>s.status!=='declined'&&s.status!=='invited').map(s=>'<option value="'+s.id+'"'+(s.id===siteId?' selected':'')+'>'+s.name+'</option>').join('')+'</select>'
    +'<div style="display:flex;gap:8px;"><div style="flex:1;"><label class="field-label" for="apStart">From</label><input type="date" id="apStart" value="'+todayStr()+'"></div><div style="flex:1;"><label class="field-label" for="apEnd">Until (optional)</label><input type="date" id="apEnd"></div></div>'
    +'<label class="field-label" for="apFile">Signed appointment letter (optional)</label><input type="file" id="apFile" accept="application/pdf,image/*" style="font-size:12.5px;">'
    +'<button class="btn orange block" style="margin-top:12px;" data-action="save-appointment">Record appointment</button>');
});
on('appointment-preset', (el)=>{ const p = APPOINTMENT_PRESETS[parseInt(el.value,10)]; document.getElementById('apType').value = p.type; document.getElementById('apRef').value = p.ref; });
on('save-appointment', async (el)=>{
  const u = val;
  if(!u('apName')){ document.getElementById('apName').focus(); return; }
  const worker = Object.values(S.state.workers||{}).find(w=>w.own && unescapeHtml(w.name)===u('apName'));
  const f = document.getElementById('apFile').files[0];
  const ok = await act(async ()=>{
    const fileId = f ? (await api.upload('/api/uploads', f)).fileId : undefined;
    await api.post('/api/appointments', { siteId: val('apSite'), appointeeName: u('apName'), workerId: worker ? worker.id : undefined, appointmentType: u('apType'), legalReference: u('apRef'), appointedBy: u('apBy'), startDate: val('apStart'), endDate: val('apEnd'), fileId });
  }, 'Appointment recorded', el);
  if(ok) closeSheet();
});
on('open-appointment', (el)=>{
  const a = (S.state.appointments||[]).find(x=>x.id===el.dataset.id);
  openSheet(sheetHead(a.appointeeName, a.type) + '<div class="card">'+appointmentRow(a)+'</div>'
    +'<div class="kv"><span>Appointed by</span><span>'+(a.appointedBy||'—')+'</span></div>'
    +'<button class="btn danger block" style="margin-top:12px;" data-action="revoke-appointment" data-id="'+a.id+'">Revoke appointment</button>');
});
on('revoke-appointment', async (el)=>{ if(confirm('Revoke this appointment? It stays on the register as revoked.') && await act(()=>api.post('/api/appointments/'+el.dataset.id+'/revoke'), 'Appointment revoked', el)) closeSheet(); });

/* ============ TOOLBOX TALKS ============ */
function renderNewToolboxSheet(siteId){
  return sheetHead('Record a toolbox talk', S.state.sites[siteId].name)
    +'<label class="field-label" for="ttTopic">Topic</label><input type="text" id="ttTopic" placeholder="e.g. Isolation and lock-out before work on the drive station">'
    +'<div style="display:flex;gap:8px;"><div style="flex:1;"><label class="field-label" for="ttDate">Date</label><input type="date" id="ttDate" value="'+todayStr()+'"></div><div style="flex:1;"><label class="field-label" for="ttPresenter">Presented by</label><input type="text" id="ttPresenter" value="'+myName()+'"></div></div>'
    +'<label class="field-label" for="ttContent">Talk content / key points</label><textarea id="ttContent" style="min-height:110px;" placeholder="What was covered"></textarea>'
    +(S.boot.features.ai?'<button class="btn secondary small" style="margin-top:6px;" data-action="draft-toolbox">'+ICONS.sparkle+' Draft content with AI</button>':'')
    +'<button class="btn orange block" style="margin-top:12px;" data-action="save-toolbox" data-site="'+siteId+'">Save and collect signatures</button>';
}
on('new-toolbox-talk', (el)=>openSheet(renderNewToolboxSheet(el.dataset.site)));
on('draft-toolbox', async (el)=>{
  const topic = (val('ttTopic'));
  if(!topic){ document.getElementById('ttTopic').focus(); return; }
  el.disabled = true;
  const ta = document.getElementById('ttContent');
  try{ await streamDraft('Toolbox talk record', topic, (t)=>{ ta.value = t; }); }
  catch(e){ showToast(e.message); }
  el.disabled = false;
});
on('save-toolbox', async (el)=>{
  const topic = (val('ttTopic'));
  if(!topic){ document.getElementById('ttTopic').focus(); return; }
  const r = await act(()=>api.post('/api/sites/'+el.dataset.site+'/toolbox-talks', { topic, heldOn: val('ttDate'), presenter: (val('ttPresenter')), content: document.getElementById('ttContent').value }), 'Toolbox talk saved', el);
  if(r) openToolbox(el.dataset.site, r.id);
});
function renderToolboxSheet(siteId, talkId){
  const t = ((S.state.toolboxTalks||{})[siteId]||[]).find(x=>x.id===talkId);
  if(!t) return sheetHead('Not found');
  const workers = ((S.state.siteWorkers||{})[siteId]||[]).map(id=>S.state.workers[id]).filter(Boolean);
  const signed = new Set(t.attendance.map(a=>a.workerId).filter(Boolean));
  let body = sheetHead(t.topic, timeAgo(t.heldOn)+' · presented by '+t.presenter+' · '+t.orgName);
  if(t.content) body += '<details><summary style="font-size:12.5px;color:var(--grey);cursor:pointer;">Talk content</summary><div class="ai-output">'+t.content+'</div></details>';
  body += '<div class="section-title">Attendance ('+t.attendance.length+')</div>';
  body += t.attendance.length ? t.attendance.map(a=>'<div class="cert-row"><div><div style="font-weight:600;">'+a.name+'</div><div class="site-card-sub">'+dateTime(a.signedAt)+'</div></div><img class="sig-thumb" src="'+a.signatureUrl+'" alt="Signature of '+a.name+'"></div>').join('')
    : '<div class="site-card-sub">Nobody has signed yet.</div>';
  if(canEdit() && !readOnly()){
    body += '<div class="section-title">Sign attendance</div>'
      +(workers.length ? '<label class="field-label" for="attWorker">Worker</label><select id="attWorker" class="field" data-action-change="att-worker"><option value="">Someone else (type name)</option>'+workers.filter(w=>!signed.has(w.id)).map(w=>'<option value="'+w.id+'">'+w.name+'</option>').join('')+'</select>' : '')
      +'<label class="field-label" for="attName">Name</label><input type="text" id="attName" placeholder="Attendee\'s full name">'
      +'<label class="field-label">Signature</label><canvas class="sigpad" id="sigpad" aria-label="Signature pad — sign with your finger or mouse"></canvas>'
      +'<div style="display:flex;gap:8px;margin-top:8px;"><button class="btn secondary" style="flex:1;" data-action="sig-clear">Clear</button><button class="btn orange" style="flex:2;" data-action="save-signature" data-talk="'+t.id+'" data-site="'+siteId+'">Save signature</button></div>'
      +'<div class="site-card-sub" style="margin-top:6px;">Pass the device to each attendee to sign in turn.</div>';
  }
  return body;
}
function openToolbox(siteId, talkId){
  openSheet(renderToolboxSheet(siteId, talkId));
  initSignaturePad();
}
on('open-toolbox-talk', (el)=>openToolbox(el.dataset.site, el.dataset.id));
on('att-worker', (el)=>{ const w = S.state.workers[el.value]; document.getElementById('attName').value = w ? unescapeHtml(w.name) : ''; });

let sigDirty = false;
function initSignaturePad(){
  const c = document.getElementById('sigpad');
  if(!c) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  c.width = c.clientWidth * ratio; c.height = c.clientHeight * ratio;
  const ctx = c.getContext('2d');
  ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
  sigDirty = false;
  let drawing = false;
  const pos = (e)=>{ const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  c.addEventListener('pointerdown', (e)=>{ drawing = true; c.setPointerCapture(e.pointerId); const [x,y] = pos(e); ctx.beginPath(); ctx.moveTo(x,y); });
  c.addEventListener('pointermove', (e)=>{ if(!drawing) return; const [x,y] = pos(e); ctx.lineTo(x,y); ctx.stroke(); sigDirty = true; });
  const end = ()=>{ drawing = false; };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
}
on('sig-clear', ()=>{ const c = document.getElementById('sigpad'); c.getContext('2d').clearRect(0,0,c.width,c.height); sigDirty = false; });
on('save-signature', async (el)=>{
  const name = (val('attName'));
  if(!name){ document.getElementById('attName').focus(); return; }
  if(!sigDirty){ showToast('Ask the attendee to sign in the box'); return; }
  const c = document.getElementById('sigpad');
  // Downscale to keep the stored image small.
  const out = document.createElement('canvas'); out.width = 360; out.height = Math.round(360 * c.height / c.width);
  out.getContext('2d').drawImage(c, 0, 0, out.width, out.height);
  const workerSel = document.getElementById('attWorker');
  const ok = await act(()=>api.post('/api/toolbox-talks/'+el.dataset.talk+'/attendance', { attendeeName: name, workerId: workerSel ? workerSel.value : '', signature: out.toDataURL('image/png') }), 'Signed — '+name, el);
  if(ok) openToolbox(el.dataset.site, el.dataset.talk);
});

/* ============ PROFILE ============ */
function renderProfileSheet(){
  const me = S.boot.me;
  const orgs = S.boot.orgs || [];
  let body = sheetHead('Profile')
    +'<div style="text-align:center;margin-bottom:14px;"><div class="identity-avatar" style="width:56px;height:56px;font-size:18px;margin:0 auto 8px;">'+escapeHtml(me.name.split(' ').map(w=>w[0]).slice(0,2).join(''))+'</div>'
    +'<div style="font-weight:600;">'+me.name+'</div><div class="site-card-sub">'+me.roleLabel+' · '+org().name+'</div><div class="site-card-sub">'+me.email+(me.verified?'':' · <span style="color:var(--amber);">unconfirmed</span>')+'</div></div>';
  if(me.isDemo){
    body += '<div class="notice">This is a demo persona. Use the persona menu at the top to switch between sample users, or create a real account from the banner.</div>';
    return body;
  }
  body += '<label class="field-label" for="profileName">Your name</label><input type="text" id="profileName" value="'+me.name+'">'
    +'<label class="field-label" for="profileTitle">Your title / role (shown on records)</label><input type="text" id="profileTitle" value="'+me.title+'" placeholder="e.g. Mine SHE Officer">'
    +'<label class="field-label" for="profilePhone">Contact number</label><input type="tel" id="profilePhone" value="'+me.phone+'">'
    +'<button class="btn orange block" style="margin-top:12px;" data-action="save-profile">Save</button>';
  if(!me.verified) body += '<button class="btn secondary block" style="margin-top:8px;" data-action="resend-verification">Resend confirmation email</button>';
  body += '<div class="section-title">Organisations</div>'
    + orgs.map(o=>'<button class="menu-row" '+(o.id===org().id?'disabled':'data-action="switch-org" data-org="'+o.id+'"')+'><div style="flex:1;"><div class="qa-title">'+o.name+'</div><div class="qa-sub">'+(o.kind==='host'?'Site owner':'Contractor')+' · '+o.role+'</div></div>'+(o.id===org().id?'<span class="badge approved">Current</span>':ICONS.chevron)+'</button>').join('')
    +'<details style="margin-top:8px;"><summary style="font-size:12.5px;color:var(--grey);cursor:pointer;">Create another organisation</summary>'
    +'<label class="field-label" for="newOrgName">Name</label><input type="text" id="newOrgName"><label class="field-label" for="newOrgKind">Type</label><select id="newOrgKind" class="field"><option value="host">Site / mining company</option><option value="contractor">Contractor company</option></select>'
    +'<button class="btn secondary block" style="margin-top:8px;" data-action="create-org">Create</button></details>';
  body += '<div class="section-title">Security</div>'
    +'<label class="field-label" for="pwCurrent">Current password</label><input type="password" id="pwCurrent" autocomplete="current-password">'
    +'<label class="field-label" for="pwNext">New password</label><input type="password" id="pwNext" autocomplete="new-password">'
    +'<button class="btn secondary block" style="margin-top:8px;" data-action="change-password">Change password</button>'
    +'<button class="btn secondary block" style="margin-top:8px;" data-action="sign-out-everywhere">Sign out on all other devices</button>'
    +'<button class="btn danger block" style="margin-top:8px;" data-action="auth-signout">Sign out</button>';
  return body;
}
on('open-profile', ()=>openSheet(renderProfileSheet()));
on('save-profile', async (el)=>{
  const u = val;
  if(await act(()=>api.patch('/api/me', { name:u('profileName'), title:u('profileTitle'), phone:u('profilePhone') }), 'Profile saved', el)) closeSheet();
});
on('change-password', async (el)=>{
  const current = document.getElementById('pwCurrent').value, next = document.getElementById('pwNext').value;
  if(!current || !next){ showToast('Enter your current and new password'); return; }
  if(await act(()=>api.post('/api/me/password', { current, next }), 'Password changed — other devices signed out', el)) closeSheet();
});
on('sign-out-everywhere', (el)=>act(()=>api.post('/api/me/sign-out-everywhere'), 'Signed out on all other devices', el));

/* ============ SEARCH ============ */
function runSearch(raw){
  const q = escapeHtml(raw.trim().toLowerCase());
  if(q.length<2) return [];
  const results = [];
  const has = (s)=>String(s||'').toLowerCase().indexOf(q)>=0;
  Object.values(S.state.sites).forEach(s=>{
    if(has(s.name) || has(s.location)) results.push({type:'Site', title:s.name, sub:s.location, siteId:s.id});
    (S.state.requirements[s.id]||[]).forEach(req=>{ if(has(req.name)) results.push({type:'Document', title:req.name, sub:s.name, siteId:s.id, reqId:req.id}); });
    (S.state.incidents[s.id]||[]).forEach(i=>{ if(has(i.description)) results.push({type:'Incident', title:incidentTypeInfo(i.type).label, sub:s.name+' · '+timeAgo(i.date), siteId:s.id, incidentId:i.id}); });
  });
  Object.values(S.state.requests||{}).forEach(rq=>{ if(has(rq.title) && S.state.sites[rq.siteId]) results.push({type:'Request', title:rq.title, sub:S.state.sites[rq.siteId].name, requestId:rq.id}); });
  Object.values(S.state.workers||{}).forEach(w=>{ if(has(w.name) || has(w.employeeNo)) results.push({type:'Worker', title:w.name, sub:w.occupation||w.orgName, workerId:w.id}); });
  if(isHost()) Object.values(S.state.contractors).forEach(c=>{ if(has(c.name)) results.push({type:'Contractor', title:c.name, sub:c.trade||'Contractor', contractorId:c.id}); });
  else LIBRARY_TYPES.forEach(t=>{ if(has(t.name)) results.push({type:'Document', title:t.name, sub:'Document library', reqId:libraryReqId(myContractorId(), t.id)}); });
  return results.slice(0,25);
}
let lastResults = [];
on('open-search', ()=>openSheet(sheetHead('Search')+'<input type="search" id="searchInput" data-action-input="search" placeholder="Search sites, documents, people, incidents…" autofocus aria-label="Search"><div id="searchResults" style="margin-top:10px;" aria-live="polite"></div>'));
on('search', (el)=>{
  lastResults = runSearch(el.value);
  const box = document.getElementById('searchResults');
  if(!el.value.trim()) box.innerHTML = '';
  else if(!lastResults.length) box.innerHTML = '<div class="site-card-sub" style="padding:8px 2px;">No matches</div>';
  else box.innerHTML = lastResults.map((r,i)=>'<button class="qa-item" data-action="search-go" data-i="'+i+'"><div class="qa-icon">'+(r.type==='Site'?ICONS.sites:r.type==='Worker'?ICONS.hardhat:r.type==='Contractor'?ICONS.passport:ICONS.audit)+'</div>'
    +'<div><div class="qa-title">'+r.title+'</div><div class="qa-sub">'+r.type+' · '+r.sub+'</div></div></button>').join('');
});
on('search-go', (el)=>{
  const r = lastResults[parseInt(el.dataset.i,10)];
  closeSheet();
  if(!r) return;
  if(r.requestId){ openRequest(r.requestId); return; }
  if(r.workerId){ openSheet(renderWorkerSheet(r.workerId)); return; }
  if(r.incidentId){ openSheet(renderIncidentDetailSheet(r.siteId, r.incidentId)); return; }
  if(r.contractorId){ S.nav='passport'; render(); return; }
  if(r.siteId){ S.activeSiteId=r.siteId; S.nav='sites'; S.siteTab='compliance'; } else S.nav='passport';
  render();
  if(r.reqId) openReqSheet(r.reqId);
});

/* ============ DASHBOARD CUSTOMISATION ============ */
let dashDraft = null;
function renderDashSheet(){
  const labels = Object.fromEntries(DASHBOARD_WIDGETS[isContractor()?'contractor':'host']);
  return sheetHead('Customise your dashboard', 'Only affects your view')
    + dashDraft.order.map((id,i)=>'<div class="dash-edit-row"><input type="checkbox" id="dw-'+id+'" data-action-change="dash-toggle" data-id="'+id+'" '+(dashDraft.hidden.includes(id)?'':'checked')+'>'
      +'<span><label for="dw-'+id+'">'+labels[id]+'</label></span>'
      +'<button class="btn secondary small icon" data-action="dash-move" data-i="'+i+'" data-dir="-1" aria-label="Move up"'+(i===0?' disabled':'')+'>'+ICONS.up+'</button>'
      +'<button class="btn secondary small icon" data-action="dash-move" data-i="'+i+'" data-dir="1" aria-label="Move down"'+(i===dashDraft.order.length-1?' disabled':'')+'>'+ICONS.down+'</button></div>').join('')
    +'<div style="display:flex;gap:8px;margin-top:12px;"><button class="btn secondary" style="flex:1;" data-action="dash-reset">Reset to default</button><button class="btn orange" style="flex:2;" data-action="dash-save">Save</button></div>';
}
on('customise-dashboard', ()=>{ const l = dashboardLayout(); dashDraft = { order: l.order.slice(), hidden: l.hidden.slice() }; openSheet(renderDashSheet()); });
on('dash-toggle', (el)=>{ const id = el.dataset.id; dashDraft.hidden = el.checked ? dashDraft.hidden.filter(x=>x!==id) : dashDraft.hidden.concat(id); });
on('dash-move', (el)=>{
  const i = parseInt(el.dataset.i,10), j = i + parseInt(el.dataset.dir,10);
  const o = dashDraft.order; [o[i], o[j]] = [o[j], o[i]];
  refreshSheet(renderDashSheet());
});
on('dash-save', async (el)=>{ if(await act(()=>api.put('/api/me/dashboard', dashDraft), 'Dashboard saved', el)) closeSheet(); });
on('dash-reset', async (el)=>{ if(await act(()=>api.put('/api/me/dashboard', { order:[], hidden:[] }), 'Dashboard reset', el)) closeSheet(); });

