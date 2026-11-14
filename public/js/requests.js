// Request document: one sheet for the four kinds of request (replacement, signed copy, general, other).
// It rides on COMVERA Exchange, so the recipient needs no account. The server decides what is allowed and fills in
// the site, contractor and document; this screen only offers what the server says is possible and reports honestly
// what happened to the email.
import { api } from './api.js';
import { S, ICONS, escapeHtml as esc, on, render, showToast, openSheet, closeSheet, sheetHead, val, readOnly, isOrgAdmin, canReview } from './core.js';

let R = null; // { kind, pre, contacts, f:{...}, sources, busy }

const KINDS = [
  ['replacement', 'Replacement document', 'Ask for a new copy of a document'],
  ['signature', 'Signed copy of this document', 'Send a document to be signed and returned'],
  ['document', 'General document request', 'A document you name, or one from a requirement'],
  ['other', 'Other document', 'Something that is not on any list'],
];
const REASONS = ['Expired', 'Incorrect', 'Incomplete', 'Unreadable', 'Out of date'];
const fmt = (v) => v ? new Date(v).toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' }) : '';
export const canRequest = () => (isOrgAdmin() || canReview()) && !readOnly();

/** Opens the form. Pass the document you are on (requirementId, or sourceKind + sourceId) and the kind to preselect. */
export async function openRequestDocument(opts = {}){
  if(!canRequest()) return showToast('Only owners, admins and reviewers with an active plan can send requests.');
  R = { kind: opts.kind || null, pre: null, contacts: [], f: {}, sources: null, source: null, busy: false, force: false };
  try{
    if(opts.requirementId || opts.sourceId){
      const q = opts.requirementId ? 'requirementId='+encodeURIComponent(opts.requirementId) : 'sourceKind='+encodeURIComponent(opts.sourceKind)+'&sourceId='+encodeURIComponent(opts.sourceId);
      R.pre = await api.get('/api/exchanges/prefill?'+q);
      if(R.pre.contractor){
        const c = await api.get('/api/exchanges/contacts?contractorId='+encodeURIComponent(R.pre.contractor.id));
        R.contacts = c.contacts;
      }
      R.f.name = (R.pre.contact || R.contacts[0] || {}).name || '';
      R.f.email = (R.pre.contact || R.contacts[0] || {}).email || '';
      R.f.person = (R.pre.person || {}).name || '';
      R.f.reason = R.pre.suggestedReason || '';
      if(!R.kind) R.kind = R.pre.suggestion || (R.pre.allowed.replacement ? 'replacement' : 'document');
      if(R.pre.source) R.source = { kind: R.pre.source.kind, id: R.pre.source.id, label: R.pre.source.label, version: R.pre.source.version };
    }
  }catch(e){ return showToast(e.message); }
  if(!R.kind) R.kind = 'document';
  draw();
}

function allowed(kind){
  const a = R.pre ? R.pre.allowed : { replacement: false, signature: true, document: true, other: true };
  return a[kind] !== false;
}
function whyNot(kind){
  if(kind === 'replacement') return 'A replacement is requested from a document on a site you run. Open the document and choose Request replacement.';
  if(kind === 'signature') return 'There is no file on this document yet, so there is nothing to sign.';
  return '';
}

function readForm(){
  const g = (id) => val(id);
  const f = R.f;
  for(const [k, id] of [['name','rqName'],['email','rqEmail'],['reason','rqReason'],['due','rqDue'],['docName','rqDocName'],['person','rqPerson'],['company','rqCompany']]){
    const el = document.getElementById(id); if(el) f[k] = g(id);
  }
}

