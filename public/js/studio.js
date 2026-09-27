// Document Studio: pick a document type, answer a few questions, and get a
// professionally formatted, branded PDF and Word document. Documents can be
// attached straight to a site requirement or the company library.

import { api } from './api.js';
import {
  S, ICONS, escapeHtml, on, openSheet, closeSheet, sheetHead, showToast, render, reload, act, val,
  isContractor, readOnly, findReq, siteIdForReq, libraryReqId, myContractorId, effectiveStatus,
} from './core.js';

let catalog = null;
async function loadCatalog(){
  if(!catalog) catalog = await api.get('/api/studio/blueprints');
  return catalog;
}
const CATEGORY_ICON = {
  'Plans & policies': ICONS.passport, 'Risk assessments': ICONS.alert, 'Procedures': ICONS.audit, 'Emergency': ICONS.alert,
  'Appointments & agreements': ICONS.people, 'Toolbox & training': ICONS.hardhat, 'Registers & checklists': ICONS.check,
};
/** Library slots a blueprint can fill (the rest map via requirement names on the server). */
export const LIBRARY_BLUEPRINT = { 'she-policy': 'hse-policy' };

export function studioBlueprintFor(reqId){
  if(reqId.startsWith('lib:')) return LIBRARY_BLUEPRINT[reqId.split(':')[2]] || null;
  const r = findReq(reqId);
  return r && r.blueprint ? r.blueprint : null;
}

/* ---------- Studio view (More → Document Studio) ---------- */
let docsCache = null;
async function loadDocs(force){
  if(!docsCache || force) docsCache = (await api.get('/api/studio/documents')).documents.map((d)=>({ ...d, title: escapeHtml(d.title), docNumber: escapeHtml(d.docNumber), createdBy: escapeHtml(d.createdBy), siteName: d.siteName ? escapeHtml(d.siteName) : '' }));
  return docsCache;
}
export function invalidateStudio(){ docsCache = null; }

export function renderStudio(){
  if(!catalog || !docsCache){
    Promise.all([loadCatalog(), loadDocs()]).then(()=>render()).catch((e)=>showToast(e.message));
    return '<div class="empty"><p>Loading Document Studio…</p></div>';
  }
  const cat = S.studioCat || 'All';
  const cats = ['All', ...catalog.categories];
  const bps = catalog.blueprints.filter(b=>cat==='All' || b.category===cat);
  const ai = S.boot.features.ai;
  let html = '<div class="dash-hero" style="margin-top:0;"><p class="hero-eyebrow">Document Studio</p><h1>Professional safety documents in minutes</h1>'
    +'<p class="greeting">Answer a few questions and SiteGuard writes a complete, branded document — with your logo, document number, revision control and sign-off blocks — as PDF and Word.'
    +(ai ? ' AI tailors every document to the job and can research the site\'s own requirements.' : '')+'</p></div>';
  html += '<div class="studio-cats" role="tablist">'+cats.map(c=>'<button class="site-picker-chip'+(c===cat?' active':'')+'" data-action="studio-cat" data-cat="'+escapeHtml(c)+'">'+escapeHtml(c)+'</button>').join('')+'</div>';
  html += '<div class="studio-grid">'+bps.map(b=>'<button class="studio-card" data-action="studio-new" data-bp="'+b.id+'"><span class="qa-icon">'+(CATEGORY_ICON[b.category]||ICONS.passport)+'</span><h4>'+escapeHtml(b.name)+'</h4><p>'+escapeHtml(b.description)+'</p><span class="badge sage" style="align-self:flex-start;">'+escapeHtml(b.category)+'</span></button>').join('')+'</div>';
  const docs = docsCache;
  html += '<div class="section-title">Your documents</div>';
  if(!docs.length) html += '<div class="card"><div class="site-card-sub">Documents you create appear here, with their revision history and review dates.</div></div>';
  else html += '<div class="card">'+docs.map(docRow).join('')+'</div>';
  return html;
}

