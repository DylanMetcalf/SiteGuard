// Safety file guide (contractor side): after joining a site, a step-by-step prompt
// that walks the contractor through everything the site asked for — company
// documents, people, documents SiteGuard writes, uploads, anything extra — so
// nobody has to work out what to do next.

import { api } from './api.js';
import {
  S, ICONS, on, act, showToast, openSheet, closeSheet, sheetHead, reload, val, sheetEl,
  computeReadiness, effectiveStatus, libraryCopyFor, isOrgAdmin, readOnly,
} from './core.js';
import { buildable } from './builder.js';

const NEEDS = ['missing', 'correction_required', 'expired'];

function plan(siteId){
  const reqs = S.state.requirements[siteId] || [];
  const st = (r)=>effectiveStatus(S.state.documents[r.id]);
  const company = reqs.filter(r=>r.library);
  const companyNeeds = company.filter(r=>NEEDS.includes(st(r)));
  // A copy the site sent back isn't offered again in bulk; the contractor fixes it one by one.
  const fromLibrary = companyNeeds.filter(r=>libraryCopyFor(r) && st(r)!=='correction_required');
  const { out, manual } = buildable(siteId);
  const uploads = manual.map(m=>m.req).filter(r=>!r.library);
  const assigned = ((S.state.siteWorkers||{})[siteId] || []).map(id=>(S.state.workers||{})[id]).filter(Boolean);
  const noMedical = assigned.filter(w=>!(w.certificates||[]).some(c=>c.kind==='medical_fitness' && (!c.expiresOn || c.expiresOn >= new Date().toISOString().slice(0,10))));
  const r = computeReadiness(siteId);
  const handedIn = (r.counts.complete||0) + (r.counts.expiring||0) + (r.counts.awaiting_review||0);
  return { reqs, company, companyNeeds, fromLibrary, write: out, uploads, assigned, noMedical, r, handedIn };
}

/** The card on the contractor's site page. */
export function guideCard(siteId){
  const p = plan(siteId);
  if(!p.reqs.length) return '';
  const pct = p.reqs.length ? Math.round(100 * p.handedIn / p.reqs.length) : 0;
  const next = p.fromLibrary.length ? 'Submit '+p.fromLibrary.length+' from your company documents'
    : p.write.length ? 'SiteGuard can write '+p.write.length+' document'+(p.write.length===1?'':'s')+' for you'
    : p.uploads.length ? p.uploads.length+' certificate'+(p.uploads.length===1?'':'s')+' or record'+(p.uploads.length===1?'':'s')+' to upload'
    : pct===100 ? 'Everything is handed in' : 'Keep going';
  return '<div class="card builder-card"><div class="chat-card-title">'+ICONS.sparkle+' Safety file guide</div>'
    +'<div class="site-card-title">'+p.handedIn+' of '+p.reqs.length+' handed in</div>'
    +'<div class="bld-progress" style="margin:8px 0;"><i style="width:'+pct+'%"></i></div>'
    +'<div class="site-card-sub">Next: '+next+'.</div>'
    +'<div class="row-actions" style="margin-top:12px;"><button class="btn primary" data-action="guide-open" data-site="'+siteId+'">'+(p.handedIn ? 'Continue my safety file' : 'Start my safety file')+'</button>'
    +(p.write.length && !readOnly() ? '<button class="btn secondary" data-action="builder-open" data-site="'+siteId+'">'+ICONS.sparkle+' Write '+p.write.length+' document'+(p.write.length===1?'':'s')+' now</button>' : '')+'</div></div>';
}

const step = (n, done, title, sub, body) => '<div class="guide-step'+(done?' done':'')+'"><div class="guide-num">'+(done?ICONS.check:n)+'</div><div class="guide-body"><div class="qa-title">'+title+'</div><div class="site-card-sub">'+sub+'</div>'+(body||'')+'</div></div>';
const reqLink = (r)=>'<button class="guide-link" data-action="open-req" data-req="'+r.id+'">'+r.name+ICONS.chevron+'</button>';

