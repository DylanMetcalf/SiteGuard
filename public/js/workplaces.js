// Sites that many contractors join with one site code (mine side).
// The mine sets the site's safety file requirements once and shares the code;
// every contractor that joins gets its own file for the site. This page shows
// them grouped by trade, one review queue for everything waiting on the mine,
// and the site's requirements.

import { api } from './api.js';
import {
  S, ICONS, SOURCE_LABEL, on, act, render, showToast, openSheet, closeSheet, sheetHead, escapeHtml, unescapeHtml, val,
  isOrgAdmin, readOnly, computeReadiness, effectiveStatus, badge, initials, searchBox, matchSearch, searching,
} from './core.js';
import { loadPacks, packPicker, checkedPacks, PACK_NOTE, openNewSite } from './sheets.js';

const W = () => S.state.workplaces || {};
/** Each contractor's file for this site (one per contractor). */
export const filesOf = (wid) => Object.values(S.state.sites).filter(s=>s.workplaceId===wid);

function stats(wid){
  const files = filesOf(wid);
  let review = 0, outstanding = 0, ready = 0;
  files.forEach(f=>{
    const r = computeReadiness(f.id);
    review += r.counts.awaiting_review || 0;
    outstanding += (r.counts.missing||0) + (r.counts.expired||0) + (r.counts.correction_required||0);
    if(f.status==='site_ready') ready++;
  });
  return { files, review, outstanding, ready };
}

/** The mine's list of shared sites, for the Sites tab. */
export function workplaceCards(){
  const ws = Object.values(W()).filter(w=>matchSearch('sites', w.name, w.location));
  if(!ws.length) return '';
  return ws.map(w=>{
    const st = stats(w.id);
    return '<div class="card site-card wp-card" data-action="open-workplace" data-id="'+w.id+'" role="button" tabindex="0">'
      +'<div class="flexbetween" style="align-items:flex-start;"><div><div class="site-card-title">'+w.name+'</div><div class="site-card-sub">'+(w.location||'No location set')+'</div></div>'
      +(w.code?'<span class="wp-code-pill mono">'+w.code+'</span>':'')+'</div>'
      +'<div class="wp-mini-stats"><span><b>'+st.files.length+'</b> contractor'+(st.files.length===1?'':'s')+'</span>'
      +'<span class="'+(st.review?'hot':'')+'"><b>'+st.review+'</b> to review</span><span><b>'+st.outstanding+'</b> outstanding</span><span><b>'+st.ready+'</b> Site Ready</span></div>'
      +'</div>';
  }).join('');
}

/* ---------- The site page ---------- */
export function renderWorkplace(wid){
  const w = W()[wid];
  const st = stats(wid);
  const tab = S.wpTab || 'contractors';
  const admin = isOrgAdmin() && !readOnly();
  let html = '<div style="margin-bottom:14px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;"><button class="btn secondary small" data-action="back-sites">← Sites</button>'
    +(admin?'<button class="btn secondary small" data-action="wp-edit" data-id="'+wid+'">Edit site</button>':'')+'</div>'
    +'<div class="view-head"><h1>'+w.name+'</h1><p>'+[w.location, st.files.length+' contractor'+(st.files.length===1?'':'s')].filter(Boolean).join(' · ')+'</p></div>';
  if(w.code) html += '<div class="card wp-code-card"><div><div class="hero-eyebrow" style="color:var(--grey);">Site code</div>'
      +'<div class="wp-code mono" aria-label="Site code">'+w.code+'</div>'
      +'<div class="site-card-sub">'+(w.joinOpen ? 'Give this to every contractor working here. They type it in SiteGuard under <strong>Join a site with a code</strong> and their safety file for this site starts straight away.' : '<strong style="color:var(--red);">Closed</strong> — contractors can\'t join with this code until you open it again.')+'</div></div>'
      +'<div class="row-actions"><button class="btn primary small" data-action="wp-share" data-id="'+wid+'">Share code</button><button class="btn secondary small" data-action="wp-copy" data-id="'+wid+'">Copy</button>'
      +(admin?'<button class="btn secondary small" data-action="wp-open" data-id="'+wid+'" data-open="'+(w.joinOpen?'0':'1')+'">'+(w.joinOpen?'Close to new contractors':'Open to contractors')+'</button><button class="btn secondary small" data-action="wp-newcode" data-id="'+wid+'">New code</button>':'')+'</div></div>';
  html += '<div class="attn-grid" style="margin:12px 0;">'
    +'<div class="attn-card blue" data-action="wp-tab" data-tab="contractors" style="cursor:pointer;"><div class="attn-num">'+st.files.length+'</div><div class="attn-label">Contractors</div></div>'
    +'<div class="attn-card '+(st.review?'amber':'blue')+'" data-action="wp-tab" data-tab="queue" style="cursor:pointer;"><div class="attn-num">'+st.review+'</div><div class="attn-label">Waiting for your review</div></div>'
    +'<div class="attn-card red" data-action="wp-tab" data-tab="contractors" style="cursor:pointer;"><div class="attn-num">'+st.outstanding+'</div><div class="attn-label">Documents outstanding</div></div>'
    +'<div class="attn-card green" style="background:var(--green-bg);"><div class="attn-num" style="color:var(--green);">'+st.ready+'</div><div class="attn-label">Site Ready</div></div></div>';
  html += '<div class="subtabs" role="tablist">'+[['contractors','Contractors'],['queue','Review queue'+(st.review?' ('+st.review+')':'')],['requirements','Requirements ('+w.requirements.length+')']]
    .map(([t,l])=>'<button role="tab" data-action="wp-tab" data-tab="'+t+'" class="'+(tab===t?'active':'')+'" aria-selected="'+(tab===t)+'">'+l+'</button>').join('')+'</div>';
  if(tab==='queue') return html + queueHtml(st.files);
  if(tab==='requirements') return html + requirementsHtml(w, admin);
  return html + contractorsHtml(w, st.files);
}