function docRow(d){
  const days = Math.round((new Date(d.reviewDue) - Date.now())/86400000);
  const due = days < 0 ? '<span class="badge missing">Review overdue</span>' : days <= 30 ? '<span class="badge expiring">Review due in '+days+' days</span>' : '<span class="badge grey">Review '+d.reviewDue+'</span>';
  return '<div class="reqrow"><div class="reqrow-main"><div class="reqrow-name">'+d.title+'</div>'
    +'<div class="reqrow-meta"><span class="srctag">'+d.docNumber+' · Rev '+d.revision+'</span>'+(d.ai?'<span class="badge sage">AI</span>':'')+due+(d.siteName?'<span class="srctag">'+d.siteName+'</span>':'')+'</div>'
    +'<div class="row-actions"><button class="btn primary small" data-action="open-review" data-id="'+d.id+'">Open</button><a class="btn secondary small" href="/api/files/'+d.pdfFileId+'" target="_blank" rel="noopener">PDF</a>'
    +'<a class="btn secondary small" href="/api/files/'+d.docxFileId+'?download=1">Word</a>'
    +(readOnly()?'':'<button class="btn secondary small" data-action="studio-revise" data-id="'+d.id+'">New revision</button>')
    +(isContractor() && !readOnly()?'<button class="btn secondary small" data-action="studio-add" data-id="'+d.id+'">Add to safety file</button>':'')
    +'</div></div></div>';
}

/* ---------- Create / revise ---------- */
function fieldHtml(f, value){
  const id = 'sf_'+f.id;
  const label = '<label class="field-label" for="'+id+'">'+escapeHtml(f.label)+(f.required || /optional/i.test(f.label)?'':' <span class="muted" style="font-weight:400;">(optional)</span>')+'</label>';
  const v = escapeHtml(value || '');
  const ph = f.placeholder ? ' placeholder="'+escapeHtml(f.placeholder)+'"' : '';
  let input;
  if(f.type==='textarea' || f.type==='lines') input = '<textarea id="'+id+'" rows="'+(f.type==='lines'?4:3)+'"'+ph+'>'+v+'</textarea>';
  else if(f.type==='select') input = '<select id="'+id+'" class="field">'+f.options.map(o=>'<option'+(o===value?' selected':'')+'>'+escapeHtml(o)+'</option>').join('')+'</select>';
  else input = '<input type="'+(f.type==='date'?'date':'text')+'" id="'+id+'" value="'+v+'"'+ph+'>';
  return label + input + (f.help ? '<div class="site-card-sub" style="margin-top:4px;">'+escapeHtml(f.help)+'</div>' : '');
}

function siteOptions(selected){
  const sites = Object.values(S.state.sites).filter(s=>s.status!=='declined' && (s.status!=='invited' || !isContractor()));
  return '<option value="">No specific site</option>'+sites.map(s=>'<option value="'+s.id+'"'+(s.id===selected?' selected':'')+'>'+s.name+'</option>').join('');
}

