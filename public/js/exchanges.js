// COMVERA Exchange in the workspace: request documents from anyone (no account needed),
// share your own documents securely, review what comes back, and keep contacts.
// The server decides who may do what; these screens only offer what it allows.
// Everything from the API is escaped here (it isn't part of the escaped bootstrap).

import { api } from './api.js';
import {
  S, ICONS, escapeHtml as esc, isHost, isOrgAdmin, canReview, readOnly, org,
  on, render, showToast, openSheet, sheetHead, closeSheet, val, searchBox, matchSearch,
} from './core.js';

let cache = null;          // { sent, received, claimable, relationships }
let detail = null;         // { id, data }
let loading = false;
const canSend = () => (isOrgAdmin() || canReview()) && !readOnly();
const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' }) : '';
const fmtTime = (v) => v ? new Date(v).toLocaleString('en-ZA', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : '';

async function load(){
  if(loading) return;
  loading = true;
  try{
    const [list, claim, rel] = await Promise.all([api.get('/api/exchanges'), api.get('/api/exchanges/claimable'), api.get('/api/relationships')]);
    cache = { sent:list.sent, received:list.received, claimable:claim, relationships:rel.relationships };
    if(S.exchangeId) detail = { id:S.exchangeId, data: await api.get('/api/exchanges/'+encodeURIComponent(S.exchangeId)) };
  } finally { loading = false; }
  render();
}
export function invalidateExchanges(){ cache = null; detail = null; }
/** Live update from the server (someone submitted, opened or downloaded). */
export function refreshExchanges(){ if(S.nav === 'more' && S.moreView === 'exchanges' && cache) load().catch(()=>{}); }

/* ---- statuses ---- */
const STATUS = {
  requested:['Requested','grey'], opened:['Opened','blue'], verified:['Verification complete','blue'], submitted:['Under review','awaiting_review'],
  changes_requested:['Replacement required','correction_required'], approved:['Approved','complete'],
  shared:['Shared','grey'], downloaded:['Downloaded','complete'],
};
function statusBadge(x){
  if(x.access === 'revoked') return '<span class="badge grey">'+(x.direction==='share'?'Revoked':'Cancelled')+'</span>';
  let [label, cls] = STATUS[x.status] || [x.status, 'grey'];
  if(x.status === 'submitted' && x.counts && x.counts.resubmitted) label = 'Resubmitted';
  return '<span class="badge '+cls+'">'+esc(label)+'</span>'+(x.access === 'expired' && x.status !== 'approved' ? ' <span class="badge expired">Access expired</span>' : '');
}
const ITEM_STATUS = { requested:['Requested','grey'], submitted:['Under review','awaiting_review'], approved:['Approved','complete'], rejected:['Replacement required','correction_required'], shared:['Shared','grey'] };
const itemBadge = (s) => { const [l, c] = ITEM_STATUS[s] || [s, 'grey']; return '<span class="badge '+c+'">'+esc(l)+'</span>'; };

function row(x, received){
  const who = received ? x.senderOrgName : (x.recipientOrgName || x.recipientName || x.recipientEmail);
  const what = x.direction === 'request' ? 'Request' : 'Share';
  const progress = x.direction === 'request' && x.counts.items ? ' · '+x.counts.approved+'/'+x.counts.items+' approved' : x.counts.items ? ' · '+x.counts.items+' document'+(x.counts.items===1?'':'s') : '';
  return '<div class="reqrow" data-action="exchange-open" data-id="'+esc(x.id)+'" role="button" tabindex="0" style="cursor:pointer;">'
    +'<div class="reqrow-main"><div class="reqrow-name">'+esc(who)+'</div>'
    +'<div class="site-card-sub">'+esc(x.ref)+' · '+what+(received ? ' from them' : ' to '+esc(x.recipientEmail))+progress+(x.deadline && x.direction==='request' ? ' · due '+esc(fmtDate(x.deadline)) : '')+'</div>'
    +'<div class="reqrow-meta">'+statusBadge(x)+'<span class="site-card-sub">'+esc(fmtDate(x.createdAt))+'</span></div></div>'
    +'<div class="reqrow-chevron">'+ICONS.chevron+'</div></div>';
}

/* ============ list ============ */
export function renderExchanges(){
  if(!cache){ load().catch(e=>showToast(e.message)); return '<div class="empty"><p>Loading…</p></div>'; }
  if(S.exchangeId) return renderDetail();
  const tab = S.exchangeTab || 'sent';
  let h = '<div class="view-head"><h1>Exchanges</h1><p>Request or share specific documents with anyone — they don\'t need a COMVERA account. Each exchange is private, time-limited and recorded.</p></div>';
  if(canSend()){
    h += '<div class="hero-actions" style="margin-bottom:14px;">'
      +'<button class="btn primary" data-action="exchange-request">'+ICONS.plus+' Request documents</button>'
      +(isHost() ? '<button class="btn secondary" data-action="exchange-bulk">'+ICONS.search+' Bulk request</button>' : '')
      +'<button class="btn secondary" data-action="exchange-share">'+ICONS.link+' Share documents</button></div>';
  }
  const cl = cache.claimable;
  if(cl.exchanges.length) h += '<div class="notice"><strong>'+cl.exchanges.length+' earlier exchange'+(cl.exchanges.length===1?' was':'s were')+' sent to '+esc(S.boot.me.email)+'.</strong> '
    +(cl.canClaim ? 'If they belong to '+esc(org().name)+', you can link them here.<div style="margin-top:8px;"><button class="btn small secondary" data-action="exchange-claim">Review and link</button></div>' : 'An owner or admin of '+esc(org().name)+' can link them to this workspace.')+'</div>';
  const counts = { sent:cache.sent.length, received:cache.received.length, contacts:cache.relationships.length };
  h += '<div class="subtabs" role="tablist">'+[['sent','Sent'],['received','Received'],['contacts','Contacts']].map(([k,l])=>
    '<button role="tab" data-action="exchange-tab" data-tab="'+k+'" class="'+(tab===k?'active':'')+'" aria-selected="'+(tab===k)+'">'+l+' ('+counts[k]+')</button>').join('')+'</div>';
  if(tab === 'contacts') return h + renderContacts();
  const list = (tab === 'sent' ? cache.sent : cache.received).filter(x=>matchSearch('exchanges', x.ref, x.recipientOrgName, x.recipientName, x.recipientEmail, x.senderOrgName));
  h += searchBox('exchanges', 'Search by company, person or reference');
  if(!list.length) return h + '<div class="empty"><h3>'+(tab==='sent' ? 'Nothing sent yet' : 'Nothing received here yet')+'</h3><p>'
    +(tab==='sent' ? 'Request documents from a contractor or share yours with a client. The other side just confirms their email address — no account needed.'
      : 'Exchanges sent to your email before you had a workspace show up here once you link them.')+'</p></div>';
  const open = list.filter(x=>x.access==='active' && x.status!=='approved');
  const closed = list.filter(x=>!(x.access==='active' && x.status!=='approved'));
  if(open.length) h += '<div class="section-title">Open</div><div class="card">'+open.map(x=>row(x, tab==='received')).join('')+'</div>';
  if(closed.length) h += '<div class="section-title">Completed, expired or revoked</div><div class="card">'+closed.map(x=>row(x, tab==='received')).join('')+'</div>';
  return h;
}

function renderContacts(){
  const rel = cache.relationships.filter(r=>matchSearch('exchange-contacts', r.name));
  let h = searchBox('exchange-contacts', 'Search companies');
  if(!rel.length) return h + '<div class="empty"><h3>No contacts yet</h3><p>Companies and the people you exchange documents with are remembered here, so the next request is quicker.</p></div>';
  h += '<div class="card">'+rel.map(r=>'<div class="reqrow" data-action="exchange-relationship" data-id="'+esc(r.id)+'" role="button" tabindex="0" style="cursor:pointer;"><div class="reqrow-main"><div class="reqrow-name">'+esc(r.name)+'</div>'
    +'<div class="site-card-sub">'+r.contacts+' contact'+(r.contacts===1?'':'s')+' · '+r.exchanges+' exchange'+(r.exchanges===1?'':'s')+(r.open ? ' · '+r.open+' open' : '')+' · last '+esc(fmtDate(r.lastInteractionAt))+'</div>'
    +'<div class="reqrow-meta">'+(r.conversion==='workspace' ? '<span class="badge sage">Has a COMVERA workspace</span>' : '<span class="badge grey">Exchange only</span>')+'</div></div>'
    +'<div class="reqrow-chevron">'+ICONS.chevron+'</div></div>').join('')+'</div>';
  return h + '<p class="site-card-sub">A contact is someone you exchange documents with. They aren\'t users of your workspace and can only ever see the exchanges you send them.</p>';
}

/* ============ detail ============ */
function renderDetail(){
  if(!detail || detail.id !== S.exchangeId){ load().catch(e=>showToast(e.message)); return '<div class="empty"><p>Loading…</p></div>'; }
  const { exchange:x, items, history } = detail.data;
  const mine = x.mine;
  let h = '<div style="margin-bottom:12px;"><button class="btn secondary small" data-action="exchange-back">← Exchanges</button></div>'
    +'<div class="view-head"><h1>'+esc(mine ? (x.recipientOrgName || x.recipientName || x.recipientEmail) : x.senderOrgName)+'</h1>'
    +'<p>'+esc(x.ref)+' · '+(x.direction==='request' ? 'Document request' : 'Secure share')+(x.siteName ? ' · '+esc(x.siteName) : '')+'</p></div>';
  h += '<div class="card"><div class="reqrow-meta" style="margin-top:0;">'+statusBadge(x)+'</div>'
    + kv('Access', x.access==='active' ? 'Active until '+fmtDate(x.accessExpiresAt) : x.access==='revoked' ? 'Revoked '+fmtTime(x.revokedAt) : 'Expired '+fmtDate(x.accessExpiresAt))
    + (mine ? kv('Sent to', (x.recipientName ? x.recipientName+' · ' : '')+x.recipientEmail) : kv('From', x.senderOrgName))
    + (x.deadline && x.direction==='request' ? kv('Needed by', fmtDate(x.deadline)) : '')
    + kv('Created', fmtTime(x.createdAt)+(mine && x.createdByName ? ' by '+x.createdByName : ''))
    + (x.openedAt ? kv('Opened', fmtTime(x.openedAt)) : '')
    + (x.verifiedAt ? kv('Email confirmed', fmtTime(x.verifiedAt)) : '')
    + (x.submittedAt ? kv('Last submitted', fmtTime(x.submittedAt)) : '')
    + (x.direction==='share' ? kv('Download', x.allowDownload ? 'Allowed' : 'View only') : '')
    + (x.claimed && mine ? kv('Recipient', 'Has linked this to their COMVERA workspace') : '')
    + (x.message ? '<div class="site-card-sub" style="margin-top:8px;">Your message: “'+esc(x.message)+'”</div>' : '')
    + (x.recipientResponse ? '<div class="notice" style="margin:10px 0 0;">Their message: “'+esc(x.recipientResponse)+'”</div>' : '')
    + '</div>';
  if(x.access !== 'active') h += '<div class="site-card-sub" style="margin:-2px 2px 10px;">The record and its history stay here; only the link and sessions have stopped working.</div>';

  const reviewable = mine && canSend() && x.direction==='request' && items.some(i=>i.status==='submitted');
  h += '<div class="section-title">Documents</div><div class="card">';
  for(const it of items){
    h += '<div class="reqrow" style="align-items:flex-start;"><div class="reqrow-main"><div class="reqrow-name">'+esc(it.documentType)+'</div>'
      +(it.personName ? '<div class="site-card-sub">For '+esc(it.personName)+'</div>' : '')
      +'<div class="reqrow-meta">'+itemBadge(it.status)+(it.downloadedAt ? '<span class="site-card-sub">Downloaded '+esc(fmtTime(it.downloadedAt))+'</span>' : '')+'</div>';
    if(it.reviewNote) h += '<div class="site-card-sub" style="margin-top:6px;">'+(it.status==='rejected'?'Sent back':'Note')+': '+esc(it.reviewNote)+(it.reviewedByName ? ' — '+esc(it.reviewedByName) : '')+'</div>';
    if(mine && it.submissions.length){
      h += '<div style="margin-top:8px;">'+it.submissions.map((s, i)=>'<div class="site-card-sub">'+(i===0 ? '<strong>' : '')+'v'+s.version+' · <a href="/api/files/'+encodeURIComponent(s.fileId)+'" target="_blank" rel="noopener">'+esc(s.filename)+'</a> · '+esc(fmtTime(s.submittedAt))+(i===0 ? '</strong>' : '')+'</div>').join('')+'</div>';
    }
    if(mine && x.direction==='share' && it.fileId) h += '<div class="site-card-sub" style="margin-top:6px;"><a href="/api/files/'+encodeURIComponent(it.fileId)+'" target="_blank" rel="noopener">'+esc(it.filename)+'</a> (your original — unchanged)</div>';
    if(!mine && x.direction==='share' && x.access==='active' && it.filename){
      h += '<div class="row-actions" style="margin-top:8px;"><a class="btn small secondary" href="/api/exchanges/'+encodeURIComponent(x.id)+'/items/'+encodeURIComponent(it.id)+'/file" target="_blank" rel="noopener">View</a>'
        +(x.allowDownload ? '<a class="btn small secondary" href="/api/exchanges/'+encodeURIComponent(x.id)+'/items/'+encodeURIComponent(it.id)+'/file?download=1">Download</a>' : '')+'</div>';
    }
    if(reviewable && it.status==='submitted'){
      h += '<div class="seg" role="group" aria-label="Decision for '+esc(it.documentType)+'" style="margin-top:10px;">'
        +'<button class="seg-btn yes" data-action="exchange-decide" data-item="'+esc(it.id)+'" data-decision="approve">Approve</button>'
        +'<button class="seg-btn no" data-action="exchange-decide" data-item="'+esc(it.id)+'" data-decision="reject">Send back</button></div>'
        +'<textarea id="xr-'+esc(it.id)+'" placeholder="What needs fixing? (required when sending back)" style="margin-top:8px; display:none;" maxlength="1000"></textarea>';
    }
    h += '</div></div>';
  }
  h += '</div>';
  if(reviewable) h += '<button class="btn primary block" data-action="exchange-save-review">Save review</button><div class="site-card-sub" style="margin:6px 2px 0;">Sending anything back emails '+esc(x.recipientEmail)+' a new link with your notes. Approved copies stay in your records.</div>';

  if(mine && canSend()){
    h += '<div class="row-actions" style="margin-top:14px; display:flex; gap:8px; flex-wrap:wrap;">';
    if(x.access !== 'revoked' && !(x.direction==='request' && x.status==='approved')) h += '<button class="btn secondary" data-action="exchange-resend">'+(x.access==='expired' ? 'Re-open and send a new link' : 'Send a reminder')+'</button>';
    if(x.access === 'active') h += '<button class="btn danger" data-action="exchange-revoke">'+(x.direction==='share' ? 'Revoke access' : 'Cancel request')+'</button>';
    h += '</div>';
  }
  if(!mine) h += '<div class="notice" style="margin-top:12px;">This exchange was sent to you by '+esc(x.senderOrgName)+'. You can see its status here; the sender keeps its own copies and history.</div>';
  if(history.length){
    h += '<div class="section-title">History</div><div class="card">'+history.map(e=>'<div class="kv"><span>'+esc(e.action)+(e.detail && e.detail.includes(' — ') ? '<div class="site-card-sub">'+esc(e.detail.split(' — ').slice(1).join(' — '))+'</div>' : '')+'</span>'
      +'<span class="site-card-sub" style="text-align:right;">'+esc(e.actor)+'<br>'+esc(fmtTime(e.at))+'</span></div>').join('')+'</div>';
  }
  return h;
}
const kv = (k, v) => '<div class="kv"><span>'+esc(k)+'</span><strong>'+esc(v)+'</strong></div>';

const decisions = {};
on('exchange-decide', (el)=>{
  decisions[el.dataset.item] = el.dataset.decision;
  const seg = el.closest('.seg');
  seg.querySelectorAll('.seg-btn').forEach(b=>b.classList.toggle('on', b === el));
  const note = document.getElementById('xr-'+el.dataset.item);
  if(note){ note.style.display = el.dataset.decision === 'reject' ? '' : 'none'; if(el.dataset.decision === 'reject') note.focus(); }
});
on('exchange-save-review', async (el)=>{
  const list = Object.entries(decisions).filter(([id])=>document.getElementById('xr-'+id)).map(([itemId, decision])=>({ itemId, decision, note: val('xr-'+itemId) }));
  if(!list.length) return showToast('Choose Approve or Send back for at least one document.');
  const missing = list.find(d=>d.decision==='reject' && d.note.length < 3);
  if(missing){ document.getElementById('xr-'+missing.itemId).focus(); return showToast('Say what needs fixing for each document you send back.'); }
  el.disabled = true;
  try{
    const r = await api.post('/api/exchanges/'+encodeURIComponent(S.exchangeId)+'/review', { decisions:list });
    list.forEach(d=>{ delete decisions[d.itemId]; });
    showToast(r.status === 'approved' ? 'All approved — request complete.' : list.some(d=>d.decision==='reject') ? 'Saved. They\'ve been emailed what to replace.' : 'Saved.');
    await load();
  }catch(e){ showToast(e.message); el.disabled = false; }
});
on('exchange-revoke', async (el)=>{
  const share = detail && detail.data.exchange.direction === 'share';
  if(!confirm(share ? 'Revoke access now? The link and any open sessions stop working immediately. Your original document is not affected.' : 'Cancel this request? The link stops working. Anything already submitted stays in your records.')) return;
  el.disabled = true;
  try{ await api.post('/api/exchanges/'+encodeURIComponent(S.exchangeId)+'/revoke'); showToast(share ? 'Access revoked.' : 'Request cancelled.'); await load(); }
  catch(e){ showToast(e.message); el.disabled = false; }
});
on('exchange-resend', async (el)=>{
  el.disabled = true;
  try{ const r = await api.post('/api/exchanges/'+encodeURIComponent(S.exchangeId)+'/resend', {}); showToast('New link sent. It works until '+fmtDate(r.accessExpiresAt)+'; the old link no longer works.'); await load(); }
  catch(e){ showToast(e.message); el.disabled = false; }
});
on('exchange-open', (el)=>{ S.nav = 'more'; S.moreView = 'exchanges'; S.exchangeId = el.dataset.id; detail = null; closeSheet(); render(); window.scrollTo(0,0); });
on('exchange-back', ()=>{ S.exchangeId = null; detail = null; render(); window.scrollTo(0,0); });
on('exchange-tab', (el)=>{ S.exchangeTab = el.dataset.tab; render(); });

/** Opens an exchange from a notification or another screen. */
export function openExchange(id){ S.nav = 'more'; S.moreView = 'exchanges'; S.exchangeId = id; invalidateExchanges(); render(); window.scrollTo(0,0); }

/* ============ relationships ============ */
on('exchange-relationship', async (el)=>{
  let d;
  try{ d = await api.get('/api/relationships/'+encodeURIComponent(el.dataset.id)); }catch(e){ return showToast(e.message); }
  const r = d.relationship;
  openSheet(sheetHead(esc(r.name), 'Known since '+esc(fmtDate(r.createdAt)))
    +'<div class="section-title">Contacts</div><div class="card">'+(d.contacts.length ? d.contacts.map(k=>'<div class="reqrow"><div class="reqrow-main"><div class="reqrow-name">'+esc(k.name || k.email)+'</div>'
      +'<div class="site-card-sub">'+esc([k.email, k.phone, k.role].filter(Boolean).join(' · '))+(k.lastUsedAt ? ' · last used '+esc(fmtDate(k.lastUsedAt)) : '')+'</div></div>'
      +(canSend() ? '<button class="btn small ghost" data-action="exchange-contact-remove" data-rel="'+esc(r.id)+'" data-id="'+esc(k.id)+'" aria-label="Remove contact">'+ICONS.cross+'</button>' : '')+'</div>').join('') : '<div class="list-empty">No contacts yet.</div>')+'</div>'
    +(canSend() ? '<details class="card"><summary style="cursor:pointer; font-weight:600;">Add a contact</summary>'
      +'<label class="field-label" for="kName">Name</label><input id="kName" type="text" maxlength="200">'
      +'<label class="field-label" for="kEmail">Email</label><input id="kEmail" type="email" maxlength="254">'
      +'<label class="field-label" for="kPhone">Phone</label><input id="kPhone" type="tel" maxlength="40">'
      +'<label class="field-label" for="kRole">Role</label><input id="kRole" type="text" maxlength="100" placeholder="e.g. SHE officer, admin">'
      +'<button class="btn primary block" style="margin-top:12px;" data-action="exchange-contact-add" data-rel="'+esc(r.id)+'">Save contact</button></details>' : '')
    +'<div class="section-title">Exchanges</div><div class="card">'+(d.exchanges.length ? d.exchanges.map(x=>row(x, false)).join('') : '<div class="list-empty">None yet.</div>')+'</div>'
    +'<p class="site-card-sub">Contacts are only used to send exchanges. They are never signed up for anything, and marketing email is only sent to people who ask for it.</p>');
});
on('exchange-contact-add', async (el)=>{
  el.disabled = true;
  try{
    await api.post('/api/relationships/'+encodeURIComponent(el.dataset.rel)+'/contacts', { name:val('kName'), email:val('kEmail'), phone:val('kPhone'), role:val('kRole') });
    showToast('Contact saved.'); closeSheet(); invalidateExchanges(); render();
  }catch(e){ showToast(e.message); el.disabled = false; }
});
on('exchange-contact-remove', async (el)=>{
  if(!confirm('Remove this contact? Past exchanges keep their record.')) return;
  try{ await api.del('/api/relationships/'+encodeURIComponent(el.dataset.rel)+'/contacts/'+encodeURIComponent(el.dataset.id)); showToast('Contact removed.'); closeSheet(); invalidateExchanges(); render(); }
  catch(e){ showToast(e.message); }
});

/* ============ request documents ============ */
const COMMON_DOCS = ['Medical certificate of fitness', 'Working at Heights certificate', 'Site induction certificate', 'Competency certificate', 'Letter of Good Standing (COID)', 'Public liability insurance', 'Tax compliance status (SARS PIN)', 'Risk assessment', 'Method statement'];
let draft = null; // { contractorId, contractorName, contacts, items:[{documentType, personName}] }

/** Opens the request form. With a contractor from the directory, its contacts are offered. */
export async function openRequestSheet(contractorId){
  draft = { contractorId: contractorId || null, contractorName:'', contacts:[], items:[{ documentType:'', personName:'' }] };
  if(contractorId){
    try{ const c = await api.get('/api/exchanges/contacts?contractorId='+encodeURIComponent(contractorId)); draft.contractorName = c.contractor.name; draft.contacts = c.contacts; }
    catch(e){ return showToast(e.message); }
  }
  drawRequest();
}
function readRequestItems(){
  if(!draft) return;
  draft.items = draft.items.map((it, i)=>({ documentType: val('xiDoc'+i), personName: val('xiPerson'+i) }));
}
function drawRequest(keep){
  const d = draft, first = d.contacts[0] || {};
  const prev = keep || {};
  const sites = isHost() ? Object.values(S.state.sites || {}).filter(s=>!d.contractorId || s.contractorId === d.contractorId) : [];
  openSheet(sheetHead('Request documents', d.contractorId ? 'From '+esc(d.contractorName) : 'From anyone — no COMVERA account needed')
    +'<div class="notice">They\'ll get an email with a secure link, confirm their email address with a one-time code, and upload straight to you. Nothing is sent as an attachment and no account is created for them.</div>'
    +(d.contractorId ? '' : '<label class="field-label" for="xrCompany">Company</label><input id="xrCompany" type="text" maxlength="200" autofocus value="'+esc(prev.company||'')+'">')
    +(d.contacts.length > 1 ? '<label class="field-label" for="xrPick">Contact</label><select id="xrPick" class="field" data-action-change="exchange-pick-contact">'+d.contacts.map((k,i)=>'<option value="'+i+'">'+esc((k.name ? k.name+' — ' : '')+k.email)+'</option>').join('')+'<option value="new">Someone else…</option></select>' : '')
    +'<label class="field-label" for="xrName">Contact name</label><input id="xrName" type="text" maxlength="200" value="'+esc(prev.contactName ?? first.name ?? '')+'">'
    +'<label class="field-label" for="xrEmail">Email</label><input id="xrEmail" type="email" maxlength="254" value="'+esc(prev.email ?? first.email ?? '')+'"'+(d.contractorId?' autofocus':'')+'>'
    +'<label class="field-label" for="xrPhone">Phone (optional)</label><input id="xrPhone" type="tel" maxlength="40" value="'+esc(prev.phone ?? first.phone ?? '')+'">'
    +'<div class="section-title">Documents needed</div>'
    + d.items.map((it, i)=>'<div class="card" style="padding:12px;"><div class="flexbetween"><strong style="font-size:13px;">Document '+(i+1)+'</strong>'+(d.items.length>1 ? '<button class="btn small ghost" data-action="exchange-item-remove" data-i="'+i+'" aria-label="Remove">'+ICONS.cross+'</button>' : '')+'</div>'
      +'<input id="xiDoc'+i+'" type="text" list="xrDocs" maxlength="200" placeholder="e.g. Working at Heights certificate" value="'+esc(it.documentType)+'" style="margin-top:8px;">'
      +'<input id="xiPerson'+i+'" type="text" maxlength="200" placeholder="Employee (optional)" value="'+esc(it.personName)+'" style="margin-top:8px;"></div>').join('')
    +'<datalist id="xrDocs">'+COMMON_DOCS.map(n=>'<option value="'+esc(n)+'">').join('')+'</datalist>'
    +'<button class="btn secondary small" data-action="exchange-item-add">'+ICONS.plus+' Add another document</button>'
    +(sites.length ? '<label class="field-label" for="xrSite">Site or project (optional)</label><select id="xrSite" class="field"><option value="">—</option>'+sites.map(s=>'<option value="'+s.id+'"'+(prev.siteId===s.id?' selected':'')+'>'+s.name+'</option>').join('')+'</select>' : '')
    +'<label class="field-label" for="xrDeadline">Needed by (optional)</label><input id="xrDeadline" type="date" value="'+esc(prev.deadline||'')+'">'
    +'<label class="field-label" for="xrMsg">Message (optional)</label><textarea id="xrMsg" maxlength="2000">'+esc(prev.message||'')+'</textarea>'
    +'<button class="btn primary block" style="margin-top:14px;" data-action="exchange-request-send">Send request</button>');
}
function readRequestForm(){
  return { company: val('xrCompany'), contactName: val('xrName'), email: val('xrEmail'), phone: val('xrPhone'), siteId: val('xrSite'), deadline: val('xrDeadline'), message: val('xrMsg') };
}
on('exchange-request', ()=>openRequestSheet(null));
on('exchange-request-for', (el)=>openRequestSheet(el.dataset.id));
on('exchange-item-add', ()=>{ readRequestItems(); const keep = readRequestForm(); draft.items.push({ documentType:'', personName:'' }); drawRequest(keep); });
on('exchange-item-remove', (el)=>{ readRequestItems(); const keep = readRequestForm(); draft.items.splice(Number(el.dataset.i), 1); drawRequest(keep); });
on('exchange-pick-contact', (el)=>{
  const k = el.value === 'new' ? { name:'', email:'', phone:'' } : draft.contacts[Number(el.value)];
  document.getElementById('xrName').value = k.name || ''; document.getElementById('xrEmail').value = k.email || ''; document.getElementById('xrPhone').value = k.phone || '';
});
on('exchange-request-send', async (el)=>{
  readRequestItems();
  const f = readRequestForm();
  const items = draft.items.filter(i=>i.documentType);
  if(!items.length) return showToast('Add at least one document.');
  const body = { contactName:f.contactName, email:f.email, phone:f.phone, message:f.message, items };
  if(draft.contractorId) body.contractorId = draft.contractorId; else body.company = f.company;
  if(f.siteId) body.siteId = f.siteId;
  if(f.deadline) body.deadline = f.deadline;
  el.disabled = true;
  try{
    const r = await api.post('/api/exchanges/request', body);
    closeSheet(); showToast('Request '+r.ref+' sent to '+f.email+'.');
    draft = null; openExchange(r.id);
  }catch(e){ showToast(e.message); el.disabled = false; }
});

/* ============ share documents ============ */
let share = null; // { q, docs, selected:Set }
async function searchDocs(){
  share.docs = (await api.get('/api/exchanges/documents?q='+encodeURIComponent(share.q))).documents;
}
export async function openShareSheet(){
  share = { q:'', docs:[], selected:new Map(), step:'pick' };
  try{ await searchDocs(); }catch(e){ return showToast(e.message); }
  drawShare();
}
const SOURCE = { document:'Company or site document', certificate:'Worker certificate', studio:'Document Studio' };
function drawShare(keep){
  const prev = keep || {};
  if(share.step === 'pick'){
    openSheet(sheetHead('Share documents securely', 'Choose from your own documents')
      +'<div class="page-search">'+ICONS.search+'<input type="search" id="xsQ" value="'+esc(share.q)+'" placeholder="Search e.g. insurance, medical, a worker\'s name" data-action-input="exchange-share-search" autocomplete="off"></div>'
      +'<div class="site-card-sub" style="margin:8px 2px;">'+share.selected.size+' selected</div>'
      +'<div class="card" style="max-height:46vh; overflow:auto;">'+(share.docs.length ? share.docs.map(d=>{ const key = d.source+':'+d.id;
        return '<label class="reqrow" style="cursor:pointer;"><input type="checkbox" data-action="exchange-share-pick" data-key="'+esc(key)+'"'+(share.selected.has(key)?' checked':'')+'>'
          +'<div class="reqrow-main"><div class="reqrow-name">'+esc(d.name)+'</div><div class="site-card-sub">'+esc([d.person, d.site, SOURCE[d.source], d.expiry ? 'expires '+fmtDate(d.expiry) : ''].filter(Boolean).join(' · '))+'</div></div></label>'; }).join('')
        : '<div class="list-empty">'+(share.q ? 'Nothing matches.' : 'No documents with a file yet. Upload documents first, then share them here.')+'</div>')+'</div>'
      +'<button class="btn primary block" style="margin-top:12px;" data-action="exchange-share-next"'+(share.selected.size?'':' disabled')+'>Next: who to share with</button>');
    const q = document.getElementById('xsQ'); if(q){ q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    return;
  }
  const chosen = [...share.selected.values()];
  openSheet(sheetHead('Share '+chosen.length+' document'+(chosen.length===1?'':'s'), 'They confirm their email with a one-time code — no account needed')
    +'<div class="card">'+chosen.map(d=>'<div class="site-card-sub">• '+esc(d.name)+(d.person ? ' — '+esc(d.person) : '')+'</div>').join('')+'<button class="btn small ghost" data-action="exchange-share-back" style="margin-top:6px;">Change selection</button></div>'
    +'<label class="field-label" for="xsCompany">Company</label><input id="xsCompany" type="text" maxlength="200" autofocus value="'+esc(prev.company||'')+'" placeholder="e.g. the mine or client">'
    +'<label class="field-label" for="xsName">Contact name</label><input id="xsName" type="text" maxlength="200" value="'+esc(prev.contactName||'')+'">'
    +'<label class="field-label" for="xsEmail">Email</label><input id="xsEmail" type="email" maxlength="254" value="'+esc(prev.email||'')+'">'
    +'<label class="field-label" for="xsDays">Access lasts</label><select id="xsDays" class="field">'+[[3,'3 days'],[7,'7 days'],[14,'14 days'],[30,'30 days'],[90,'90 days']].map(([v,l])=>'<option value="'+v+'"'+(Number(prev.days||14)===v?' selected':'')+'>'+l+'</option>').join('')+'</select>'
    +'<div class="toggle-row"><span>Allow downloads<div class="site-card-sub">Off: they can view the document but not download it from COMVERA.</div></span><input type="checkbox" id="xsDl"'+(prev.allowDownload === false ? '' : ' checked')+'></div>'
    +'<label class="field-label" for="xsMsg">Message (optional)</label><textarea id="xsMsg" maxlength="2000">'+esc(prev.message||'')+'</textarea>'
    +'<div class="site-card-sub" style="margin-top:10px;">You\'ll see when they open, view and download. You can revoke access at any time; your originals never change.</div>'
    +'<button class="btn primary block" style="margin-top:12px;" data-action="exchange-share-send">Share securely</button>');
}
let shareTimer = null;
on('exchange-share', ()=>openShareSheet());
on('exchange-share-search', (el)=>{
  share.q = el.value;
  clearTimeout(shareTimer);
  shareTimer = setTimeout(async ()=>{ try{ await searchDocs(); drawShare(); }catch(e){ showToast(e.message); } }, 250);
});
on('exchange-share-pick', (el)=>{
  const key = el.dataset.key;
  if(el.checked){ const d = share.docs.find(x=>x.source+':'+x.id === key); if(d) share.selected.set(key, d); }
  else share.selected.delete(key);
  const b = document.querySelector('[data-action="exchange-share-next"]'); if(b) b.disabled = !share.selected.size;
  const c = document.querySelector('.overlay .site-card-sub'); if(c) c.textContent = share.selected.size+' selected';
});
on('exchange-share-next', ()=>{ share.step = 'who'; drawShare(); });
on('exchange-share-back', ()=>{ share.step = 'pick'; drawShare(); });
on('exchange-share-send', async (el)=>{
  const body = {
    company: val('xsCompany'), contactName: val('xsName'), email: val('xsEmail'), days: Number(val('xsDays')), allowDownload: val('xsDl'), message: val('xsMsg'),
    documents: [...share.selected.values()].map(d=>({ source:d.source, id:d.id })),
  };
  el.disabled = true;
  try{ const r = await api.post('/api/exchanges/share', body); closeSheet(); showToast('Shared ('+r.ref+'). '+body.email+' has been emailed a secure link.'); share = null; openExchange(r.id); }
  catch(e){ showToast(e.message); el.disabled = false; }
});

/* ============ bulk request (mines) ============ */
let bulk = null; // { q, records, selected:Map, plan }
async function searchRecords(){
  bulk.records = bulk.q.trim().length >= 2 ? (await api.get('/api/exchanges/records?q='+encodeURIComponent(bulk.q.trim()))).records : [];
}
function drawBulk(){
  if(bulk.plan){
    const p = bulk.plan;
    openSheet(sheetHead('Confirm bulk request', bulk.selected.size+' document'+(bulk.selected.size===1?'':'s')+' · '+p.groups.length+' compan'+(p.groups.length===1?'y':'ies'))
      +'<div class="notice">Each company gets one secure request listing its documents. Nothing is sent until you confirm.</div>'
      +'<div class="card">'+p.groups.map(g=>{ const missing = !g.contactEmail;
        return '<div class="reqrow" style="align-items:flex-start;"><div class="reqrow-main"><div class="reqrow-name">'+esc(g.contractorName)+'</div><div class="site-card-sub">'+g.count+' document'+(g.count===1?'':'s')+(missing ? '' : ' → '+esc((g.contactName ? g.contactName+' · ' : '')+g.contactEmail))+'</div>'
          +(missing ? '<div class="form-error" style="margin-top:6px;">No contact email yet — enter one to include this company.</div><input type="email" id="xb-'+esc(g.contractorId)+'" placeholder="Contact email" maxlength="254" style="margin-top:6px;">' : '')+'</div></div>'; }).join('')+'</div>'
      +'<label class="field-label" for="xbDeadline">Needed by (optional)</label><input id="xbDeadline" type="date">'
      +'<label class="field-label" for="xbMsg">Message (optional)</label><textarea id="xbMsg" maxlength="2000"></textarea>'
      +'<div class="flexbetween" style="margin-top:14px; gap:8px;"><button class="btn secondary" data-action="exchange-bulk-back">Back</button><button class="btn primary" data-action="exchange-bulk-send">Send '+p.groups.length+' request'+(p.groups.length===1?'':'s')+'</button></div>');
    return;
  }
  const byCompany = {};
  bulk.records.forEach(r=>{ (byCompany[r.contractorName] = byCompany[r.contractorName] || []).push(r); });
  openSheet(sheetHead('Bulk request', 'Search your contractors\' records, select, and request fresh copies')
    +'<div class="page-search">'+ICONS.search+'<input type="search" id="xbQ" value="'+esc(bulk.q)+'" placeholder="e.g. Working at Heights, medical, a contractor" data-action-input="exchange-bulk-search" autocomplete="off"></div>'
    +'<div class="flexbetween" style="margin:8px 2px;"><span class="site-card-sub" id="xbCount">'+bulk.selected.size+' selected</span>'+(bulk.records.length ? '<button class="btn small ghost" data-action="exchange-bulk-all">Select all '+bulk.records.length+'</button>' : '')+'</div>'
    +'<div class="card" style="max-height:46vh; overflow:auto;">'+(bulk.records.length ? Object.entries(byCompany).map(([name, rows])=>'<div class="section-title" style="margin:10px 2px 4px;">'+esc(name)+'</div>'+rows.map(r=>
        '<label class="reqrow" style="cursor:pointer;"><input type="checkbox" data-action="exchange-bulk-pick" data-key="'+esc(r.key)+'"'+(bulk.selected.has(r.key)?' checked':'')+'>'
        +'<div class="reqrow-main"><div class="reqrow-name">'+esc(r.documentType)+(r.personName ? ' — '+esc(r.personName) : '')+'</div>'
        +'<div class="site-card-sub">'+esc([r.siteName, r.expiry ? 'expires '+fmtDate(r.expiry) : '', r.contactEmail ? '' : 'no contact email yet'].filter(Boolean).join(' · '))+'</div></div></label>').join('')).join('')
      : '<div class="list-empty">'+(bulk.q.trim().length >= 2 ? 'Nothing matches.' : 'Type at least two letters to search certificates, site documents and earlier requests.')+'</div>')+'</div>'
    +'<button class="btn primary block" style="margin-top:12px;" data-action="exchange-bulk-review"'+(bulk.selected.size?'':' disabled')+'>Review '+bulk.selected.size+' selected</button>');
  const q = document.getElementById('xbQ'); if(q){ q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}
const bulkItems = () => [...bulk.selected.values()].map(r=>({ contractorId:r.contractorId, documentType:r.documentType, personName:r.personName || '', ...(r.workerId ? { workerId:r.workerId } : {}) }));
let bulkTimer = null;
on('exchange-bulk', ()=>{ bulk = { q:'', records:[], selected:new Map(), plan:null }; drawBulk(); });
on('exchange-bulk-search', (el)=>{
  bulk.q = el.value;
  clearTimeout(bulkTimer);
  bulkTimer = setTimeout(async ()=>{ try{ await searchRecords(); drawBulk(); }catch(e){ showToast(e.message); } }, 300);
});
function bulkCount(){
  const c = document.getElementById('xbCount'); if(c) c.textContent = bulk.selected.size+' selected';
  const b = document.querySelector('[data-action="exchange-bulk-review"]'); if(b){ b.disabled = !bulk.selected.size; b.textContent = 'Review '+bulk.selected.size+' selected'; }
}
on('exchange-bulk-pick', (el)=>{
  const r = bulk.records.find(x=>x.key === el.dataset.key);
  if(el.checked && r) bulk.selected.set(r.key, r); else bulk.selected.delete(el.dataset.key);
  bulkCount();
});
on('exchange-bulk-all', ()=>{ bulk.records.forEach(r=>bulk.selected.set(r.key, r)); drawBulk(); });
on('exchange-bulk-review', async (el)=>{
  el.disabled = true;
  try{ bulk.plan = await api.post('/api/exchanges/bulk-request', { items:bulkItems(), dryRun:true }); drawBulk(); }
  catch(e){ showToast(e.message); el.disabled = false; }
});
on('exchange-bulk-back', ()=>{ bulk.plan = null; drawBulk(); });
on('exchange-bulk-send', async (el)=>{
  const contacts = {};
  for(const g of bulk.plan.groups) if(!g.contactEmail){
    const email = val('xb-'+g.contractorId);
    if(!email){ document.getElementById('xb-'+g.contractorId).focus(); return showToast('Enter a contact email for '+g.contractorName+'.'); }
    contacts[g.contractorId] = { name:'', email };
  }
  const body = { items:bulkItems(), contacts, message: val('xbMsg') };
  const deadline = val('xbDeadline'); if(deadline) body.deadline = deadline;
  el.disabled = true;
  try{
    const r = await api.post('/api/exchanges/bulk-request', body);
    closeSheet(); bulk = null; invalidateExchanges();
    S.nav = 'more'; S.moreView = 'exchanges'; S.exchangeId = null; S.exchangeTab = 'sent'; render();
    showToast(r.created.length+' request'+(r.created.length===1?'':'s')+' sent.');
  }catch(e){ showToast(e.message); el.disabled = false; }
});

/* ============ claim earlier exchanges ============ */
on('exchange-claim', ()=>{
  const list = cache.claimable.exchanges;
  const mismatch = list.some(x=>!x.sameCompany);
  openSheet(sheetHead('Link earlier exchanges', 'Sent to '+esc(S.boot.me.email)+' before you had a workspace')
    +'<div class="notice">Only link exchanges that belong to '+esc(org().name)+'. Linking shows their status and history here; it doesn\'t give you anything from the sender\'s workspace, and nothing is merged.</div>'
    +'<div class="card">'+list.map(x=>'<label class="reqrow" style="cursor:pointer;"><input type="checkbox" class="xc-pick" value="'+esc(x.id)+'" checked>'
      +'<div class="reqrow-main"><div class="reqrow-name">'+esc(x.senderOrgName)+' · '+esc(x.ref)+'</div><div class="site-card-sub">'+(x.direction==='request'?'Request':'Share')+' · '+esc(fmtDate(x.createdAt))+' · addressed to “'+esc(x.recipientOrgName || 'no company given')+'”</div>'
      +(x.sameCompany ? '' : '<div class="reqrow-meta"><span class="badge expiring">Different company name</span></div>')+'</div></label>').join('')+'</div>'
    +'<label class="toggle-row" style="cursor:pointer;"><span>I confirm these exchanges belong to '+esc(org().name)+'.</span><input type="checkbox" id="xcConfirm"></label>'
    +(mismatch ? '<label class="toggle-row" style="cursor:pointer;"><span>Some were addressed to a different company name. I confirm they are still ours.</span><input type="checkbox" id="xcDiff"></label>' : '')
    +'<button class="btn primary block" style="margin-top:12px;" data-action="exchange-claim-send">Link to '+esc(org().name)+'</button>');
});
on('exchange-claim-send', async (el)=>{
  const ids = [...document.querySelectorAll('.xc-pick:checked')].map(i=>i.value);
  if(!ids.length) return showToast('Select at least one exchange.');
  if(!val('xcConfirm')) return showToast('Tick the confirmation first.');
  el.disabled = true;
  try{
    const r = await api.post('/api/exchanges/claim', { ids, confirm:true, confirmDifferentCompany: !!val('xcDiff') });
    closeSheet(); invalidateExchanges(); S.exchangeTab = 'received'; render();
    showToast(r.claimed+' exchange'+(r.claimed===1?'':'s')+' linked.');
  }catch(e){ showToast(e.message); el.disabled = false; }
});
