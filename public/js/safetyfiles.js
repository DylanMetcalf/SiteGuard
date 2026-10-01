// Safety files, contractor side: one place to start or continue a safety file
// (for a site on SiteGuard or for a private client), and to upload a document
// into the company library or straight into a file.
//
// Every safety file belongs to one site or project; company documents are
// filed once and reused, so a new file never duplicates the library.

import {
  S, ICONS, on, actions, openSheet, closeSheet, sheetHead, computeReadiness, effectiveStatus,
  isContractor, isOrgAdmin, readOnly, myContractorId, libraryReqId, LIBRARY_TYPES,
} from './core.js';
import { openGuide } from './guide.js';

const isProject = (s)=>!!(s && s.project);
const files = ()=>Object.values(S.state.sites).filter(s=>s.status!=='invited' && s.status!=='declined');

/** The primary call to action, reused on the dashboard, the Safety files list, Studio and More. */
export function buildButton(cls){
  if(!isContractor() || readOnly()) return '';
  return '<button class="btn primary '+(cls||'')+'" data-action="sfb-start">'+ICONS.passport+' Create safety file</button>';
}

on('sfb-start', ()=>{
  const mine = files();
  const row = (s)=>{
    const r = computeReadiness(s.id);
    return '<button class="menu-row" data-action="sfb-continue" data-site="'+s.id+'"><div class="qa-icon">'+(isProject(s)?ICONS.passport:ICONS.sites)+'</div>'
      +'<div style="flex:1;"><div class="qa-title">'+s.name+'</div><div class="qa-sub">'+(isProject(s)?'Project for '+s.hostName:s.hostName)+' · '+r.percent+'% ready</div></div>'+ICONS.chevron+'</button>';
  };
  const admin = isOrgAdmin() && !readOnly();
  openSheet(sheetHead('Create a safety file', 'Who is it for?')
    +'<div class="card">'
    +(admin ? '<button class="menu-row" data-action="sfb-join"><div class="qa-icon">'+ICONS.link+'</div><div style="flex:1;"><div class="qa-title">A site on SiteGuard</div><div class="qa-sub">The site gave you a code. Its requirements load straight in, and the site sponsors this file.</div></div>'+ICONS.chevron+'</button>'
      +'<button class="menu-row" data-action="sfb-project"><div class="qa-icon">'+ICONS.plus+'</div><div style="flex:1;"><div class="qa-title">A client who isn\'t on SiteGuard</div><div class="qa-sub">Pick the documents they need, file them from your library, send a PDF or a link.</div></div>'+ICONS.chevron+'</button>'
      : '<div class="site-card-sub">Ask an owner or admin of your company to start a new safety file.</div>')
    +'</div>'
    +(mine.length ? '<div class="section-title">Or continue one you\'ve started</div><div class="card">'+mine.map(row).join('')+'</div>' : '')
    +'<div class="site-card-sub" style="margin-top:8px;">Your company documents are filed once and reused in every safety file, so nothing is uploaded twice.</div>');
});
on('sfb-join', ()=>{ closeSheet(); setTimeout(()=>actions['join-site'](), 200); });
on('sfb-project', ()=>{ closeSheet(); setTimeout(()=>actions['new-project'](), 200); });
on('sfb-continue', (el)=>{
  closeSheet();
  S.nav = 'sites'; S.activeSiteId = el.dataset.site; S.siteTab = 'compliance';
  import('./core.js').then(m=>{ m.render(); window.scrollTo(0,0); setTimeout(()=>openGuide(el.dataset.site, false), 250); });
});

/* ---------- Upload a document: into the company library, or straight into a file ---------- */
on('upload-document', ()=>{
  const cid = myContractorId();
  const lib = LIBRARY_TYPES.map(t=>{ const id = libraryReqId(cid, t.id); const st = effectiveStatus(S.state.documents[id]); return '<option value="'+id+'">'+t.name+(st==='complete'||st==='expiring'?' (replace)':'')+'</option>'; }).join('');
  const perFile = files().map(s=>{
    const reqs = (S.state.requirements[s.id]||[]).filter(r=>!r.library);
    if(!reqs.length) return '';
    return '<optgroup label="'+s.name+(isProject(s)?' — '+s.hostName:'')+'">'+reqs.map(r=>{ const st = effectiveStatus(S.state.documents[r.id]); return '<option value="'+r.id+'">'+r.name+(st==='missing'?' · missing':st==='correction_required'?' · sent back':st==='expired'?' · expired':'')+'</option>'; }).join('')+'</optgroup>';
  }).join('');
  openSheet(sheetHead('Upload a document', 'Where does it belong?')
    +'<div class="site-card-sub">Company documents (registration, COID letter, insurance, policies) are kept once and offered to every safety file. Anything else goes into the safety file that asked for it.</div>'
    +'<label class="field-label" for="upTarget">Document</label><select id="upTarget"><optgroup label="Company documents">'+lib+'</optgroup>'+perFile+'</select>'
    +'<button class="btn primary block" style="margin-top:12px;" data-action="upload-document-go">Continue</button>'
    +'<div class="site-card-sub" style="margin-top:8px;">Not in the list? Open a safety file and use “Anything else to add?” in its guide.</div>');
});
on('upload-document-go', ()=>{
  const id = (document.getElementById('upTarget')||{}).value;
  if(!id) return;
  closeSheet();
  setTimeout(()=>actions['open-req']({ dataset: { req: id } }), 200);
});