function render(siteId, fresh){
  const site = S.state.sites[siteId];
  const p = plan(siteId);
  const pct = p.reqs.length ? Math.round(100 * p.handedIn / p.reqs.length) : 0;
  const ro = readOnly();
  let html = sheetHead(fresh ? 'You\'ve joined '+site.name : 'Your safety file', fresh ? 'Let\'s build your safety file for this site' : site.name)
    +'<div class="bld-progress" style="margin:6px 0 4px;"><i style="width:'+pct+'%"></i></div>'
    +'<div class="site-card-sub">'+p.handedIn+' of '+p.reqs.length+' handed in'+(p.r.counts.awaiting_review?' · '+p.r.counts.awaiting_review+' with the site for review':'')+(p.r.counts.complete?' · '+p.r.counts.complete+((S.state.sites[siteId]||{}).project?' filed':' approved'):'')+'</div>';

  // 1. Company documents
  const compDone = p.company.length && !p.companyNeeds.length;
  html += step(1, compDone, 'Company documents', p.company.length ? (p.company.length - p.companyNeeds.length)+' of '+p.company.length+' handed in — COID letter, insurance, registration and policies' : 'This site didn\'t ask for company documents.',
    (p.fromLibrary.length && !ro ? '<button class="btn primary small" style="margin-top:8px;" data-action="guide-lib" data-site="'+siteId+'">Submit '+p.fromLibrary.length+' from my company documents</button>' : '')
    + p.companyNeeds.filter(r=>!p.fromLibrary.includes(r)).map(reqLink).join(''));

  // 2. People
  const peopleDone = p.assigned.length && !p.noMedical.length;
  html += step(2, peopleDone, 'Your people on this site', p.assigned.length ? p.assigned.length+' worker'+(p.assigned.length===1?'':'s')+' assigned'+(p.noMedical.length?' · <strong style="color:var(--red);">'+p.noMedical.length+' without a valid medical</strong>':' · all with a valid medical') : 'Add the people who will work here, with their medical certificates, and assign them to the site.',
    ro ? '' : '<div class="row-actions" style="margin-top:8px;"><button class="btn secondary small" data-action="assign-worker" data-site="'+siteId+'">Assign workers</button><button class="btn secondary small" data-action="new-worker">Add a worker</button></div>');

  // 3. Documents SiteGuard writes
  html += step(3, !p.write.length, 'Documents SiteGuard writes for you', p.write.length ? p.write.length+' to write — risk assessments, plans, procedures, appointments and registers, branded and numbered' : 'All written and handed in.',
    p.write.length && !ro ? '<button class="btn primary small" style="margin-top:8px;" data-action="builder-open" data-site="'+siteId+'">Write them now</button>' : '');

  // 4. Uploads
  html += step(4, !p.uploads.length, 'Certificates and records to upload', p.uploads.length ? 'These come from other people (doctors, trainers, testers), so upload a copy of each:' : 'Nothing left to upload.',
    p.uploads.map(reqLink).join(''));

  // 5. Anything else
  html += step(5, false, 'Anything else to add?', 'Add a document the site didn\'t ask for, like a lift plan or traffic management plan. If SiteGuard can write it, it will offer to.',
    ro ? '' : '<input type="text" id="guideOther" list="guideIdeas" maxlength="200" placeholder="e.g. Lift plan for the 50 t crane" style="margin-top:8px;"><datalist id="guideIdeas">'
      + ['Lift plan','Traffic management plan','Hot work procedure','Confined space entry procedure','Fall protection plan','Lock-out / isolation procedure','Toolbox talk record','Organogram and key contacts','Environmental management plan','Emergency response plan'].map(x=>'<option value="'+x+'">').join('')+'</datalist>'
      +'<button class="btn secondary small" style="margin-top:8px;" data-action="guide-add" data-site="'+siteId+'">Add to my safety file</button>');

  // 6. Check and send
  html += step(6, pct===100, 'Check, preview and download', (pct===100 ? 'Everything is handed in.' : 'See exactly what is still outstanding before you download.')+((S.state.sites[siteId]||{}).project ? ' Then send the file to your client.' : ' The site reviews each document and tells you in your inbox if anything needs changing.'),
    '<div class="row-actions" style="margin-top:8px;"><button class="btn primary small" data-action="export-bundle" data-site="'+siteId+'">Check and build the PDF</button><button class="btn secondary small" data-action="guide-missing" data-site="'+siteId+'">See what\'s still missing</button></div>');
  return html;
}

export function openGuide(siteId, fresh){
  openSheet(render(siteId, fresh));
  const s = sheetEl(); if(s){ s.dataset.guide = siteId; s.dataset.fresh = fresh ? '1' : ''; }
}
/** Keep the guide current while it's open (after uploads, the builder, etc.). */
export function refreshGuide(){
  const s = sheetEl();
  if(s && s.dataset.guide && S.state.sites[s.dataset.guide]){ const y = s.scrollTop; s.innerHTML = render(s.dataset.guide, s.dataset.fresh === '1'); s.scrollTop = y; }
}

on('guide-open', (el)=>openGuide(el.dataset.site, false));
on('guide-lib', async (el)=>{
  if(el.disabled) return;
  const p = plan(el.dataset.site);
  el.disabled = true; el.textContent = 'Submitting…';
  let ok = 0, fail = 0;
  for(const r of p.fromLibrary){
    try{
      const a = await api.post('/api/documents/'+encodeURIComponent(r.id)+'/use-library');
      await api.post('/api/documents/'+encodeURIComponent(r.id)+'/submit', { note: a.note, expiryDate: a.expiryDate });
      ok++;
    }catch{ fail++; }
  }
  await reload().catch(()=>{});
  openGuide(el.dataset.site, false);
  showToast(ok+' submitted from your company documents'+(fail?' · '+fail+' couldn\'t be — open them to see why':''));
});
on('guide-add', async (el)=>{
  const name = val('guideOther');
  if(name.length < 2){ showToast('Type the name of the document you want to add'); const i = document.getElementById('guideOther'); if(i) i.focus(); return; }
  const siteId = el.dataset.site;
  const r = await act(()=>api.post('/api/sites/'+siteId+'/my-documents', { name }), null, el);
  if(!r) return;
  await reload().catch(()=>{});
  const req = (S.state.requirements[siteId]||[]).find(x=>x.id===r.id);
  if(req && req.blueprint){
    closeSheet();
    showToast('Added — SiteGuard can write this for you');
    const m = await import('./studio.js');
    setTimeout(()=>m.openStudioForm(req.blueprint, { siteId, reqId: req.id, reqName: req.name }), 250);
  } else {
    openGuide(siteId, false);
    showToast('Added to your safety file — upload it from step 4');
  }
});
on('guide-missing', (el)=>{
  closeSheet();
  S.nav = 'passport'; S.passportFilter = 'missing'; S.search = S.search || {}; S.search.mydocs = S.state.sites[el.dataset.site] ? S.state.sites[el.dataset.site].name.replace(/&amp;/g,'&') : '';
  import('./core.js').then(m=>{ m.render(); window.scrollTo(0,0); });
});
on('guide-pdf', (el)=>{ showToast('Preparing your safety file — the download starts in a moment'); window.location.href = '/api/sites/'+encodeURIComponent(el.dataset.site)+'/safety-file.pdf'; });

export const canJoin = () => isOrgAdmin() && !readOnly();
