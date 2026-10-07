// Review workspace: read a Document Studio document section by section.
// Reviewers approve or ask for changes per section and comment on highlighted
// text; the author edits sections in place, saves a new revision and
// resubmits. Guests with a review link use the same screen without an account.

import { api } from './api.js';
import { S, ICONS, escapeHtml, on, render, reload, showToast, isContractor, openSheet, closeSheet, sheetHead } from './core.js';

const R = () => (S.review ??= { id: null, token: null, data: null, drafts: {}, editing: null, form: null, keep: {}, loading: false, error: '' });

/* ---------- Loading ---------- */
/** Opens a document; `reqId` ties it to one requirement (the one the mine is vetting). */
export function openReview(id, reqId){
  const r = R();
  if(r.id !== id || (r.req || null) !== (reqId || null)){ S.review = { id, req: reqId || null, token: null, data: null, drafts: {}, editing: null, form: null, keep: {}, loading: false, error: '' }; }
  closeSheet(true);
  S.nav = 'review';
  render(); window.scrollTo(0,0);
  load();
}
export function openGuestReview(token){
  S.review = { id: null, token, data: null, drafts: {}, editing: null, form: null, keep: {}, loading: false, error: '' };
  load();
}
async function load(){
  const r = R();
  if(r.loading) return;
  r.loading = true;
  try{
    r.data = await api.get(r.token ? '/api/review-links/'+encodeURIComponent(r.token) : '/api/review/'+r.id+(r.req ? '?req='+encodeURIComponent(r.req) : ''));
    if(!r.token && r.data.doc.id !== r.id) r.id = r.data.doc.id;
    r.error = '';
  }catch(e){ r.error = e.status===404 ? 'This document isn\'t available — the link may have expired or been withdrawn.' : e.message; }
  r.loading = false;
  render();
}
/** Live updates from colleagues: refresh the document without losing drafts or typing. */
export function refreshReview(){ const r = R(); if((r.id || r.token) && S.nav==='review' && !r.loading) load(); }

/* ---------- Rendering the document model ---------- */
function mark(text, quotes){
  let html = escapeHtml(text);
  for(const q of quotes){
    const eq = escapeHtml(q);
    const i = eq ? html.indexOf(eq) : -1;
    if(i >= 0) html = html.slice(0, i) + '<mark>' + eq + '</mark>' + html.slice(i + eq.length);
  }
  return html;
}
function blockHtml(b, quotes){
  switch(b.type){
    case 'paragraph': return '<p>'+mark(b.text, quotes)+'</p>';
    case 'note': return '<div class="rv-note">'+mark(b.text, quotes)+'</div>';
    case 'bullets': return '<ul>'+b.items.map(i=>'<li>'+mark(i, quotes)+'</li>').join('')+'</ul>';
    case 'numbered': return '<ol>'+b.items.map(i=>'<li>'+mark(i, quotes)+'</li>').join('')+'</ol>';
    case 'fields': return '<dl class="rv-fields">'+b.items.map(([k,v])=>'<dt>'+escapeHtml(k)+'</dt><dd>'+mark(v||'—', quotes)+'</dd>').join('')+'</dl>';
    case 'table': return '<div class="rv-table"><table><thead><tr>'+b.columns.map(c=>'<th>'+escapeHtml(c)+'</th>').join('')+'</tr></thead><tbody>'
      + b.rows.map(row=>'<tr>'+b.columns.map((_,k)=>{ const t = row[k] || ''; const m = /^\d+ (High|Medium|Low)$/.exec(t); return '<td'+(m?' class="rate '+m[1].toLowerCase()+'"':'')+'>'+mark(t, quotes)+'</td>'; }).join('')+'</tr>').join('')+'</tbody></table></div>';
    case 'signatures': return '<div class="rv-sign">'+b.roles.map(r=>'<div><span>'+escapeHtml(r)+'</span><i>Name · Signature · Date</i></div>').join('')+'</div>';
    default: return '';
  }
}