/** Opens the questions for a blueprint. ctx: { siteId, reqId, reviseOf, values } */
export async function openStudioForm(bpId, ctx = {}){
  let cat;
  try{ cat = await loadCatalog(); }catch(e){ showToast(e.message); return; }
  const bp = cat.blueprints.find(b=>b.id===bpId);
  if(!bp){ showToast('That document type is not available'); return; }
  S.studioForm = { bpId, ...ctx };
  const values = ctx.values || {};
  const fields = bp.fields.filter(f=>!(f.id==='site' && ctx.siteId));
  openSheet(sheetHead(ctx.reviseOf ? 'New revision' : escapeHtml(bp.name), ctx.reviseOf ? escapeHtml(bp.name) : escapeHtml(bp.description))
    +(ctx.reqName ? '<div class="notice">For requirement: <strong>'+ctx.reqName+'</strong>. When it\'s ready you can attach it and submit it for review in one step.</div>' : '')
    +(!ctx.reviseOf ? '<label class="field-label" for="sf_siteId">Site</label><select id="sf_siteId" class="field"'+(ctx.reqId?' disabled':'')+'>'+siteOptions(ctx.siteId)+'</select><div class="site-card-sub" style="margin-top:4px;">The site\'s name, client and emergency details go into the document.</div>' : '')
    + fields.map(f=>fieldHtml(f, values[f.id])).join('')
    +(ctx.reviseOf ? '<label class="field-label" for="sf_revisionNote">What changed?</label><input type="text" id="sf_revisionNote" placeholder="e.g. Annual review; updated emergency contacts">' : '')
    +(S.boot.features.ai ? '<label class="toggle-row" style="border:none;margin-top:8px;"><span>Research the site\'s published requirements<br><span class="site-card-sub">Uses web search; takes a little longer</span></span><input type="checkbox" id="sf_research"></label>' : '')
    +'<div class="site-card-sub" style="margin-top:10px;">'+(S.boot.features.ai ? 'SiteGuard drafts the document from its safety templates, then AI tailors it to your answers.' : 'SiteGuard writes the document from its safety templates, tailored to the work you describe.')+' Your logo, colours and document numbering are applied automatically.</div>'
    +'<button class="btn primary block" style="margin-top:12px;" data-action="studio-generate" id="studioGo">'+(ctx.reviseOf?'Create revision':'Create document')+'</button>'
    +'<div id="studioOut"></div>');
}

on('studio-cat', (el)=>{ S.studioCat = el.dataset.cat; render(); });
on('studio-new', (el)=>openStudioForm(el.dataset.bp));
on('open-studio', ()=>{ closeSheet(); S.nav='more'; S.moreView='studio'; render(); window.scrollTo(0,0); });
on('studio-for-req', (el)=>{
  const reqId = el.dataset.req;
  const r = findReq(reqId);
  openStudioForm(el.dataset.bp, { reqId, siteId: reqId.startsWith('lib:') ? '' : siteIdForReq(reqId), reqName: r ? r.name : '' });
});
on('studio-revise', async (el)=>{
  try{
    const d = await api.get('/api/studio/documents/'+el.dataset.id);
    openStudioForm(d.blueprint, { reviseOf: d.id, siteId: d.siteId || '', values: d.inputs || {} });
  }catch(e){ showToast(e.message); }
});

on('studio-generate', async (el)=>{
  const f = S.studioForm; if(!f || el.disabled) return;
  el.disabled = true;
  const cat = await loadCatalog().catch(()=>null);
  if(!cat){ el.disabled = false; showToast('Couldn\'t load the document types — check your connection'); return; }
  const bp = cat.blueprints.find(b=>b.id===f.bpId);
  const values = {};
  for(const fld of bp.fields){
    const node = document.getElementById('sf_'+fld.id);
    if(!node) continue;
    values[fld.id] = node.value.trim();
    if(fld.required && !values[fld.id]){ el.disabled = false; node.focus(); showToast(fld.label+' is required'); return; }
  }
  const siteSel = document.getElementById('sf_siteId');
  const siteId = f.siteId || (siteSel ? siteSel.value : '');
  const out = document.getElementById('studioOut');
  el.textContent = S.boot.features.ai ? 'Writing your document… this can take a minute' : 'Writing your document…';
  out.innerHTML = '';
  try{
    const r = await api.post('/api/studio/documents', {
      blueprintId: f.bpId, values, siteId: siteId || undefined,
      requirementId: f.reqId && !f.reqId.startsWith('lib:') ? f.reqId : undefined,
      research: !!val('sf_research'), reviseOf: f.reviseOf, revisionNote: f.reviseOf ? val('sf_revisionNote') : undefined,
    });
    invalidateStudio();
    const detail = await api.get('/api/studio/documents/'+r.id);
    S.studioLast = { ...r, pdfFileId: detail.pdfFileId, docxFileId: detail.docxFileId };
    el.style.display = 'none';
    out.innerHTML = '<div class="card" style="margin-top:14px;border-color:var(--sage-soft);background:var(--sage-bg);">'
      +'<div class="chat-card-title">'+ICONS.check+' Ready'+(r.ai?' · AI-tailored':'')+'</div>'
      +'<div class="site-card-title">'+escapeHtml(r.title)+'</div>'
      +'<div class="site-card-sub">'+escapeHtml(r.docNumber)+' · Rev '+r.revision+' · review by '+r.reviewDue+'</div>'
      +'<div class="row-actions"><button class="btn secondary small" data-action="open-review" data-id="'+r.id+'">Read &amp; edit</button><a class="btn secondary small" href="/api/files/'+detail.pdfFileId+'" target="_blank" rel="noopener">Open PDF</a><a class="btn secondary small" href="/api/files/'+detail.docxFileId+'?download=1">Download Word</a></div>'
      +(f.reqId && isContractor() ? '<button class="btn primary block" style="margin-top:12px;" data-action="studio-attach" data-req="'+f.reqId+'">'+(f.reqId.startsWith('lib:')?'Save to your library':'Attach and submit for review')+'</button>' : '')
      +(!f.reqId && isContractor() ? '<button class="btn secondary block" style="margin-top:10px;" data-action="studio-add" data-id="'+r.id+'">Add to a safety file…</button>' : '')
      +'<div class="site-card-sub" style="margin-top:8px;">Review it before use and sign the approval block. It\'s saved under More → Document Studio.</div></div>';
  }catch(e){
    el.disabled = false; el.textContent = f.reviseOf ? 'Create revision' : 'Create document';
    out.innerHTML = '<div class="form-error">'+escapeHtml(e.message)+'</div>';
  }
});