function contractorsHtml(w, files){
  if(!files.length) return '<div class="empty"><h3>No contractors yet</h3><p>Share the site code above. Each contractor that joins appears here with its own safety file, grouped by trade.</p></div>';
  const rows = files.map(f=>{ const c = S.state.contractors[f.contractorId] || { name:'Contractor' }; const r = computeReadiness(f.id); return { f, c, r, trade: (c.trade||'').trim() || 'Trade not set' }; })
    .filter(x=>matchSearch('wp', x.c.name, x.c.trade, x.c.reg, x.c.contact));
  const trades = [...new Set(rows.map(x=>x.trade))].sort((a,b)=>a.localeCompare(b));
  const tf = trades.includes(S.wpTrade) ? S.wpTrade : '';
  let html = searchBox('wp', 'Search contractors on this site')
    + (trades.length > 1 ? '<div class="filter-chips"><button class="site-picker-chip'+(tf?'':' active')+'" data-action="wp-trade" data-trade="">All trades<b>'+rows.length+'</b></button>'+trades.map(t=>'<button class="site-picker-chip'+(tf===t?' active':'')+'" data-action="wp-trade" data-trade="'+t+'">'+t+'<b>'+rows.filter(x=>x.trade===t).length+'</b></button>').join('')+'</div>' : '');
  if(!rows.length) return html + '<div class="list-empty">No contractor matches “'+escapeHtml(S.search.wp)+'”.</div>';
  (tf ? [tf] : trades).forEach(t=>{
    const group = rows.filter(x=>x.trade===t).sort((a,b)=>(b.r.counts.awaiting_review||0)-(a.r.counts.awaiting_review||0) || unescapeHtml(a.c.name).localeCompare(unescapeHtml(b.c.name)));
    html += '<div class="section-title">'+t+' · '+group.length+'</div><div class="card">'+group.map(({ f, c, r })=>{
      const pct = f.status==='site_ready' ? 100 : r.percent;
      const out = (r.counts.missing||0)+(r.counts.expired||0)+(r.counts.correction_required||0);
      return '<div class="reqrow" data-action="open-site" data-site="'+f.id+'" role="button" tabindex="0" style="cursor:pointer;"><div class="avatar-sq">'+initials(unescapeHtml(c.name))+'</div>'
        +'<div class="reqrow-main"><div class="reqrow-name">'+c.name+'</div><div class="reqrow-meta">'
        +(f.status==='site_ready'?'<span class="badge complete">Site Ready</span>':'<span class="badge grey">'+pct+'% complete</span>')
        +(r.counts.awaiting_review?'<span class="badge awaiting_review">'+r.counts.awaiting_review+' to review</span>':'')
        +(out?'<span class="badge missing">'+out+' outstanding</span>':'')+'</div></div><div class="reqrow-chevron">'+ICONS.chevron+'</div></div>';
    }).join('')+'</div>';
  });
  return html;
}

