// Safety File Builder: writes every document a site still needs in one go.
// The contractor picks the documents, answers the shared questions once, and
// SiteGuard creates each one (numbered and branded), then submits them all.
// Each document is created independently, so one failure never loses the rest.

import { api } from './api.js';
import { S, ICONS, escapeHtml, unescapeHtml, on, openSheet, sheetHead, showToast, render, reload, effectiveStatus, sheetEl, libraryCopyFor } from './core.js';
import { loadCatalogPublic } from './studio.js';

const NEEDS = ['missing', 'correction_required', 'expired'];

/** Requirements on a site that Document Studio can write and that still need a document. */
export function buildable(siteId){
  const reqs = (S.state.requirements[siteId] || []);
  const out = [], manual = [], fromLibrary = [];
  for(const r of reqs){
    const eff = effectiveStatus(S.state.documents[r.id]);
    if(!NEEDS.includes(eff)) continue;
    if(libraryCopyFor(r) && eff!=='correction_required') fromLibrary.push({ req: r, eff });
    else if(r.blueprint) out.push({ req: r, eff });
    else manual.push({ req: r, eff });
  }
  return { out, manual, fromLibrary };
}

/** The card on the contractor's site screen. */
export function builderCard(siteId){
  const { out, manual, fromLibrary } = buildable(siteId);
  if(!out.length && !fromLibrary.length) return '';
  const total = out.length + manual.length + fromLibrary.length;
  return '<div class="card builder-card"><div class="chat-card-title">'+ICONS.sparkle+' Safety File Builder</div>'
    +'<div class="site-card-title">'+(out.length ? 'SiteGuard can write '+out.length+(fromLibrary.length ? ' and fill '+fromLibrary.length+' from your company documents —' : ' of the')+' '+total+' documents this site still needs' : fromLibrary.length+' of the '+total+' documents this site needs are already in your company documents')+'</div>'
    +'<div class="site-card-sub">Answer a few questions once and get a complete, branded document for each — then submit them all for review.</div>'
    +'<button class="btn primary" style="margin-top:12px;" data-action="builder-open" data-site="'+siteId+'">Build my safety file</button></div>';
}

const GROUPS = [
  ['About the job', ['scope', 'steps', 'duration', 'workforce', 'equipment', 'frequency']],
  ['People', ['supervisor', 'safetyOfficer', 'ceo', 'team', 'firstAider', 'presenter', 'appointmentType', 'appointee', 'appointeeId', 'appointedBy', 'startDate', 'contractorSignatory', 'clientSignatory', 'client']],
];

function fieldHtml(f, value){
  const id = 'bf_'+(f.key||f.id), v = escapeHtml(value || '');
  const ph = f.placeholder ? ' placeholder="'+escapeHtml(f.placeholder)+'"' : '';
  const label = '<label class="field-label" for="'+id+'">'+escapeHtml(f.label.replace(/ \(optional\)$/i,''))+(f.required?'':' <span class="muted" style="font-weight:400;">(optional)</span>')+'</label>';
  if(f.type==='textarea' || f.type==='lines') return label+'<textarea id="'+id+'" rows="'+(f.type==='lines'?3:3)+'"'+ph+'>'+v+'</textarea>';
  if(f.type==='select') return label+'<select id="'+id+'" class="field">'+f.options.map(o=>'<option'+(o===value?' selected':'')+'>'+escapeHtml(o)+'</option>').join('')+'</select>';
  return label+'<input type="'+(f.type==='date'?'date':'text')+'" id="'+id+'" value="'+v+'"'+ph+'>';
}