async function attachAndSubmit(slot, generatedId, btn){
  const ok = await act(async ()=>{
    const a = await api.post('/api/documents/'+encodeURIComponent(slot)+'/attach-generated', { generatedId });
    await api.post('/api/documents/'+encodeURIComponent(slot)+'/submit', { note: a.note, expiryDate: a.reviewDue });
  }, slot.startsWith('lib:') ? 'Saved to your document library' : 'Submitted for review', btn);
  if(ok){ closeSheet(); invalidateStudio(); }
}
on('studio-attach', (el)=>{ if(S.studioLast) attachAndSubmit(el.dataset.req, S.studioLast.id, el); });

/** Pick where to put an existing generated document. */
on('studio-add', async (el)=>{
  const id = el.dataset.id;
  let d;
  try{ d = await api.get('/api/studio/documents/'+id); }catch(e){ showToast(e.message); return; }
  const options = [];
  for(const s of Object.values(S.state.sites)){
    if(s.status!=='in_progress' && s.status!=='site_ready') continue;
    for(const r of (S.state.requirements[s.id]||[])){
      const doc = S.state.documents[r.id] || {};
      const eff = effectiveStatus(doc);
      if(eff==='awaiting_review' || eff==='complete') continue;
      options.push({ slot:r.id, label:s.name+' — '+r.name, match: r.blueprint===d.blueprint });
    }
  }
  const lib = Object.entries(LIBRARY_BLUEPRINT).filter(([,bp])=>bp===d.blueprint).map(([type])=>({ slot: libraryReqId(myContractorId(), type), label:'Company library — Health & Safety policy', match:true }));
  const all = [...lib, ...options.sort((a,b)=>(b.match?1:0)-(a.match?1:0))];
  if(!all.length){ showToast('No open requirements to attach this to'); return; }
  S.studioLast = { id };
  openSheet(sheetHead('Add to a safety file', escapeHtml(d.title))
    +'<label class="field-label" for="studioSlot">Requirement</label><select id="studioSlot" class="field">'+all.map(o=>'<option value="'+escapeHtml(o.slot)+'">'+(o.match?'★ ':'')+o.label+'</option>').join('')+'</select>'
    +'<div class="site-card-sub" style="margin-top:4px;">★ marks requirements this document type is made for. It\'s submitted for review with its document number, and its review date becomes the expiry date.</div>'
    +'<button class="btn primary block" style="margin-top:12px;" data-action="studio-add-go">Attach and submit</button>');
});
on('studio-add-go', (el)=>{ const slot = val('studioSlot'); if(slot && S.studioLast) attachAndSubmit(slot, S.studioLast.id, el); });

export { reload };