function queueHtml(files){
  const groups = files.map(f=>{
    const c = S.state.contractors[f.contractorId] || { name:'Contractor' };
    const items = (S.state.requirements[f.id]||[]).filter(r=>effectiveStatus(S.state.documents[r.id])==='awaiting_review');
    return { f, c, items };
  }).filter(g=>g.items.length);
  if(!groups.length) return '<div class="empty"><h3>Nothing waiting</h3><p>Documents contractors submit for this site appear here, so you can vet them one after another.</p></div>';
  return '<div class="site-card-sub" style="margin:4px 2px 10px;">Tap a document to read it and approve it or send it back. Documents written in SiteGuard open section by section, so you can approve each part and highlight what needs changing.</div>'
    + groups.map(({ f, c, items })=>'<div class="section-title">'+c.name+' · '+items.length+'</div><div class="card">'+items.map(r=>{
      const d = S.state.documents[r.id]||{};
      return '<div class="reqrow" data-action="'+(d.studioDocId?'open-review':'open-req')+'" '+(d.studioDocId?'data-id="'+d.studioDocId+'"':'data-req="'+r.id+'"')+' role="button" tabindex="0" style="cursor:pointer;"><div class="reqrow-main"><div class="reqrow-name">'+r.name+'</div>'
        +'<div class="reqrow-meta">'+badge('awaiting_review')+'<span class="srctag">'+r.category+'</span>'+(d.version?'<span class="srctag">'+d.version+'</span>':'')+(d.studioDocId?'<span class="srctag">Written in SiteGuard</span>':'')+'</div></div><div class="reqrow-chevron">'+ICONS.chevron+'</div></div>';
    }).join('')+'</div>').join('');
}

function requirementsHtml(w, admin){
  let html = '<div class="site-card-sub" style="margin:4px 2px 10px;">Every contractor on this site must meet these. New requirements are added to every contractor\'s file straight away.</div>';
  if(admin) html += '<div class="row-actions" style="margin-bottom:10px;"><button class="btn primary small" data-action="wp-add-list" data-id="'+w.id+'">Add from a list</button><button class="btn secondary small" data-action="wp-add-own" data-id="'+w.id+'">Add your own</button></div>';
  if(!w.requirements.length) return html + '<div class="empty"><h3>No requirements yet</h3><p>Add the general safety file list, or your own items.</p></div>';
  const cats = [...new Set(w.requirements.map(r=>r.category))];
  cats.forEach(cat=>{
    html += '<div class="section-title">'+cat+'</div><div class="card">'+w.requirements.filter(r=>r.category===cat).map(r=>'<div class="reqrow"><div class="reqrow-main"><div class="reqrow-name">'+r.name+'</div>'
      +'<div class="reqrow-meta"><span class="srctag">'+(SOURCE_LABEL[r.source]||r.source)+'</span></div>'+(r.why?'<div class="site-card-sub" style="margin-top:3px;">'+r.why+'</div>':'')+'</div>'
      +(admin?'<button class="btn secondary small" data-action="wp-remove" data-id="'+w.id+'" data-name="'+r.name+'" aria-label="Remove '+r.name+'">Remove</button>':'')+'</div>').join('')+'</div>';
  });
  return html;
}