function recipientBlock(){
  const f = R.f, pre = R.pre;
  const pick = R.contacts.length > 1 ? '<label class="field-label" for="rqPick">Send to</label><select id="rqPick" class="field" data-action-change="rq-pick">'
    + R.contacts.map((k,i)=>'<option value="'+i+'"'+(k.email===f.email?' selected':'')+'>'+esc((k.name ? k.name+' — ' : '')+k.email)+'</option>').join('')+'<option value="new">Someone else…</option></select>' : '';
  return '<div class="section-title">Who will receive it</div>'
    + (pre && pre.contractor ? '<div class="site-card-sub">'+esc(pre.contractor.name)+(pre.siteName ? ' · '+esc(pre.siteName) : '')+'</div>' : '')
    + (!pre || !pre.contractor ? '<label class="field-label" for="rqCompany">Company or person</label><input id="rqCompany" type="text" maxlength="200" value="'+esc(f.company||'')+'">' : '')
    + pick
    + '<label class="field-label" for="rqName">Name</label><input id="rqName" type="text" maxlength="200" value="'+esc(f.name||'')+'" autocomplete="off">'
    + '<label class="field-label" for="rqEmail">Email</label><input id="rqEmail" type="email" maxlength="254" value="'+esc(f.email||'')+'" autocomplete="off">'
    + (!f.email && R.kind === 'signature' ? '<div class="site-card-sub">No email on file for this person. Send it to a supervisor or contact who can get it signed, or have it signed in person and upload the signed copy under Documents.</div>' : '')
    + '<div class="site-card-sub" style="margin-top:4px;">They get a secure link, confirm this email with a one-time code and need no account.</div>';
}

function draw(){
  const f = R.f, pre = R.pre, kind = R.kind;
  const chips = '<div class="rq-kinds" role="radiogroup" aria-label="Type of request">' + KINDS.map(([k, label, sub])=>{
    const ok = allowed(k);
    return '<button type="button" class="rq-kind'+(k===kind?' on':'')+'" role="radio" aria-checked="'+(k===kind)+'" data-action="rq-kind" data-kind="'+k+'"'+(ok?'':' disabled aria-disabled="true"')+'><strong>'+esc(label)+'</strong><span>'+esc(sub)+'</span></button>';
  }).join('') + '</div>';
  let body = chips;
  if(!allowed(kind)) body += '<div class="notice">'+esc(whyNot(kind))+'</div>';
  const disabledOthers = KINDS.filter(([k])=>!allowed(k)).map(([k])=>whyNot(k));
  if(disabledOthers.length) body += '<div class="site-card-sub" style="margin:6px 0;">'+esc(disabledOthers[0])+'</div>';

  // The document: carried across from where you started, or typed / picked.
  if(pre && kind !== 'other'){
    body += '<div class="card rq-about"><div class="qa-title">'+esc(pre.documentType)+'</div><div class="qa-sub">'
      + esc([pre.siteName, pre.contractor && pre.contractor.name, pre.source && pre.source.version ? 'version '+pre.source.version : '', pre.source && pre.source.status && pre.source.status !== 'complete' ? pre.source.status.replace('_',' ') : '', pre.source && pre.source.expiryDate ? 'valid to '+fmt(pre.source.expiryDate) : ''].filter(Boolean).join(' · '))+'</div></div>';
  } else if(kind === 'signature'){
    body += signaturePicker();
  }
  if(kind === 'document' && !pre || kind === 'other' || (kind === 'replacement' && !pre)){
    body += '<label class="field-label" for="rqDocName">'+(kind==='other' ? 'Document name' : 'Which document?')+'</label>'
      + '<input id="rqDocName" type="text" maxlength="200" list="rqDocs" value="'+esc(f.docName||'')+'" placeholder="'+(kind==='other' ? 'e.g. Site access letter' : 'e.g. Working at Heights certificate')+'" '+(kind==='other'?'required':'')+'>'
      + '<datalist id="rqDocs">'+['Medical certificate of fitness','Working at Heights certificate','Letter of Good Standing (COID)','Public liability insurance','Risk assessment','Method statement'].map(n=>'<option value="'+esc(n)+'">').join('')+'</datalist>';
  }
  if(kind === 'signature') body += '<label class="field-label" for="rqPerson">Who must sign</label><input id="rqPerson" type="text" maxlength="200" value="'+esc(f.person||'')+'" placeholder="Worker or person\'s name">';

  body += recipientBlock();

  body += '<div class="section-title">'+(kind==='replacement' ? 'Why a replacement?' : 'Instruction')+'</div>';
  if(kind === 'replacement') body += '<div class="rq-reasons">'+REASONS.map(r=>'<button type="button" class="chip" data-action="rq-reason" data-reason="'+esc(r)+'">'+esc(r)+'</button>').join('')+'</div>';
  body += '<input id="rqReason" type="text" maxlength="1000" value="'+esc(f.reason ?? (kind==='signature' ? 'Please sign and return' : ''))+'" placeholder="'+(kind==='replacement' ? 'Say what to fix (required)' : kind==='signature' ? 'Please sign and return' : 'Anything they should know (optional)')+'" aria-label="Reason or instruction">';
  body += '<label class="field-label" for="rqDue">Due date (optional)</label><input id="rqDue" type="date" value="'+esc(f.due||'')+'">';
  if(kind === 'signature') body += '<div class="site-card-sub" style="margin-top:8px;">They download the document, sign it (print and sign, or any signing tool they trust) and return the signed copy. COMVERA records the copy that comes back; it does not verify signatures. A later revision of the document needs its own signature.</div>';
  if(kind === 'replacement') body += '<div class="site-card-sub" style="margin-top:8px;">The new upload is filed as the next version and waits for your review. The old version and its history stay.</div>';
  if(kind === 'other') body += '<div class="site-card-sub" style="margin-top:8px;">This does not become a safety-file requirement or change readiness.</div>';
  body += '<div id="rqNote"></div><button class="btn primary block" style="margin-top:14px;" data-action="rq-send"'+(allowed(kind)?'':' disabled')+'>Send request</button>';
  openSheet(sheetHead('Request document', pre ? pre.documentType : 'Ask for a document, a replacement or a signed copy')+body);
}

