// SiteGuard web app entry point: boot, render, event delegation and live sync.

import { api } from './api.js';
import { S, ICONS, actions, on, reload, setRender, showToast, closeSheet, consumeSkippedPop, afterPendingBack } from './core.js';
import { handleDeepLink, renderAuth, renderNoOrg } from './auth.js';
import { topbar, bottomNav, renderView } from './views.js';
import './sheets.js';
import './assistant.js';
import { refreshStudio } from './studio.js';
import { refreshGuide } from './guide.js';
import { renderReview, openGuestReview, refreshReview, openReview } from './review.js';
import './inbox.js';
import './builder.js';
import './safetyfiles.js';
import { maybeOfferTour } from './tour.js';

const app = document.getElementById('app');

/* ---- Phone back button: each screen gets a history entry; Back returns to the previous screen. ---- */
let restoring = false;
const navOf = () => ({ nav: S.nav || 'dashboard', moreView: S.moreView || null, activeSiteId: S.activeSiteId || null, siteTab: S.siteTab || null, wp: S.activeWorkplaceId || null, wpTab: S.wpTab || null });
const sameNav = (a, b) => a.nav === b.nav && (a.moreView || null) === (b.moreView || null) && (a.activeSiteId || null) === (b.activeSiteId || null) && (a.siteTab || null) === (b.siteTab || null) && (a.wp || null) === (b.wp || null) && (a.wpTab || null) === (b.wpTab || null);
function syncHistory(){
  if(restoring || !S.boot || !S.boot.authenticated) return;
  afterPendingBack(()=>{
    const st = navOf(), cur = history.state;
    if(!cur || !cur.nav){ history.replaceState(st, ''); return; }
    if(cur.sheet) return;
    if(!sameNav(cur, st)) history.pushState(st, '');
  });
}
window.addEventListener('popstate', (e)=>{
  if(consumeSkippedPop()) return;
  if(document.querySelector('.overlay:not(.tutorial)')){ closeSheet(true); return; }
  const st = e.state;
  if(!st || !st.nav || st.sheet || !S.boot || !S.boot.authenticated || sameNav(st, navOf())) return;
  S.nav = st.nav; S.moreView = st.moreView; S.activeSiteId = st.activeSiteId; if(st.siteTab) S.siteTab = st.siteTab; S.activeWorkplaceId = st.wp || null; if(st.wpTab) S.wpTab = st.wpTab;
  restoring = true; render(); restoring = false; window.scrollTo(0,0);
});
window.addEventListener('sg:signed-out', ()=>{
  if(!S.boot || !S.boot.authenticated) return;
  closeSheet(true);
  reload().then(()=>showToast('You were signed out — sign in again to carry on.')).catch(()=>{});
});

// Send unexpected browser errors to the server log (a few per page load), so bugs surface without a user report.
let reported = 0;
function reportError(message, stack){
  if(reported++ >= 5 || !message) return;
  const view = [S.nav, S.moreView, S.siteTab].filter(Boolean).join('/');
  api.post('/api/client-errors', { message: String(message).slice(0,2000), stack: stack ? String(stack).slice(0,4000) : undefined, url: location.pathname, view }).catch(()=>{});
}
window.addEventListener('error', (e)=>reportError(e.message, e.error && e.error.stack));
window.addEventListener('unhandledrejection', (e)=>{ const r = e.reason || {}; if(r.name==='ApiError' || r.status!==undefined) return; reportError(r.message || String(r), r.stack); });

let wasOutside = false;
function render(){
  const b = S.boot;
  if(!b){ app.innerHTML = '<div class="empty"><p>Loading…</p></div>'; return; }
  if(S.guestReviewToken){
    // Someone opening a review link: no account needed, just the document.
    app.innerHTML = '<div class="guest-top"><div class="brand"><div class="brand-mark"></div><div class="brand-text"><div class="brand-name">SiteGuard</div><div class="brand-tag" style="display:block;">Document review</div></div></div></div><main class="view">'+renderReview()+'</main>';
    return;
  }
  if(!b.authenticated || S.authView){
    app.innerHTML = renderAuth();
    stopLive();
    wasOutside = true;
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
  // Keep the cursor in a page's search box when the page redraws (typing, or a live update).
  const typing = active && active.dataset && active.dataset.search ? { key: active.dataset.search, pos: active.selectionStart } : null;
  const arriving = wasOutside; wasOutside = false; // just signed in or up: start at the top, not where the form was scrolled
  app.innerHTML = topbar() + '<main class="view">'+renderView()+'</main>' + bottomNav();
  syncHistory();
  if(arriving) window.scrollTo(0, 0); else if(S.keepScroll || typing) window.scrollTo(0, y);
  if(typing){ const n = document.querySelector('[data-search="'+typing.key+'"]'); if(n){ n.focus(); try{ n.setSelectionRange(typing.pos, typing.pos); }catch{ /* search inputs in some browsers */ } } }
  startLive();
  maybeOfferTour();
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
  if(e.key==='Enter' && e.target.matches('#askDash')){ e.preventDefault(); const b = document.querySelector('[data-action="ask-dashboard"]'); if(b) b.click(); }
  if(e.key==='Enter' && e.target.matches('#siPassword, #siEmail')){ const b = document.querySelector('[data-action="signin"]'); if(b) b.click(); }
});

async function switchPersona(userId){
  try{
    await api.post('/api/demo/switch', { userId });
    S.nav='dashboard'; S.activeSiteId=null; S.activeWorkplaceId=null; S.moreView=null; S.focusSiteId=null;
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
    refetchTimer = setTimeout(()=>{ S.keepScroll = true; S.deferRender = true; reload().then(()=>{ refreshReview(); refreshStudio(); refreshGuide(); }).catch(()=>{}).finally(()=>{ S.keepScroll = false; S.deferRender = false; }); }, 250);
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

/* ============ boot ============ */
// Installable app + a friendly offline page. Never caches records (see /sw.js).
if('serviceWorker' in navigator && location.protocol !== 'file:'){
  window.addEventListener('load', ()=>{ navigator.serviceWorker.register('/sw.js').catch(()=>{}); });
}
(async function boot(){
  render();
  try{
    // Fetch the session (and its CSRF token) first: some emailed links POST on arrival.
    await reload();
    const rv = /^\/review\/([A-Za-z0-9_-]{20,100})$/.exec(location.pathname);
    if(rv){ S.guestReviewToken = rv[1]; openGuestReview(rv[1]); return; }
    await handleDeepLink();
    await reload();
    if(S.pendingToast){ showToast(S.pendingToast); S.pendingToast = null; }
  }catch(e){
    app.innerHTML = '<div class="empty"><h3>Can\'t reach SiteGuard</h3><p>'+(e.message||'')+'</p><p>Refresh the page to try again.</p></div>';
  }
})();

on('open-review', (el)=>openReview(el.dataset.id, el.dataset.req));
