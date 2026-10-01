// Platform overview for the people who run this SiteGuard service (PLATFORM_ADMIN_EMAILS).
// The server decides who may see it; this screen only shows what it returns.

import { api } from './api.js';
import { escapeHtml, timeAgo, render, showToast } from './core.js';

let cache = null;
async function load(){ cache = await api.get('/api/admin/overview'); render(); }
export function invalidatePlatform(){ cache = null; }

const stat = (label, value) => '<div class="kv"><span>'+escapeHtml(label)+'</span><span>'+escapeHtml(value)+'</span></div>';

export function renderPlatform(){
  if(!cache){ load().catch(e=>showToast(e.message)); return '<div class="empty"><p>Loading…</p></div>'; }
  const c = cache, u = c.usage, h = c.health;
  const kinds = Object.fromEntries(c.organisations.map(o=>[o.kind, o]));
  const host = kinds.host || {total:0,last30:0}, con = kinds.contractor || {total:0,last30:0};
  let html = '<div class="view-head"><h1>Platform</h1><p>Everyone on this SiteGuard service · demo accounts left out</p></div>';
  html += '<div class="section-title">Customers</div><div class="card">'
    + stat('Mines & principal employers', host.total+' ('+host.last30+' new in 30 days)')
    + stat('Contractor companies', con.total+' ('+con.last30+' new in 30 days)')
    + c.plans.map(p=>stat('Plan: '+p.plan, p.n)).join('')
    + c.subscriptionStatus.map(s=>stat('Subscription: '+s.status, s.n)).join('')
    + '</div>';
  html += '<div class="section-title">Usage</div><div class="card">'
    + stat('People', u.users+' ('+u.activeUsers7d+' active this week)')
    + stat('Sites (mine files)', u.sites) + stat('Contractor projects', u.projects) + stat('Site codes', u.workplaces)
    + stat('Documents on file', u.documentsFiled) + stat('Document Studio documents', u.studioDocuments)
    + stat('Safety file revisions', u.safetyFileRevisions) + stat('AI requests this month', u.aiRequestsThisMonth)
    + '</div>';
  html += '<div class="section-title">Health</div><div class="card">'
    + stat('Emails failed (7 days)', h.emailFailed7d) + stat('Emails waiting over an hour', h.emailStuck)
    + stat('Server running for', Math.round(h.uptimeSeconds/3600)+' hours')
    + ((h.emailFailed7d || h.emailStuck) ? '<div class="site-card-sub" style="margin-top:6px;">Check SMTP_URL and the server log if emails are failing.</div>' : '')
    + '</div>';
  html += '<div class="section-title">Latest sign-ups</div><div class="card">'
    + (c.recentSignups.length ? c.recentSignups.map(o=>'<div class="kv"><span>'+escapeHtml(o.name)+' <span class="site-card-sub">· '+(o.kind==='host'?'mine':'contractor')+' · '+escapeHtml(o.plan)+' · '+o.members+' member'+(o.members===1?'':'s')+'</span></span><span>'+timeAgo(o.createdAt)+'</span></div>').join('') : '<div class="site-card-sub">No sign-ups yet.</div>')
    + '</div>';
  html += '<div class="section-title">Latest feedback</div><div class="card">'
    + (c.recentFeedback.length ? c.recentFeedback.map(f=>'<div style="padding:6px 0;border-bottom:1px solid var(--line);"><div class="site-card-sub">'+(f.kind==='problem'?'Problem':'Idea')+' · '+escapeHtml(f.org||'—')+' · '+timeAgo(f.createdAt)+'</div><div>'+escapeHtml(f.message)+'</div></div>').join('') : '<div class="site-card-sub">No feedback yet.</div>')
    + '</div><div class="site-card-sub">Updated '+timeAgo(c.generatedAt)+'. <button class="linkish" data-action="platform-refresh">Refresh</button></div>';
  return html;
}
