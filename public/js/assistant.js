// SiteGuard Assistant: a chat sheet over POST /api/assistant. The conversation
// lives only in this tab. Replies can carry cards (start a site, a checklist,
// a draft, open a site) that hand off to the normal, permission-checked flows.

import { api } from './api.js';
import { S, ICONS, escapeHtml, on, openSheet, closeSheet, sheetEl, render, showToast, isContractor, canCreateSite } from './core.js';
import { openNewSite, openDraft, loadPacks } from './sheets.js';

const chat = () => (S.chat ??= { items: [], busy: false });

const EXAMPLES_HOST = [
  'What does a contractor need for electrical work on a conveyor at a coal mine?',
  'What needs my attention today?',
  'Safety file requirements for scaffolding and welding on a plant shutdown',
];
const EXAMPLES_CONTRACTOR = [
  'What documents do I need for welding inside a tank at a gold mine?',
  'What needs my attention today?',
  'Draft a method statement for replacing conveyor idlers',
];

/** Minimal, safe formatting: escape everything, then allow **bold** and "- " bullets. */
function formatReply(text){
  const blocks = String(text || '').split(/\n{2,}/);
  return blocks.map((block)=>{
    const lines = block.split('\n');
    let html = '', inList = false;
    for(const raw of lines){
      const line = escapeHtml(raw).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      const bullet = /^\s*[-•*]\s+(.*)$/.exec(line);
      if(bullet){ if(!inList){ html += '<ul>'; inList = true; } html += '<li>'+bullet[1]+'</li>'; }
      else { if(inList){ html += '</ul>'; inList = false; } if(line.trim()) html += '<div>'+line+'</div>'; }
    }
    if(inList) html += '</ul>';
    return '<div class="chat-block">'+html+'</div>';
  }).join('');
}

function packName(packs, id){ const p = packs.find(x=>x.id===id); return p ? p.name : escapeHtml(id); }

function renderCard(card, mi, ci, packs){
  const btn = (action, label, cls) => '<button class="btn '+(cls||'secondary')+' small" data-action="'+action+'" data-mi="'+mi+'" data-ci="'+ci+'">'+label+'</button>';
  if(card.type === 'site_proposal'){
    const n = card.extraRequirements.length;
    return '<div class="chat-card"><div class="chat-card-title">'+ICONS.sites+' Start this site</div>'
      +'<div class="qa-title">'+(card.name ? escapeHtml(card.name) : 'New site')+(card.location ? ' <span class="site-card-sub">· '+escapeHtml(card.location)+'</span>' : '')+'</div>'
      +'<div class="site-card-sub">Packs: '+card.packIds.map(id=>packName(packs, id)).join(', ')+(n ? ' + '+n+' site-specific item'+(n===1?'':'s') : '')+'</div>'
      +(card.rationale ? '<div class="site-card-sub" style="margin-top:4px;">'+escapeHtml(card.rationale)+'</div>' : '')
      +'<div class="chat-card-actions">'+btn('chat-card-site', 'Review and create', 'primary')+'</div></div>';
  }
  if(card.type === 'checklist'){
    const byCat = {};
    for(const it of card.items) (byCat[it.category] ??= []).push(it.name);
    return '<div class="chat-card"><div class="chat-card-title">'+ICONS.check+' '+escapeHtml(card.title)+'</div>'
      + Object.entries(byCat).map(([cat, names])=>'<div class="site-card-sub" style="margin-top:6px;font-weight:600;">'+escapeHtml(cat)+'</div><ul>'+names.map(nm=>'<li>'+escapeHtml(nm)+'</li>').join('')+'</ul>').join('')
      +'<div class="chat-card-actions">'+btn('chat-card-copy', 'Copy checklist')+'</div></div>';
  }
  if(card.type === 'draft'){
    return '<div class="chat-card"><div class="chat-card-title">'+ICONS.sparkle+' '+escapeHtml(card.docType)+'</div>'
      +'<div class="chat-card-actions">'+btn('chat-card-draft', 'Draft it now', 'primary')+'</div></div>';
  }
  if(card.type === 'open_site'){
    return '<div class="chat-card chat-card-inline">'+btn('chat-card-open', ICONS.sites+' Open '+escapeHtml(card.name))+'</div>';
  }
  return '';
}

function safeUrl(u){ try{ const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; }catch{ return null; } }