/* ---------- Editor ---------- */
function editorHtml(idx, blocks){
  return blocks.map((b, bi)=>{
    const id = 'ed_'+idx+'_'+bi;
    const ta = (v, rows, hint) => '<textarea id="'+id+'" rows="'+rows+'" data-rv-keep>'+escapeHtml(v)+'</textarea>'+(hint?'<div class="site-card-sub">'+hint+'</div>':'');
    switch(b.type){
      case 'paragraph': return '<label class="field-label" for="'+id+'">Paragraph</label>'+ta(b.text, 4);
      case 'note': return '<label class="field-label" for="'+id+'">Note</label>'+ta(b.text, 3);
      case 'bullets': case 'numbered': return '<label class="field-label" for="'+id+'">'+(b.type==='bullets'?'Bullet points':'Numbered steps')+'</label>'+ta(b.items.join('\n'), Math.min(12, b.items.length+2), 'One item per line.');
      case 'signatures': return '<label class="field-label" for="'+id+'">Sign-off roles</label>'+ta(b.roles.join('\n'), b.roles.length+1, 'One role per line.');
      case 'fields': return '<div class="field-label">Details</div><div class="rv-grid rv-grid-2">'+b.items.map(([k,v],ri)=>'<input type="text" id="'+id+'_k'+ri+'" value="'+escapeHtml(k)+'" aria-label="Label" data-rv-keep><input type="text" id="'+id+'_v'+ri+'" value="'+escapeHtml(v)+'" aria-label="Value" data-rv-keep>').join('')+'</div>';
      case 'table': return '<div class="field-label">Table</div><div class="rv-edit-table"><table><thead><tr>'+b.columns.map(c=>'<th>'+escapeHtml(c)+'</th>').join('')+'<th></th></tr></thead><tbody>'
        + b.rows.map((row, ri)=>'<tr>'+b.columns.map((_,k)=>'<td><textarea id="'+id+'_r'+ri+'c'+k+'" rows="2" data-rv-keep>'+escapeHtml(row[k]||'')+'</textarea></td>').join('')+'<td><button class="btn danger small" data-action="rv-row-del" data-sec="'+idx+'" data-block="'+bi+'" data-row="'+ri+'" aria-label="Remove row">✕</button></td></tr>').join('')
        +'</tbody></table></div><button class="btn secondary small" data-action="rv-row-add" data-sec="'+idx+'" data-block="'+bi+'">+ Add row</button>';
      default: return '';
    }
  }).join('');
}
/** Reads the editor inputs for a section back into blocks. */
function readEditor(idx, blocks){
  const v = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
  const lines = (s) => s.split('\n').map(x=>x.trim()).filter(Boolean);
  return blocks.map((b, bi)=>{
    const id = 'ed_'+idx+'_'+bi;
    switch(b.type){
      case 'paragraph': case 'note': return { ...b, text: v(id).trim() };
      case 'bullets': case 'numbered': return { ...b, items: lines(v(id)) };
      case 'signatures': return { ...b, roles: lines(v(id)) };
      case 'fields': return { ...b, items: b.items.map((_, ri)=>[v(id+'_k'+ri).trim(), v(id+'_v'+ri).trim()]) };
      case 'table': return { ...b, rows: b.rows.map((_, ri)=>b.columns.map((__, k)=>v(id+'_r'+ri+'c'+k).trim())) };
      default: return b;
    }
  }).filter(b=>!((b.type==='paragraph'||b.type==='note') && !b.text));
}
const sectionBlocks = (r, s) => r.drafts[s.index] || s.blocks;

