// Contractor projects: safety files a contractor builds for clients that aren't on
// SiteGuard. A project works like any other file (guide, Document Studio, builder,
// workers, the bound PDF, revisions, share links); these are the parts that differ:
// starting one, editing it, shaping its requirement list, sending it to the client,
// and archiving it. Nobody reviews a project inside SiteGuard, so a filed document
// counts straight away and the file shows "Ready to send" rather than "Site Ready".

import { api } from './api.js';
import {
  S, ICONS, actions, on, act, render, showToast, openSheet, closeSheet, sheetHead, escapeHtml, val,
  isContractor, isOrgAdmin, readOnly, computeReadiness, SOURCE_LABEL,
} from './core.js';
import { loadPacks, packPicker, PACK_NOTE } from './sheets.js';

export const isProject = (site) => !!(site && site.project);
export const projects = () => Object.values(S.state.sites).filter(isProject);
const canManage = () => isContractor() && isOrgAdmin() && !readOnly();

/** The header note and actions on a project's page. */
export function projectBar(siteId){
  const s = S.state.sites[siteId];
  const { total, counts } = computeReadiness(siteId);
  const outstanding = (counts.missing||0) + (counts.expired||0);
  const ready = total && !outstanding;
  return '<div class="card project-bar"><div class="flexbetween" style="align-items:flex-start;gap:10px;">'
    +'<div><div class="hero-eyebrow" style="color:var(--sage-strong);margin:0 0 2px;">Your project</div>'
    +'<div class="site-card-title">For '+s.hostName+'</div>'
    +(s.clientContact?'<div class="site-card-sub">'+s.clientContact+'</div>':'')+'</div>'
    +'<span class="badge '+(ready?'complete':'grey')+'">'+(ready?ICONS.check+'Ready to send':outstanding+' to go')+'</span></div>'
    +'<div class="site-card-sub" style="margin-top:8px;">You manage this file yourself. Documents you file count straight away. When it\'s ready, send the client the PDF or a secure link. The client doesn\'t need a SiteGuard account.</div>'
    +'<div class="row-actions">'
    +'<button class="btn primary small" data-action="new-share-link" data-site="'+siteId+'">Send to client</button>'
    +'<a class="btn secondary small" href="/api/sites/'+encodeURIComponent(siteId)+'/safety-file.pdf" download>Download PDF</a>'
    +(canManage()?'<button class="btn secondary small" data-action="project-reqs" data-site="'+siteId+'">Requirements</button><button class="btn secondary small" data-action="project-edit" data-site="'+siteId+'">Edit</button>':'')
    +'</div></div>';
}

/** The contractor's Sites tab: projects in their own group. */
export function projectsSection(match){
  const list = projects().filter(match);
  let html = '<div class="section-title flexbetween"><span>My projects · '+list.length+'</span>'+(canManage()?'<button class="linkish" data-action="new-project">+ New project</button>':'')+'</div>';
  if(!list.length) return html + '<div class="card project-empty"><div class="site-card-title" style="font-size:14px;">Build a safety file for any client</div>'
    +'<div class="site-card-sub" style="margin-top:4px;">Working for a client or at a site that isn\'t on SiteGuard? Start a project, pick the documents they need, file them once, and send a professional PDF or a secure link.</div>'
    +(canManage()?'<button class="btn primary small" style="margin-top:10px;" data-action="new-project">Start a project</button>':'')+'</div>';
  return html;
}