function stepPick(b){
  const { out, manual, fromLibrary } = buildable(b.siteId);
  const site = S.state.sites[b.siteId];
  return sheetHead('Build my safety file', site.name)
    +'<div class="builder-steps"><span class="on">1 Documents</span><span>2 Questions</span><span>3 Create</span></div>'
    +'<div class="site-card-sub">Tick the documents to write. Each gets its own number, your logo and a sign-off block.</div>'
    +(out.length ? '' : '<div class="notice" style="margin-top:10px;">Nothing here needs writing — just submit what you already have.</div>')
    +(out.length ? '<div class="card" style="margin-top:10px;">'+out.map(({ req, eff })=>'<label class="toggle-row"><span><span class="qa-title" style="font-size:14px;">'+req.name+'</span><span class="site-card-sub" style="display:block;">'+(eff==='correction_required'?'Sent back for correction — write a fresh version':eff==='expired'?'Expired — write a current version':'Not submitted yet')+'</span></span><input type="checkbox" class="bld-pick" value="'+req.id+'" checked></label>').join('')+'</div>' : '')
    +(fromLibrary.length ? '<div class="section-title">Already in your company documents</div><div class="card">'+fromLibrary.map(({ req })=>{ const l = libraryCopyFor(req); return '<label class="toggle-row"><span><span class="qa-title" style="font-size:14px;">'+req.name+'</span><span class="site-card-sub" style="display:block;">Your current copy'+(l.doc.expiryDate?', valid until '+l.doc.expiryDate:'')+' — submitted with the rest</span></span><input type="checkbox" class="bld-lib" value="'+req.id+'" checked></label>'; }).join('')+'</div>' : '')
    +(manual.length?'<details class="builder-manual"><summary>'+manual.length+' document'+(manual.length===1?'':'s')+' you\'ll still need to upload</summary><div class="site-card-sub">These are certificates and records from third parties (for example your COID letter or insurance), so they can\'t be written for you:</div><ul>'+manual.map(m=>'<li>'+m.req.name+'</li>').join('')+'</ul></details>':'')
    +'<button class="btn primary block" style="margin-top:14px;" data-action="builder-next">'+(out.length ? 'Next: a few questions' : 'Submit them now')+'</button>';
}

/** A pick-list answer the requirement's own name already gives, e.g. "Harness and lanyard inspection register" → "Harness and lanyards". */
function presetFor(f, reqName){
  if(f.id!=='equipment' || f.type!=='select' || !f.options) return null;
  const name = reqName.toLowerCase();
  const hits = f.options.filter(o=>name.includes(o.toLowerCase().split(/\s+/)[0]));
  return hits.length===1 ? hits[0] : null;
}

function stepQuestions(b){
  // Questions shared by several documents are asked once. Two cases are kept apart:
  // a pick-list the requirement's own name already answers (e.g. "Scaffolding inspection
  // register" → Scaffolding) is filled in per document, and a question whose name clashes
  // with a different kind of question in another document is asked separately.
  const byId = new Map();
  const sig = (f)=>f.type+'|'+(f.options||[]).join('|');
  b.keyMap = {};
  for(const it of b.items){
    const bp = b.catalog.blueprints.find(x=>x.id===it.blueprint);
    it.presets = {};
    for(const f of bp.fields){
      if(f.id==='site') continue;
      const preset = presetFor(f, unescapeHtml(it.name));
      if(preset){ it.presets[f.id] = preset; continue; }
      let key = f.id;
      const cur = byId.get(key);
      if(cur && cur.sig!==sig(f)){ key = bp.id+'__'+f.id; }
      b.keyMap[bp.id+':'+f.id] = key;
      const existing = byId.get(key);
      byId.set(key, existing ? { ...existing, required: existing.required || f.required }
        : { ...f, key, sig: sig(f), label: key===f.id ? f.label : f.label+' — '+bp.name });
    }
  }
  const all = [...byId.values()];
  const grouped = GROUPS.map(([title, ids])=>[title, all.filter(f=>ids.includes(f.id))]);
  const other = all.filter(f=>!GROUPS.some(([, ids])=>ids.includes(f.id)));
  if(other.length) grouped.push(['Anything else', other]);
  b.fields = grouped.flatMap(([, fs])=>fs); // display order, so a missing answer points at the first one on screen
  return sheetHead('Build my safety file', S.state.sites[b.siteId].name)
    +'<div class="builder-steps"><span class="done">1 Documents</span><span class="on">2 Questions</span><span>3 Create</span></div>'
    +'<div class="site-card-sub">Answered once, used in all '+b.items.length+' documents. The site\'s name and client are filled in for you, and its emergency details when the site has added them.</div>'
    + grouped.filter(([, fs])=>fs.length).map(([title, fs])=>'<div class="section-title">'+title+'</div>'+fs.map(f=>fieldHtml(f, b.values[f.key])).join('')).join('')
    +(S.boot.features.ai?'<label class="toggle-row" style="border:none;margin-top:10px;"><span>Research the site\'s published requirements<br><span class="site-card-sub">Uses web search for each document; slower</span></span><input type="checkbox" id="bf_research"></label>':'')
    +'<div class="row-actions" style="margin-top:14px;"><button class="btn secondary" data-action="builder-back">Back</button><button class="btn primary" style="flex:1;" data-action="builder-go">Create '+b.items.length+' document'+(b.items.length===1?'':'s')+'</button></div>';
}