/* ---------- The screen ---------- */
function statusPill(s, r){
  if(r.drafts[s.index]) return '<span class="badge sage">Edited — not saved</span>';
  if(!s.status) return '<span class="badge grey">To review</span>';
  return s.status.decision==='approved'
    ? '<span class="badge complete">Approved · '+escapeHtml(s.status.by)+'</span>'
    : '<span class="badge missing">Changes requested · '+escapeHtml(s.status.by)+'</span>';
}
function commentHtml(c, canResolve){
  return '<div class="rv-comment'+(c.resolvedAt?' resolved':'')+'">'
    +(c.quote?'<blockquote>“'+escapeHtml(c.quote)+'”</blockquote>':'')
    +'<div>'+escapeHtml(c.body)+'</div>'
    +'<div class="rv-meta">'+escapeHtml(c.authorName)+' · '+({owner:'author',host:'site reviewer',external:'external reviewer'})[c.authorKind]+' · Rev '+c.revision+' · '+new Date(c.createdAt).toLocaleDateString('en-ZA')
    +(c.resolvedAt?' · resolved by '+escapeHtml(c.resolvedBy||''):'')
    +(!c.resolvedAt && canResolve?' · <button class="linkish" data-action="rv-resolve" data-id="'+c.id+'">Mark resolved</button>':'')+'</div></div>';
}
function inlineForm(r, s, kind){
  const id = 'rvf_'+s.index;
  const q = r.form && r.form.quote ? '<blockquote>“'+escapeHtml(r.form.quote)+'”</blockquote>' : '';
  const label = kind==='changes' ? 'What needs to change?' : 'Comment';
  return '<div class="rv-form">'+q+'<label class="field-label" for="'+id+'">'+label+'</label><textarea id="'+id+'" rows="3" maxlength="2000" data-rv-keep placeholder="'+(kind==='changes'?'Be specific, e.g. add the isolation points for the drive station':'Your comment')+'"></textarea>'
    +'<div class="row-actions"><button class="btn primary small" data-action="rv-send" data-sec="'+s.index+'">'+(kind==='changes'?'Request changes':'Post comment')+'</button><button class="btn secondary small" data-action="rv-form-cancel">Cancel</button></div></div>';
}

function sectionHtml(r, s){
  const d = r.data, v = d.viewer;
  const comments = d.comments.filter(c=>c.sectionIndex===s.index && c.sectionHeading===s.heading);
  const open = comments.filter(c=>!c.resolvedAt), done = comments.filter(c=>c.resolvedAt);
  const quotes = open.map(c=>c.quote).filter(Boolean);
  const editing = r.editing === s.index;
  const blocks = sectionBlocks(r, s);
  let actions = '';
  if(!editing){
    if(v.canDecide){
      actions += '<button class="btn sage small" data-action="rv-approve" data-sec="'+s.index+'"'+(s.status&&s.status.decision==='approved'?' disabled':'')+'>'+ICONS.check+' Approve</button>'
        +'<button class="btn secondary small" data-action="rv-form" data-kind="changes" data-sec="'+s.index+'">Needs changes</button>';
    }
    if(v.canComment) actions += '<button class="btn secondary small" data-action="rv-form" data-kind="comment" data-sec="'+s.index+'">Comment</button>';
    if(v.canEdit) actions += '<button class="btn secondary small" data-action="rv-edit" data-sec="'+s.index+'">Edit</button>';
  } else {
    actions = '<button class="btn primary small" data-action="rv-edit-done" data-sec="'+s.index+'">Done</button><button class="btn secondary small" data-action="rv-edit-cancel" data-sec="'+s.index+'">Cancel</button>';
  }
  const formOpen = r.form && r.form.sec === s.index;
  return '<article class="rv-sec'+(s.status&&!r.drafts[s.index]?' is-'+s.status.decision:'')+'" data-sec="'+s.index+'" id="rvsec'+s.index+'">'
    +'<header><h3><span class="rv-num">'+(s.index+1)+'</span>'+escapeHtml(s.heading)+'</h3>'+statusPill(s, r)+'</header>'
    +(editing ? '<div class="rv-editor">'+editorHtml(s.index, blocks)+'</div>' : '<div class="rv-body" data-sec="'+s.index+'">'+blocks.map(b=>blockHtml(b, quotes)).join('')+'</div>')
    +(open.length ? '<div class="rv-comments">'+open.map(c=>commentHtml(c, v.role!=='external')).join('')+'</div>' : '')
    +(done.length ? '<details class="rv-done"><summary>'+done.length+' resolved comment'+(done.length===1?'':'s')+'</summary>'+done.map(c=>commentHtml(c, false)).join('')+'</details>' : '')
    +(formOpen ? inlineForm(r, s, r.form.kind) : '')
    +(actions ? '<div class="rv-actions">'+actions+'</div>' : '')
    +'</article>';
}