function signaturePicker(){
  if(R.source) return '<div class="card rq-about"><div class="qa-title">'+esc(R.source.label)+'</div><div class="qa-sub">'+esc(R.source.version ? 'version '+R.source.version : '')+' <button class="linkish" data-action="rq-source-clear">Change</button></div></div>';
  return '<label class="field-label" for="rqSrcQ">Document to sign</label><input id="rqSrcQ" type="search" placeholder="Search your documents" data-action-input="rq-source-search" autocomplete="off">'
    + '<div id="rqSrcList" class="card" style="max-height:30vh;overflow:auto;">'+sourceList()+'</div>';
}
function sourceList(){
  if(!R.sources) return '<div class="list-empty">Loading…</div>';
  if(!R.sources.length) return '<div class="list-empty">No documents with a file yet. Upload the document first.</div>';
  return R.sources.map((s,i)=>'<button class="menu-row" data-action="rq-source-pick" data-i="'+i+'"><div style="flex:1;"><div class="qa-title">'+esc(s.name)+'</div><div class="qa-sub">'+esc([s.person, s.site, s.version ? 'version '+s.version : ''].filter(Boolean).join(' · '))+'</div></div></button>').join('');
}
async function loadSources(q){
  try{ R.sources = (await api.get('/api/exchanges/sources?q='+encodeURIComponent(q||''))).sources; }catch(e){ R.sources = []; showToast(e.message); }
  const el = document.getElementById('rqSrcList'); if(el) el.innerHTML = sourceList();
}