function stepRun(b){
  const done = b.items.filter(i=>i.state==='done').length;
  const failed = b.items.filter(i=>i.state==='failed').length;
  const running = b.items.some(i=>i.state==='writing' || i.state==='waiting') && b.running;
  const submitted = b.items.filter(i=>i.submitted).length;
  const icon = { waiting:'<span class="bld-dot"></span>', writing:'<span class="bld-spin" aria-label="Writing"></span>', done:ICONS.check, failed:ICONS.alert };
  return sheetHead('Build my safety file', S.state.sites[b.siteId].name)
    +'<div class="builder-steps"><span class="done">1 Documents</span><span class="done">2 Questions</span><span class="on">3 Create</span></div>'
    +'<div class="bld-progress"><i style="width:'+Math.round(done/b.items.length*100)+'%"></i></div>'
    +'<div class="site-card-sub" aria-live="polite">'+(running ? 'Writing '+(done+1)+' of '+b.items.length+'… you can keep this open or come back later.' : done+' of '+b.items.length+' ready'+(failed?' · '+failed+' failed':'')+(submitted?' · '+submitted+' submitted':''))+'</div>'
    +'<div class="card" style="margin-top:10px;">'+b.items.map((it, i)=>'<div class="reqrow"><div class="bld-state '+it.state+'">'+icon[it.state]+'</div><div class="reqrow-main"><div class="reqrow-name">'+it.name+'</div>'
      +'<div class="reqrow-meta">'+(it.result?'<span class="srctag">'+escapeHtml(it.result.docNumber)+'</span>':'')+(it.submitted?'<span class="badge awaiting_review">Submitted</span>':'')+(it.error?'<span class="site-card-sub" style="color:var(--red);">'+escapeHtml(it.error)+'</span>':'')+'</div></div>'
      +(it.state==='done'?'<button class="btn secondary small" data-action="open-review" data-id="'+it.result.id+'">Read</button>':'')
      +(it.state==='failed'?'<button class="btn secondary small" data-action="builder-retry" data-i="'+i+'">Retry</button>':'')+'</div>').join('')+'</div>'
    +(!running && done ? '<div class="site-card-sub" style="margin-top:10px;">Read each document before submitting: check the details and sign the approval block. You can edit any section in the app.</div>'
      +(done > submitted ? '<label class="toggle-row" style="border:none;margin-top:10px;"><span>I have read these documents; they are correct for this site and signed where needed</span><input type="checkbox" id="bldConfirm"></label>'+'<button class="btn primary block" style="margin-top:12px;" data-action="builder-submit">Submit '+(done-submitted)+' for review</button>' : '<div class="notice" style="margin-top:12px;background:var(--green-bg);color:var(--green);">All created documents are submitted. The site has been notified.</div>')
      +'<button class="btn secondary block" style="margin-top:8px;" data-action="builder-close">Close</button>' : '');
}

/** Redraws the builder if it is on screen; `open` brings it back after the user closed it. */
function show(open){
  const b = S.builder; if(!b) return;
  const sheet = sheetEl();
  const onScreen = sheet && sheet.dataset.builder==='1';
  if(!onScreen && !open) return; // closed while writing: keep working quietly, the toast says when it's done
  const html = b.step===1 ? stepPick(b) : b.step===2 ? stepQuestions(b) : stepRun(b);
  if(onScreen){ sheet.innerHTML = html; }
  else { openSheet(html); const s = sheetEl(); if(s) s.dataset.builder = '1'; }
}

// Keep answers as they are typed, so closing the sheet by accident loses nothing.
document.addEventListener('input', (e)=>{
  const t = e.target, b = S.builder;
  if(b && t && t.id && t.id.startsWith('bf_') && t.id!=='bf_research') b.values[t.id.slice(3)] = t.value;
});

