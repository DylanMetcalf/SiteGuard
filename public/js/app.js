// SiteGuard web app entry point: boot, render, event delegation and live sync.

import { api } from './api.js';
import { S, ICONS, actions, reload, setRender, showToast, closeSheet } from './core.js';
import { handleDeepLink, renderAuth, renderNoOrg } from './auth.js';
import { topbar, bottomNav, renderView } from './views.js';
import './sheets.js';

const app = document.getElementById('app');

function render(){
  const b = S.boot;
  if(!b){ app.innerHTML = '<div class="empty"><p>Loading…</p></div>'; return; }
  if(!b.authenticated || S.authView){
    app.innerHTML = renderAuth();
    stopLive();
    return;
  }
  if(!b.org){ app.innerHTML = renderNoOrg(); stopLive(); return; }
  // Don't yank the page out from under someone typing in it.
  const active = document.activeElement;
  if(active && app.contains(active) && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName) && S.deferRender){
    active.addEventListener('blur', ()=>render(), { once:true });
    return;
  }
  const y = window.scrollY;
  app.innerHTML = topbar() + '<main class="view">'+renderView()+'</main>' + bottomNav();
  if(S.keepScroll) window.scrollTo(0, y);
  startLive();
  maybeShowTutorial();
}
setRender(render);

/* ============ event delegation ============ */
function dispatch(name, el, e){
  const fn = actions[name];
  if(!fn) return;
  Promise.resolve(fn(el, e)).catch(err=>showToast(err.message || 'Something went wrong'));
}
document.addEventListener('click', (e)=>{
  const el = e.target.closest('[data-action]');
  if(!el || el.disabled) return;
  if(el.tagName==='A' && el.getAttribute('href')) return;
  if(el.type==='checkbox') return; // handled on change
  e.preventDefault();
  dispatch(el.dataset.action, el, e);
});
document.addEventListener('change', (e)=>{
  const el = e.target;
  if(el.dataset && el.dataset.actionChange) dispatch(el.dataset.actionChange, el, e);
  else if(el.type==='checkbox' && el.dataset.action) dispatch(el.dataset.action, el, e);
  else if(el.id==='personaSel') switchPersona(el.value);
  else if(el.id==='verifySel'){ S.verifySiteId = el.value; render(); }
});
document.addEventListener('input', (e)=>{
  const el = e.target;
  if(el.dataset && el.dataset.actionInput) dispatch(el.dataset.actionInput, el, e);
});
document.addEventListener('keydown', (e)=>{
  if(e.key==='Escape') closeSheet();
  if((e.key==='Enter' || e.key===' ') && e.target.matches('[role="button"][data-action]')){ e.preventDefault(); e.target.click(); }
  if(e.key==='Enter' && e.target.matches('#siPassword, #siEmail')){ const b = document.querySelector('[data-action="signin"]'); if(b) b.click(); }
});

async function switchPersona(userId){
  try{
    await api.post('/api/demo/switch', { userId });
    S.nav='dashboard'; S.activeSiteId=null; S.moreView=null; S.focusSiteId=null;
    closeSheet();
    await reload();
    showToast('Now viewing as '+S.boot.me.name.replace(/&amp;/g,'&'));
  }catch(e){ showToast(e.message); }
}

/* ============ live sync ============ */
let es = null, refetchTimer = null;
function startLive(){
  if(es || typeof EventSource === 'undefined') return;
  es = new EventSource('/api/events');
  es.addEventListener('open', ()=>{ if(!S.live){ S.live = true; updateLiveDot(); } });
  es.addEventListener('change', ()=>{
    clearTimeout(refetchTimer);
    refetchTimer = setTimeout(()=>{ S.keepScroll = true; S.deferRender = true; reload().catch(()=>{}).finally(()=>{ S.keepScroll = false; S.deferRender = false; }); }, 250);
  });
  es.addEventListener('error', ()=>{
    S.live = false; updateLiveDot();
    // EventSource retries by itself; if the session ended, stop and re-check.
    if(es && es.readyState === EventSource.CLOSED){ stopLive(); setTimeout(()=>reload().catch(()=>{}), 3000); }
  });
}
function stopLive(){ if(es){ es.close(); es = null; } S.live = false; }
function updateLiveDot(){ const d = document.querySelector('.live-dot'); if(d) d.classList.toggle('off', !S.live); }
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible' && S.boot && S.boot.org){ S.keepScroll = true; reload().catch(()=>{}).finally(()=>{ S.keepScroll=false; }); } });

/* ============ first-run tutorial (from the MVP) ============ */
const TUTORIAL_STEPS = [
  {title:'Your sites, at a glance', text:'Pick the site you\'re working on and SiteGuard shows you exactly what\'s outstanding — no digging through folders or spreadsheets.'},
  {title:'One tap to log anything', text:'The + button is always there — upload a document, log today\'s site diary, report an incident or record a toolbox talk, from wherever you are.'},
  {title:'Your whole team, live', text:'Colleagues and contractors see the same record as you, on any device. Expiring certificates, corrections and open incidents are flagged — and emailed — automatically.'},
];
let tutorialStep = 0, tutorialChecked = false;
function maybeShowTutorial(){
  if(tutorialChecked) return;
  tutorialChecked = true;
  let seen = false;
  try{ seen = localStorage.getItem('sg_tutorial_seen')==='1'; }catch{ seen = true; }
  if(!seen) showTutorialStep();
}
function showTutorialStep(){
  document.querySelectorAll('.overlay.tutorial').forEach(o=>o.remove());
  const step = TUTORIAL_STEPS[tutorialStep];
  const isLast = tutorialStep===TUTORIAL_STEPS.length-1;
  const overlay = document.createElement('div');
  overlay.className='overlay tutorial';
  overlay.innerHTML = '<div class="sheet tut-card" role="dialog" aria-modal="true"><div class="tut-icon">'+ICONS.sparkle+'</div><h2>'+step.title+'</h2><p>'+step.text+'</p>'
    +'<div class="tut-dots">'+TUTORIAL_STEPS.map((s,i)=>'<span class="'+(i===tutorialStep?'active':'')+'"></span>').join('')+'</div>'
    +'<button class="btn orange block" id="tutNext">'+(isLast?'Get started':'Next')+'</button>'
    +(isLast?'':'<button class="btn secondary block" style="margin-top:8px;" id="tutSkip">Skip</button>')+'</div>';
  document.body.appendChild(overlay);
  overlay.querySelector('#tutNext').onclick = ()=>{ if(isLast) finishTutorial(); else { tutorialStep++; showTutorialStep(); } };
  const skip = overlay.querySelector('#tutSkip'); if(skip) skip.onclick = finishTutorial;
}
function finishTutorial(){
  try{ localStorage.setItem('sg_tutorial_seen','1'); }catch{ /* private mode */ }
  document.querySelectorAll('.overlay.tutorial').forEach(o=>o.remove());
}

/* ============ boot ============ */
(async function boot(){
  render();
  try{
    // Fetch the session (and its CSRF token) first: some emailed links POST on arrival.
    await reload();
    await handleDeepLink();
    await reload();
    if(S.pendingToast){ showToast(S.pendingToast); S.pendingToast = null; }
  }catch(e){
    app.innerHTML = '<div class="empty"><h3>Can\'t reach SiteGuard</h3><p>'+(e.message||'')+'</p><p>Refresh the page to try again.</p></div>';
  }
})();
