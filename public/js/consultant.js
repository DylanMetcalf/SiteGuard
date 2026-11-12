// A safety consultant's portfolio: the client companies they look after, how full the plan is, and what needs
// attention at each. The server enforces every rule (client limit, locked registration numbers, when a client may
// be archived); this screen only shows the answer and the reason.
import { api } from './api.js';
import { S, ICONS, escapeHtml, on, openSheet, closeSheet, sheetHead, showToast, render, reload, org, val } from './core.js';

let data = null, loading = false, failed = '';

export function invalidateClients(){ data = null; failed = ''; }

async function load(){
  if(loading) return;
  loading = true;
  try{ data = await api.get('/api/consultant/clients'); failed = ''; }
  catch(e){ failed = e.message || 'Could not load your clients.'; }
  loading = false;
  render();
}

const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

function clientCard(c){
  const bits = [c.missing && c.missing+' missing', c.awaitingReview && c.awaitingReview+' waiting for review', c.needsCorrection && c.needsCorrection+' to correct', c.expired && c.expired+' expired', c.expiringSoon && c.expiringSoon+' expiring soon'].filter(Boolean);
  const status = c.archived ? '<span class="badge grey">Archived</span>' : bits.length ? '<span class="site-card-sub">'+escapeHtml(bits.join(' · '))+'</span>' : '<span class="badge approved">'+ICONS.check+'Up to date</span>';
  return '<div class="card client-card"><div class="flexbetween" style="align-items:flex-start;gap:10px;"><div style="min-width:0;"><div class="site-card-title">'+escapeHtml(c.name)+'</div>'
    +'<div class="site-card-sub">Reg. '+escapeHtml(c.registrationNumber||'')+' · '+plural(c.sites, 'site', 'sites')+'</div></div>'+(c.archived ? '' : '<button class="btn primary small" data-action="client-open" data-id="'+c.id+'">Open</button>')+'</div>'
    +'<div style="margin-top:8px;">'+status+'</div>'
    +(c.archived ? '' : '<div class="client-actions"><button class="linkish" data-action="client-rename" data-id="'+c.id+'" data-name="'+escapeHtml(c.name)+'">Rename</button>'
      +(c.canArchive ? '<button class="linkish" data-action="client-archive" data-id="'+c.id+'" data-name="'+escapeHtml(c.name)+'">Archive</button>' : '')+'</div>')
    +'</div>';
}

export function renderClients(){
  if(!data){
    if(!loading && !failed) load();
    return '<div class="view-head"><h1>Client companies</h1></div>'+(failed ? '<div class="banner bad"><span>'+escapeHtml(failed)+'</span><button class="btn small secondary" data-action="client-retry">Try again</button></div>' : '<div class="empty"><p>Loading…</p></div>');
  }
  const full = data.used >= data.limit;
  const pct = data.limit ? Math.min(100, Math.round(data.used / data.limit * 100)) : 100;
  const live = data.clients.filter(c=>!c.archived), archived = data.clients.filter(c=>c.archived);
  let html = '<div class="view-head"><div class="flexbetween"><h1>Client companies</h1><button class="btn primary small" data-action="client-add"'+(full?' disabled':'')+'>+ Add client</button></div>'
    +'<p>'+escapeHtml(data.plan.name)+' · '+data.used+' of '+data.limit+' client companies used</p></div>'
    +'<div class="client-meter" role="img" aria-label="'+data.used+' of '+data.limit+' client companies used"><span style="width:'+pct+'%;"></span></div>';
  if(data.trial) html += '<div class="site-card-sub" style="margin:0 0 10px;">Free trial: up to '+data.limit+' client companies. Choose a plan to cover more.</div>';
  if(full) html += '<div class="banner info"><span>Your plan is full. Choose a larger plan to add more client companies.</span><button class="btn small secondary" data-action="goto-more" data-view="billing">See plans</button></div>';
  else if(data.limit && data.used / data.limit >= 0.8) html += '<div class="site-card-sub" style="margin:6px 0 10px;">You are close to your limit. A larger plan lowers the price per client.</div>';
  if(!live.length) html += '<div class="empty"><h3>No client companies yet</h3><p>Add the first company you look after. Each client gets its own documents, workers and sites, kept apart from your other clients.</p><button class="btn primary" data-action="client-add">Add my first client</button></div>';
  html += live.map(clientCard).join('');
  if(archived.length) html += '<div class="section-title">Archived</div>'+archived.map(clientCard).join('');
  return html;
}