function barHtml(r){
  const d = r.data, v = d.viewer, t = d.target, sum = d.summary;
  const drafts = Object.keys(r.drafts).length;
  if(v.role==='owner'){
    if(drafts) return '<div class="rv-bar"><span>'+drafts+' section'+(drafts===1?'':'s')+' edited</span><button class="btn primary" data-action="rv-save">Save as Rev '+(d.doc.revision+1)+'</button></div>';
    if(t && (t.submittedRevision===null || t.submittedRevision < d.doc.revision) && (isContractor()))
      return '<div class="rv-bar"><span>Rev '+d.doc.revision+' isn\'t submitted to '+escapeHtml(t.siteName)+' yet</span><button class="btn primary" data-action="rv-resubmit">'+(t.submittedRevision===null?'Submit for review':'Resubmit for review')+'</button></div>';
    return '';
  }
  if(v.role==='host' && v.canDecide && t){
    const allOk = sum.approved === sum.total;
    const pending = t.status === 'awaiting_review';
    return '<div class="rv-bar"><span>'+sum.approved+' of '+sum.total+' approved'+(sum.changes?' · '+sum.changes+' need changes':'')+'</span>'
      +(pending && sum.changes ? '<button class="btn danger" data-action="rv-sendback">Send back with changes</button>' : '')
      +(pending ? '<button class="btn primary" data-action="rv-approve-doc"'+(allOk?'':' disabled title="Approve every section first"')+'>Approve document</button>' : '<span class="badge '+(t.status==='complete'?'complete':'grey')+'">'+(t.status==='complete'?'Approved':'Not awaiting review')+'</span>')
      +'</div>';
  }
  if(v.role==='external'){
    return '<div class="rv-bar"><label for="rvGuestName" class="sr-only">Your name</label><input type="text" id="rvGuestName" placeholder="Your name and company (shown with your comments)" value="'+escapeHtml(r.guestName||'')+'" maxlength="120" data-rv-keep></div>';
  }
  return '';
}

export function renderReview(){
  const r = R();
  if(r.error) return '<div class="empty"><h3>Can\'t open this document</h3><p>'+escapeHtml(r.error)+'</p>'+(r.token?'':'<button class="btn secondary" data-action="goto-more" data-view="studio">Go to Document Studio</button>')+'</div>';
  if(!r.data) return '<div class="empty"><p>Opening the document…</p></div>';
  const d = r.data, v = d.viewer, sum = d.summary, t = d.target;
  const pct = sum.total ? Math.round(sum.approved / sum.total * 100) : 0;
  let html = '';
  if(!r.token) html += '<div style="margin-bottom:12px;"><button class="btn secondary small" data-action="rv-back">← Back</button></div>';
  html += '<div class="dash-hero rv-hero"><p class="hero-eyebrow">'+({owner:'Your document',host:'Review requested',external:'Review requested by '+escapeHtml((d.link&&d.link.companyName)||'')})[v.role]+'</p>'
    +'<h1>'+escapeHtml(d.doc.title)+'</h1>'
    +'<p class="greeting">'+escapeHtml(d.doc.docNumber)+' · Rev '+d.doc.revision+(d.doc.subtitle?' · '+escapeHtml(d.doc.subtitle):'')+'</p>'
    +'<div class="rv-progress" role="img" aria-label="'+sum.approved+' of '+sum.total+' sections approved"><i style="width:'+pct+'%"></i></div>'
    +'<div class="hero-stats"><div class="hero-stat"><b>'+sum.approved+'</b><span>Approved</span></div><div class="hero-stat"><b>'+sum.changes+'</b><span>Need changes</span></div><div class="hero-stat"><b>'+(sum.total-sum.approved-sum.changes)+'</b><span>To review</span></div></div>'
    +'<div class="row-actions" style="margin-top:14px;">'
      +(d.doc.pdfFileId?'<a class="btn secondary small" href="/api/files/'+d.doc.pdfFileId+'" target="_blank" rel="noopener">Open PDF</a>':'')
      +(d.doc.docxFileId?'<a class="btn secondary small" href="/api/files/'+d.doc.docxFileId+'?download=1">Word</a>':'')
      +(r.token?'<a class="btn secondary small" href="/api/review-links/'+encodeURIComponent(r.token)+'/pdf" target="_blank" rel="noopener">Download PDF</a>':'')
      +(v.role==='owner'?'<button class="btn secondary small" data-action="rv-share">Share for review</button>':'')
    +'</div></div>';
  if(t) html += '<div class="notice">'+(v.role==='host' ? 'Submitted by the contractor for <strong>'+escapeHtml(t.requirementName)+'</strong> at '+escapeHtml(t.siteName)+'. ' : 'For <strong>'+escapeHtml(t.requirementName)+'</strong> at '+escapeHtml(t.siteName)+' — '+({awaiting_review:'waiting on review',correction_required:'changes requested',complete:'approved',missing:'not submitted yet'}[t.status]||t.status)+'. ')
    +(v.canDecide ? 'Approve each section or ask for changes. To highlight text, select it before tapping <em>Comment</em>.' : v.role==='owner' ? 'Edit any section, then save a new revision and resubmit — sections already approved stay approved unless you change them.' : '')+'</div>';
  else if(v.role==='external') html += '<div class="notice">Read each section, then approve it or say what needs to change. To highlight text, select it before tapping <em>Comment</em>. Your name is shown with your feedback.</div>';
  html += d.sections.map(s=>sectionHtml(r, s)).join('');
  const general = d.comments.filter(c=>c.sectionIndex===null);
  html += '<div class="section-title">General comments</div><div class="card">'+(general.length?general.map(c=>commentHtml(c, v.role!=='external')).join(''):'<div class="site-card-sub">No general comments yet.</div>')
    +(v.canComment?'<div class="row-actions"><button class="btn secondary small" data-action="rv-form" data-kind="comment" data-sec="-1">Add a general comment</button></div>'+(r.form&&r.form.sec===-1?inlineForm(r, {index:-1}, 'comment'):''):'')+'</div>';
  if(v.role==='owner' && d.revisions.length > 1) html += '<div class="section-title">Revision history</div><div class="card">'+d.revisions.map(x=>'<div class="kv"><span>Rev '+x.revision+' · '+escapeHtml(x.by)+'</span><span>'+escapeHtml(x.note||'')+'</span></div>').join('')+'</div>';
  html += barHtml(r);
  setTimeout(restoreKept, 0);
  return '<div class="rv">'+html+'</div>';
}