/* ---------- Create ---------- */
export async function openNewWorkplace(prefill){
  let packs;
  try{ packs = await loadPacks(); }catch(e){ showToast(e.message); return; }
  const pf = prefill || {};
  S.newSiteExtras = pf.extraRequirements || [];
  const extras = S.newSiteExtras;
  openSheet(sheetHead('Add a site', pf.fromAssistant ? 'Prepared by the assistant — check everything before creating' : 'Contractors join it with a site code')
    +'<label class="field-label" for="wpName">Site name</label><input type="text" id="wpName" value="'+escapeHtml(pf.name||'')+'" placeholder="e.g. Kathu Mine — Plant 2">'
    +'<label class="field-label" for="wpLocation">Location</label><input type="text" id="wpLocation" value="'+escapeHtml(pf.location||'')+'" placeholder="e.g. Kathu, Northern Cape">'
    +'<div class="section-title">What must every contractor\'s safety file contain?</div>'
    +'<div class="site-card-sub" style="margin-bottom:8px;">Tick a general safety file and any add-ons for the work done here. You can add your own items and change the list at any time.</div>'
    + packPicker(packs, pf.packIds || ['general-mine'], []) + PACK_NOTE
    +(extras.length?'<div class="section-title">Also suggested</div><div class="card">'+extras.map((x,i)=>'<label class="toggle-row"><span>'+escapeHtml(x.name)+'<span class="site-card-sub" style="display:block;">'+escapeHtml(x.why||'')+'</span></span><input type="checkbox" class="extra-req-box" value="'+i+'" checked></label>').join('')+'</div>':'')
    +'<details style="margin-top:10px;"><summary class="site-card-sub" style="cursor:pointer;font-weight:600;">Emergency information (shown to every contractor)</summary>'
      +'<label class="field-label" for="wpMuster">Muster point</label><input type="text" id="wpMuster" placeholder="e.g. Muster point B, main gate">'
      +'<label class="field-label" for="wpContact">Emergency number</label><input type="text" id="wpContact" placeholder="e.g. Control room 053 000 0000">'
      +'<label class="field-label" for="wpHospital">Nearest medical facility</label><input type="text" id="wpHospital" placeholder="e.g. Kathu Hospital"></details>'
    +'<button class="btn primary block" style="margin-top:14px;" data-action="save-workplace">Create site and get its code</button>'
    +'<button class="linkish" style="margin-top:12px;display:block;" data-action="new-site-single">Or invite one contractor by email for a single job</button>');
}
on('new-site-single', ()=>{ closeSheet(); setTimeout(()=>openNewSite({ single:true }), 250); });
on('save-workplace', async (el)=>{
  const name = val('wpName');
  if(!name){ showToast('Give the site a name'); document.getElementById('wpName').focus(); return; }
  const extras = [...document.querySelectorAll('.extra-req-box:checked')].map(b=>(S.newSiteExtras||[])[Number(b.value)]).filter(Boolean)
    .map(x=>({ category:x.category, name:x.name, source:x.source||'site', why:x.why||'' }));
  const packIds = checkedPacks();
  if(!packIds.length && !extras.length && !confirm('No requirements ticked. Create the site with an empty list and add requirements later?')) return;
  const r = await act(()=>api.post('/api/workplaces', { name, location: val('wpLocation'), packIds, requirements: extras, emergency: { musterPoint: val('wpMuster'), contact: val('wpContact'), hospital: val('wpHospital') } }), null, el);
  if(!r) return;
  closeSheet();
  S.nav = 'sites'; S.activeSiteId = null; S.activeWorkplaceId = r.id; S.wpTab = 'contractors'; render(); window.scrollTo(0,0);
  showToast('Site created with '+r.requirements+' requirements — share the code with your contractors');
});