function renderLog(packs){
  const c = chat();
  if(!c.items.length){
    const ex = isContractor() ? EXAMPLES_CONTRACTOR : EXAMPLES_HOST;
    return '<div class="chat-empty"><p>Ask what a site or job needs, check on your sites, or get a document drafted.</p>'
      + ex.map((q,i)=>'<button class="chat-chip" data-action="chat-example" data-i="'+i+'">'+escapeHtml(q)+'</button>').join('')
      +'</div>';
  }
  return c.items.map((m, mi)=>{
    if(m.role === 'user') return '<div class="chat-msg user">'+escapeHtml(m.content)+'</div>';
    const sources = (m.sources||[]).map(s=>({ url: safeUrl(s.url), title: s.title })).filter(s=>s.url);
    return '<div class="chat-msg bot">'
      +(m.notice ? '<div class="notice" style="margin-bottom:8px;">'+escapeHtml(m.notice)+'</div>' : '')
      + formatReply(m.content)
      +(sources.length ? '<div class="chat-sources"><div class="site-card-sub">Sources</div>'+sources.map(s=>'<a href="'+escapeHtml(s.url)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(s.title||s.url)+'</a>').join('')+'</div>' : '')
      +(m.cards||[]).map((card, ci)=>renderCard(card, mi, ci, packs)).join('')
      +'</div>';
  }).join('') + (c.busy ? '<div class="chat-msg bot chat-typing" aria-live="polite"><span></span><span></span><span></span></div>' : '');
}

async function refresh(){
  const log = document.getElementById('chatLog');
  if(!log) return;
  let packs = [];
  try{ packs = await loadPacks(); }catch{ /* names fall back to ids */ }
  log.innerHTML = renderLog(packs);
  log.scrollTop = log.scrollHeight;
  const send = document.getElementById('chatSend');
  if(send) send.disabled = chat().busy;
}

function modeLabel(){
  return S.boot.features.ai ? '<span class="badge green">AI</span>' : '<span class="badge grey">Built-in rules</span>';
}

export function openAssistant(question){
  openSheet('<div class="sheet-head"><div><h3>SiteGuard Assistant '+modeLabel()+'</h3><div class="site-card-sub">Guidance, not legal advice. Nothing changes until you confirm.</div></div>'
    +'<div style="display:flex;gap:6px;align-items:center;">'+(chat().items.length?'<button class="btn secondary small" data-action="chat-reset">New chat</button>':'')
    +'<button class="sheet-close" data-action="close-sheet" aria-label="Close">'+ICONS.cross+'</button></div></div>'
    +'<div id="chatLog" class="chat-log"></div>'
    +'<form class="chat-form" id="chatForm"><textarea id="chatInput" rows="2" maxlength="4000" placeholder="e.g. What does the safety file need for welding at Shaft 3?" aria-label="Message"></textarea>'
    +'<button class="btn primary" id="chatSend" type="submit">Send</button></form>');
  const sheet = sheetEl();
  if(sheet) sheet.classList.add('chat-sheet');
  const form = document.getElementById('chatForm');
  const input = document.getElementById('chatInput');
  form.addEventListener('submit', (e)=>{ e.preventDefault(); send(input.value); });
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(input.value); } });
  refresh();
  if(question) send(question); else setTimeout(()=>input.focus(), 30);
}

async function send(text){
  const c = chat();
  const q = String(text || '').trim();
  if(!q || c.busy) return;
  const input = document.getElementById('chatInput');
  if(input) input.value = '';
  c.items.push({ role:'user', content:q });
  c.busy = true;
  refresh();
  try{
    const r = await api.post('/api/assistant', { messages: c.items.map(m=>({ role:m.role, content:m.content })) });
    c.items.push({ role:'assistant', content:r.reply, cards:r.cards||[], sources:r.sources||[], notice:r.notice||'', mode:r.mode });
  }catch(e){
    c.items.pop();
    showToast(e.message);
    if(input) input.value = q;
  }
  c.busy = false;
  refresh();
}

const cardOf = (el) => { const m = chat().items[Number(el.dataset.mi)]; return m && m.cards ? m.cards[Number(el.dataset.ci)] : null; };

on('open-assistant', (el)=>openAssistant(el && el.dataset ? el.dataset.q : ''));
on('chat-example', (el)=>{ const ex = isContractor() ? EXAMPLES_CONTRACTOR : EXAMPLES_HOST; send(ex[Number(el.dataset.i)]); });
on('chat-reset', ()=>{ S.chat = { items: [], busy: false }; openAssistant(); });
on('chat-card-site', (el)=>{
  const card = cardOf(el); if(!card) return;
  if(!canCreateSite()){ showToast('Only admins can add sites'); return; }
  openNewSite({ name: card.name, location: card.location, packIds: card.packIds, extraRequirements: card.extraRequirements, fromAssistant: true });
});
on('chat-card-draft', (el)=>{ const card = cardOf(el); if(card) openDraft(card.docType, card.brief); });
on('chat-card-open', (el)=>{
  const card = cardOf(el); if(!card) return;
  if(!S.state.sites[card.siteId]){ showToast('That site isn\'t available to you any more'); return; }
  closeSheet();
  S.nav = 'sites'; S.activeSiteId = card.siteId; S.siteTab = 'compliance';
  render(); window.scrollTo(0,0);
});
on('chat-card-copy', async (el)=>{
  const card = cardOf(el); if(!card) return;
  const text = card.title + '\n' + card.items.map(i=>'[ ] '+i.category+' — '+i.name).join('\n');
  try{ await navigator.clipboard.writeText(text); showToast('Checklist copied'); }catch{ showToast('Copy failed'); }
});
on('ask-dashboard', ()=>{
  const q = document.getElementById('askDash');
  openAssistant(q ? q.value.trim() : '');
});