/* Keep typed text through re-renders (live updates from other people). */
function restoreKept(){ const r = R(); for(const [id, val] of Object.entries(r.keep)){ const el = document.getElementById(id); if(el && el.value !== val) el.value = val; } }
document.addEventListener('input', (e)=>{ const t = e.target; if(t && t.hasAttribute && t.hasAttribute('data-rv-keep') && t.id){ R().keep[t.id] = t.value; if(t.id==='rvGuestName'){ R().guestName = t.value; try{ localStorage.setItem('sg_guest_name', t.value); }catch{} } } });
let lastSel = null;
document.addEventListener('selectionchange', ()=>{
  const sel = window.getSelection(); const text = sel ? sel.toString().trim() : '';
  if(!text) return;
  const node = sel.anchorNode && (sel.anchorNode.nodeType===1 ? sel.anchorNode : sel.anchorNode.parentElement);
  const body = node && node.closest ? node.closest('.rv-body') : null;
  if(body) lastSel = { sec: Number(body.dataset.sec), text: text.slice(0, 400) };
});

/* ---------- Actions ---------- */
const secOf = (el) => Number(el.dataset.sec);
const sectionByIndex = (i) => R().data.sections.find(s=>s.index===i);
const base = () => { const r = R(); return r.token ? '/api/review-links/'+encodeURIComponent(r.token) : '/api/review/'+r.data.doc.id; };
function guestName(){
  const r = R(); const n = (r.guestName || '').trim();
  if(n.length < 2){ const el = document.getElementById('rvGuestName'); if(el) el.focus(); showToast('Add your name and company at the bottom first'); return null; }
  return n;
}
async function busy(el, fn){ if(el.disabled) return; el.disabled = true; try{ await fn(); }catch(e){ showToast(e.message); } el.disabled = false; }