/* ---------- start a project ---------- */
on('new-project', async ()=>{
  let packs;
  try{ packs = await loadPacks(); }catch(e){ showToast(e.message); return; }
  const mine = Object.values(S.state.sites).filter(s=>(S.state.requirements[s.id]||[]).length);
  openSheet(sheetHead('New project', 'A safety file for a client who isn\'t on SiteGuard')
    +'<label class="field-label" for="pjClient">Client</label><input type="text" id="pjClient" maxlength="200" placeholder="e.g. Acme Construction" list="pjClients">'
    +'<datalist id="pjClients">'+[...new Set(projects().map(p=>p.hostName))].map(n=>'<option value="'+n+'">').join('')+'</datalist>'
    +'<label class="field-label" for="pjContact">Client contact (optional)</label><input type="text" id="pjContact" maxlength="300" placeholder="e.g. Jane Dube, SHE manager, jane@acme.co.za">'
    +'<label class="field-label" for="pjName">Project or site name</label><input type="text" id="pjName" maxlength="300" placeholder="e.g. Warehouse roof replacement, Midrand">'
    +'<label class="field-label" for="pjLoc">Location (optional)</label><input type="text" id="pjLoc" maxlength="300" placeholder="e.g. 12 Main Road, Midrand">'
    +'<div class="section-title">What the safety file must contain</div>'
    +(mine.length?'<label class="field-label" for="pjCopy">Start from one of your files (optional)</label><select id="pjCopy" class="field"><option value="">Don\'t copy</option>'+mine.map(s=>'<option value="'+s.id+'">'+s.name+' — '+s.hostName+' ('+(S.state.requirements[s.id]||[]).length+')</option>').join('')+'</select>':'')
    +'<div class="site-card-sub" style="margin:8px 0 6px;">Tick the lists that fit the job. The general construction list suits most clients outside mining. You can add or remove individual documents afterwards.</div>'
    + packPicker(packs, ['general-construction'], []) + PACK_NOTE
    +'<button class="btn primary block" style="margin-top:12px;" data-action="new-project-go">Create project</button>');
});
on('new-project-go', async (el)=>{
  const clientName = val('pjClient'), name = val('pjName');
  if(!clientName){ showToast('Who is the client?'); document.getElementById('pjClient').focus(); return; }
  if(!name){ showToast('Name the project or site'); document.getElementById('pjName').focus(); return; }
  const packIds = [...document.querySelectorAll('.pack-box:checked')].map(x=>x.value);
  const copyFromSiteId = val('pjCopy') || undefined;
  if(!packIds.length && !copyFromSiteId && !confirm('Start with an empty requirement list? You can add documents afterwards.')) return;
  const r = await act(()=>api.post('/api/projects', { clientName, clientContact: val('pjContact'), name, location: val('pjLoc'), packIds, copyFromSiteId }), null, el);
  if(r){
    closeSheet();
    S.nav = 'sites'; S.activeSiteId = r.id; S.siteTab = 'compliance'; render(); window.scrollTo(0,0);
    showToast('Project created with '+r.requirements+' document'+(r.requirements===1?'':'s')+' to gather');
  }
});

/* ---------- edit, archive ---------- */
on('project-edit', (el)=>{
  const s = S.state.sites[el.dataset.site];
  openSheet(sheetHead('Edit project', s.name)
    +'<label class="field-label" for="peName">Project or site name</label><input type="text" id="peName" maxlength="300" value="'+s.name+'">'
    +'<label class="field-label" for="peLoc">Location</label><input type="text" id="peLoc" maxlength="300" value="'+(s.location||'')+'">'
    +'<label class="field-label" for="peClient">Client</label><input type="text" id="peClient" maxlength="200" value="'+s.hostName+'">'
    +'<label class="field-label" for="peContact">Client contact</label><input type="text" id="peContact" maxlength="300" value="'+(s.clientContact||'')+'">'
    +'<div class="section-title">Emergency information</div>'
    +'<label class="field-label" for="peMuster">Assembly point</label><input type="text" id="peMuster" maxlength="300" value="'+(s.emergency.musterPoint||'')+'">'
    +'<label class="field-label" for="peEmg">Emergency number</label><input type="text" id="peEmg" maxlength="300" value="'+(s.emergency.contact||'')+'">'
    +'<label class="field-label" for="peHosp">Nearest hospital</label><input type="text" id="peHosp" maxlength="300" value="'+(s.emergency.hospital||'')+'">'
    +'<button class="btn primary block" style="margin-top:12px;" data-action="project-save" data-site="'+s.id+'">Save</button>'
    +'<button class="btn secondary block" style="margin-top:8px;" data-action="project-archive" data-site="'+s.id+'">Archive this project</button>'
    +'<div class="site-card-sub" style="margin-top:6px;">Archiving hides the project from your lists. Its history stays on record.</div>');
});
on('project-save', async (el)=>{
  if(!val('peName') || !val('peClient')){ showToast('The project and client need a name'); return; }
  const ok = await act(()=>api.patch('/api/projects/'+el.dataset.site, { name: val('peName'), location: val('peLoc'), clientName: val('peClient'), clientContact: val('peContact'), emergency: { musterPoint: val('peMuster'), contact: val('peEmg'), hospital: val('peHosp') } }), 'Project saved', el);
  if(ok) closeSheet();
});
on('project-archive', async (el)=>{
  if(!confirm('Archive this project? It disappears from your lists; nothing is deleted.')) return;
  const ok = await act(()=>api.post('/api/projects/'+el.dataset.site+'/archive'), 'Project archived', el);
  if(ok){ closeSheet(); S.activeSiteId = null; render(); }
});