/* ---------- Actions ---------- */
on('open-workplace', (el)=>{ S.nav='sites'; S.activeSiteId=null; S.activeWorkplaceId = el.dataset.id; S.wpTab='contractors'; render(); window.scrollTo(0,0); });
on('wp-tab', (el)=>{ S.wpTab = el.dataset.tab; render(); });
on('wp-trade', (el)=>{ S.wpTrade = el.dataset.trade; S.keepScroll = true; render(); S.keepScroll = false; });
const shareText = (w)=>'Join '+unescapeHtml(w.name)+' on SiteGuard: open '+location.origin+' , sign in as your contractor company and tap "Join a site with a code". Site code: '+w.code;
on('wp-copy', async (el)=>{ const w = W()[el.dataset.id]; try{ await navigator.clipboard.writeText(w.code); showToast('Site code copied'); }catch{ showToast('Site code: '+w.code); } });
on('wp-share', async (el)=>{
  const w = W()[el.dataset.id];
  if(navigator.share){ try{ await navigator.share({ title:'Join '+unescapeHtml(w.name), text: shareText(w) }); return; }catch{ /* cancelled */ } }
  try{ await navigator.clipboard.writeText(shareText(w)); showToast('Invitation text copied — paste it into WhatsApp or an email'); }catch{ showToast(shareText(w)); }
});
on('wp-newcode', async (el)=>{
  if(!confirm('Make a new site code? The current code stops working straight away; contractors already on the site are not affected.')) return;
  await act(()=>api.post('/api/workplaces/'+el.dataset.id+'/code'), 'New site code ready', el);
});
on('wp-open', async (el)=>{ await act(()=>api.patch('/api/workplaces/'+el.dataset.id, { joinOpen: el.dataset.open==='1' }), el.dataset.open==='1' ? 'Open to contractors again' : 'Closed to new contractors', el); });
on('wp-edit', (el)=>{
  const w = W()[el.dataset.id], e = w.emergency || {};
  openSheet(sheetHead('Edit site', 'Changes show in every contractor\'s file')
    +'<label class="field-label" for="weName">Name</label><input type="text" id="weName" value="'+w.name+'">'
    +'<label class="field-label" for="weLocation">Location</label><input type="text" id="weLocation" value="'+w.location+'">'
    +'<div class="section-title">Emergency information</div>'
    +'<label class="field-label" for="weMuster">Muster point</label><input type="text" id="weMuster" value="'+(e.musterPoint||'')+'">'
    +'<label class="field-label" for="weContact">Emergency number</label><input type="text" id="weContact" value="'+(e.contact||'')+'">'
    +'<label class="field-label" for="weHospital">Nearest medical facility</label><input type="text" id="weHospital" value="'+(e.hospital||'')+'">'
    +'<button class="btn primary block" style="margin-top:12px;" data-action="wp-save-edit" data-id="'+w.id+'">Save</button>');
});
on('wp-save-edit', async (el)=>{
  if(!val('weName')){ document.getElementById('weName').focus(); return; }
  if(await act(()=>api.patch('/api/workplaces/'+el.dataset.id, { name: val('weName'), location: val('weLocation'), emergency: { musterPoint: val('weMuster'), contact: val('weContact'), hospital: val('weHospital') } }), 'Site updated', el)) closeSheet();
});
on('wp-add-list', async (el)=>{
  let packs; try{ packs = await loadPacks(); }catch(e){ showToast(e.message); return; }
  const w = W()[el.dataset.id];
  openSheet(sheetHead('Add requirements', w.name) + packPicker(packs, [], w.requirements.map(r=>r.name)) + PACK_NOTE
    +'<button class="btn primary block" style="margin-top:12px;" data-action="wp-save-list" data-id="'+w.id+'">Add to the site</button>');
});
on('wp-save-list', async (el)=>{
  const packIds = checkedPacks();
  if(!packIds.length){ showToast('Tick at least one list'); return; }
  const r = await act(()=>api.post('/api/workplaces/'+el.dataset.id+'/requirements', { packIds }), null, el);
  if(r){ closeSheet(); showToast(r.added+' added'+(r.contractorsUpdated?' — '+r.contractorsUpdated+' contractor'+(r.contractorsUpdated===1?'\'s file':'s\' files')+' updated':'')); }
});
const CATS = ['Company Documents','Legal Appointments','Personnel','Plans & Procedures','Site-Specific','Equipment','Registers & Records'];
on('wp-add-own', (el)=>{
  openSheet(sheetHead('Add your own requirement', W()[el.dataset.id].name)
    +'<label class="field-label" for="wrName">What must contractors provide?</label><input type="text" id="wrName" placeholder="e.g. Blasting exclusion zone acknowledgement">'
    +'<label class="field-label" for="wrCat">Section</label><select id="wrCat" class="field">'+CATS.map(c=>'<option>'+c+'</option>').join('')+'</select>'
    +'<label class="field-label" for="wrSource">Why is it required?</label><select id="wrSource" class="field">'+Object.entries(SOURCE_LABEL).filter(([k])=>k!=='platform').map(([k,v])=>'<option value="'+k+'"'+(k==='site'?' selected':'')+'>'+v+'</option>').join('')+'</select>'
    +'<label class="field-label" for="wrWhy">Explain it for the contractor (optional)</label><textarea id="wrWhy" placeholder="e.g. Blasting takes place daily at 13:00; everyone on site must know the exclusion zones."></textarea>'
    +'<button class="btn primary block" style="margin-top:12px;" data-action="wp-save-own" data-id="'+el.dataset.id+'">Add to the site</button>');
});
on('wp-save-own', async (el)=>{
  const name = val('wrName');
  if(!name){ document.getElementById('wrName').focus(); return; }
  const r = await act(()=>api.post('/api/workplaces/'+el.dataset.id+'/requirements', { requirements: [{ category: val('wrCat'), name, source: val('wrSource'), why: val('wrWhy') }] }), null, el);
  if(r){ closeSheet(); showToast('Added'+(r.contractorsUpdated?' — now in '+r.contractorsUpdated+' contractor'+(r.contractorsUpdated===1?'\'s file':'s\' files'):'')); }
});
on('wp-remove', async (el)=>{
  if(!confirm('Take “'+unescapeHtml(el.dataset.name)+'” off this site\'s list? Contractors who join from now on won\'t be asked for it. Files of contractors already on the site keep it and its history.')) return;
  await act(()=>api.post('/api/workplaces/'+el.dataset.id+'/requirements/remove', { name: unescapeHtml(el.dataset.name) }), 'Removed from the site\'s list', el);
});