on('rq-kind', (el)=>{ readForm(); R.kind = el.dataset.kind; if(R.kind === 'replacement' && R.pre && !R.f.reason) R.f.reason = R.pre.suggestedReason || ''; draw(); if(R.kind === 'signature' && !R.source && !R.pre) loadSources(''); });
on('rq-reason', (el)=>{ const i = document.getElementById('rqReason'); if(i){ i.value = el.dataset.reason; i.focus(); } const n = document.getElementById('rqNote'); if(n) n.innerHTML = ''; });
on('rq-pick', (el)=>{ const k = el.value === 'new' ? { name:'', email:'' } : R.contacts[Number(el.value)]; document.getElementById('rqName').value = k.name || ''; document.getElementById('rqEmail').value = k.email || ''; });
on('rq-source-search', (el)=>{ clearTimeout(R.t); R.t = setTimeout(()=>loadSources(el.value), 250); });
on('rq-source-pick', (el)=>{ readForm(); const s = R.sources[Number(el.dataset.i)]; R.source = { kind: s.kind, id: s.id, label: s.name, version: s.version }; if(s.person && !R.f.person) R.f.person = s.person; draw(); });
on('rq-source-clear', ()=>{ readForm(); R.source = null; draw(); loadSources(''); });

function buildBody(){
  const f = R.f, pre = R.pre, kind = R.kind;
  const item = { kind, reason: f.reason || '', dueDate: f.due || undefined };
  if(kind === 'replacement' && pre && pre.requirementId) item.requirementId = pre.requirementId;
  else if(kind === 'document' && pre && pre.requirementId) item.requirementId = pre.requirementId;
  else item.documentType = f.docName || (pre && pre.documentType) || '';
  if(kind === 'signature'){
    if(!R.source) throw new Error('Choose the document that needs signing.');
    item.source = { kind: R.source.kind, id: R.source.id };
    item.personName = f.person || '';
  }
  if(kind === 'replacement' && !(pre && pre.requirementId) && !item.documentType) throw new Error('Say which document you need.');
  if(kind === 'other' && !item.documentType) throw new Error('Enter the name of the document you need.');
  if(kind === 'replacement' && (item.reason||'').length < 3) throw new Error('Say why a replacement is needed — tap a reason or type one.');
  if(!f.email) throw new Error(kind === 'signature' ? 'Enter an email for someone who can get this signed.' : 'Enter the email address to send it to.');
  const body = { contactName: f.name || '', email: f.email, items: [item], force: R.force };
  if(pre && pre.contractor) body.contractorId = pre.contractor.id; else body.company = f.company || '';
  if(f.due) body.deadline = f.due;
  return body;
}

/** What can honestly be said about the email: queued is not delivered, and no mail server means nothing left the server. */
export function deliveryText(e){
  if(!e) return '';
  return ({
    not_configured: 'Email is not set up on this server, so nothing was sent. The request exists; ask your administrator to set up email, then send a reminder.',
    queued: 'The email is queued. Delivery is not confirmed yet.',
    retrying: 'The email could not be delivered yet and is being retried.',
    sent: 'The email was handed to the mail server. It does not tell us whether it was read.',
    failed: 'The email could not be delivered. Check the address, then send a reminder to try again.',
    none: '',
  })[e.state] || '';
}

on('rq-send', async (el)=>{
  if(R.busy) return;
  readForm();
  const note = document.getElementById('rqNote');
  let body;
  try{ body = buildBody(); }catch(e){ if(note) note.innerHTML = '<div class="form-error" role="alert">'+esc(e.message)+'</div>'; return; }
  R.busy = true; el.disabled = true;
  try{
    const r = await api.post('/api/exchanges/request', body);
    if(r.duplicate){
      R.busy = false; el.disabled = false;
      if(note) note.innerHTML = '<div class="notice"><strong>Already requested.</strong> '+esc(r.duplicate.ref)+' was sent '+esc(fmt(r.duplicate.createdAt))+' and is still open. Send a reminder instead of a second request?'
        +'<div class="row-actions" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;"><button class="btn small primary" data-action="rq-remind" data-id="'+esc(r.duplicate.id)+'">Send a reminder</button>'
        +'<button class="btn small secondary" data-action="exchange-open" data-id="'+esc(r.duplicate.id)+'">View it</button>'
        +'<button class="btn small ghost" data-action="rq-force">Request anyway</button></div></div>';
      return;
    }
    R.busy = false;
    openSheet(sheetHead('Request '+esc(r.ref)+' created', 'Waiting for '+esc(body.email))
      +'<div class="notice" style="margin:0 0 12px;">'+esc(deliveryText(r.email))+'</div>'
      +'<button class="btn primary block" data-action="exchange-open" data-id="'+esc(r.id)+'">View request</button><button class="btn secondary block" style="margin-top:8px;" data-action="close-sheet">Done</button>');
    S.exchangeStale = true;
  }catch(e){ R.busy = false; el.disabled = false; if(note) note.innerHTML = '<div class="form-error" role="alert">'+esc(e.message)+'</div>'; }
});
on('rq-force', (el)=>{ R.force = true; const b = document.querySelector('[data-action="rq-send"]'); if(b){ b.click(); } });
on('rq-remind', async (el)=>{
  el.disabled = true;
  try{ const r = await api.post('/api/exchanges/'+encodeURIComponent(el.dataset.id)+'/resend', {}); closeSheet(); showToast(deliveryText(r.email) || 'Reminder queued.'); }
  catch(e){ showToast(e.message); el.disabled = false; }
});