on('rv-back', ()=>{ if(history.length > 1) history.back(); else { S.nav='more'; S.moreView='studio'; render(); } });
on('rv-form', (el)=>{
  const r = R(); const sec = secOf(el);
  r.form = { sec, kind: el.dataset.kind, quote: lastSel && lastSel.sec === sec ? lastSel.text : '' };
  lastSel = null; render();
  setTimeout(()=>{ const t = document.getElementById('rvf_'+sec); if(t){ t.focus(); t.scrollIntoView({ block:'center' }); } }, 30);
});
on('rv-form-cancel', ()=>{ const r = R(); if(r.form) delete r.keep['rvf_'+r.form.sec]; r.form = null; render(); });
on('rv-send', (el)=>busy(el, async ()=>{
  const r = R(); const f = r.form; if(!f) return;
  const body = (document.getElementById('rvf_'+f.sec)||{}).value?.trim() || '';
  if(!body){ showToast(f.kind==='changes' ? 'Say what needs to change' : 'Write your comment first'); return; }
  const name = r.token ? guestName() : null; if(r.token && !name) return;
  if(f.kind==='changes'){
    await api.post(base()+'/decision', { sectionHash: sectionByIndex(f.sec).hash, decision:'changes', note: body, quote: f.quote || '', ...(name?{name}:{}) });
  } else {
    await api.post(base()+'/comments', { sectionIndex: f.sec < 0 ? null : f.sec, quote: f.quote || '', body, ...(name?{name}:{}) });
  }
  delete r.keep['rvf_'+f.sec]; r.form = null;
  showToast(f.kind==='changes' ? 'Changes requested — the author has been notified' : 'Comment posted');
  await load();
}));
on('rv-approve', (el)=>busy(el, async ()=>{
  const r = R(); const name = r.token ? guestName() : null; if(r.token && !name) return;
  await api.post(base()+'/decision', { sectionHash: sectionByIndex(secOf(el)).hash, decision:'approved', note:'', ...(name?{name}:{}) });
  await load();
  const next = R().data.sections.find(s=>!s.status || s.status.decision!=='approved');
  if(next){ const n = document.getElementById('rvsec'+next.index); if(n) n.scrollIntoView({ behavior:'smooth', block:'start' }); }
  else showToast('Every section is approved');
}));
on('rv-resolve', (el)=>busy(el, async ()=>{ await api.post('/api/review/comments/'+el.dataset.id+'/resolve'); await load(); }));
on('rv-edit', (el)=>{ const r = R(); r.editing = secOf(el); S.deferRender = true; render(); const n = document.getElementById('rvsec'+r.editing); if(n) n.scrollIntoView({ block:'start' }); });
on('rv-edit-cancel', (el)=>{ const r = R(); const i = secOf(el); r.editing = null; S.deferRender = false; for(const k of Object.keys(r.keep)) if(k.startsWith('ed_'+i+'_')) delete r.keep[k]; render(); });
on('rv-edit-done', (el)=>{
  const r = R(); const i = secOf(el); const s = sectionByIndex(i);
  const blocks = readEditor(i, sectionBlocks(r, s));
  if(!blocks.length){ showToast('A section needs some content'); return; }
  if(JSON.stringify(blocks) === JSON.stringify(s.blocks)) delete r.drafts[i]; else r.drafts[i] = blocks;
  for(const k of Object.keys(r.keep)) if(k.startsWith('ed_'+i+'_')) delete r.keep[k];
  r.editing = null; S.deferRender = false; render();
});
on('rv-row-add', (el)=>{
  const r = R(); const i = secOf(el); const s = sectionByIndex(i);
  const blocks = readEditor(i, sectionBlocks(r, s)); const b = blocks[Number(el.dataset.block)];
  if(b && b.type==='table'){ b.rows.push(b.columns.map(()=>'')); r.drafts[i] = blocks; for(const k of Object.keys(r.keep)) if(k.startsWith('ed_'+i+'_')) delete r.keep[k]; render(); }
});
on('rv-row-del', (el)=>{
  const r = R(); const i = secOf(el); const s = sectionByIndex(i);
  const blocks = readEditor(i, sectionBlocks(r, s)); const b = blocks[Number(el.dataset.block)];
  if(b && b.type==='table' && b.rows.length > 1){ b.rows.splice(Number(el.dataset.row), 1); r.drafts[i] = blocks; for(const k of Object.keys(r.keep)) if(k.startsWith('ed_'+i+'_')) delete r.keep[k]; render(); }
  else showToast('A table needs at least one row');
});
on('rv-save', (el)=>busy(el, async ()=>{
  const r = R(); const d = r.data;
  if(r.editing !== null){ showToast('Tap Done on the section you are editing first'); return; }
  const sections = d.sections.map(s=>({ heading: s.heading, blocks: r.drafts[s.index] || s.blocks }));
  el.textContent = 'Saving…';
  const out = await api.post('/api/review/'+d.doc.id+'/save', { sections });
  r.drafts = {}; r.keep = {}; r.id = out.id;
  showToast('Saved as Rev '+out.revision);
  await load();
}));
on('rv-resubmit', (el)=>busy(el, async ()=>{
  const r = R(); const d = r.data; const t = d.target;
  const a = await api.post('/api/documents/'+encodeURIComponent(t.requirementId)+'/attach-generated', { generatedId: d.doc.id });
  await api.post('/api/documents/'+encodeURIComponent(t.requirementId)+'/submit', { note: a.note, expiryDate: a.reviewDue });
  showToast('Submitted for review — the site has been notified');
  await reload(); await load();
}));
on('rv-approve-doc', (el)=>busy(el, async ()=>{
  const t = R().data.target;
  await api.post('/api/documents/'+encodeURIComponent(t.requirementId)+'/approve');
  showToast('Document approved — the contractor has been notified');
  await reload(); await load();
}));
on('rv-sendback', (el)=>busy(el, async ()=>{
  const d = R().data;
  const lines = d.sections.filter(s=>s.status && s.status.decision==='changes').map(s=>'• '+s.heading+': '+(s.status.note||'see comments'));
  const text = 'Changes needed in '+lines.length+' section'+(lines.length===1?'':'s')+' (see the review workspace for details):\n'+lines.join('\n');
  await api.post('/api/documents/'+encodeURIComponent(d.target.requirementId)+'/correction', { text: text.slice(0, 3900) });
  showToast('Sent back to the contractor with your notes');
  await reload(); await load();
}));

