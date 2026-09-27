// In-app inbox: notifications for review requests, feedback, approvals and
// corrections, so everything can be handled without leaving SiteGuard.

import { api } from './api.js';
import { S, ICONS, on, actions, openSheet, closeSheet, sheetHead, render, timeAgo } from './core.js';
import { openReview } from './review.js';
import { openReqSheet, computeTasks } from './sheets.js';

const KIND_ICON = { review: ICONS.passport, submitted: ICONS.passport, approved: ICONS.check, correction: ICONS.alert };

function rel(ts){
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if(m < 1) return 'just now'; if(m < 60) return m+' min ago'; if(m < 1440) return Math.round(m/60)+' h ago';
  return timeAgo(ts);
}

function renderInbox(){
  const inbox = S.boot.inbox || { items: [], unread: 0 };
  const tasks = computeTasks();
  let html = sheetHead('Inbox', inbox.unread ? inbox.unread+' new' : 'You\'re up to date');
  html += '<button class="qa-item" data-action="open-tasks" data-filter="all"><div class="qa-icon">'+ICONS.bell+'</div><div style="flex:1;"><div class="qa-title">Your to-do list</div><div class="qa-sub">'+(tasks.length ? tasks.length+' thing'+(tasks.length===1?'':'s')+' to do across your sites' : 'Nothing waiting on you')+'</div></div>'+ICONS.chevron+'</button>';
  html += '<div class="section-title">Notifications</div>';
  if(!inbox.items.length) html += '<div class="site-card-sub">Review requests, feedback, approvals and corrections appear here as they happen.</div>';
  html += inbox.items.map((n, i)=>'<button class="qa-item inbox-item'+(n.read?'':' unread')+'" data-action="inbox-go" data-i="'+i+'"><div class="qa-icon">'+(KIND_ICON[n.kind]||ICONS.bell)+'</div>'
    +'<div style="flex:1;min-width:0;"><div class="qa-title">'+n.title+'</div>'+(n.body?'<div class="qa-sub inbox-body">'+n.body+'</div>':'')+'<div class="qa-sub">'+rel(n.createdAt)+'</div></div></button>').join('');
  return html;
}

on('open-inbox', ()=>{
  openSheet(renderInbox());
  const inbox = S.boot.inbox;
  if(inbox && inbox.unread){
    api.post('/api/notifications/read').catch(()=>{});
    inbox.unread = 0;
    inbox.items.forEach(n=>{ n.read = true; });
    const b = document.querySelector('.bell-count'); if(b) b.remove();
  }
});

on('inbox-go', (el)=>{
  const n = ((S.boot.inbox||{}).items||[])[Number(el.dataset.i)];
  if(!n) return;
  const link = n.link || {};
  if(link.kind==='review' && link.id){ openReview(link.id); return; }
  closeSheet();
  if(link.kind==='req' && link.siteId && S.state.sites[link.siteId]){
    S.nav='sites'; S.activeSiteId=link.siteId; S.siteTab='compliance'; render(); window.scrollTo(0,0);
    if(link.id) setTimeout(()=>openReqSheet(link.id), 50);
    return;
  }
  if(link.kind==='site' && link.siteId && S.state.sites[link.siteId]){ S.nav='sites'; S.activeSiteId=link.siteId; render(); return; }
  if(link.kind==='studio'){ S.nav='more'; S.moreView='studio'; render(); return; }
  if(link.kind==='requests'){ actions['open-tasks']({ dataset:{ filter:'all' } }); return; }
});