/* ---- entry points ---- */
on('request-document', (el)=>openRequestDocument({ kind: el.dataset.kind || null, requirementId: el.dataset.req || undefined, sourceKind: el.dataset.sourceKind || undefined, sourceId: el.dataset.sourceId || undefined }));

/** The block on a requirement for site reviewers: ask for a replacement or another document, and see what is already open. */
export function requirementRequestBlock(reqId, eff){
  if(!canRequest() || !canReview()) return '';
  const suggest = eff === 'expired' || eff === 'expiring';
  return '<div class="card rq-block"><div class="qa-title">Ask the contractor</div>'
    + (suggest ? '<div class="site-card-sub">This document '+(eff==='expired' ? 'has expired' : 'expires soon')+'. Ask for a new copy.</div>' : '<div class="site-card-sub">Incorrect, incomplete or unreadable? Ask for a replacement without a comment thread.</div>')
    + '<div id="rqOpen" data-req="'+esc(reqId)+'"></div>'
    + '<div class="row-actions" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;"><button class="btn small '+(suggest?'primary':'secondary')+'" data-action="request-document" data-kind="replacement" data-req="'+esc(reqId)+'">Request replacement</button>'
    + '<button class="btn small secondary" data-action="request-document" data-kind="signature" data-req="'+esc(reqId)+'">Request signature</button></div></div>';
}
/** Fills the "already requested" list in an open requirement sheet. */
export async function hydrateOutstanding(reqId){
  const box = document.getElementById('rqOpen');
  if(!box || box.dataset.req !== reqId) return;
  try{
    const r = await api.get('/api/exchanges/outstanding?requirementId='+encodeURIComponent(reqId));
    if(!r.open.length) return;
    box.innerHTML = r.open.map(o=>'<button class="reqrow" data-action="exchange-open" data-id="'+esc(o.id)+'" style="width:100%;text-align:left;"><div class="reqrow-main"><div class="reqrow-name">'+esc(o.kindLabel)+' requested · '+esc(o.ref)+'</div>'
      +'<div class="site-card-sub">'+esc(o.status==='submitted' ? 'Returned — waiting for your review' : o.status==='rejected' ? 'Sent back — waiting for a new copy' : 'Waiting for '+o.recipientEmail)+(o.dueDate ? ' · due '+esc(fmt(o.dueDate)) : '')+'</div></div></button>').join('');
  }catch{ /* the block still works without the list */ }
}

/** A small block for a company document or worker certificate: request a signature. */
export function signatureButton(sourceKind, sourceId, label){
  if(!canRequest()) return '';
  return '<button class="btn secondary small" data-action="request-document" data-kind="signature" data-source-kind="'+esc(sourceKind)+'" data-source-id="'+esc(sourceId)+'">'+ICONS.link+' '+esc(label || 'Request signature')+'</button>';
}