/* ---------- requirement list ---------- */
on('project-reqs', async (el)=>{
  const siteId = el.dataset.site;
  let packs;
  try{ packs = await loadPacks(); }catch(e){ showToast(e.message); return; }
  const reqs = S.state.requirements[siteId] || [];
  const filed = (r)=>{ const d = S.state.documents[r.id]; return d && d.version; };
  openSheet(sheetHead('Requirements', S.state.sites[siteId].name)
    +'<div class="site-card-sub" style="margin-bottom:8px;">What this client\'s safety file must contain. Remove what doesn\'t apply; anything already filed stays on record.</div>'
    +'<div class="card">'+(reqs.length ? reqs.map(r=>'<div class="reqrow"><div class="reqrow-main"><div class="reqrow-name">'+r.name+'</div><div class="reqrow-meta"><span class="srctag">'+r.category+'</span><span class="srctag">'+(SOURCE_LABEL[r.source]||r.source)+'</span>'+(filed(r)?'<span class="badge complete">Filed</span>':'')+'</div></div>'
      +(filed(r)?'':'<button class="btn secondary small" data-action="project-req-remove" data-site="'+siteId+'" data-req="'+r.id+'" aria-label="Remove '+r.name+'">Remove</button>')+'</div>').join('') : '<div class="site-card-sub">No requirements yet.</div>')+'</div>'
    +'<div class="section-title">Add your own</div><div class="card">'
    +'<label class="field-label" for="prName">Document</label><input type="text" id="prName" maxlength="200" placeholder="e.g. Client induction attendance record">'
    +'<label class="field-label" for="prCat">Group</label><input type="text" id="prCat" maxlength="80" value="Client requirements">'
    +'<label class="field-label" for="prWhy">Why it\'s needed (optional)</label><input type="text" id="prWhy" maxlength="1000" placeholder="e.g. Required by the client\'s contractor management procedure">'
    +'<button class="btn secondary block" style="margin-top:10px;" data-action="project-req-add" data-site="'+siteId+'">Add document</button></div>'
    +'<div class="section-title">Add a list</div>'+packPicker(packs, [], reqs.map(r=>r.name))
    +'<button class="btn secondary block" style="margin-top:10px;" data-action="project-pack-add" data-site="'+siteId+'">Add ticked lists</button>');
});
/** Redraws the requirements sheet with fresh data (act() has already reloaded). */
function refreshReqSheet(siteId){ actions['project-reqs']({ dataset: { site: siteId } }); }
on('project-req-remove', async (el)=>{
  const ok = await act(()=>api.post('/api/projects/'+el.dataset.site+'/requirements/'+el.dataset.req+'/remove'), 'Removed', el);
  if(ok) refreshReqSheet(el.dataset.site);
});
on('project-req-add', async (el)=>{
  const name = val('prName');
  if(!name){ showToast('Name the document'); return; }
  const ok = await act(()=>api.post('/api/projects/'+el.dataset.site+'/requirements', { requirements: [{ name, category: val('prCat') || 'Client requirements', source: 'client', why: val('prWhy') }] }), 'Added to the file', el);
  if(ok) refreshReqSheet(el.dataset.site);
});
on('project-pack-add', async (el)=>{
  const packIds = [...document.querySelectorAll('.pack-box:checked')].map(x=>x.value);
  if(!packIds.length){ showToast('Tick a list first'); return; }
  const r = await act(()=>api.post('/api/projects/'+el.dataset.site+'/requirements', { packIds }), null, el);
  if(r){ showToast(r.added+' document'+(r.added===1?'':'s')+' added'); refreshReqSheet(el.dataset.site); }
});

/** Counts for the dashboard. */
export function projectStats(){
  const list = projects();
  let ready = 0, outstanding = 0;
  list.forEach(p=>{ const r = computeReadiness(p.id); const out = (r.counts.missing||0)+(r.counts.expired||0); outstanding += out; if(r.total && !out) ready++; });
  return { count: list.length, ready, outstanding };
}