/** The dashboard card for a consultant: the same list, shorter. */
export function clientsWidget(){
  if(!org().isConsultant) return '';
  if(!data){ if(!loading && !failed) load(); return '<div class="card"><div class="site-card-sub">Loading your clients…</div></div>'; }
  const live = data.clients.filter(c=>!c.archived);
  const need = live.filter(c=>c.missing||c.awaitingReview||c.needsCorrection||c.expired||c.expiringSoon);
  return '<div class="card"><div class="flexbetween"><div class="site-card-title">Your clients</div><button class="linkish" data-action="goto-more" data-view="clients">See all</button></div>'
    +'<div class="site-card-sub" style="margin:2px 0 8px;">'+data.used+' of '+data.limit+' used · '+(need.length ? plural(need.length, 'client needs', 'clients need')+' attention' : 'everyone is up to date')+'</div>'
    +live.slice(0,4).map(c=>'<button class="today-row" data-action="client-open" data-id="'+c.id+'"><span class="today-dot" style="background:'+((c.expired||c.needsCorrection)?'var(--red)':(c.missing||c.awaitingReview||c.expiringSoon)?'var(--amber)':'var(--green)')+';" aria-hidden="true"></span><span class="today-text"><b>'+escapeHtml(c.name)+'</b><span>'+(c.missing+c.awaitingReview+c.needsCorrection+c.expired+c.expiringSoon ? plural(c.missing,'missing','missing')+' · '+c.expired+' expired · '+c.expiringSoon+' expiring' : 'Up to date')+'</span></span></button>').join('')
    +(live.length ? '' : '<button class="btn primary small" data-action="client-add">Add my first client</button>')+'</div>';
}

/** Shown inside a client company: a way back to the consultant's portfolio. */
export function managedBanner(){
  const m = org().managedBy;
  if(!m) return '';
  return '<div class="banner info"><span>You are working inside this client company for <strong>'+escapeHtml(m.name)+'</strong>.</span><button class="btn small secondary" data-action="client-back" data-id="'+m.id+'">Back to my clients</button></div>';
}

on('client-retry', ()=>{ failed = ''; load(); });
on('client-add', ()=>openSheet(sheetHead('Add a client company', 'Each client gets its own documents, workers and sites')
  +'<label class="field-label" for="clName">Company name</label><input type="text" id="clName" maxlength="200" placeholder="e.g. Alpha Scaffolding (Pty) Ltd">'
  +'<label class="field-label" for="clReg">Company registration number</label><input type="text" id="clReg" maxlength="40" placeholder="e.g. 2015/123456/07" inputmode="numeric">'
  +'<div class="site-card-sub" style="margin-top:6px;">The registration number identifies the company and <strong>cannot be changed later</strong>, so check it. A company can only be looked after by one consultant.</div>'
  +'<div id="clErr" class="form-error" role="alert"></div>'
  +'<button class="btn primary block" style="margin-top:14px;" data-action="client-add-go">Add client company</button>'));
on('client-add-go', async (el)=>{
  const name = val('clName'), registrationNumber = val('clReg'), err = document.getElementById('clErr');
  if(!name || !registrationNumber){ if(err) err.textContent = 'Enter the company name and its registration number.'; return; }
  el.disabled = true;
  try{ await api.post('/api/consultant/clients', { name, registrationNumber }); closeSheet(); invalidateClients(); try{ localStorage.setItem('sg_welcome_done_'+org().id, '1'); }catch{ /* private mode */ } showToast('Client company added'); S.nav='more'; S.moreView='clients'; render(); }
  catch(e){ if(err) err.textContent = e.message; el.disabled = false; }
});
on('client-rename', (el)=>openSheet(sheetHead('Rename client company', 'Only the name can be changed')
  +'<label class="field-label" for="clRename">Company name</label><input type="text" id="clRename" maxlength="200" value="'+escapeHtml(el.dataset.name)+'">'
  +'<div id="clErr" class="form-error" role="alert"></div><button class="btn primary block" style="margin-top:14px;" data-action="client-rename-go" data-id="'+el.dataset.id+'">Save</button>'));
on('client-rename-go', async (el)=>{
  const name = val('clRename'), err = document.getElementById('clErr');
  try{ await api.patch('/api/consultant/clients/'+el.dataset.id, { name }); closeSheet(); invalidateClients(); render(); showToast('Renamed'); }
  catch(e){ if(err) err.textContent = e.message; }
});
on('client-archive', (el)=>openSheet(sheetHead('Archive '+escapeHtml(el.dataset.name)+'?', 'Frees a client slot. Nothing is deleted.')
  +'<p class="site-card-sub">The company keeps its records but becomes read-only. A company that has been used stays reserved, so it cannot be added again; contact us if that is a mistake.</p>'
  +'<div id="clErr" class="form-error" role="alert"></div><button class="btn primary block" style="margin-top:14px;" data-action="client-archive-go" data-id="'+el.dataset.id+'">Archive</button>'));
on('client-archive-go', async (el)=>{
  const err = document.getElementById('clErr');
  try{ await api.post('/api/consultant/clients/'+el.dataset.id+'/archive', {}); closeSheet(); invalidateClients(); render(); showToast('Archived'); }
  catch(e){ if(err) err.textContent = e.message; }
});
on('client-open', async (el)=>{
  try{
    await api.post('/api/consultant/clients/'+el.dataset.id+'/access', {});
    await api.post('/api/auth/switch-org', { orgId: el.dataset.id });
    S.nav='dashboard'; S.activeSiteId=null; S.moreView=null; invalidateClients();
    await reload();
  }catch(e){ showToast(e.message); }
});
on('client-back', async (el)=>{
  try{ await api.post('/api/auth/switch-org', { orgId: el.dataset.id }); S.nav='more'; S.moreView='clients'; S.activeSiteId=null; invalidateClients(); await reload(); }
  catch(e){ showToast(e.message); }
});