on('builder-open', async (el)=>{
  const siteId = el.dataset.site;
  if(S.builder && S.builder.siteId===siteId && S.builder.step>1){ show(true); return; }
  let catalog;
  try{ catalog = await loadCatalogPublic(); }catch(e){ showToast(e.message); return; }
  const me = S.boot.me;
  S.builder = { siteId, step:1, catalog, items:[], values: { ceo: '', appointedBy: unescapeHtml(me.name)+(me.title?', '+unescapeHtml(me.title):''), supervisor: '', presenter: unescapeHtml(me.name) }, running:false };
  show(true);
});
on('builder-next', ()=>{
  const b = S.builder;
  const ids = [...document.querySelectorAll('.bld-pick:checked')].map(x=>x.value);
  b.library = [...document.querySelectorAll('.bld-lib:checked')].map(x=>x.value);
  if(!ids.length && !b.library.length){ showToast('Tick at least one document'); return; }
  const reqs = S.state.requirements[b.siteId];
  if(!ids.length){ submitLibrary(b).then((n)=>{ showToast(n+' submitted from your company documents'); S.builder = null; import('./core.js').then(m=>m.closeSheet()); }); return; }
  b.items = ids.map(id=>{ const r = reqs.find(x=>x.id===id); return { reqId:id, name:r.name, blueprint:r.blueprint, state:'waiting' }; });
  b.step = 2; show();
});
function readValues(b){
  for(const f of b.fields){ const el = document.getElementById('bf_'+f.key); if(el) b.values[f.key] = el.value.trim(); }
}
on('builder-back', ()=>{ const b = S.builder; readValues(b); b.step = 1; show(); });
on('builder-go', ()=>{
  const b = S.builder; readValues(b);
  const missing = b.fields.find(f=>f.required && !b.values[f.key]);
  if(missing){ showToast(missing.label.replace(/ \(optional\)$/i,'')+' is needed for at least one document'); const el = document.getElementById('bf_'+missing.key); if(el) el.focus(); return; }
  if(!b.values.contractorSignatory && b.values.ceo) b.values.contractorSignatory = b.values.ceo;
  b.research = !!(document.getElementById('bf_research') || {}).checked;
  b.step = 3; run();
});
on('builder-retry', (el)=>{ const b = S.builder; const it = b.items[Number(el.dataset.i)]; it.state = 'waiting'; it.error = ''; run(); });
on('builder-close', ()=>{ S.builder = null; import('./core.js').then(m=>m.closeSheet()); });

async function run(){
  const b = S.builder; if(!b || b.running) return;
  b.running = true; show();
  for(const it of b.items){
    if(it.state!=='waiting') continue;
    it.state = 'writing'; show();
    const bp = b.catalog.blueprints.find(x=>x.id===it.blueprint);
    const values = {};
    for(const f of bp.fields){
      const v = (it.presets||{})[f.id] || b.values[(b.keyMap||{})[bp.id+':'+f.id] || f.id];
      if(v) values[f.id] = v;
    }
    const body = { blueprintId: it.blueprint, siteId: b.siteId, requirementId: it.reqId, values, research: b.research };
    try{
      try{ it.result = await api.post('/api/studio/documents', body); }
      catch(e){
        if(e.status!==429) throw e;
        await new Promise(r=>setTimeout(r, 30000)); // wait out the per-minute limit once, then carry on
        it.result = await api.post('/api/studio/documents', body);
      }
      it.state = 'done';
    }catch(e){ it.state = 'failed'; it.error = e.message; }
    if(S.builder !== b) return;
    show();
  }
  b.running = false; show();
  const done = b.items.filter(i=>i.state==='done').length;
  showToast(done+' document'+(done===1?'':'s')+' ready to read and submit');
}

/** Submits the ticked company documents (once); returns how many went through. */
async function submitLibrary(b){
  let n = 0;
  for(const reqId of (b.library||[])){
    try{
      const a = await api.post('/api/documents/'+encodeURIComponent(reqId)+'/use-library');
      await api.post('/api/documents/'+encodeURIComponent(reqId)+'/submit', { note: a.note, expiryDate: a.expiryDate });
      n++;
    }catch{ /* shown as still missing on the site */ }
  }
  b.library = [];
  await reload().catch(()=>{});
  return n;
}
on('builder-submit', async (el)=>{
  const b = S.builder; if(!b || el.disabled) return;
  const c = document.getElementById('bldConfirm');
  if(c && !c.checked){ showToast('Read each document first, then tick the box to confirm'); c.focus(); return; }
  el.disabled = true; el.textContent = 'Submitting…';
  let ok = await submitLibrary(b), fail = 0;
  for(const it of b.items){
    if(it.state!=='done' || it.submitted) continue;
    try{
      const a = await api.post('/api/documents/'+encodeURIComponent(it.reqId)+'/attach-generated', { generatedId: it.result.id });
      await api.post('/api/documents/'+encodeURIComponent(it.reqId)+'/submit', { note: a.note, expiryDate: a.reviewDue });
      it.submitted = true; ok++;
    }catch(e){ it.error = e.message; fail++; }
  }
  await reload().catch(()=>{});
  show();
  showToast(ok+' submitted for review'+(fail?' · '+fail+' couldn\'t be submitted':''));
});