/* ---------- Share for review (owner) ---------- */
on('rv-share', ()=>{
  const d = R().data; if(!d) return;
  const links = (d.links||[]).filter(l=>!l.revokedAt && new Date(l.expiresAt) > new Date());
  openSheet(sheetHead('Share for review', escapeHtml(d.doc.title))
    +'<div class="site-card-sub">Anyone with the link can read this document, approve sections and comment — no COMVERA account needed. It always shows the latest revision. Their feedback lands in your inbox.</div>'
    +'<label class="field-label" for="rvLinkLabel">Who is it for?</label><input type="text" id="rvLinkLabel" maxlength="120" placeholder="e.g. Naledi, SHE Manager at Leeuwpan">'
    +'<label class="field-label" for="rvLinkDays">Link works for</label><select id="rvLinkDays" class="field"><option value="7">7 days</option><option value="14" selected>14 days</option><option value="30">30 days</option></select>'
    +'<button class="btn primary block" style="margin-top:12px;" data-action="rv-link-create">Create review link</button><div id="rvLinkOut"></div>'
    +(links.length?'<div class="section-title">Active links</div>'+links.map(l=>'<div class="kv"><span>'+escapeHtml(l.label||'Review link')+' · until '+new Date(l.expiresAt).toLocaleDateString('en-ZA')+(l.lastUsedAt?' · opened':'')+'</span><button class="linkish" data-action="rv-link-revoke" data-id="'+l.id+'">Withdraw</button></div>').join(''):''));
});
on('rv-link-create', (el)=>busy(el, async ()=>{
  const d = R().data;
  const out = await api.post('/api/review/'+d.doc.id+'/links', { label: document.getElementById('rvLinkLabel').value.trim(), days: Number(document.getElementById('rvLinkDays').value) });
  document.getElementById('rvLinkOut').innerHTML = '<div class="copy-box"><input type="text" id="rvLinkUrl" readonly value="'+escapeHtml(out.url)+'"><button class="btn secondary small" data-action="rv-link-copy">Copy</button></div><div class="site-card-sub" style="margin-top:6px;">Send it by email or WhatsApp. It only opens this document, for '+out.days+' days.</div>';
  el.style.display = 'none';
  load();
}));
on('rv-link-copy', async ()=>{ const i = document.getElementById('rvLinkUrl'); try{ await navigator.clipboard.writeText(i.value); showToast('Link copied'); }catch{ i.select(); showToast('Select the link and copy it'); } });
on('rv-link-revoke', (el)=>busy(el, async ()=>{ await api.del('/api/review/links/'+el.dataset.id); showToast('Link withdrawn'); closeSheet(); await load(); }));

try{ R().guestName = localStorage.getItem('sg_guest_name') || ''; }catch{ /* storage blocked */ }
