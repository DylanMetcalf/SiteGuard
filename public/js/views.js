// Main screens. Rendering is ported from the original MVP; data now comes
// from the server and every button is a data-action handled in app.js.

import { api } from './api.js';
import {
  S, ICONS, SOURCE_LABEL, STATUS_LABEL, CERT_KINDS, LIBRARY_TYPES,
  org, role, isContractor, isHost, isOrgAdmin, canReview, canEdit, readOnly, myName, myContractorId, isDemoMode,
  computeReadiness, siteSubmissionStatus, statusLabelForSubmission, gauge, gaugeColor, badge, timeAgo, dateTime, initials,
  openSafetyIssues, orgOpenSafetyIssuesCount, incidentTypeInfo, permitTypeInfo, permitEffectiveStatus, effectiveStatus, certStatus,
  libraryReqId, contractorOf, daysUntil, on, act, render, reload, showToast, openSheet, sheetHead, closeSheet, searchBox, matchSearch, searching, escapeHtml, unescapeHtml, deepEscape, printHtml, findReq, actions,
} from './core.js';
import { computeTasks, sessionLabel } from './sheets.js';
import { renderStudio } from './studio.js';
import { buildButton } from './safetyfiles.js';
import { renderPlatform, invalidatePlatform } from './platform.js';
import { renderReview } from './review.js';
import { guideCard } from './guide.js';
import { renderWorkplace, workplaceCards } from './workplaces.js';
import { isProject, projectBar, projectsSection } from './projects.js';
import { suspendedBanner, suspendControls, gateSection, auditsSection, validityCard, revisionsLink, timelineSection } from './oversight.js';

/* ============ SHELL ============ */
export function topbar(){
  const highCount = computeTasks().filter(t=>t.priority==='high').length;
  const personas = S.boot.personas;
  return '<div class="topbar"><div class="brand-row">'
    +'<div class="brand"><div class="brand-mark"></div><div class="brand-text"><div class="brand-name">SiteGuard'+(isDemoMode()?' <span class="demo-tag">DEMO</span>':'')+'</div>'
    +'<div class="brand-tag"><span class="live-dot'+(S.live?'':' off')+'" title="'+(S.live?'Live — changes from colleagues appear automatically':'Reconnecting…')+'"></span>'+org().name+'</div></div></div>'
    +'<div class="identity">'
    +'<button class="identity-avatar" data-action="open-assistant" aria-label="Ask the SiteGuard Assistant" title="Ask the SiteGuard Assistant" style="background:var(--brand-bg); color:var(--brand-ink);">'+ICONS.sparkle+'</button>'
    +'<button class="identity-avatar" data-action="open-search" aria-label="Search" style="background:var(--paper-raised); color:var(--ink);">'+ICONS.search+'</button>'
    +(()=>{ const unread = (S.boot.inbox||{}).unread||0; return '<button class="identity-avatar" data-action="open-inbox" aria-label="Inbox'+(unread?', '+unread+' new':'')+'" style="background:var(--paper-raised); color:var(--ink); position:relative;">'+ICONS.bell+(unread?'<span class="bell-count">'+(unread>9?'9+':unread)+'</span>':highCount?'<span class="bell-dot"></span>':'')+'</button>'; })()
    +(personas && personas.length ? '<select class="persona-select" id="personaSel" aria-label="Demo persona" title="Demo persona — switches to another sample user (their real permissions apply)">'
        // In a clean start both people share one name, so lead with the company ("the mine" / "the contractor").
        + personas.map(p=>'<option value="'+p.userId+'"'+(p.current?' selected':'')+' title="'+p.label+'">'+(org().cleanDemo ? p.label.split(' · ')[1] : p.name+' ('+p.label.split(' · ')[1]+')')+'</option>').join('')+'</select>' : '')
    +'<button class="identity-avatar" data-action="open-profile" aria-label="Profile">'+initials(myName())+'</button></div>'
    +'</div>'+banners()+'</div>';
}

function banners(){
  const o = org(), f = S.boot.features;
  let html = '';
  if(o.isDemo) html += '<div class="banner warn"><span>'+(o.cleanDemo ? 'Your practice space — kept for 30 days. Switch between the mine and the contractor with the menu above.' : 'Demo with sample data. Switch people with the menu above.')+'</span><button class="btn small secondary" data-action="leave-demo">Create a real account</button></div>';
  if(!S.boot.me.verified) html += '<div class="banner info"><span>Confirm your email address — we sent a link to '+S.boot.me.email+'.</span><button class="btn small secondary" data-action="resend-verification">Resend</button></div>';
  if(f.billing && !o.isDemo){
    if(isContractor() && !o.ownAccess && o.standing!=='lapsed') html += '<div class="banner info"><span>'+(o.subscriptionStatus==='trialing'?'Your trial has ended. ':'')+'Sites that sponsor you are still covered. Your own projects and other clients need a contractor plan.</span>'+(isOrgAdmin()?'<button class="btn small secondary" data-action="goto-more" data-view="billing">See plans</button>':'')+'</div>';
    else if(o.standing==='lapsed') html += '<div class="banner bad"><span>Read-only: '+(o.subscriptionStatus==='trialing'?'your trial has ended':'your subscription is inactive')+'. Everything stays viewable; choose a plan to keep making changes.</span>'+(isOrgAdmin()?'<button class="btn small secondary" data-action="goto-more" data-view="billing">Billing</button>':'')+'</div>';
    else if(o.standing==='grace') html += '<div class="banner warn"><span>We couldn\'t take your last payment. Update your card to avoid interruption.</span>'+(isOrgAdmin()?'<button class="btn small secondary" data-action="billing-portal">Update card</button>':'')+'</div>';
    else if(o.subscriptionStatus==='trialing' && o.trialEndsAt){
      const days = Math.max(0, Math.ceil((new Date(o.trialEndsAt) - Date.now())/86400000));
      html += '<div class="banner info"><span>Trial: '+days+' day'+(days===1?'':'s')+' left on '+o.planName+'.</span>'+(isOrgAdmin()?'<button class="btn small secondary" data-action="goto-more" data-view="billing">Choose a plan</button>':'')+'</div>';
    }
  }
  return html;
}

export function bottomNav(){
  const tabs = [['dashboard','Dashboard',ICONS.dashboard],['sites',isContractor()?'Safety files':'Sites',ICONS.sites],null,['passport', isContractor()?'Documents':'Contractors', ICONS.passport],['more','More',ICONS.more]];
  return '<nav class="bottomnav"><div class="bottomnav-row">'
    + tabs.map(t=> t ? '<button data-action="nav" data-nav="'+t[0]+'" class="'+(S.nav===t[0]?'active':'')+'"'+(S.nav===t[0]?' aria-current="page"':'')+'>'+t[2]+'<span>'+t[1]+'</span></button>'
      : '<button class="fab" data-action="open-fab" aria-label="Quick actions">'+ICONS.plus+'</button>').join('')
    +'</div></nav>';
}

export function renderView(){
  if(S.nav==='dashboard') return renderDashboard();
  if(S.nav==='sites'){
    if(S.activeSiteId && S.state.sites[S.activeSiteId]) return renderSiteDetail(S.activeSiteId);
    if(S.activeWorkplaceId && (S.state.workplaces||{})[S.activeWorkplaceId]) return renderWorkplace(S.activeWorkplaceId);
    return renderSitesList();
  }
  if(S.nav==='passport') return isContractor() ? renderPassport() : renderContractorsList();
  if(S.nav==='more') return renderMore();
  if(S.nav==='review') return renderReview();
  return '';
}

/* ============ DASHBOARD ============ */
function greeting(){
  const h = new Date().getHours();
  const part = h<12?'Morning':h<17?'Afternoon':'Evening';
  return part+', '+myName().split(' ')[0];
}

export const DASHBOARD_WIDGETS = {
  contractor: [['agent','Compliance agent'],['assistant','Ask SiteGuard'],['studio','Document Studio'],['invitations','Invitations'],['focus','Site you\'re working on'],['allSites','All your sites'],['workforce','Worker certificates'],['company','Company profile']],
  host: [['agent','Compliance agent'],['assistant','Ask SiteGuard'],['studio','Document Studio'],['safety','Safety alert'],['organisation','Organisation overview'],['attention','Needs attention'],['portfolio','Site portfolio'],['invitations','Pending invitations'],['workforce','Worker certificates']],
};
const DEFAULT_WIDGETS = {
  contractor: ['agent','assistant','studio','invitations','focus','allSites','workforce','company'],
  admin: ['safety','agent','assistant','studio','organisation','portfolio','invitations','workforce'],
  reviewer: ['safety','agent','assistant','attention','portfolio','workforce'],
  viewer: ['safety','agent','assistant','attention','portfolio'],
};
export function dashboardLayout(){
  const all = DASHBOARD_WIDGETS[isContractor()?'contractor':'host'].map(w=>w[0]);
  const prefs = S.state.dashboardPrefs || {};
  if(prefs.order && prefs.order.length){
    const order = prefs.order.filter(id=>all.includes(id));
    return { order: order.concat(all.filter(id=>!order.includes(id))), hidden: (prefs.hidden||[]).filter(id=>all.includes(id)) };
  }
  const defaults = DEFAULT_WIDGETS[role()] || all;
  return { order: defaults.concat(all.filter(id=>!defaults.includes(id))), hidden: all.filter(id=>!defaults.includes(id)) };
}

/* ---- Compliance agent ---- */
const SEV_BADGE = { high:'<span class="badge missing">High</span>', medium:'<span class="badge expiring">Medium</span>', low:'<span class="badge grey">Low</span>' };
function findingRow(f, i){
  return '<div class="reqrow" data-action="agent-go" data-i="'+i+'" role="button" tabindex="0" style="cursor:pointer;">'
    +'<div class="reqrow-main"><div class="reqrow-name">'+f.title+'</div><div class="site-card-sub">'+f.detail+'</div></div>'
    +'<div style="flex:none;">'+SEV_BADGE[f.severity]+'</div></div>';
}
function relTime(ts){
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if(isNaN(mins)) return '';
  if(mins < 1) return 'just now';
  if(mins < 60) return mins+' min ago';
  if(mins < 24*60) return Math.round(mins/60)+' h ago';
  return timeAgo(ts);
}
function agentStatusLine(){
  const a = S.boot.agent || { findings: [] };
  return (a.lastRunAt ? 'Checked '+relTime(a.lastRunAt) : 'Not checked yet')+' · runs every 15 minutes';
}
function agentWidget(){
  const a = S.boot.agent || { findings: [] };
  const f = a.findings;
  const head = '<div class="section-title">Compliance agent</div><div class="card">'
    +'<div class="flexbetween" style="gap:8px;"><div class="site-card-sub">'+agentStatusLine()+'</div><button class="btn secondary small" data-action="agent-run">Check now</button></div>';
  if(!f.length) return head + '<div class="reqrow"><div class="qa-icon" style="background:var(--green-bg);color:var(--green);">'+ICONS.check+'</div><div class="reqrow-main"><div class="reqrow-name">Nothing needs attention</div><div class="site-card-sub">The agent reviews every site for expiries, reviews, requests, incidents and permits.</div></div></div></div>';
  return head + f.slice(0,4).map(findingRow).join('')
    +(f.length>4 ? '<button class="btn secondary block" style="margin-top:8px;" data-action="goto-more" data-view="agent">See all '+f.length+'</button>' : '')
    +'</div>';
}
function renderAgent(){
  const f = (S.boot.agent || { findings: [] }).findings;
  return '<div class="view-head"><h1>Compliance agent</h1><p>'+agentStatusLine()+'</p></div>'
    +'<div class="card"><div class="site-card-sub">SiteGuard checks every site continuously, the way a careful SHE coordinator would, and lists what needs doing, most urgent first. Items clear themselves once they\'re dealt with.</div>'
    +'<button class="btn secondary small" style="margin-top:8px;" data-action="agent-run">Check now</button></div>'
    +(f.length ? '<div class="card">'+f.map(findingRow).join('')+'</div>' : '<div class="empty"><h3>All clear</h3><p>Nothing needs attention right now.</p></div>');
}

function studioWidget(){
  return '<div class="section-title">Document Studio</div><div class="card" data-action="goto-more" data-view="studio" role="button" tabindex="0" style="cursor:pointer;display:flex;gap:14px;align-items:center;">'
    +'<div class="qa-icon" style="width:48px;height:48px;border-radius:14px;">'+ICONS.passport+'</div>'
    +'<div style="flex:1;"><div class="site-card-title">Create a professional document</div><div class="site-card-sub">Risk assessments, SHE plans, procedures, appointments and more — branded with your logo, as PDF and Word.</div></div>'+ICONS.chevron+'</div>';
}

function assistantWidget(){
  const hint = isContractor() ? 'e.g. What do I need for welding inside a tank at a gold mine?' : 'e.g. Safety file for electrical work on a conveyor at a coal mine';
  return '<div class="section-title">Ask SiteGuard</div><div class="card ask-hero">'
    +'<div class="site-card-sub">'+(isContractor()?'Find out what a site or job needs, check your sites, or get a document drafted.':'Describe a site or job to get its safety-file requirements and start it in one tap, or ask how your sites are doing.')+'</div>'
    +'<div class="ask-card"><input type="text" id="askDash" placeholder="'+hint+'" aria-label="Ask SiteGuard"><button class="btn primary small" data-action="ask-dashboard">Ask</button></div></div>';
}

/** First-run checklist for site owners; disappears once the core loop has happened once. */
function gettingStarted(){
  if(!isHost() || !isOrgAdmin() || (isDemoMode() && !org().cleanDemo)) return '';
  const sites = Object.values(S.state.sites);
  const wps = Object.values(S.state.workplaces||{});
  const steps = [
    { done: sites.length>0 || wps.length>0, title:'Add your first site', sub:'Name it and tick what every contractor\'s safety file must contain — a general safety file list is ready to use.', action:'new-site' },
    { done: wps.some(w=>w.requirements.length) || sites.some(s=>(S.state.requirements[s.id]||[]).length), title:'Set what the safety file must contain', sub:'Start from the general list, then add anything specific to the site.' },
    { done: sites.some(s=>s.status==='in_progress'||s.status==='site_ready'), title:'Share the site code with your contractors', sub:'Send the code by WhatsApp or email, or put it on the notice board. Each contractor that joins gets its own safety file for the site.', action: wps.length ? 'open-workplace' : null, id: wps.length ? wps[0].id : '' },
    { done: sites.some(s=>(S.state.requirements[s.id]||[]).some(r=>{ const d = S.state.documents[r.id]; return d && d.version && (d.status==='complete' || d.status==='correction_required'); })), title:'Review the first submission', sub:'Approve it or request a correction — the contractor is notified either way.' },
  ];
  if(steps.every(x=>x.done)) return '';
  const next = steps.findIndex(x=>!x.done);
  return '<div class="section-title">Getting started</div><div class="card checkpoint">'
    + steps.map((x,i)=>'<div class="reqrow"><div class="qa-icon" style="width:28px;height:28px;border-radius:50%;flex:none;'+(x.done?'background:var(--green-bg);color:var(--green);':i===next?'background:var(--brand);color:#fff;':'')+'">'+(x.done?ICONS.check:(i+1))+'</div>'
      +'<div class="reqrow-main"><div class="reqrow-name"'+(x.done?' style="color:var(--grey);text-decoration:line-through;"':'')+'>'+x.title+'</div>'+(i===next?'<div class="site-card-sub">'+x.sub+'</div>':'')+'</div>'
      +(i===next && x.action && !readOnly()?'<button class="btn primary small" data-action="'+x.action+'"'+(x.id?' data-id="'+x.id+'"':'')+'>'+(x.action==='open-workplace'?'Show code':'Start')+'</button>':'')+'</div>').join('')
    +'</div>';
}

function renderDashboard(){
  const { order, hidden } = dashboardLayout();
  const sitesAll = Object.values(S.state.sites);
  const active = sitesAll.filter(s=>s.status==='in_progress'||s.status==='site_ready').length;
  const ready = sitesAll.filter(s=>s.status==='site_ready').length;
  const findings = ((S.boot.agent||{}).findings||[]);
  const urgent = findings.filter(f=>f.severity==='high').length;
  const stat = (n, label) => '<div class="hero-stat"><b>'+n+'</b><span>'+label+'</span></div>';
  const head = '<div class="dash-hero"><div class="flexbetween" style="align-items:flex-start;"><div><p class="hero-eyebrow">'+org().name+'</p><h1>'+greeting()+'</h1>'
    +'<p class="greeting">'+(urgent ? urgent+' urgent item'+(urgent===1?'':'s')+' need'+(urgent===1?'s':'')+' you today.' : findings.length ? findings.length+' item'+(findings.length===1?'':'s')+' to look at — nothing urgent.' : 'Everything is in order across your sites.')+'</p></div>'
    +'<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;"><button class="btn secondary small" data-action="start-tour">Walkthrough</button><button class="btn secondary small" data-action="customise-dashboard">Customise</button></div></div>'
    +(isContractor() && !readOnly() ? '<div class="hero-actions">'+buildButton()+'<button class="btn secondary" data-action="upload-document">'+ICONS.upload+' Upload document</button><button class="btn secondary" data-action="goto-more" data-view="studio">Document Studio</button><button class="btn secondary" data-action="open-assistant">'+ICONS.sparkle+' Assistant</button></div>' : '')
    +'<div class="hero-stats">'+stat(active, isContractor()?'Active sites':'Active sites')+stat(ready,'Site Ready')+stat(findings.length,'To action')+'</div></div>';
  const ctx = isContractor() ? contractorDashboardContext() : null;
  const parts = order.filter(id=>!hidden.includes(id)).map(id=> id==='assistant' ? assistantWidget() : id==='agent' ? agentWidget() : id==='studio' ? studioWidget() : (isContractor() ? contractorWidget(id, ctx) : hostWidget(id)) ).filter(Boolean);
  let start = gettingStarted();
  // A new contractor's first step is usually a code the site gave them: put it first.
  if(ctx && !ctx.mySites.length && !ctx.invited.length && isOrgAdmin() && !readOnly())
    start = '<button class="qa-item join-first" data-action="join-site"><div class="qa-icon">'+ICONS.link+'</div><div style="flex:1;"><div class="qa-title">Got a code from a site?</div><div class="qa-sub">Join the site with it — takes 10 seconds</div></div>'+ICONS.chevron+'</button>'
      + '<button class="qa-item join-first" data-action="new-project"><div class="qa-icon">'+ICONS.plus+'</div><div style="flex:1;"><div class="qa-title">Working for a client who isn\'t on SiteGuard?</div><div class="qa-sub">Start a project and build their safety file yourself</div></div>'+ICONS.chevron+'</button>' + start;
  if(!parts.length) return head + start + '<div class="empty"><h3>Nothing on your dashboard</h3><p>Use Customise to choose what shows here.</p></div>';
  return head + start + parts.join('');
}

function contractorDashboardContext(){
  const allMySites = Object.values(S.state.sites);
  const invited = allMySites.filter(s=>s.status==='invited');
  const mySites = allMySites.filter(s=>s.status!=='invited' && s.status!=='declined');
  if(mySites.length && (!S.focusSiteId || !mySites.find(s=>s.id===S.focusSiteId))) S.focusSiteId = mySites[0].id;
  return { invited, mySites };
}

function contractorWidget(id, ctx){
  const { invited, mySites } = ctx;
  if(id==='invitations'){
    if(!invited.length) return '';
    return '<div class="section-title">Invitations</div>' + invited.map(s=>
      '<div class="card checkpoint" data-action="open-site" data-site="'+s.id+'" style="cursor:pointer;"><div class="flexbetween"><div><div class="site-card-title">'+s.name+'</div><div class="site-card-sub">'+s.hostName+' · '+s.location+'</div></div><span class="badge blue">Pending</span></div></div>'
    ).join('');
  }
  if(id==='focus'){
    if(!mySites.length) return invited.length ? '' : '<div class="empty"><h3>No sites yet</h3><p>Once a site invites '+org().name+', it will show up here. Sites invite you by email, or give you a join code on site.</p>'+(isOrgAdmin()?'<button class="btn primary" data-action="join-site">Join a site with a code</button>':'')+'</div>';
    const focus = S.state.sites[S.focusSiteId];
    const {counts, percent, total} = computeReadiness(focus.id);
    const pct = focus.status==='site_ready' ? 100 : percent;
    let html = '';
    if(mySites.length>1){
      html += '<div class="section-title">Which site are you working on?</div><div class="site-picker-row">'+mySites.map(s=>
        '<button class="site-picker-chip'+(s.id===S.focusSiteId?' active':'')+'" data-action="focus-site" data-site="'+s.id+'">'+s.name.split('—')[0].trim()+'</button>').join('')+'</div>';
    }
    html += '<div class="card checkpoint focus-card" data-action="open-site" data-site="'+focus.id+'" style="cursor:pointer;">'
      +'<div class="flexbetween">'+gauge(pct,64)+'<div style="text-align:right;">'
      +(focus.status==='site_ready'?'<span class="badge approved">'+ICONS.check+'Site Ready</span>':'<span class="site-card-sub">'+statusLabelForSubmission(siteSubmissionStatus(focus.id))+'</span>')
      +'</div></div><div class="site-card-title" style="margin-top:10px;">'+focus.name+'</div><div class="site-card-sub">'+focus.hostName+' · '+focus.location+'</div>'
      +'<div class="mini-stats">'
        +'<div class="mini-stat"><b style="color:var(--green);">'+(counts.complete||0)+'</b><span>Complete</span></div>'
        +'<div class="mini-stat"><b style="color:var(--red);">'+((counts.expired||0)+(counts.correction_required||0))+'</b><span>Needs you</span></div>'
        +'<div class="mini-stat"><b style="color:var(--amber);">'+(counts.expiring||0)+'</b><span>Expiring</span></div>'
        +'<div class="mini-stat"><b>'+total+'</b><span>Total</span></div>'
      +'</div></div>';
    return html;
  }
  if(id==='allSites'){
    if(mySites.length<2) return '';
    return '<div class="section-title">All your sites</div>' + mySites.map(portfolioRow).join('');
  }
  if(id==='workforce') return workforceAlertWidget();
  if(id==='company'){
    return '<div class="section-title">Company profile</div>'
      +'<div class="card checkpoint" data-action="nav" data-nav="passport" style="cursor:pointer;"><div class="flexbetween"><div><div class="site-card-title">Your Documents</div><div class="site-card-sub">Company library and every file you\'ve submitted, in one place</div></div>'+ICONS.chevron+'</div></div>';
  }
  return '';
}

function hostWidget(id){
  const sites = Object.values(S.state.sites);
  if(id==='safety'){
    const n = orgOpenSafetyIssuesCount();
    return n ? '<div class="notice" style="background:var(--red-bg);color:var(--red);margin-bottom:10px;cursor:pointer;" data-action="goto-more" data-view="safety">'+n+' open safety issue'+(n===1?'':'s')+' across your sites — tap for the Safety Centre</div>' : '';
  }
  if(id==='organisation'){
    return '<div class="section-title">Organisation</div><div class="attn-grid">'
      +attnCard('blue', sites.length, 'Sites', null, 'nav-sites')
      +attnCard('green', Object.keys(S.state.contractors).length, 'Contractors', null, 'nav-passport')
      +attnCard('amber', sites.filter(s=>s.status==='site_ready').length, 'Site ready')
      +attnCard('red', orgOpenSafetyIssuesCount(), 'Open safety issues', null, 'safety')+'</div>';
  }
  if(id==='attention'){
    let corrections=0, awaiting=0, expired=0;
    sites.forEach(s=>{ const {counts}=computeReadiness(s.id); corrections+=counts.correction_required||0; awaiting+=counts.awaiting_review||0; expired+=counts.expired||0; });
    return '<div class="section-title">Needs attention</div><div class="attn-grid">'
      +attnCard('red', expired, 'Expired', 'expired')
      +attnCard('blue', awaiting, 'Awaiting review', 'awaiting_review')
      +attnCard('red', corrections, 'Open corrections', 'correction_required')
      +attnCard('green', sites.filter(s=>s.status==='site_ready').length, 'Sites ready')+'</div>';
  }
  if(id==='portfolio'){
    return '<div class="section-title">Site portfolio</div>'
      + (sites.length ? sites.map(portfolioRow).join('') : '<div class="empty"><h3>No sites yet</h3><p>'+(isOrgAdmin()?'Add your first site to start tracking contractor compliance.':'Once an admin adds a site, it will show up here.')+'</p>'+(isOrgAdmin()?'<button class="btn primary" data-action="new-site">Add a site</button>':'')+'</div>');
  }
  if(id==='invitations'){
    const pending = Object.values(S.state.invitations).filter(i=>i.status==='pending');
    return '<div class="section-title">Pending invitations</div>'
      + (!pending.length ? '<div class="card"><div class="site-card-sub">No pending invitations. Adding a site invites its contractor by email.</div></div>'
        : '<div class="card">' + pending.map(inv=>{
          const site = S.state.sites[inv.siteId];
          return '<div class="reqrow" data-action="open-site" data-site="'+inv.siteId+'" style="cursor:pointer;"><div class="reqrow-main"><div class="reqrow-name">'+inv.contractorName+'</div>'
            +'<div class="reqrow-meta"><span class="badge blue">Pending</span><span class="srctag">'+(site?site.name:'')+' · sent '+timeAgo(inv.sentAt)+(inv.email?' · '+inv.email:'')+'</span></div></div></div>';
        }).join('') + '</div>');
  }
  if(id==='workforce') return workforceAlertWidget();
  return '';
}

function workforceAlertWidget(){
  const rows = [];
  Object.values(S.state.workers||{}).forEach(w=>{
    if(!w.active) return;
    w.certificates.forEach(c=>{
      const st = certStatus(c);
      if(st==='expired' || st==='expiring') rows.push({w, c, st});
    });
  });
  if(!rows.length) return '';
  rows.sort((a,b)=>(a.c.expiresOn||'').localeCompare(b.c.expiresOn||''));
  return '<div class="section-title">Worker certificates</div><div class="card">'
    + rows.slice(0,6).map(r=>'<div class="reqrow" data-action="open-worker" data-worker="'+r.w.id+'" style="cursor:pointer;"><div class="reqrow-main"><div class="reqrow-name">'+r.w.name+' — '+r.c.name+'</div>'
      +'<div class="reqrow-meta">'+badge(r.st)+'<span class="srctag">'+(r.st==='expired'?'expired ':'expires ')+timeAgo(r.c.expiresOn)+(r.w.own?'':' · '+r.w.orgName)+'</span></div></div><div class="reqrow-chevron">'+ICONS.chevron+'</div></div>').join('')
    + (rows.length>6?'<button class="btn secondary small" style="margin-top:8px;" data-action="goto-more" data-view="workforce">See all '+rows.length+'</button>':'')
    +'</div>';
}

function attnCard(color, num, label, docFilter, target){
  const attrs = docFilter ? ' data-action="doc-centre-jump" data-filter="'+docFilter+'" style="cursor:pointer;"'
    : target==='safety' ? ' data-action="goto-more" data-view="safety" style="cursor:pointer;"'
    : target==='nav-sites' ? ' data-action="nav" data-nav="sites" style="cursor:pointer;"'
    : target==='nav-passport' ? ' data-action="nav" data-nav="passport" style="cursor:pointer;"' : '';
  return '<div class="attn-card '+color+'"'+attrs+'><div class="attn-num">'+num+'</div><div class="attn-label">'+label+'</div></div>';
}

export function portfolioRow(site){
  const {percent} = computeReadiness(site.id);
  const contractor = contractorOf(site);
  const pct = site.status==='site_ready' ? 100 : percent;
  const who = isContractor() ? site.hostName : contractor.name;
  const out = isProject(site) ? (computeReadiness(site.id).counts.missing||0)+(computeReadiness(site.id).counts.expired||0) : 0;
  const sub = isProject(site) ? 'For '+who+' · '+(computeReadiness(site.id).total ? (out ? out+' to go' : 'Ready to send') : 'No requirements yet')
    : site.status==='site_ready' ? 'Site Ready · '+who
    : site.status==='invited' ? who+' · Invitation pending'
    : site.status==='declined' ? who+' · Invitation declined'
    : who+' · '+statusLabelForSubmission(siteSubmissionStatus(site.id));
  const color = site.status==='invited' ? 'var(--blue)' : site.status==='declined' ? 'var(--grey)' : gaugeColor(pct);
  return '<div class="portfolio-row" data-action="open-site" data-site="'+site.id+'" role="button" tabindex="0"><div class="portfolio-bar">'
    +'<div class="portfolio-top"><span class="portfolio-name">'+site.name+'</span><span class="portfolio-pct" style="color:'+color+';">'+(site.status==='invited'?'Invited':site.status==='declined'?'Declined':pct+'%')+'</span></div>'
    +'<div class="portfolio-track"><div class="portfolio-fill" style="width:'+(site.status==='invited'||site.status==='declined'?0:pct)+'%;background:'+gaugeColor(pct)+';"></div></div>'
    +'<div class="portfolio-sub">'+sub+'</div></div>'
    +'<div class="site-card-arrow">'+ICONS.chevron+'</div></div>';
}

/* ============ SITES ============ */
function renderSitesList(){
  // On the mine side, each contractor's file on a shared site lives inside that site's page.
  const sites = Object.values(S.state.sites).filter(s=>!(isHost() && s.workplaceId && (S.state.workplaces||{})[s.workplaceId]) && !isProject(s));
  const projectList = isContractor() ? Object.values(S.state.sites).filter(isProject) : [];
  const projectMatch = (s)=>matchSearch('sites', s.name, s.location, s.hostName);
  const projectsHtml = isContractor() ? projectsSection(projectMatch) + projectList.filter(projectMatch).map(portfolioRow).join('') : '';
  const nWp = Object.keys(S.state.workplaces||{}).length;
  let html = '<div class="view-head"><div class="flexbetween"><h1>'+(isContractor()?'Safety files':'Sites')+'</h1>'+(isHost() && isOrgAdmin() && !readOnly()?'<button class="btn primary small" data-action="new-site">+ Add site</button>':'')
    +(isContractor() ? buildButton('small') : '')+'</div>'
    +'<p>'+(isHost() ? nWp+' site'+(nWp===1?'':'s')+(sites.length?' · '+sites.length+' single job'+(sites.length===1?'':'s'):'') : 'One safety file per site or client, built from your company documents · '+sites.length+' on SiteGuard sites · '+projectList.length+' for your own clients')+'</p></div>';
  if(isHost() && nWp){
    html += ((nWp + sites.length) > 3 || searching('sites') ? searchBox('sites', 'Search sites, locations or contractors') : '')
      + '<div class="section-title">Sites contractors join with a code</div>' + (workplaceCards() || '<div class="list-empty">No site matches.</div>');
    if(!sites.length) return html;
    html += '<div class="section-title">Single-contractor jobs</div>';
    return html + sites.filter(s=>matchSearch('sites', s.name, s.location, (contractorOf(s)||{}).name)).map(portfolioRow).join('');
  }
  if(!sites.length && projectList.length) return html + '<div class="section-title">Sites on SiteGuard</div><div class="card"><div class="site-card-sub">When a site on SiteGuard gives you a code or invites you, its file appears here.</div>'+(isOrgAdmin()&&!readOnly()?'<button class="btn secondary small" style="margin-top:8px;" data-action="join-site">Join a site with a code</button>':'')+'</div>' + projectsHtml;
  if(!sites.length) return html + (isContractor() ? '<div class="section-title">Sites on SiteGuard</div>' : '') + '<div class="empty"><h3>No sites yet</h3><p>'+(isContractor()?'Sites appear here when a site owner invites your company — by email, or with a join code.':'Add a site to start tracking contractor compliance.')+'</p>'+(isContractor()&&isOrgAdmin()&&!readOnly()?'<button class="btn primary" data-action="join-site">Join a site with a code</button>':'')+'</div>' + projectsHtml;
  const kind = (s)=>s.status==='site_ready'?'ready':s.status==='invited'?'invited':s.status==='declined'?'declined':'progress';
  const attention = (s)=>{ if(s.status!=='in_progress') return false; const st = siteSubmissionStatus(s.id); return st==='changes_required' || (isHost() ? st==='under_review' || st==='ready_to_approve' : st!=='under_review'); };
  const base = sites.filter(s=>matchSearch('sites', s.name, s.location, s.hostName, (contractorOf(s)||{}).name));
  const tests = { all:()=>true, attention, progress:s=>kind(s)==='progress', ready:s=>kind(s)==='ready', invited:s=>kind(s)==='invited' };
  const f = tests[S.sitesFilter] ? S.sitesFilter : 'all';
  const chips = [['all','All'],['attention','Needs attention'],['progress','In progress'],['ready','Site Ready'],['invited','Invited']];
  html += (sites.length > 3 || searching('sites') ? searchBox('sites', isHost()?'Search sites, locations or contractors':'Search sites, locations or mines') : '')
    + '<div class="filter-chips">'+chips.map(([k,l])=>'<button class="site-picker-chip'+(f===k?' active':'')+'" data-action="sites-filter" data-filter="'+k+'">'+l+'<b>'+base.filter(tests[k]).length+'</b></button>').join('')+'</div>';
  const shown = base.filter(tests[f]);
  return html + (isContractor() ? '<div class="section-title">Sites on SiteGuard</div>' : '') + (shown.length ? shown.map(portfolioRow).join('') : '<div class="list-empty">'+(searching('sites') ? 'No site matches “'+escapeHtml(S.search.sites)+'”.' : 'No sites in this view.')+'</div>') + projectsHtml;
}
on('passport-filter', (el)=>{ S.passportFilter = el.dataset.filter; S.keepScroll = true; render(); S.keepScroll = false; });
on('sites-filter', (el)=>{ S.sitesFilter = el.dataset.filter; S.keepScroll = true; render(); S.keepScroll = false; });

function renderSiteDetail(siteId){
  const site = S.state.sites[siteId];
  const contractor = contractorOf(site);
  const invite = Object.values(S.state.invitations).find(i=>i.siteId===siteId && i.status==='pending');

  if(isContractor() && site.status==='invited'){
    return '<div style="margin-bottom:14px;"><button class="btn secondary small" data-action="back-sites">← Sites</button></div>'
      +'<div class="view-head"><h1>You\'re invited</h1><p>'+site.name+'</p></div>'
      +'<div class="card checkpoint"><div class="site-card-title">'+site.name+'</div>'
      +'<div class="site-card-sub" style="margin-top:6px;">'+[site.hostName, site.location].filter(Boolean).join(' · ')+'</div>'
      +'<div class="site-card-sub" style="margin-top:10px;">'+site.hostName+' has invited '+org().name+' to work this site and submit a safety file. Accepting shows you the requirements and starts tracking readiness; declining removes it from your list.</div>'
      +(isOrgAdmin() && invite ? '<div style="display:flex;gap:8px;margin-top:14px;"><button class="btn primary" style="flex:1;" data-action="invitation-decide" data-id="'+invite.id+'" data-decision="accept">Accept</button>'
        +'<button class="btn secondary" style="flex:1;" data-action="invitation-decide" data-id="'+invite.id+'" data-decision="decline">Decline</button></div>'
        : '<div class="notice" style="margin-top:12px;">An owner or admin of '+org().name+' needs to accept this invitation.</div>')
      +'</div>';
  }

  const canShare = !readOnly() && (isContractor() ? isOrgAdmin() : canReview());
  let html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;justify-content:space-between;flex-wrap:wrap;">'
    +'<button class="btn secondary small" data-action="back-sites">'+(isHost() && site.workplaceId && (S.state.workplaces||{})[site.workplaceId] ? '← '+S.state.workplaces[site.workplaceId].name : isContractor() ? '← Safety files' : '← Sites')+'</button>'
    +'<div style="display:flex;gap:6px;flex-wrap:wrap;">'
    +'<button class="btn danger small icon" data-action="open-emergency" data-site="'+siteId+'" title="Emergency info" aria-label="Emergency info">'+ICONS.emergency+'</button>'
    +(isHost() && isOrgAdmin() && !readOnly() && !site.workplaceId ? '<button class="btn secondary small" data-action="edit-site" data-site="'+siteId+'">Edit</button>' : '')
    +(isHost() && isOrgAdmin() && !readOnly() && site.workplaceId && site.status!=='declined' ? '<button class="btn secondary small" data-action="wp-remove-contractor" data-site="'+siteId+'">Remove</button>' : '')
    +(canShare && site.status!=='declined' && !isProject(site) ? '<button class="btn secondary small" data-action="new-share-link" data-site="'+siteId+'">Share</button>' : '')
    +'<button class="btn secondary small" data-action="export-site" data-site="'+siteId+'">Export</button></div></div>'
    +'<div class="view-head"><h1>'+site.name+'</h1><p>'+[site.location, isContractor()?(isProject(site)?'Project for '+site.hostName:site.hostName):contractor.name].filter(Boolean).join(' · ')+'</p></div>'
    +'<div class="subtabs" role="tablist">'
      +['compliance','activity','people'].map(t=>'<button role="tab" data-action="site-tab" data-tab="'+t+'" class="'+(S.siteTab===t?'active':'')+'" aria-selected="'+(S.siteTab===t)+'">'+({compliance:'Compliance',activity:'Site activity',people:'People'})[t]+'</button>').join('')
    +'</div>' + suspendedBanner(siteId) + sponsorLine(site);

  if(S.siteTab==='activity') return html + renderSiteActivity(siteId);
  if(S.siteTab==='people') return html + renderSitePeople(siteId);

  const {items, total, counts, percent} = computeReadiness(siteId);
  const submission = siteSubmissionStatus(siteId);
  const safety = openSafetyIssues(siteId);
  const safetyBlocksApproval = safety.severeIncidents.length>0;
  const canApprove = canReview() && !readOnly() && submission==='ready_to_approve' && site.status==='in_progress' && !safetyBlocksApproval;
  const approval = S.state.approvals[siteId];

  if(isProject(site)) html += projectBar(siteId);
  if(site.status==='invited' && isHost()){
    html += '<div class="card checkpoint" style="margin-top:12px;"><div class="flexbetween"><div>'
      +'<div class="site-card-title" style="font-size:14px;">Awaiting contractor response</div>'
      +'<div class="site-card-sub">'+contractor.name+' was invited '+(invite?timeAgo(invite.sentAt):'')+(invite&&invite.email?' ('+invite.email+')':'')+' and hasn\'t accepted yet. Requirements are visible below but the contractor can\'t submit against them until they accept.</div>'
      +'</div><span class="badge blue">Pending</span></div>'
      +(isOrgAdmin() && !readOnly() ? '<div class="row-actions"><button class="btn primary small" data-action="join-code" data-site="'+siteId+'">Get a join code</button><button class="btn secondary small" data-action="resend-invitation" data-site="'+siteId+'">Resend invitation</button><button class="btn secondary small" data-action="reassign-site" data-site="'+siteId+'">Assign a different contractor</button></div>' : '')
      +'</div>';
  } else if(site.status==='declined' && isHost()){
    html += '<div class="card checkpoint" style="margin-top:12px;border-color:var(--red);"><div class="site-card-title" style="font-size:14px;">Invitation declined</div>'
      +'<div class="site-card-sub">'+contractor.name+' declined this invitation. Assign a different contractor or follow up directly.</div>'
      +(isOrgAdmin() && !readOnly() ? '<div class="row-actions"><button class="btn primary small" data-action="reassign-site" data-site="'+siteId+'">Assign a contractor</button></div>' : '')+'</div>';
  }

  if(safety.count){
    html += '<div class="notice" style="background:var(--red-bg);color:var(--red);cursor:pointer;" data-action="site-tab" data-tab="activity">'
      + safety.incidents.length+' open incident'+(safety.incidents.length===1?'':'s')+(safety.expiredPermits.length?' · '+safety.expiredPermits.length+' expired permit'+(safety.expiredPermits.length===1?'':'s')+' not closed out':'')
      + ' — see Site activity' + (safety.severeIncidents.length ? ' (includes a lost time injury or fatality)' : '') +'</div>';
  }

  if(site.status==='site_ready' && approval){
    html += '<div class="card checkpoint" style="border-color:var(--green);">'
      +'<div class="badge approved" style="margin-bottom:8px;">'+ICONS.check+'Site Ready</div>'
      +'<div class="site-card-sub">Approved by '+approval.approver+', '+approval.role+' · '+timeAgo(approval.date)+' · '+approval.version+'</div>'
      +'<div class="row-actions"><a class="btn secondary small" href="/verify/'+approval.verificationId+'" target="_blank" rel="noopener">View verification</a></div></div>';
  } else if(submission==='no_requirements'){
    html += '<div class="empty"><h3>No requirements set for this '+(isProject(site)?'project':'site')+'</h3><p>'+(isProject(site)?'Add the documents this client needs under Requirements above.':isContractor()?'The site hasn\'t defined what\'s required yet — check back soon.':'Add the documents this site needs from '+contractor.name+'.')+'</p>'
      +(isHost() && isOrgAdmin() && !readOnly() ? '<div class="row-actions" style="justify-content:center;"><button class="btn primary" data-action="apply-packs" data-site="'+siteId+'">Use a starter pack</button><button class="btn secondary" data-action="add-requirement" data-site="'+siteId+'">Add one by one</button></div>' : '')+'</div>';
  } else {
    html += '<div class="card checkpoint readiness-hero">'+gauge(percent, 78)
      +'<div><div class="site-card-title">'+(isProject(site)?'File complete':'Site Readiness')+'</div><div class="site-card-sub">'+(counts.complete||0)+' of '+total+' '+(isProject(site)?'documents filed':'requirements complete')+'</div>'
      +'<button class="why-link linkish" data-action="open-why" data-site="'+siteId+'">Why '+percent+'%?</button></div></div>';
    if(submission==='changes_required') html += '<div class="notice" style="background:var(--red-bg);color:var(--red);">'+((counts.correction_required||0)+(counts.expired||0))+' item(s) need corrections or renewal before this site can be approved.</div>';
    else if(submission==='under_review') html += '<div class="notice">'+counts.awaiting_review+' item(s) awaiting reviewer sign-off.</div>';
    else if(submission==='ready_to_approve' && safetyBlocksApproval) html += '<div class="notice" style="background:var(--red-bg);color:var(--red);">All requirements complete, but this site can\'t be marked Ready while a lost time injury or fatality investigation is still open.</div>';
    else if(submission==='ready_to_approve' && !canReview() && !isProject(site)) html += '<div class="notice" style="background:var(--green-bg);color:var(--green);">All requirements complete — waiting on final site approval.</div>';
    if(canApprove) html += '<button class="btn primary block" data-action="approve-site" data-site="'+siteId+'" style="margin-bottom:14px;">Approve — Mark Site Ready</button>';
    if(isContractor()) html += guideCard(siteId);
  }
  const filed = (S.state.requirements[siteId]||[]).filter(r=>['complete','expiring','awaiting_review'].includes(effectiveStatus(S.state.documents[r.id]))).length;
  if(filed && !isProject(site)) html += '<a class="bundle-link" role="button" tabindex="0" style="cursor:pointer;" data-action="export-bundle" data-site="'+siteId+'"><span class="bundle-ic">'+ICONS.passport+'</span><span class="bundle-txt"><strong>Download the safety file</strong><span class="site-card-sub">One PDF: cover, contents and all '+filed+' submitted document'+(filed===1?'':'s')+'</span></span>'+ICONS.chevron+'</a>';
  if(filed) html += revisionsLink(siteId);

  const grouped = {};
  items.forEach(it=>{ (grouped[it.req.category] = grouped[it.req.category]||[]).push(it); });
  Object.keys(grouped).forEach(cat=>{
    html += '<div class="section-title">'+cat+'</div><div class="card">';
    grouped[cat].forEach(it=>{
      html += '<div class="reqrow" data-action="open-req" data-req="'+it.req.id+'" role="button" tabindex="0" style="cursor:pointer;"><div class="reqrow-main">'
        +'<div class="reqrow-name">'+it.req.name+'</div>'
        +'<div class="reqrow-meta">'+(it.req.optional && !it.counted ? '<span class="badge grey">Optional</span>' : badge(it.status))+'<span class="srctag">'+SOURCE_LABEL[it.req.source]+(it.req.optional?' · optional':'')+'</span>'+(it.doc.expiryDate?'<span class="srctag">expires '+timeAgo(it.doc.expiryDate)+'</span>':'')+'</div>'
        +'</div><div class="reqrow-chevron">'+ICONS.chevron+'</div></div>';
    });
    html += '</div>';
  });
  if(total && isHost() && isOrgAdmin() && !readOnly()) html += '<div class="row-actions"><button class="btn secondary" style="flex:1;" data-action="add-requirement" data-site="'+siteId+'">+ Add a requirement</button><button class="btn secondary" style="flex:1;" data-action="apply-packs" data-site="'+siteId+'">+ Add a starter pack</button></div>';
  return html;
}

export function permitBadge(status){
  const map = { active:['complete','Active'], pending:['awaiting_review','Pending issue'], expired:['expired','Expired — close out'], closed:['complete','Closed'] };
  const [cls,label] = map[status] || ['missing', status];
  return '<span class="badge '+cls+'">'+(cls==='complete'?ICONS.check:'')+label+'</span>';
}
export function renderPermitRow(p, siteId, showSite){
  const eff = permitEffectiveStatus(p);
  return '<div class="reqrow" data-action="open-permit" data-site="'+siteId+'" data-id="'+p.id+'" role="button" tabindex="0" style="cursor:pointer;"><div class="reqrow-main">'
    +'<div class="reqrow-name">'+permitTypeInfo(p.type).label+' — '+p.location+'</div>'
    +'<div class="reqrow-meta">'+permitBadge(eff)+'<span class="srctag">'+(showSite?S.state.sites[siteId].name+' · ':'')+(p.issuedTo||'unassigned')+' · '+(p.validTo?'until '+dateTime(p.validTo):'no expiry set')+'</span></div>'
    +'</div><div class="reqrow-chevron">'+ICONS.chevron+'</div></div>';
}
export function renderIncidentRow(inc, siteId, showSite){
  const t = incidentTypeInfo(inc.type);
  const statusBadge = {open:'<span class="badge correction_required">Open</span>', investigating:'<span class="badge expiring">Investigating</span>', closed:'<span class="badge complete">'+ICONS.check+'Closed</span>'}[inc.status];
  return '<div class="reqrow" data-action="open-incident" data-site="'+siteId+'" data-id="'+inc.id+'" role="button" tabindex="0" style="cursor:pointer;"><div class="reqrow-main">'
    +'<div class="reqrow-name" style="color:'+t.color+';">'+t.label+'</div>'
    +'<div class="reqrow-meta">'+statusBadge+'<span class="srctag">'+(showSite?S.state.sites[siteId].name+' · ':'')+timeAgo(inc.date)+' · '+inc.reportedBy+'</span></div>'
    +'</div><div class="reqrow-chevron">'+ICONS.chevron+'</div></div>';
}

/** Who pays for this file: the mine sponsors the contractor's file on its own site (billing on only). */
function sponsorLine(site){
  if(!S.boot.features.billing || isProject(site) || site.status==='invited') return '';
  if(isContractor()){
    if(site.sponsored) return '<div class="sponsor-line"><span class="badge sage">Sponsored</span> '+site.hostName+' covers your work on this safety file.</div>';
    return org().ownAccess ? '' : '<div class="notice" style="background:var(--amber-bg);color:var(--amber);">'+site.hostName+' isn\'t sponsoring this file right now. It stays readable; choose a contractor plan under Plan &amp; billing to keep working on it.</div>';
  }
  if(!(S.state.contractors[site.contractorId]||{}).linked || site.status==='declined') return '';
  const admin = isOrgAdmin() && !readOnly() && site.status!=='declined';
  return '<div class="sponsor-line"><span class="badge '+(site.sponsored?'sage':'')+'">'+(site.sponsored?'Sponsored by you':'Not sponsored')+'</span> '
    +(site.sponsored ? 'The contractor works on this file without its own plan.' : 'The contractor needs its own plan to change this file.')
    +(admin ? ' <button class="linkish" data-action="sponsorship" data-site="'+site.id+'" data-do="'+(site.sponsored?'end':'resume')+'">'+(site.sponsored?'End sponsorship':'Sponsor again')+'</button>' : '')+'</div>';
}
on('sponsorship', (el)=>{
  const end = el.dataset.do==='end';
  if(end && !confirm('Stop sponsoring this contractor\'s file? Their records stay readable, but they\'ll need their own plan to keep changing it.')) return;
  return act(()=>api.post('/api/sites/'+encodeURIComponent(el.dataset.site)+'/sponsorship/'+(end?'end':'resume'), {}), end?'Sponsorship ended':'Sponsoring again', el);
});

function renderSiteActivity(siteId){
  const ro = readOnly();
  const permits = S.state.permits[siteId] || [];
  const project = isProject(S.state.sites[siteId]);
  let html = project ? '<div class="notice" style="margin-top:4px;">Permits to work on this project are issued by the client\'s authorised person under their own system. Record incidents and your daily diary here so they print in the safety file.</div>'
    : auditsSection(siteId) + '<div class="section-title">Permit to work register</div>';
  if(!project){
    if(!ro && (isContractor() || canReview())) html += '<button class="btn primary block" data-action="new-permit" data-site="'+siteId+'" style="margin-bottom:10px;">'+(isContractor()?'Request a permit':'Issue a permit')+'</button>';
    html += permits.length ? '<div class="card">' + permits.map(p=>renderPermitRow(p, siteId)).join('') + '</div>'
      : '<div class="card"><div class="site-card-sub">No permits raised for this site. High-risk work — hot work, heights, confined space, excavation, lifting, electrical isolation — should have one before it starts.</div></div>';
  }

  const incidents = S.state.incidents[siteId] || [];
  html += '<div class="section-title">Incident register</div>';
  if(!ro) html += '<button class="btn danger block" data-action="report-incident" data-site="'+siteId+'" style="margin-bottom:10px;">Report an incident</button>';
  html += incidents.length ? '<div class="card">' + incidents.map(inc=>renderIncidentRow(inc, siteId)).join('') + '</div>'
    : '<div class="card"><div class="site-card-sub">No incidents logged for this site. Near misses count too — logging them is how patterns get caught before someone gets hurt.</div></div>';

  const diary = S.state.diary[siteId]||[];
  html += '<div class="section-title">Daily site diary</div>';
  if(!ro) html += '<button class="btn secondary block" data-action="new-diary" data-site="'+siteId+'" style="margin-bottom:10px;">+ Log today\'s entry</button>';
  html += diary.length ? '<div class="card">' + diary.slice(0,8).map(renderDiaryRow).join('') + '</div>' : '<div class="card"><div class="site-card-sub">No diary entries yet.</div></div>';

  html += '<div class="section-title">Inspections &amp; corrective actions</div>';
  const list = S.state.inspections[siteId]||[];
  if(canReview() && !ro) html += '<button class="btn primary block" data-action="new-inspection" data-site="'+siteId+'" style="margin-bottom:14px;">Log inspection</button>';
  if(!list.length) return html + (project ? '' : '<div class="empty"><h3>No inspections logged yet</h3><p>Scheduled inspections and spot checks will appear here.</p></div>') + timelineSection(siteId);
  list.forEach(insp=>{
    const openDefects = insp.defects.filter(d=>d.status!=='verified').length;
    html += '<div class="card checkpoint inspection-card"><div class="flexbetween"><div><div class="site-card-title">'+insp.title+'</div>'
      +'<div class="site-card-sub">'+insp.type+' · '+insp.inspector+' · '+timeAgo(insp.date)+'</div></div>'
      +(openDefects? '<span class="badge correction_required">'+openDefects+' open</span>' : '<span class="badge complete">'+ICONS.check+'Clear</span>')+'</div>'
      + inspectxRow(insp);
    insp.defects.forEach(d=> html += renderDefectRow(d));
    if(canReview() && !ro) html += '<button class="btn secondary small" style="margin-top:10px;" data-action="new-defect" data-id="'+insp.id+'" data-site="'+siteId+'">+ Log defect</button>';
    html += '</div>';
  });
  return html + timelineSection(siteId);
}
function renderDiaryRow(entry){
  return '<div class="diary-row"><div class="diary-head"><span>'+timeAgo(entry.date)+' · '+entry.crew+' on site</span>'+(entry.incident? '<span class="diary-incident">⚠ Incident</span>' : '')+'</div>'
    +'<div class="site-card-sub" style="margin-top:2px;">'+entry.weather+' · logged by '+entry.author+'</div>'
    +'<div style="margin-top:4px;">'+entry.summary+'</div>'
    +(entry.incident? '<div style="margin-top:4px;color:var(--red);">'+entry.incidentNote+'</div>' : '')+'</div>';
}
function inspectxRow(insp){
  const s = S.state.settings || {};
  if(!insp.externalRef && !s.inspectxEnabled) return '';
  const enabled = s.inspectxEnabled && s.inspectxBaseUrl && /^https:\/\//.test(s.inspectxBaseUrl);
  const link = enabled && insp.externalRef ? '<a class="btn secondary small" href="'+s.inspectxBaseUrl+encodeURIComponent(insp.externalRef)+'" target="_blank" rel="noopener">Open in InspectX</a>' : '';
  return '<div class="site-card-sub" style="margin:8px 0;display:flex;align-items:center;justify-content:space-between;"><span>InspectX reference: '+(insp.externalRef||'none')+'</span>'+link+'</div>';
}
function renderDefectRow(d){
  const sevLabel = {high:'High',medium:'Medium',low:'Low'}[d.severity];
  let actions;
  if(d.status==='verified') actions = '<span class="badge complete">'+ICONS.check+'Verified</span>';
  else if(isContractor() && (d.status==='assigned'||d.status==='open') && !readOnly()) actions = '<button class="btn secondary small" data-action="defect" data-op="resolve" data-id="'+d.id+'">Mark resolved</button>';
  else if(canReview() && d.status==='resolved' && !readOnly()) actions = '<button class="btn primary small" data-action="defect" data-op="verify" data-id="'+d.id+'">Verify &amp; close</button>';
  else if(d.status==='resolved') actions = '<span class="badge awaiting_review">Awaiting verification</span>';
  else actions = '<span class="badge missing">'+(d.status==='assigned'?'Assigned':'Open')+'</span>';
  return '<div class="defect-row"><div class="flexbetween"><span class="sev '+d.severity+'">'+sevLabel+'</span>'+actions+'</div>'
    +'<div style="font-size:13px;margin-top:6px;">'+d.description+'</div>'
    +'<div class="site-card-sub" style="margin-top:3px;">Assigned to '+(d.assignedTo||'—')+' · due '+d.dueDate+'</div></div>';
}

/* ---- People tab: workers, toolbox talks, appointments for this site ---- */
function renderSitePeople(siteId){
  const ro = readOnly();
  const ids = (S.state.siteWorkers||{})[siteId] || [];
  const workers = ids.map(id=>S.state.workers[id]).filter(Boolean);
  let html = '<div class="section-title">Workforce on site</div>';
  if(isContractor() && !ro) html += '<button class="btn secondary block" data-action="assign-worker" data-site="'+siteId+'" style="margin-bottom:10px;">+ Assign workers to this site</button>';
  if(!workers.length){
    html += '<div class="card"><div class="site-card-sub">'+(isContractor()?'Assign the people you\'ll bring to this site. The site sees each person\'s medical fitness, induction and training status — usually the first thing an auditor checks.':'The contractor hasn\'t assigned any workers yet. Once they do, you\'ll see each person\'s medical fitness, induction and training status here.')+'</div></div>';
  } else {
    html += '<div class="card">' + workers.map(w=>workerRow(w, siteId)).join('') + '</div>';
  }
  if(workers.length && !isProject(S.state.sites[siteId])) html += gateSection(siteId);

  const talks = (S.state.toolboxTalks||{})[siteId] || [];
  html += '<div class="section-title">Toolbox talks, inductions &amp; training</div>';
  if(canEdit() && !ro) html += '<div class="row-actions" style="margin:0 0 10px;"><button class="btn secondary" style="flex:1;" data-action="new-toolbox-talk" data-site="'+siteId+'">+ Toolbox talk</button>'
    +'<button class="btn secondary" style="flex:1;" data-action="new-toolbox-talk" data-kind="induction" data-site="'+siteId+'">+ Site induction</button>'
    +'<button class="btn secondary" style="flex:1;" data-action="new-toolbox-talk" data-kind="training" data-site="'+siteId+'">+ Other session</button></div>';
  html += talks.length ? '<div class="card">' + talks.map(t=>'<div class="reqrow" data-action="open-toolbox-talk" data-site="'+siteId+'" data-id="'+t.id+'" role="button" tabindex="0" style="cursor:pointer;"><div class="reqrow-main"><div class="reqrow-name">'+t.topic+'</div>'
      +'<div class="reqrow-meta"><span class="srctag">'+sessionLabel(t.kind)+'</span><span class="srctag">'+timeAgo(t.heldOn)+' · '+t.presenter+'</span><span class="badge '+(t.attendance.length?'complete':'missing')+'">'+t.attendance.length+' signed</span></div></div><div class="reqrow-chevron">'+ICONS.chevron+'</div></div>').join('')+'</div>'
    : '<div class="card"><div class="site-card-sub">Nothing recorded yet. Record the session, then pass the device round so each attendee signs. A signed site induction counts as that worker\'s induction at the gate.</div></div>';

  const appts = (S.state.appointments||[]).filter(a=>a.siteId===siteId);
  html += '<div class="section-title">Appointments for this site</div>';
  if(isOrgAdmin() && !ro) html += '<button class="btn secondary block" data-action="new-appointment" data-site="'+siteId+'" style="margin-bottom:10px;">+ Record an appointment</button>';
  html += appts.length ? '<div class="card">'+appts.map(appointmentRow).join('')+'</div>' : '<div class="card"><div class="site-card-sub">No statutory appointments recorded against this site.</div></div>';
  return html;
}

export function workerSummary(w){
  const certs = w.certificates || [];
  const medical = certs.filter(c=>c.kind==='medical_fitness');
  const worst = certs.map(certStatus).reduce((a,s)=> s==='expired'?'expired': a==='expired'?a : s==='expiring'?'expiring':a, 'complete');
  const noMedical = !medical.length;
  return { worst: noMedical ? 'missing' : worst, noMedical, count: certs.length };
}
function workerRow(w, siteId){
  const s = workerSummary(w);
  const label = s.noMedical ? 'No medical on file' : s.worst==='expired' ? 'Certificate expired' : s.worst==='expiring' ? 'Certificate expiring' : 'Current';
  return '<div class="reqrow" data-action="open-worker" data-worker="'+w.id+'"'+(siteId?' data-site="'+siteId+'"':'')+' role="button" tabindex="0" style="cursor:pointer;"><div class="reqrow-main">'
    +'<div class="reqrow-name">'+w.name+(w.active?'':' <span class="badge grey">Inactive</span>')+'</div>'
    +'<div class="reqrow-meta"><span class="badge '+(s.worst==='missing'?'missing':s.worst)+'">'+label+'</span><span class="srctag">'+(w.occupation||'—')+' · '+s.count+' certificate'+(s.count===1?'':'s')+(w.own?'':' · '+w.orgName)+'</span></div>'
    +'</div><div class="reqrow-chevron">'+ICONS.chevron+'</div></div>';
}
export function appointmentRow(a){
  const ended = a.revokedAt || (a.endDate && daysUntil(a.endDate) < 0);
  return '<div class="reqrow"'+(a.own && !a.revokedAt && isOrgAdmin() && !readOnly()?' data-action="open-appointment" data-id="'+a.id+'" style="cursor:pointer;" role="button" tabindex="0"':'')+'><div class="reqrow-main">'
    +'<div class="reqrow-name">'+a.appointeeName+' — '+a.type+'</div>'
    +'<div class="reqrow-meta"><span class="badge '+(ended?'grey':'complete')+'">'+(a.revokedAt?'Revoked':ended?'Ended':'Active')+'</span>'
    +'<span class="srctag">'+(a.legalReference?a.legalReference+' · ':'')+'from '+timeAgo(a.startDate)+(a.endDate?' to '+timeAgo(a.endDate):'')+(a.own?'':' · '+a.orgName)+'</span>'
    +(a.fileUrl?'<a class="srctag" href="'+a.fileUrl+'" target="_blank" rel="noopener">letter</a>':'')+'</div></div></div>';
}

/* ============ CONTRACTOR: YOUR DOCUMENTS ============ */
function renderPassport(){
  const contractorId = myContractorId();
  const mySites = Object.values(S.state.sites).filter(s=>s.status!=='invited' && s.status!=='declined');
  let html = '<div class="view-head"><div class="flexbetween"><h1>Your Documents</h1>'
    +'<button class="btn secondary small" data-action="toggle-select">'+(S.docSelectMode?'Cancel':'Select')+'</button></div>'
    +'<p>'+org().name+'</p></div>';
  if(!S.docSelectMode) html += studioWidget().replace('<div class="section-title">Document Studio</div>','');
  if(S.docSelectMode){
    html += '<div class="card checkpoint" style="display:flex;align-items:center;justify-content:space-between;">'
      +'<span class="site-card-sub">'+S.selectedDocs.length+' selected</span>'
      +'<div style="display:flex;gap:6px;"><button class="btn secondary small" data-action="export-selected">Export PDF</button>'
      +(readOnly()?'':'<button class="btn danger small" data-action="withdraw-selected">Withdraw</button>')+'</div></div>';
  }
  // Every document the company owes: its reusable company documents, then each site's requirements.
  const groups = [{ title:'Company documents', sub:'Upload each once — keep one current copy here for every site you work on.',
    rows: LIBRARY_TYPES.map(t=>{ const id = libraryReqId(contractorId, t.id); return { id, name:t.name, doc:S.state.documents[id] || {status:'missing'}, where:'Company documents' }; }) }];
  mySites.forEach(site=>groups.push({ title:site.name, rows:(S.state.requirements[site.id]||[]).map(r=>({ id:r.id, name:r.name, doc:S.state.documents[r.id] || {status:'missing'}, where:site.name+' '+r.category })) }));
  const bucket = (d)=>{ const e = effectiveStatus(d); return e==='complete' ? 'approved' : e==='awaiting_review' ? 'review' : e==='missing' ? (d.pendingFileId ? 'attention' : 'missing') : 'attention'; };
  const f = S.passportFilter || 'all';
  const counts = { all:0, missing:0, attention:0, review:0, approved:0 };
  groups.forEach(g=>g.rows.forEach(r=>{ if(!matchSearch('mydocs', r.name, r.where)) return; counts.all++; counts[bucket(r.doc)]++; }));
  html += searchBox('mydocs', 'Search your documents or sites')
    + '<div class="filter-chips">'+[['all','All'],['missing','Missing'],['attention','Needs attention'],['review','In review'],['approved','Approved']]
      .map(([k,l])=>'<button class="site-picker-chip'+(f===k?' active':'')+'" data-action="passport-filter" data-filter="'+k+'">'+l+'<b>'+counts[k]+'</b></button>').join('')+'</div>';
  let shownAny = false;
  groups.forEach((g, gi)=>{
    const rows = g.rows.filter(r=>matchSearch('mydocs', r.name, r.where) && (f==='all' || bucket(r.doc)===f));
    if(!rows.length) return;
    shownAny = true;
    html += '<div class="section-title">'+g.title+'</div>'+(gi===0 && f==='all' && !searching('mydocs') ? '<div class="site-card-sub" style="margin-bottom:8px;">'+g.sub+'</div>' : '')
      +'<div class="card">'+rows.map(r=>documentRow(r.id, r.name, r.doc)).join('')+'</div>';
  });
  if(!shownAny) html += '<div class="list-empty">'+(searching('mydocs') ? 'Nothing matches “'+escapeHtml(S.search.mydocs)+'”.' : f==='approved' ? 'Nothing approved yet.' : 'Nothing here — well done.')+'</div>';
  html += '<div class="section-title">Your people</div><div class="card checkpoint" data-action="goto-more" data-view="workforce" style="cursor:pointer;"><div class="flexbetween"><div><div class="site-card-title">Workforce</div><div class="site-card-sub">Medical fitness, inductions and training for each worker</div></div>'+ICONS.chevron+'</div></div>';
  html += '<div class="section-title">Sites you\'re on</div>'
    + (mySites.length ? mySites.map(portfolioRow).join('') : '<div class="empty"><h3>Not on any sites yet</h3><p>Once a site invites you and you accept, it\'ll show up here.</p></div>');
  return html;
}
function documentRow(reqId, name, doc){
  const eff = effectiveStatus(doc);
  const checked = S.selectedDocs.indexOf(reqId)>=0;
  return '<div class="reqrow"'+(S.docSelectMode?'':' data-action="open-req" data-req="'+reqId+'" role="button" tabindex="0" style="cursor:pointer;"')+'>'
    +(S.docSelectMode?'<input type="checkbox" data-action="doc-check" data-req="'+reqId+'" '+(checked?'checked':'')+' style="margin-right:2px;" aria-label="Select '+name+'">':'')
    +'<div class="reqrow-main"><div class="reqrow-name">'+name+'</div>'
    +'<div class="reqrow-meta">'+badge(eff)+(doc.expiryDate?'<span class="srctag">expires '+timeAgo(doc.expiryDate)+'</span>':'')+(doc.aiDrafted?'<span class="srctag">AI draft</span>':'')+(doc.pendingFileId?'<span class="srctag">file attached, not submitted</span>':'')+'</div></div>'
    +(S.docSelectMode?'':'<div class="reqrow-chevron">'+ICONS.chevron+'</div>')+'</div>';
}

/* ============ HOST: DOCUMENTS & CONTRACTORS ============ */
function allDocumentsAcrossSites(){
  const rows = [];
  Object.values(S.state.sites).forEach(site=>{
    (S.state.requirements[site.id]||[]).forEach(req=>{
      const doc = S.state.documents[req.id] || {status:'missing'};
      rows.push({ req, doc, status: effectiveStatus(doc), site, contractor: contractorOf(site) });
    });
  });
  return rows;
}
function renderDocumentCentre(){
  const all = allDocumentsAcrossSites();
  const rows = all.filter(r=>matchSearch('docs', r.req.name, r.req.category, r.site.name, r.contractor.name));
  const counts = {all:rows.length, awaiting_review:0, expiring:0, expired:0, correction_required:0, missing:0, complete:0};
  rows.forEach(r=>{ if(counts[r.status]!==undefined) counts[r.status]++; });
  const filter = S.docCentreFilter;
  const shown = filter==='all' ? rows : rows.filter(r=>r.status===filter);
  const chips = [['all','All'],['awaiting_review','Awaiting review'],['missing','Missing'],['correction_required','Corrections'],['expiring','Expiring'],['expired','Expired'],['complete','Approved']];
  let html = searchBox('docs', 'Search documents, sites or contractors')
    + '<div class="filter-chips">'+chips.map(([key,label])=>'<button class="site-picker-chip'+(filter===key?' active':'')+'" data-action="doc-centre-filter" data-filter="'+key+'">'+label+'<b>'+counts[key]+'</b></button>').join('')+'</div>';
  if(!all.length) return html + '<div class="empty"><h3>No documents yet</h3><p>Once contractors start submitting against site requirements, they\'ll show up here.</p></div>';
  if(!shown.length) return html + '<div class="list-empty">'+(searching('docs') ? 'Nothing matches “'+escapeHtml(S.search.docs)+'”.' : 'Nothing in this category.')+'</div>';
  const LIMIT = 200;
  return html + '<div class="card">' + shown.slice(0, LIMIT).map(r=>'<div class="reqrow" data-action="open-req" data-req="'+r.req.id+'" role="button" tabindex="0" style="cursor:pointer;"><div class="reqrow-main">'
    +'<div class="reqrow-name">'+r.req.name+'</div><div class="reqrow-meta">'+badge(r.status)+'<span class="srctag">'+r.site.name+' · '+r.contractor.name+'</span></div></div>'
    +'<div class="reqrow-chevron">'+ICONS.chevron+'</div></div>').join('') + '</div>'
    + (shown.length > LIMIT ? '<div class="list-empty">Showing '+LIMIT+' of '+shown.length+'. Search or pick a category to narrow it down.</div>' : '');
}

/** What a contractor still owes, and what's waiting on us, across its active sites. */
function contractorSummary(c){
  const sites = Object.values(S.state.sites).filter(s=>s.contractorId===c.id);
  let outstanding = 0, awaiting = 0, total = 0, complete = 0;
  sites.filter(s=>s.status!=='declined').forEach(s=>{
    (S.state.requirements[s.id]||[]).forEach(r=>{
      const st = effectiveStatus(S.state.documents[r.id]);
      total++;
      if(st==='awaiting_review') awaiting++;
      else if(st==='complete' || st==='expiring') complete++;
      else outstanding++;
    });
  });
  const ids = new Set(sites.map(s=>s.id));
  const workers = Object.values(S.state.workers||{}).filter(w=>!w.own && (w.siteIds||[]).some(id=>ids.has(id))).length;
  return { sites, outstanding, awaiting, total, complete, workers, percent: total ? Math.round(100*complete/total) : 0 };
}

function renderContractorsList(){
  const tab = S.hostPeopleTab || 'contractors';
  let html = '<div class="view-head"><h1>'+(tab==='contractors'?'Contractors':'Documents')+'</h1><p>'+org().name+'</p></div>'
    +'<div class="subtabs" role="tablist">'
    +[['contractors','Contractors'],['documents','Documents']].map(([t,l])=>'<button role="tab" data-action="host-people-tab" data-tab="'+t+'" class="'+(tab===t?'active':'')+'" aria-selected="'+(tab===t)+'">'+l+'</button>').join('')
    +'</div>';
  if(tab==='documents') return html + renderDocumentCentre();

  const list = Object.values(S.state.contractors);
  if(!list.length) return html+'<div class="empty"><h3>No contractors yet</h3><p>Contractors are added when you create a site and invite them. Tap + and choose <strong>Add a site</strong>.</p></div>';
  const withSum = list.map(c=>({ c, sum: contractorSummary(c) }));
  const trades = [...new Set(list.map(c=>(c.trade||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const f = S.contractorFilter || 'all', trade = S.contractorTrade || '', sort = S.contractorSort || 'attention';
  const counts = { all:0, review:0, outstanding:0, joined:0, pending:0 };
  const passes = (x)=>matchSearch('contractors', x.c.name, x.c.trade, x.c.reg, x.c.coid, x.c.contact, x.c.contactEmail, x.sum.sites.map(s=>s.name).join(' ')) && (!trade || (x.c.trade||'').trim()===trade);
  const base = withSum.filter(passes);
  const is = { all:()=>true, review:x=>x.sum.awaiting>0, outstanding:x=>x.sum.outstanding>0, joined:x=>x.c.linked, pending:x=>!x.c.linked };
  base.forEach(x=>Object.keys(is).forEach(k=>{ if(is[k](x)) counts[k]++; }));
  const shown = base.filter(is[f] || is.all).sort(sort==='name' ? (a,b)=>unescapeHtml(a.c.name).localeCompare(unescapeHtml(b.c.name))
    : sort==='reliability' ? (a,b)=>b.c.reliability-a.c.reliability
    : (a,b)=>(b.sum.awaiting*2+b.sum.outstanding)-(a.sum.awaiting*2+a.sum.outstanding) || unescapeHtml(a.c.name).localeCompare(unescapeHtml(b.c.name)));
  html += searchBox('contractors', 'Search by name, trade, registration, contact or site');
  html += '<div class="filter-chips">'+[['all','All'],['review','Awaiting your review'],['outstanding','Documents outstanding'],['joined','On SiteGuard'],['pending','Not yet joined']]
    .map(([k,l])=>'<button class="site-picker-chip'+(f===k?' active':'')+'" data-action="contractor-filter" data-filter="'+k+'">'+l+'<b>'+counts[k]+'</b></button>').join('')+'</div>';
  html += '<div class="list-tools">'
    +'<label>Trade <select class="field" data-action-change="contractor-trade"><option value="">All trades</option>'+trades.map(t=>'<option'+(t===trade?' selected':'')+'>'+t+'</option>').join('')+'</select></label>'
    +'<label>Sort <select class="field" data-action-change="contractor-sort">'+[['attention','Needs attention first'],['name','Name A–Z'],['reliability','Most reliable']].map(([k,l])=>'<option value="'+k+'"'+(k===sort?' selected':'')+'>'+l+'</option>').join('')+'</select></label></div>';
  if(!shown.length) return html + '<div class="list-empty">'+(searching('contractors') ? 'No contractor matches “'+escapeHtml(S.search.contractors)+'”.' : 'No contractors in this view.')+'</div>';
  return html + '<div class="card">' + shown.map(({c, sum})=>'<div class="reqrow" data-action="open-contractor" data-id="'+c.id+'" role="button" tabindex="0" style="cursor:pointer;">'
    +'<div class="avatar-sq">'+initials(unescapeHtml(c.name))+'</div><div class="reqrow-main">'
    +'<div class="reqrow-name">'+c.name+'</div>'
    +'<div class="reqrow-meta">'
      +(sum.awaiting?'<span class="badge awaiting_review">'+sum.awaiting+' to review</span>':'')
      +(sum.outstanding?'<span class="badge missing">'+sum.outstanding+' outstanding</span>':'')
      +(!sum.awaiting && !sum.outstanding && sum.total?'<span class="badge complete">Up to date</span>':'')
      +'<span class="srctag">'+(c.trade||'Trade not set')+'</span>'
      +'<span class="srctag">'+sum.sites.length+' site'+(sum.sites.length===1?'':'s')+'</span>'
      +(c.linked?'':'<span class="srctag">Not yet joined</span>')
    +'</div></div><div class="reqrow-chevron">'+ICONS.chevron+'</div></div>').join('') + '</div>';
}

on('host-people-tab', (el)=>{ S.hostPeopleTab = el.dataset.tab; render(); window.scrollTo(0,0); });
on('contractor-filter', (el)=>{ S.contractorFilter = el.dataset.filter; S.keepScroll = true; render(); S.keepScroll = false; });
on('contractor-trade', (el)=>{ S.contractorTrade = el.value; S.keepScroll = true; render(); S.keepScroll = false; });
on('contractor-sort', (el)=>{ S.contractorSort = el.value; S.keepScroll = true; render(); S.keepScroll = false; });
on('open-contractor', (el)=>{
  const c = S.state.contractors[el.dataset.id];
  if(!c) return;
  const sum = contractorSummary(c);
  const row = (k, v)=>'<div class="kv"><span>'+k+'</span><strong>'+(v||'—')+'</strong></div>';
  openSheet(sheetHead(c.name, c.linked ? 'On SiteGuard — details kept up to date by '+c.name : 'Not yet joined SiteGuard')
    +'<div class="card">'+row('Trade / specialisation', c.trade)+row('Registration no.', c.reg)+row('COID no.', c.coid)+row('Contact', c.contact)+row('Email', c.contactEmail && !/\.invalid$/.test(c.contactEmail) ? '<a href="mailto:'+c.contactEmail+'">'+c.contactEmail+'</a>' : '')+(c.address?row('Address', c.address):'')
      +row('Reliability', c.reliability>0 ? c.reliability+'% (first-time-right '+c.firstTimeRightRate+'%'+(c.onTimeRate?', on time '+c.onTimeRate+'%':'')+')' : 'Not enough submissions yet')
      +row('Workers on your sites', String(sum.workers))+'</div>'
    +'<div class="section-title">Sites</div>'
    +(sum.sites.length ? '<div class="card">'+sum.sites.map(s=>{ const r = computeReadiness(s.id); const pct = s.status==='site_ready' ? 100 : r.percent;
        return '<div class="reqrow" data-action="contractor-site" data-site="'+s.id+'" role="button" tabindex="0" style="cursor:pointer;"><div class="reqrow-main"><div class="reqrow-name">'+s.name+'</div><div class="reqrow-meta"><span class="badge '+(s.status==='site_ready'?'complete':s.status==='invited'?'grey':'awaiting_review')+'">'+(s.status==='site_ready'?'Site Ready':s.status==='invited'?'Invited':s.status==='declined'?'Declined':pct+'% ready')+'</span></div></div><div class="reqrow-chevron">'+ICONS.chevron+'</div></div>'; }).join('')+'</div>'
      : '<div class="list-empty">No sites yet.</div>')
    +(c.linked
      ? '<div class="notice" style="margin-top:12px;">'+c.name+' manages its own company details in SiteGuard, so they can\'t be changed here. That keeps the record accurate and shows who is responsible for it.</div>'
      : (isOrgAdmin() && !readOnly() ? '<button class="btn secondary block" style="margin-top:12px;" data-action="edit-contractor" data-id="'+c.id+'">Correct invitation details</button><div class="site-card-sub" style="margin-top:6px;">You can correct the name or email you invited them with until they join. After that, they keep their own details up to date.</div>' : ''))
    + suspendControls(c));
});
on('contractor-site', (el)=>{ closeSheet(); S.nav='sites'; S.activeSiteId = el.dataset.site; S.siteTab='compliance'; render(); window.scrollTo(0,0); });

/* ============ MORE ============ */
function renderMore(){
  if(S.moreView) return '<div style="margin-bottom:14px;"><button class="btn secondary small" data-action="goto-more" data-view="">← More</button></div>' + (MORE_VIEWS[S.moreView] ? MORE_VIEWS[S.moreView]() : '');
  const item = (view, icon, title, sub) => '<button class="menu-row" data-action="goto-more" data-view="'+view+'"><div class="qa-icon">'+icon+'</div><div style="flex:1;"><div class="qa-title">'+title+'</div><div class="qa-sub">'+sub+'</div></div>'+ICONS.chevron+'</button>';
  let html = '<div class="view-head"><h1>More</h1><p>'+org().name+' · '+org().roleLabel+'</p></div>'
    +'<button class="tour-cta" data-action="start-tour"><span class="tour-cta-ic">'+ICONS.sparkle+'</span><span><strong>Walkthrough</strong><span class="site-card-sub">A guided tour of every page, with auto-play for demos</span></span>'+ICONS.chevron+'</button>'
    +'<div class="card">';
  if(isContractor() && !readOnly()) html += '<button class="menu-row" data-action="sfb-start"><div class="qa-icon">'+ICONS.passport+'</div><div style="flex:1;"><div class="qa-title">Create a safety file</div><div class="qa-sub">For a site on SiteGuard or any client</div></div>'+ICONS.chevron+'</button>';
  html += item('studio', ICONS.passport, 'Document Studio', 'Your documents, plus branded safety documents as PDF and Word');
  if(isContractor() && isOrgAdmin() && !readOnly()) html += '<button class="menu-row" data-action="new-project"><div class="qa-icon">'+ICONS.plus+'</div><div style="flex:1;"><div class="qa-title">New project</div><div class="qa-sub">A safety file for a client who isn\'t on SiteGuard</div></div>'+ICONS.chevron+'</button>';
  if(isContractor() && isOrgAdmin()) html += '<button class="menu-row" data-action="join-site"><div class="qa-icon">'+ICONS.link+'</div><div style="flex:1;"><div class="qa-title">Join a site with a code</div><div class="qa-sub">Type the code the site gave you</div></div>'+ICONS.chevron+'</button>';
  const nf = (S.boot.agent||{findings:[]}).findings.length;
  html += item('agent', ICONS.verify, 'Compliance agent', nf ? nf+' item'+(nf===1?'':'s')+' need attention' : 'Continuous checks across every site');
  html += '<button class="menu-row" data-action="open-assistant"><div class="qa-icon">'+ICONS.sparkle+'</div><div style="flex:1;"><div class="qa-title">SiteGuard Assistant</div><div class="qa-sub">Ask what a site or job needs, or how your sites are doing</div></div>'+ICONS.chevron+'</button>';
  if(isHost()) html += item('safety', ICONS.alert, 'Safety Centre', 'Open incidents and permits across every site');
  html += item('workforce', ICONS.hardhat, 'Workforce', isContractor()?'Your workers\' medicals, inductions and training':'Contractor workers assigned to your sites');
  html += item('appointments', ICONS.passport, 'Appointments register', 'Statutory appointments and their letters');
  html += item('audit', ICONS.audit, 'Audit trail', 'Complete history — who, what, when');
  html += item('links', ICONS.link, 'External share links', 'Expiring links for people outside '+org().name);
  html += item('verify', ICONS.verify, 'Verify a record', 'Check a Site Ready verification');
  html += '</div><div class="section-title">Organisation</div><div class="card">';
  html += item('team', ICONS.people, 'Team & roles', 'Invite colleagues and set what they can do');
  if(isOrgAdmin()) html += item('billing', ICONS.card, 'Plan & billing', org().planName+' · '+org().seatLimit+' seats');
  if(isOrgAdmin()) html += item('settings', ICONS.gear, 'Organisation settings', 'Company details, notifications, integrations');
  if(S.boot.me.platformAdmin) html += item('platform', ICONS.dashboard, 'Platform', 'Sign-ups, plans, usage and health across the service');
  html += '</div><div class="section-title">Account</div><div class="card">'
    +'<button class="menu-row" data-action="open-profile"><div class="qa-icon">'+initials(myName())+'</div><div style="flex:1;"><div class="qa-title">'+myName()+'</div><div class="qa-sub">'+S.boot.me.email+'</div></div>'+ICONS.chevron+'</button>'
    +'<button class="menu-row" data-action="open-feedback"><div class="qa-icon">'+ICONS.alert+'</div><div style="flex:1;"><div class="qa-title">Report a problem or suggest an idea</div><div class="qa-sub">Goes straight to the SiteGuard team</div></div>'+ICONS.chevron+'</button>'
    +'<a class="menu-row" href="/privacy" target="_blank" rel="noopener"><div class="qa-icon">'+ICONS.verify+'</div><div style="flex:1;"><div class="qa-title">Privacy &amp; terms</div><div class="qa-sub">How SiteGuard handles your information</div></div>'+ICONS.chevron+'</a>'
    +'<button class="menu-row" data-action="auth-signout"><div class="qa-icon">⎋</div><div><div class="qa-title">Sign out</div></div></button></div>';
  return html;
}

const MORE_VIEWS = {
  safety: renderSafetyCentre,
  workforce: renderWorkforce,
  appointments: renderAppointments,
  audit: renderAudit,
  links: renderShareLinks,
  verify: renderVerify,
  team: () => renderTeam(),
  billing: () => renderBilling(),
  settings: renderSettings,
  agent: renderAgent,
  studio: renderStudio,
  platform: renderPlatform,
};

/* ---- Safety Centre (cross-site incidents & permits) ---- */
function renderSafetyCentre(){
  const incidents = [], permits = [];
  Object.keys(S.state.sites).forEach(siteId=>{
    (S.state.incidents[siteId]||[]).forEach(inc=>incidents.push({inc, siteId}));
    (S.state.permits[siteId]||[]).forEach(p=>permits.push({p, siteId, eff:permitEffectiveStatus(p)}));
  });
  const f = S.safetyFilter;
  const openInc = incidents.filter(x=>x.inc.status!=='closed');
  const severe = openInc.filter(x=>x.inc.type==='lost_time'||x.inc.type==='fatality');
  const pending = permits.filter(x=>x.eff==='pending'), active = permits.filter(x=>x.eff==='active'), expired = permits.filter(x=>x.eff==='expired');
  const chips = [['action','Needs action',openInc.length+pending.length+expired.length],['open','Open incidents',openInc.length],['severe','LTI / fatality',severe.length],['pending','Permits to issue',pending.length],['active','Active permits',active.length],['expired','Expired permits',expired.length],['all','Everything',incidents.length+permits.length]];
  let html = '<div class="view-head"><h1>Safety Centre</h1><p>Incidents and permits across all '+Object.keys(S.state.sites).length+' sites</p></div>'
    +'<div class="attn-grid" style="margin-bottom:12px;">'
    +'<div class="attn-card red" data-action="safety-filter" data-filter="open" style="cursor:pointer;"><div class="attn-num">'+openInc.length+'</div><div class="attn-label">Open incidents</div></div>'
    +'<div class="attn-card red" data-action="safety-filter" data-filter="severe" style="cursor:pointer;"><div class="attn-num">'+severe.length+'</div><div class="attn-label">LTI / fatality open</div></div>'
    +'<div class="attn-card blue" data-action="safety-filter" data-filter="pending" style="cursor:pointer;"><div class="attn-num">'+pending.length+'</div><div class="attn-label">Permits awaiting issue</div></div>'
    +'<div class="attn-card amber" data-action="safety-filter" data-filter="expired" style="cursor:pointer;"><div class="attn-num">'+expired.length+'</div><div class="attn-label">Expired, not closed</div></div></div>'
    +'<div class="site-picker-row" style="margin-bottom:10px;">'+chips.map(([k,l,n])=>'<button class="site-picker-chip'+(f===k?' active':'')+'" data-action="safety-filter" data-filter="'+k+'">'+l+' ('+n+')</button>').join('')+'</div>';
  const siteName = (id)=>(S.state.sites[id]||{}).name;
  const incRows = (f==='open'||f==='action'?openInc : f==='severe'?severe : f==='all'?incidents : []).filter(x=>matchSearch('safety', x.inc.description, x.inc.person, x.inc.type, siteName(x.siteId)));
  const permRows = (f==='action'?pending.concat(expired) : f==='pending'?pending : f==='active'?active : f==='expired'?expired : f==='all'?permits : []).filter(x=>matchSearch('safety', x.p.location, x.p.description, x.p.type, x.p.issuedTo, siteName(x.siteId)));
  html += searchBox('safety', 'Search by site, location, person or description');
  if(incRows.length) html += '<div class="section-title">Incidents</div><div class="card">'+incRows.map(x=>renderIncidentRow(x.inc, x.siteId, true)).join('')+'</div>';
  if(permRows.length) html += '<div class="section-title">Permits</div><div class="card">'+permRows.map(x=>renderPermitRow(x.p, x.siteId, true)).join('')+'</div>';
  if(!incRows.length && !permRows.length) html += '<div class="empty"><h3>'+(f==='action'?'All clear':'Nothing here')+'</h3><p>'+(f==='action'?'No open incidents, permits awaiting issue or expired permits across your sites.':'No items match this filter.')+'</p></div>';
  return html;
}

/* ---- Workforce ---- */
function renderWorkforce(){
  const allWorkers = Object.values(S.state.workers||{});
  const workers = allWorkers.filter(w=>matchSearch('workforce', w.name, w.occupation, w.employeeNo, w.orgName, (w.certificates||[]).map(c=>c.name).join(' ')));
  const own = workers.filter(w=>w.own), others = workers.filter(w=>!w.own);
  let html = '<div class="view-head"><div class="flexbetween"><h1>Workforce</h1>'+(canEdit() && !readOnly()?'<button class="btn primary small" data-action="new-worker">+ Add worker</button>':'')+'</div>'
    +'<p>Per-worker medical surveillance, inductions and training. Only the last 4 characters of ID numbers are stored.</p></div>';
  if(allWorkers.length) html += searchBox('workforce', 'Search by name, occupation, company or certificate');
  if(searching('workforce') && !workers.length) return html + '<div class="list-empty">No worker matches “'+escapeHtml(S.search.workforce)+'”.</div>';
  if(isContractor() || own.length){
    html += '<div class="section-title">'+(isContractor()?'Your workers':'Your own staff')+'</div>'
      + (own.length ? '<div class="card">'+own.map(w=>workerRow(w)).join('')+'</div>' : '<div class="empty"><h3>No workers yet</h3><p>Add each person on your crew, then record their medical certificate of fitness, site inductions and training with expiry dates. You\'ll get reminders before anything lapses.</p></div>');
  }
  if(isHost()){
    html += '<div class="section-title">Contractor workers on your sites</div>'
      + (others.length ? '<div class="card">'+others.map(w=>workerRow(w)).join('')+'</div>' : '<div class="card"><div class="site-card-sub">Contractors haven\'t assigned any workers to your sites yet.</div></div>');
  }
  return html;
}

/* ---- Appointments register ---- */
function renderAppointments(){
  const all = S.state.appointments || [];
  const list = all.filter(a=>matchSearch('appointments', a.appointeeName, a.type, a.legalReference, a.orgName));
  const own = list.filter(a=>a.own), others = list.filter(a=>!a.own);
  let html = '<div class="view-head"><div class="flexbetween"><h1>Appointments register</h1>'+(isOrgAdmin() && !readOnly()?'<button class="btn primary small" data-action="new-appointment">+ Record</button>':'')+'</div>'
    +'<p>Statutory appointments (e.g. OHS Act s16(1)/16(2), Construction Regulations 8(1)/8(7), MHSA appointments) with their signed letters.</p></div>';
  if(all.length > 3 || searching('appointments')) html += searchBox('appointments', 'Search by person, appointment or company');
  html += '<div class="section-title">'+org().name+'</div>' + (own.length ? '<div class="card">'+own.map(appointmentRow).join('')+'</div>' : '<div class="card"><div class="site-card-sub">No appointments recorded yet.</div></div>');
  if(others.length) html += '<div class="section-title">Other organisations on your sites</div><div class="card">'+others.map(appointmentRow).join('')+'</div>';
  html += '<div class="notice" style="margin-top:12px;">SiteGuard records appointments; it doesn\'t decide which ones your operation legally needs. Confirm requirements with your legal or SHE advisor.</div>';
  return html;
}

/* ---- Audit ---- */
function renderAudit(){
  const sites = Object.values(S.state.sites);
  const f = S.auditFilter;
  const filtered = f.from || f.to || f.siteId;
  const rows = (filtered && S.auditRows ? S.auditRows : S.state.audit).filter(a=>matchSearch('audit', a.actor, a.action, a.detail, (S.state.sites[a.siteId]||{}).name));
  return '<div class="view-head"><h1>Audit trail</h1><p>Complete, append-only history — who, what, when</p></div>'
    +'<div class="card">'
    +'<label class="field-label" for="auditFrom">From</label><input type="date" id="auditFrom" value="'+f.from+'">'
    +'<label class="field-label" for="auditTo">To</label><input type="date" id="auditTo" value="'+f.to+'">'
    +'<label class="field-label" for="auditSite">Site</label><select id="auditSite" class="field"><option value="">All sites</option>'
      + sites.map(s=>'<option value="'+s.id+'"'+(f.siteId===s.id?' selected':'')+'>'+s.name+'</option>').join('')+'</select>'
    +'<div style="display:flex;gap:8px;margin-top:10px;"><button class="btn secondary small" style="flex:1;" data-action="audit-filter">Apply filter</button>'
    +'<button class="btn primary small" style="flex:1;" data-action="audit-export">Export PDF</button></div></div>'
    + searchBox('audit', 'Search by person, action or detail')
    +'<div class="site-card-sub" style="margin-bottom:8px;">'+(filtered?rows.length+' event'+(rows.length===1?'':'s')+' matching filter':'Latest '+rows.length+' events — filter or export for the full history')+'</div>'
    +'<div class="card">' + (rows.length ? rows.map(a=>'<div class="audit-row"><div class="audit-dot action"></div><div class="audit-body">'
      +'<div class="audit-action"><strong>'+a.actor+'</strong> ('+a.role+') — '+a.action+'</div>'
      +'<div class="audit-meta">'+(a.detail?a.detail+' · ':'')+dateTime(a.ts)+(a.siteId&&S.state.sites[a.siteId]?' · '+S.state.sites[a.siteId].name:'')+'</div></div></div>').join('')
      : '<div class="site-card-sub">No events match this filter.</div>') +'</div>';
}

/* ---- Share links ---- */
function renderShareLinks(){
  const links = S.state.shareLinks || [];
  const now = new Date().toISOString();
  let html = '<div class="view-head"><h1>External share links</h1><p>Read-only links for auditors, clients or principal contractors outside '+org().name+'. Each one expires, can be revoked, and shows only the one site it was made for.</p></div>';
  html += '<div class="notice">Create a link from a site\'s page with the <strong>Share</strong> button.</div>';
  if(!links.length) return html + '<div class="empty"><h3>No links yet</h3><p>Links you create will be listed here with how often they were opened.</p></div>';
  if(links.length > 5 || searching('links')) html += searchBox('links', 'Search by site or who it was for');
  return html + '<div class="card">'+links.filter(l=>matchSearch('links', (S.state.sites[l.siteId]||{}).name, l.label, l.createdBy)).map(l=>{
    const site = S.state.sites[l.siteId];
    const status = l.revokedAt ? 'Revoked' : l.expiresAt < now ? 'Expired' : 'Active';
    return '<div class="reqrow"><div class="reqrow-main"><div class="reqrow-name">'+(l.kind==='safety_file'?'Safety file':'Readiness status')+' — '+(site?site.name:'Site')+(l.label?' ('+l.label+')':'')+'</div>'
      +'<div class="reqrow-meta"><span class="badge '+(status==='Active'?'complete':'grey')+'">'+status+'</span><span class="srctag">by '+l.createdBy+' · expires '+timeAgo(l.expiresAt)+' · opened '+l.accessCount+'×'+(l.lastAccessedAt?' (last '+timeAgo(l.lastAccessedAt)+')':'')+'</span></div></div>'
      +(status==='Active' && !readOnly() ? '<button class="btn danger small" data-action="revoke-link" data-id="'+l.id+'">Revoke</button>' : '')+'</div>';
  }).join('')+'</div>';
}

/* ---- Verify ---- */
function renderVerify(){
  const approved = Object.entries(S.state.approvals);
  let html = '<div class="view-head"><h1>Verify</h1><p>Check a SiteGuard Site Ready record. Anyone can verify a code at /verify/&lt;code&gt; — no account needed.</p></div>'
    +'<div class="card"><label class="field-label" for="verifyCode">Verification code</label><input type="text" id="verifyCode" placeholder="e.g. SG-2026-7K4M2QXA">'
    +'<button class="btn primary block" style="margin-top:10px;" data-action="verify-code">Check code</button></div>';
  if(!approved.length) return html + '<div class="empty"><h3>No Site Ready records yet</h3><p>Approved sites will be listed here.</p></div>';
  if(!S.verifySiteId || !S.state.approvals[S.verifySiteId]) S.verifySiteId = approved[0][0];
  const approval = S.state.approvals[S.verifySiteId];
  const site = S.state.sites[S.verifySiteId];
  html += '<div class="section-title">Your records</div><select id="verifySel" class="field" style="margin-bottom:12px;" aria-label="Record">'
    + approved.map(([id])=>'<option value="'+id+'"'+(id===S.verifySiteId?' selected':'')+'>'+S.state.sites[id].name+'</option>').join('')+'</select>'
    +'<div class="verify-card"><div class="stamp">'+(site.status==='site_ready'?'Verified':'Superseded')+'</div>'
    +'<h3>'+site.name+'</h3>'
    +'<div class="vrow"><span>'+(isContractor()?'Host':'Contractor')+'</span><span>'+(isContractor()?site.hostName:contractorOf(site).name)+'</span></div>'
    +'<div class="vrow"><span>Version</span><span>'+approval.version+'</span></div>'
    +'<div class="vrow"><span>Status</span><span>'+(site.status==='site_ready'?'Site Ready':'Not currently ready')+'</span></div>'
    +'<div class="vrow"><span>Approved</span><span>'+timeAgo(approval.date)+' by '+approval.approver+'</span></div>'
    +'<div class="vid mono">'+approval.verificationId+'</div>'
    +'<a class="btn secondary small" style="margin-top:12px;" href="/verify/'+approval.verificationId+'" target="_blank" rel="noopener">Open public verification page</a></div>'
    +'<div class="notice" style="margin-top:14px;">Verification confirms this record exists and is current. It does not display private documents or personal information.</div>';
  return html;
}

/* ---- Team ---- */
let teamCache = null;
async function loadTeam(){ teamCache = await api.get('/api/org/members'); render(); }
function renderTeam(){
  if(!teamCache){ loadTeam().catch(e=>showToast(e.message)); return '<div class="empty"><p>Loading…</p></div>'; }
  const t = teamCache, admin = isOrgAdmin();
  const roleOpts = (cur) => t.roles.map(r=>'<option value="'+r.id+'"'+(r.id===cur?' selected':'')+'>'+escapeHtml(r.label)+'</option>').join('');
  let html = '<div class="view-head"><h1>Team &amp; roles</h1><p>'+t.members.length+' member'+(t.members.length===1?'':'s')+(t.limitsEnforced?' · '+t.seatsUsed+' of '+t.seatLimit+' seats used':'')+'</p></div>';
  if(admin && !readOnly()){
    html += '<div class="card"><div class="site-card-title" style="font-size:14px;">Invite a colleague</div>'
      +'<label class="field-label" for="inviteEmail">Email</label><input type="email" id="inviteEmail" placeholder="name@company.co.za">'
      +'<label class="field-label" for="inviteRole">Role</label><select id="inviteRole" class="field">'+roleOpts(isContractor()?'member':'reviewer')+'</select>'
      +'<button class="btn primary block" style="margin-top:10px;" data-action="invite-user">Send invitation</button>'
      +'<div class="site-card-sub" style="margin-top:8px;">'+roleHelp()+'</div></div>';
  }
  if(t.members.length > 5 || searching('team')) html += searchBox('team', 'Search colleagues by name or email');
  html += '<div class="section-title">Members</div><div class="card">'+t.members.filter(m=>matchSearch('team', escapeHtml(m.name), escapeHtml(m.email))).map(m=>{
    const me = m.id===S.boot.me.id;
    return '<div class="reqrow"><div class="reqrow-main"><div class="reqrow-name">'+escapeHtml(m.name)+(me?' (you)':'')+'</div>'
      +'<div class="reqrow-meta"><span class="srctag">'+escapeHtml(m.email)+'</span>'+(m.verified?'':'<span class="badge expiring">Unconfirmed email</span>')+'</div>'
      +(admin && !readOnly() ? '<div class="row-actions"><select class="field" style="width:auto;padding:5px 8px;font-size:12px;" data-action-change="member-role" data-id="'+m.id+'" aria-label="Role for '+escapeHtml(m.name)+'">'+roleOpts(m.role)+'</select>'
        +'<button class="btn danger small" data-action="remove-member" data-id="'+m.id+'" data-name="'+escapeHtml(m.name)+'">'+(me?'Leave':'Remove')+'</button></div>'
        : '<div class="reqrow-meta"><span class="badge grey">'+escapeHtml((t.roles.find(r=>r.id===m.role)||{}).label||m.role)+'</span></div>')
      +'</div></div>';
  }).join('')+'</div>';
  if(t.invites.length){
    html += '<div class="section-title">Pending invitations</div><div class="card">'+t.invites.map(i=>'<div class="reqrow"><div class="reqrow-main"><div class="reqrow-name">'+escapeHtml(i.email)+'</div>'
      +'<div class="reqrow-meta"><span class="badge blue">'+escapeHtml((t.roles.find(r=>r.id===i.role)||{}).label||i.role)+'</span><span class="srctag">expires '+timeAgo(i.expires_at)+'</span></div></div>'
      +(admin?'<button class="btn secondary small" data-action="revoke-invite" data-id="'+i.id+'">Revoke</button>':'')+'</div>').join('')+'</div>';
  }
  if(!admin) html += '<button class="btn danger block" style="margin-top:12px;" data-action="remove-member" data-id="'+S.boot.me.id+'" data-name="you">Leave '+org().name+'</button>';
  return html;
}
function roleHelp(){
  return isContractor()
    ? '<strong>Owner/Admin:</strong> manage team and billing, accept site invitations. <strong>Staff:</strong> submit documents, request permits, log diary and incidents.'
    : '<strong>Owner/Admin:</strong> sites, contractors, team, billing — plus everything reviewers do. <strong>Reviewer:</strong> review documents, approve sites, issue permits, investigate incidents. <strong>Site Staff:</strong> view, log diary entries and report incidents.';
}
export function invalidateTeam(){ teamCache = null; }

/* ---- Billing ---- */
let billingCache = null;
async function loadBilling(){ billingCache = await api.get('/api/billing'); render(); }
function renderBilling(){
  if(!billingCache){ loadBilling().catch(e=>showToast(e.message)); return '<div class="empty"><p>Loading…</p></div>'; }
  const b = billingCache;
  let html = '<div class="view-head"><h1>Plan &amp; billing</h1><p>'+org().name+'</p></div>';
  const promo = '<div class="section-title">Have a promo code?</div><div class="card"><div class="row-actions"><input type="text" id="promoCode" maxlength="40" placeholder="e.g. PARTNER2026" style="flex:1;min-width:140px;" autocapitalize="characters"><button class="btn secondary" data-action="billing-redeem">Apply</button></div></div>';
  if(!b.enabled){
    return html + '<div class="card"><div class="site-card-sub">Billing isn\'t configured on this server (no Stripe keys), so every organisation has full access. Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and the plan price IDs to turn on plans, trials and seat limits.</div></div>';
  }
  if(b.grant) html += '<div class="card checkpoint"><div class="site-card-title">'+escapeHtml(b.grant.plan)+' — given by SiteGuard</div><div class="site-card-sub">'+(b.grant.until ? 'Until '+escapeHtml(String(b.grant.until).slice(0,10))+'.' : 'No end date.')+' No payment needed while this lasts.</div></div>';
  else if(isContractor() && !b.ownAccess) html += '<div class="notice">'+(b.sponsored ? 'You have no plan of your own. Sites that sponsor you are covered; your own projects and other clients need a contractor plan.' : 'You have no plan of your own and no site is sponsoring you right now. Everything stays readable; choose a plan to keep working.')+'</div>';
  if(b.coupon) html += '<div class="notice" style="background:var(--green-bg);color:var(--green);">Promo code '+escapeHtml(b.coupon)+' will be applied when you subscribe.</div>';
  const current = b.plans.find(p=>p.id===b.plan);
  html += '<div class="card checkpoint"><div class="kv"><span>Current plan</span><span>'+escapeHtml(current?current.name:b.plan)+'</span></div>'
    +'<div class="kv"><span>Status</span><span>'+escapeHtml(b.status)+(b.status==='trialing'&&b.trialEndsAt?' until '+timeAgo(b.trialEndsAt):'')+'</span></div>'
    +'<div class="kv"><span>Seats</span><span>'+b.seatsUsed+' used of '+b.seatLimit+'</span></div>'
    +(b.activeSites!==null?'<div class="kv"><span>Active sites</span><span>'+b.activeSites+(current&&current.siteLimit?' of '+current.siteLimit:'')+'</span></div>':'')
    +(b.currentPeriodEnd?'<div class="kv"><span>Renews</span><span>'+timeAgo(b.currentPeriodEnd)+'</span></div>':'')
    +(b.hasCustomer?'<button class="btn secondary block" style="margin-top:10px;" data-action="billing-portal">Payment method &amp; invoices</button>':'')+'</div>';
  html += '<div class="section-title">'+(b.hasSubscription?'Change plan or seats':'Choose a plan')+'</div>';
  html += '<label class="field-label" for="billSeats">Seats</label><input type="number" id="billSeats" min="'+Math.max(1,b.seatsUsed)+'" value="'+Math.max(b.seatLimit, b.seatsUsed)+'">';
  html += b.plans.map(p=>'<div class="plan-card'+(p.id===b.plan?' current':'')+'"><div class="flexbetween"><div class="site-card-title">'+escapeHtml(p.name)+'</div>'+(p.id===b.plan?'<span class="badge approved">Current</span>':'')+'</div>'
    +'<div class="site-card-sub">'+escapeHtml(p.blurb)+'</div>'
    +(p.paid ? (p.purchasable ? '<button class="btn '+(p.id===b.plan?'secondary':'primary')+' small" style="margin-top:8px;" data-action="billing-choose" data-plan="'+p.id+'">'+(b.hasSubscription ? (p.id===b.plan?'Update seats':'Switch to '+escapeHtml(p.name)) : 'Subscribe')+'</button>' : '<div class="site-card-sub" style="margin-top:6px;">Not available yet.</div>') : '<div class="site-card-sub" style="margin-top:6px;">'+(p.id==='contractor_free' ? 'No subscription — covers only the files sites sponsor.' : 'No card needed.')+'</div>')
    +'</div>').join('');
  html += '<div class="site-card-sub" style="margin-top:8px;">Plan changes are prorated. Cancel any time from “Payment method &amp; invoices”; your data stays readable.</div>';
  return html + promo;
}
export function invalidateBilling(){ billingCache = null; }

/* ---- Settings ---- */
function renderSettings(){
  const o = org(), s = S.state.settings || {};
  const ro = readOnly();
  let html = '<div class="view-head"><h1>Organisation settings</h1><p>'+o.name+'</p></div>'
    +'<div class="section-title">Company details</div><div class="card">'
    +'<div class="site-card-sub" style="margin-bottom:2px;">Used on exports and to fill in AI-drafted documents so they read as genuine company paperwork.</div>'
    +'<label class="field-label" for="orgName">Legal / trade name</label><input type="text" id="orgName" value="'+o.name+'">'
    +'<label class="field-label" for="orgReg">Registration number</label><input type="text" id="orgReg" value="'+o.reg+'">'
    +'<label class="field-label" for="orgCoid">COID number</label><input type="text" id="orgCoid" value="'+o.coid+'">'
    +'<label class="field-label" for="orgVat">VAT number (optional)</label><input type="text" id="orgVat" value="'+o.vat+'">'
    +'<label class="field-label" for="orgAddress">Physical address</label><input type="text" id="orgAddress" value="'+o.address+'">'
    +(isContractor()?'<label class="field-label" for="orgTrade">Trade</label><input type="text" id="orgTrade" value="'+o.trade+'">':'')
    +(ro?'':'<button class="btn primary block" style="margin-top:12px;" data-action="save-org">Save company details</button>')+'</div>';
  html += brandingCard(ro);
  html += validityCard();
  html += '<div class="section-title">Notifications</div><div class="card">'
    +'<div class="toggle-row"><label for="digestToggle">Email reminder digests (expiring documents &amp; certificates, open incidents, overdue requests)</label><input type="checkbox" id="digestToggle" '+(s.reminderDigest===false?'':'checked')+' '+(ro?'disabled':'data-action-change="toggle-digest"')+'></div>'
    +'<div class="toggle-row"><label for="weeklyToggle">Monday compliance summary for admins (from the compliance agent)</label><input type="checkbox" id="weeklyToggle" '+(s.weeklySummary===false?'':'checked')+' '+(ro?'disabled':'data-action-change="toggle-weekly"')+'></div>'
    +'<div class="field-label" style="margin-top:12px;">Remind us before a document or certificate expires</div>'
    +'<div class="check-grid" id="reminderDays">'+[90,60,30,14,7,1].map(d=>'<label class="check-chip"><input type="checkbox" value="'+d+'"'+((s.reminderDays||[30,7]).includes(d)?' checked':'')+(ro?' disabled':'')+'> '+(d===1?'1 day':d+' days')+'</label>').join('')+'</div>'
    +'<div class="site-card-sub" style="margin-top:6px;">One email at each point you tick, and one when it expires. Nothing is repeated, so the list stays short.</div>'
    +(ro?'':'<button class="btn secondary small" style="margin-top:8px;" data-action="save-reminder-days">Save reminder days</button>')
    +'<div class="site-card-sub" style="margin-top:10px;">Invitations, correction requests, requests for information, permit requests and serious incidents are always emailed.</div></div>';
  if(isHost()){
    html += '<div class="section-title">InspectX integration</div><div class="card"><div class="site-card-sub" style="margin-bottom:10px;">SiteGuard works fully without InspectX. Once enabled, inspections with an external reference link straight across.</div>'
      +'<div class="toggle-row"><label for="inspectxToggle">Enable InspectX links</label><input type="checkbox" id="inspectxToggle" '+(s.inspectxEnabled?'checked':'')+'></div>'
      +'<label class="field-label" for="inspectxUrl">InspectX base URL</label><input type="url" id="inspectxUrl" value="'+(s.inspectxBaseUrl||'')+'" placeholder="https://app.inspectx.example/i/">'
      +(ro?'':'<button class="btn secondary block" style="margin-top:10px;" data-action="save-integration">Save</button>')+'</div>';
  }
  html += '<div class="section-title">Your data</div><div class="card"><div class="site-card-sub">Download everything '+o.name+' can see in SiteGuard — company details, team, sites and files, document records and the audit trail — as one file you can keep or move elsewhere. Uploaded documents are listed, not included; download those from each file.</div>'
    +'<a class="btn secondary small" style="margin-top:10px;" href="/api/org/export" download>Download our data</a>'
    +'<div class="site-card-sub" style="margin-top:8px;"><a href="/privacy" target="_blank" rel="noopener">Privacy notice</a> · <a href="/terms" target="_blank" rel="noopener">Terms of use</a></div></div>';
  html += '<div class="section-title">AI drafting</div><div class="card"><div class="site-card-sub">'
    +(S.boot.features.ai ? 'AI drafting and expiry-date detection are on. Requests go through SiteGuard\'s server — no API key is ever stored in your browser.'
      : S.boot.features.aiConfigured ? 'AI drafting is included in '+(isContractor()?'Contractor Pro':'Site Professional')+'. Upgrade under Plan &amp; billing to turn it on.'
      : 'No AI key is configured, so drafting and the assistant use SiteGuard\'s built-in templates and rules. Add ANTHROPIC_API_KEY on the server to switch on AI.')+'</div></div>';
  return html;
}

const BRAND_SWATCHES = [['#16325C','Navy'],['#3F6E55','Sage'],['#0F6B6B','Teal'],['#B8430F','Safety orange'],['#A51C24','Red'],['#5B2A86','Purple'],['#1C1C1C','Black']];
function brandingCard(ro){
  const b = org().branding || {};
  const color = b.brandColor || '#16325C';
  return '<div class="section-title">Document branding</div><div class="card">'
    +'<div class="site-card-sub">Applied to every document created in Document Studio: your logo on the cover and every page header, your colour on headings and tables, and your document numbers.</div>'
    +'<label class="field-label">Logo</label><div class="logo-preview">'+(b.logoFileId ? '<img src="/api/files/'+b.logoFileId+'" alt="Company logo">' : '<span class="site-card-sub">No logo yet — documents show your company name instead.</span>')+'</div>'
    +(ro?'':'<div class="row-actions"><label class="btn secondary small" for="logoInput" style="cursor:pointer;">'+(b.logoFileId?'Replace logo':'Upload logo')+'</label><input type="file" id="logoInput" accept="image/png,image/jpeg" class="sr-only" data-action-change="upload-logo">'
      +(b.logoFileId?'<button class="btn danger small" data-action="remove-logo">Remove</button>':'')+'</div><div class="site-card-sub" style="margin-top:6px;">PNG or JPG, under 2 MB. A wide logo on a transparent background looks best.</div>')
    +'<label class="field-label">Brand colour</label><div class="swatch-row">'+BRAND_SWATCHES.map(([c,n])=>'<button class="swatch'+(c.toLowerCase()===color.toLowerCase()?' active':'')+'" style="background:'+c+';" data-action="pick-swatch" data-color="'+c+'" aria-label="'+n+'" title="'+n+'"'+(ro?' disabled':'')+'></button>').join('')
    +'<input type="color" id="brandColor" value="'+color+'" aria-label="Custom colour" style="width:40px;height:32px;padding:0;border:none;background:none;"'+(ro?' disabled':'')+'></div>'
    +'<label class="field-label" for="docPrefix">Document number prefix</label><input type="text" id="docPrefix" value="'+(b.docPrefix||'')+'" maxlength="12" style="text-transform:uppercase;" placeholder="e.g. ABC"'+(ro?' disabled':'')+'>'
    +'<div class="site-card-sub" style="margin-top:4px;">Documents are numbered like '+(b.docPrefix||'ABC')+'-RA-001, '+(b.docPrefix||'ABC')+'-SHEP-001.</div>'
    +(ro?'':'<button class="btn primary block" style="margin-top:12px;" data-action="save-branding">Save branding</button>')+'</div>';
}
on('pick-swatch', (el)=>{ document.getElementById('brandColor').value = el.dataset.color; document.querySelectorAll('.swatch').forEach(s=>s.classList.toggle('active', s===el)); });
on('save-branding', (el)=>act(()=>api.patch('/api/org/branding', { brandColor: document.getElementById('brandColor').value, docPrefix: document.getElementById('docPrefix').value.trim() }), 'Branding saved', el));
on('upload-logo', async (el)=>{
  const f = el.files && el.files[0]; if(!f) return;
  await act(()=>api.upload('/api/org/logo', f), 'Logo uploaded');
});
on('remove-logo', (el)=>act(()=>api.del('/api/org/logo'), 'Logo removed', el));

/* ============ EXPORTS ============ */
export function exportSafetyFile(siteId){
  const site = S.state.sites[siteId];
  const contractor = contractorOf(site);
  const {items, total, counts, percent} = computeReadiness(siteId);
  const approval = S.state.approvals[siteId];
  let html = '<h1>'+site.name+'</h1>'
    +'<div class="p-sub">'+site.location+' · Host: '+site.hostName+' · Contractor: '+contractor.name+(contractor.reg||contractor.coid?' ('+[contractor.reg?'Reg '+contractor.reg:'', contractor.coid?'COID '+contractor.coid:''].filter(Boolean).join(', ')+')':'')+'</div>'
    +'<div class="p-sub">Exported '+new Date().toLocaleString('en-ZA')+' by '+myName()+', '+S.boot.me.roleLabel+'</div>';
  html += approval ? '<div class="p-section">Approval</div><div class="p-sub">Approved by '+approval.approver+' ('+approval.role+', '+approval.org+') on '+approval.date+' · Version '+approval.version+' · Verification ID '+approval.verificationId+' · verify at '+location.origin+'/verify/'+approval.verificationId+'</div>'
    : '<div class="p-section">Status</div><div class="p-sub">Not yet approved — Site Readiness '+percent+'% ('+(counts.complete||0)+' of '+total+' requirements complete)</div>';
  html += '<div class="p-section">Requirements register</div><table><tr><th>Category</th><th>Requirement</th><th>Source</th><th>Status</th><th>Version</th><th>Expiry</th><th>Updated</th></tr>';
  items.forEach(it=>{ html += '<tr><td>'+it.req.category+'</td><td>'+it.req.name+'</td><td>'+SOURCE_LABEL[it.req.source]+'</td><td>'+STATUS_LABEL[it.status]+'</td><td>'+(it.doc.version||'—')+'</td><td>'+(it.doc.expiryDate||'—')+'</td><td>'+(it.doc.updatedAt||'—')+'</td></tr>'; });
  html += '</table>';
  const workers = ((S.state.siteWorkers||{})[siteId]||[]).map(id=>S.state.workers[id]).filter(Boolean);
  if(workers.length){
    html += '<div class="p-section">Workforce</div><table><tr><th>Worker</th><th>Occupation</th><th>Certificates</th></tr>';
    workers.forEach(w=>{ html += '<tr><td>'+w.name+'</td><td>'+(w.occupation||'—')+'</td><td>'+(w.certificates.map(c=>c.name+(c.expiresOn?' (to '+c.expiresOn+')':'')).join('; ')||'None recorded')+'</td></tr>'; });
    html += '</table>';
  }
  const inc = S.state.incidents[siteId]||[];
  if(inc.length){
    html += '<div class="p-section">Incident register</div><table><tr><th>Date</th><th>Type</th><th>Status</th><th>Description</th><th>Root cause</th><th>Corrective actions</th></tr>';
    inc.forEach(i=>{ html += '<tr><td>'+i.date+'</td><td>'+incidentTypeInfo(i.type).label+'</td><td>'+i.status+'</td><td>'+i.description+'</td><td>'+(i.rootCause||'—')+'</td><td>'+(i.correctiveActions||'—')+'</td></tr>'; });
    html += '</table>';
  }
  const permits = S.state.permits[siteId]||[];
  if(permits.length){
    html += '<div class="p-section">Permit to work register</div><table><tr><th>Type</th><th>Location</th><th>Status</th><th>Issued to</th><th>Valid from</th><th>Valid to</th></tr>';
    permits.forEach(p=>{ html += '<tr><td>'+permitTypeInfo(p.type).label+'</td><td>'+p.location+'</td><td>'+permitEffectiveStatus(p)+'</td><td>'+(p.issuedTo||'—')+'</td><td>'+dateTime(p.validFrom)+'</td><td>'+dateTime(p.validTo)+'</td></tr>'; });
    html += '</table>';
  }
  const talks = (S.state.toolboxTalks||{})[siteId]||[];
  if(talks.length){
    html += '<div class="p-section">Toolbox talks</div><table><tr><th>Date</th><th>Topic</th><th>Presenter</th><th>Attendees (signed)</th></tr>';
    talks.forEach(t=>{ html += '<tr><td>'+t.heldOn+'</td><td>'+t.topic+'</td><td>'+t.presenter+'</td><td>'+(t.attendance.map(a=>a.name).join(', ')||'—')+'</td></tr>'; });
    html += '</table>';
  }
  const siteAudit = S.state.audit.filter(a=>a.siteId===siteId);
  if(siteAudit.length){
    html += '<div class="p-section">Audit history (latest)</div><table><tr><th>Date</th><th>Actor</th><th>Action</th><th>Detail</th></tr>';
    siteAudit.forEach(a=>{ html += '<tr><td>'+dateTime(a.ts)+'</td><td>'+a.actor+' ('+a.role+')</td><td>'+a.action+'</td><td>'+a.detail+'</td></tr>'; });
    html += '</table>';
  }
  html += '<div class="p-foot">Generated by SiteGuard. This export reflects the digital record at the time of export; the platform record is the source of truth. This document does not itself constitute a guarantee of legal compliance.</div>';
  printHtml(html);
}

/* ============ view-level actions ============ */
on('nav', (el)=>{ S.nav = el.dataset.nav; if(S.nav==='sites'){ S.activeSiteId=null; S.activeWorkplaceId=null; } if(S.nav==='more') S.moreView=null; S.docSelectMode=false; render(); window.scrollTo(0,0); });
on('open-site', (el)=>{ S.activeSiteId = el.dataset.site; S.nav='sites'; S.siteTab='compliance'; render(); window.scrollTo(0,0); });
on('back-sites', ()=>{
  // A contractor's file on a shared site goes back to that site's page on the mine side.
  const s = S.state.sites[S.activeSiteId];
  S.activeWorkplaceId = isHost() && s && s.workplaceId && (S.state.workplaces||{})[s.workplaceId] ? s.workplaceId : null;
  S.activeSiteId=null; render(); window.scrollTo(0,0);
});
on('focus-site', (el, e)=>{ e.stopPropagation(); S.focusSiteId = el.dataset.site; render(); });
on('site-tab', (el)=>{ S.siteTab = el.dataset.tab; render(); });
on('goto-more', (el)=>{ S.nav='more'; S.moreView = el.dataset.view || null; if(S.moreView==='team') invalidateTeam(); if(S.moreView==='billing') invalidateBilling(); if(S.moreView==='platform') invalidatePlatform(); render(); window.scrollTo(0,0); });
on('doc-centre-filter', (el)=>{ S.docCentreFilter = el.dataset.filter; render(); });
on('doc-centre-jump', (el)=>{ S.docCentreFilter = el.dataset.filter; S.hostPeopleTab = 'documents'; S.nav='passport'; render(); });
on('safety-filter', (el)=>{ S.safetyFilter = el.dataset.filter; render(); });
on('toggle-select', ()=>{ S.docSelectMode = !S.docSelectMode; S.selectedDocs = []; render(); });
on('doc-check', (el)=>{
  const id = el.dataset.req;
  if(el.checked){ if(!S.selectedDocs.includes(id)) S.selectedDocs.push(id); } else S.selectedDocs = S.selectedDocs.filter(x=>x!==id);
  render();
});
on('export-selected', async (el)=>{
  if(!S.selectedDocs.length){ showToast('Tick the documents to include first'); return; }
  if(el.disabled) return;
  const label = el.textContent; el.disabled = true; el.textContent = 'Merging…';
  try{ await api.download('/api/documents/pack', { slots: S.selectedDocs }, 'Document-pack.pdf'); showToast('Document pack downloaded — '+S.selectedDocs.length+' document'+(S.selectedDocs.length===1?'':'s')+' in one PDF'); }
  catch(e){ showToast(e.message); }
  finally{ el.disabled = false; el.textContent = label; }
});
on('withdraw-selected', async ()=>{
  if(!S.selectedDocs.length) return;
  if(!confirm('Withdraw '+S.selectedDocs.length+' document(s)? They go back to "missing" (earlier versions stay in the history).')) return;
  const ids = S.selectedDocs.slice();
  await act(async ()=>{ for(const id of ids) await api.del('/api/documents/'+encodeURIComponent(id)); }, 'Withdrawn');
  S.selectedDocs = []; S.docSelectMode = false; render();
});
on('export-site', (el)=>{
  const id = el.dataset.site;
  openSheet(sheetHead('Export', S.state.sites[id].name)
    +'<button class="qa-item" data-action="export-bundle" data-site="'+id+'"><div class="qa-icon">'+ICONS.passport+'</div><div style="flex:1;"><div class="qa-title">Complete safety file (PDF)</div><div class="qa-sub">Cover, contents, site registers, then every submitted document, appointment and worker certificate in one file</div></div>'+ICONS.chevron+'</button>'
    +'<button class="qa-item" data-action="export-register" data-site="'+id+'"><div class="qa-icon">'+ICONS.audit+'</div><div style="flex:1;"><div class="qa-title">One-page status report (print)</div><div class="qa-sub">Requirement statuses, registers and recent audit history, to print or save as PDF</div></div>'+ICONS.chevron+'</button>');
});
on('export-register', (el)=>{ closeSheet(); exportSafetyFile(el.dataset.site); });
/** Before compiling: what's in the file, what isn't, and what will be flagged in it (spec: never disguise an incomplete file). */
on('export-bundle', (el)=>{
  const siteId = el.dataset.site, site = S.state.sites[siteId];
  const { items, total, counts } = computeReadiness(siteId);
  const list = (st)=>items.filter(i=>i.counted && i.status===st).map(i=>i.req.name);
  const missing = list('missing'), expired = list('expired'), back = list('correction_required');
  const optionalOut = items.filter(i=>!i.counted).map(i=>i.req.name);
  // Documents with a file in them can be left out of this PDF; the rest are listed as gaps either way.
  const filed = items.filter(i=>['complete','expiring','awaiting_review'].includes(i.status));
  const appts = (S.state.appointments||[]).filter(a=>a.siteId===siteId).length;
  const certs = ((S.state.siteWorkers||{})[siteId]||[]).reduce((n, id)=>n + (((S.state.workers[id]||{}).certificates)||[]).length, 0);
  const workers = ((S.state.siteWorkers||{})[siteId]||[]).map(id=>S.state.workers[id]).filter(Boolean);
  const noMedical = workers.filter(w=>!w.certificates.some(c=>c.kind==='medical_fitness' && certStatus(c)!=='expired'));
  const inFile = (counts.complete||0)+(counts.expiring||0)+(counts.awaiting_review||0);
  const row = (n, label, cls)=>'<div class="sfr-stat '+cls+'"><b>'+n+'</b><span>'+label+'</span></div>';
  const names = (arr)=>arr.length ? '<ul class="plain-list">'+arr.slice(0,8).map(n=>'<li>'+n+'</li>').join('')+(arr.length>8?'<li>and '+(arr.length-8)+' more</li>':'')+'</ul>' : '';
  const gaps = missing.length + expired.length + back.length;
  openSheet(sheetHead('Safety file check', site.name)
    +'<div class="sfr-grid">'+row(total,'Required','')+row(inFile,'In the file','ok')+row(missing.length,'Missing',missing.length?'bad':'')+row(expired.length+back.length,'Expired or sent back',expired.length+back.length?'bad':'')+'</div>'
    +(counts.awaiting_review && !site.project ? '<div class="notice">'+counts.awaiting_review+' document'+(counts.awaiting_review===1?' is':'s are')+' included but still waiting for the site\'s review.</div>' : '')
    +(counts.expiring ? '<div class="notice">'+counts.expiring+' document'+(counts.expiring===1?' expires':'s expire')+' within 30 days.</div>' : '')
    +(missing.length ? '<div class="section-title">Missing</div>'+names(missing) : '')
    +(expired.length+back.length ? '<div class="section-title">Expired or sent back</div>'+names(expired.concat(back)) : '')
    +(noMedical.length ? '<div class="section-title">Workers without a valid medical</div>'+names(noMedical.map(w=>w.name)) : '')
    +(optionalOut.length ? '<div class="section-title">Optional, not in the file</div>'+names(optionalOut) : '')
    +(gaps ? '<div class="notice alert-red" style="margin-top:12px;">The PDF lists every gap on its contents page, so the reader sees exactly what\'s outstanding. It is not presented as complete.</div>'
      : '<div class="notice alert-green" style="margin-top:12px;">Everything required is in the file.</div>')
    +(filed.length ? '<details class="sfr-pick"'+(isHost()?' open':'')+'><summary>Choose documents — or download them one by one</summary>'
      +'<div class="site-card-sub" style="margin:6px 0;">Untick anything you don\'t want in this copy. A copy with documents left out says so on its cover and doesn\'t count as a new revision.</div>'
      +'<div class="sfr-list sfr-docs">'+filed.map(i=>{ const d = S.state.documents[i.req.id]||{}; return '<label class="toggle-row"><span>'+i.req.name+'<span class="site-card-sub" style="display:block;">'+i.req.category+(d.assetUrl?' · <a href="'+d.assetUrl+'" target="_blank" rel="noopener">Open on its own</a>':'')+'</span></span><input type="checkbox" class="sfr-doc" value="'+i.req.id+'" checked></label>'; }).join('')
      +(appts?'<label class="toggle-row"><span>Appointment letters ('+appts+')</span><input type="checkbox" id="sfrAppts" checked></label>':'')
      +(certs?'<label class="toggle-row"><span>Workforce certificates ('+certs+')</span><input type="checkbox" id="sfrCerts" checked></label>':'')
      +'</div></details>' : '')
    +(site.project && isOrgAdmin() && !readOnly() ? arrangeHtml(siteId) : '')
    +'<div class="row-actions" style="margin-top:12px;"><button class="btn primary" style="flex:1;" data-action="safety-file-download" data-site="'+siteId+'">'+(gaps?'Download with the gaps listed':'Download the safety file')+'</button>'
    +'<button class="btn secondary" data-action="safety-file-download" data-preview="1" data-site="'+siteId+'">Preview</button></div>'
    +(!readOnly() && (isContractor() ? isOrgAdmin() : canReview()) ? '<button class="btn secondary block" style="margin-top:8px;" data-action="'+(site.project?'project-send':'new-share-link')+'" data-site="'+siteId+'">'+(site.project?'Send to '+site.hostName:'Share with someone outside SiteGuard')+'</button>' : '')
    +(gaps && isContractor() ? '<button class="btn secondary block" style="margin-top:8px;" data-action="guide-open" data-site="'+siteId+'">Fill the gaps first</button>' : ''));
});
/** Your own project file: the order documents appear in the PDF. */
function arrangeHtml(siteId){
  const reqs = S.state.requirements[siteId]||[];
  if(reqs.length < 2) return '';
  return '<details class="sfr-pick"'+(S.arrangeOpen?' open':'')+'><summary>Arrange the order</summary><div class="sfr-list">'
    + reqs.map((r,i)=>'<div class="toggle-row"><span>'+(i+1)+'. '+r.name+'<span class="site-card-sub" style="display:block;">'+r.category+'</span></span><span class="row-actions">'
      +'<button class="btn secondary small icon" data-action="arrange-move" data-site="'+siteId+'" data-i="'+i+'" data-d="-1" aria-label="Move '+r.name+' up"'+(i===0?' disabled':'')+'>'+ICONS.up+'</button>'
      +'<button class="btn secondary small icon" data-action="arrange-move" data-site="'+siteId+'" data-i="'+i+'" data-d="1" aria-label="Move '+r.name+' down"'+(i===reqs.length-1?' disabled':'')+'>'+ICONS.down+'</button></span></div>').join('')
    + '</div></details>';
}
on('arrange-move', async (el)=>{
  const siteId = el.dataset.site, i = Number(el.dataset.i), j = i + Number(el.dataset.d);
  const ids = (S.state.requirements[siteId]||[]).map(r=>r.id);
  if(j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  const ok = await act(()=>api.post('/api/projects/'+encodeURIComponent(siteId)+'/requirements/order', { ids }), null, el);
  if(ok){ S.arrangeOpen = true; actions['export-bundle']({ dataset: { site: siteId } }); S.arrangeOpen = false; }
});
on('safety-file-download', (el)=>{
  const all = [...document.querySelectorAll('.sfr-doc')];
  const picked = all.filter(x=>x.checked).map(x=>x.value);
  const a = document.getElementById('sfrAppts'), c = document.getElementById('sfrCerts');
  const q = new URLSearchParams();
  if(picked.length < all.length) q.set('only', picked.join(','));
  if(a && !a.checked) q.set('appointments', '0');
  if(c && !c.checked) q.set('certificates', '0');
  if(all.length && !picked.length && !q.has('appointments') && !q.has('certificates') && !confirm('No documents are ticked, so the PDF will list the file\'s contents only. Continue?')) return;
  if(el.dataset.preview){
    q.set('preview', '1');
    window.open('/api/sites/'+encodeURIComponent(el.dataset.site)+'/safety-file.pdf?'+q.toString(), '_blank', 'noopener');
    return;
  }
  closeSheet();
  showToast('Preparing the safety file — the download starts in a moment');
  window.location.href = '/api/sites/'+encodeURIComponent(el.dataset.site)+'/safety-file.pdf'+(q.toString() ? '?'+q.toString() : '');
});
on('approve-site', (el)=>act(()=>api.post('/api/sites/'+el.dataset.site+'/approve'), 'Site marked Site Ready', el));
on('invitation-decide', async (el)=>{
  const ok = await act(()=>api.post('/api/invitations/'+el.dataset.id+'/'+el.dataset.decision), el.dataset.decision==='accept'?'Invitation accepted — requirements are now open':'Invitation declined', el);
  if(ok && el.dataset.decision==='decline'){ S.activeSiteId=null; render(); }
});
on('resend-invitation', (el)=>act(()=>api.post('/api/sites/'+el.dataset.site+'/resend-invitation'), 'Invitation re-sent', el));
on('defect', (el)=>act(()=>api.post('/api/defects/'+el.dataset.id+'/'+el.dataset.op), el.dataset.op==='resolve'?'Marked resolved — awaiting verification':'Closed out', el));
on('revoke-link', (el)=>{ if(confirm('Revoke this link? Anyone holding it loses access immediately.')) act(()=>api.post('/api/share-links/'+el.dataset.id+'/revoke'), 'Link revoked', el); });
on('verify-code', ()=>{ const code = document.getElementById('verifyCode').value.trim(); if(code) window.open('/verify/'+encodeURIComponent(code), '_blank', 'noopener'); });
on('audit-filter', async ()=>{
  S.auditFilter = { from: document.getElementById('auditFrom').value, to: document.getElementById('auditTo').value, siteId: document.getElementById('auditSite').value };
  if(!S.auditFilter.from && !S.auditFilter.to && !S.auditFilter.siteId){ S.auditRows = null; render(); return; }
  try{
    const q = new URLSearchParams(Object.entries(S.auditFilter).filter(([,v])=>v));
    const r = await api.get('/api/audit?'+q);
    S.auditRows = deepEscape(r.events);
    render();
  }catch(e){ showToast(e.message); }
});
on('audit-export', async ()=>{
  try{
    const f = S.auditFilter;
    const q = new URLSearchParams(Object.entries(f).filter(([,v])=>v)); q.set('limit','5000');
    const rows = deepEscape((await api.get('/api/audit?'+q)).events);
    const rangeLabel = (f.from||f.to) ? (f.from||'earliest')+' to '+(f.to||'now') : 'complete history';
    const siteLabel = f.siteId && S.state.sites[f.siteId] ? S.state.sites[f.siteId].name : 'all sites';
    printHtml('<h1>SiteGuard Audit Trail</h1><div class="p-sub">'+org().name+' · '+siteLabel+' · '+rangeLabel+'</div>'
      +'<div class="p-sub">Exported '+new Date().toLocaleString('en-ZA')+' by '+myName()+', '+S.boot.me.roleLabel+'</div>'
      +'<table><tr><th>Date</th><th>Actor</th><th>Role</th><th>Action</th><th>Detail</th></tr>'
      + rows.map(a=>'<tr><td>'+dateTime(a.ts)+'</td><td>'+a.actor+'</td><td>'+a.role+'</td><td>'+a.action+'</td><td>'+a.detail+'</td></tr>').join('')
      +'</table><div class="p-foot">Generated by SiteGuard — this export reflects the audit record at the time of export; the platform record remains the source of truth.</div>');
  }catch(e){ showToast(e.message); }
});
on('invite-user', async (el)=>{
  const email = document.getElementById('inviteEmail').value.trim();
  if(!email){ document.getElementById('inviteEmail').focus(); return; }
  const ok = await act(()=>api.post('/api/org/invites', { email, role: document.getElementById('inviteRole').value }), 'Invitation sent to '+email, el);
  if(ok){ invalidateTeam(); render(); }
});
on('member-role', async (el)=>{ const ok = await act(()=>api.patch('/api/org/members/'+el.dataset.id, { role: el.value }), 'Role updated'); invalidateTeam(); render(); return ok; });
on('remove-member', async (el)=>{
  const self = el.dataset.id===S.boot.me.id;
  if(!confirm(self ? 'Leave '+unescapeHtml(org().name)+'? You\'ll lose access to its data.' : 'Remove this person from the organisation? They lose access immediately.')) return;
  const ok = await act(()=>api.del('/api/org/members/'+el.dataset.id), self?'You left the organisation':'Removed', el);
  invalidateTeam(); if(ok) render();
});
on('revoke-invite', async (el)=>{ await act(()=>api.del('/api/org/invites/'+el.dataset.id), 'Invitation revoked', el); invalidateTeam(); render(); });
on('billing-portal', async (el)=>{ try{ el.disabled = true; const r = await api.post('/api/billing/portal'); location.href = r.url; }catch(e){ showToast(e.message); el.disabled = false; } });
on('billing-choose', async (el)=>{
  const seats = parseInt(document.getElementById('billSeats').value, 10) || 1;
  el.disabled = true;
  try{
    if(billingCache && billingCache.hasSubscription){
      await api.post('/api/billing/change', { plan: el.dataset.plan, seats });
      invalidateBilling(); await act(async()=>{}, 'Subscription updated');
    } else {
      const r = await api.post('/api/billing/checkout', { plan: el.dataset.plan, seats });
      location.href = r.url;
    }
  }catch(e){ showToast(e.message); el.disabled = false; }
});
on('save-org', (el)=>{
  const g = id => document.getElementById(id) ? document.getElementById(id).value.trim() : undefined;
  const body = { name:g('orgName'), reg_number:g('orgReg'), coid_number:g('orgCoid'), vat_number:g('orgVat'), address:g('orgAddress') };
  if(isContractor()) body.trade = g('orgTrade');
  return act(()=>api.patch('/api/org', body), 'Company details saved', el);
});
on('toggle-digest', (el)=>act(()=>api.patch('/api/org/settings', { reminderDigest: el.checked }), el.checked?'Reminder digests on':'Reminder digests off'));
on('billing-redeem', async (el)=>{
  const code = (document.getElementById('promoCode')||{}).value||'';
  if(!code.trim()){ showToast('Type the code first'); return; }
  const ok = await act(()=>api.post('/api/billing/redeem', { code: code.trim() }), 'Code applied', el);
  if(ok){ invalidateBilling(); render(); }
});
on('platform-refresh', ()=>{ invalidatePlatform(); render(); });
on('save-reminder-days', (el)=>{
  const days = [...document.querySelectorAll('#reminderDays input:checked')].map(x=>Number(x.value));
  if(!days.length){ showToast('Tick at least one reminder'); return; }
  return act(()=>api.patch('/api/org/settings', { reminderDays: days }), 'Reminder days saved', el);
});
on('toggle-weekly', (el)=>act(()=>api.patch('/api/org/settings', { weeklySummary: el.checked }), el.checked?'Weekly summary on':'Weekly summary off'));
on('save-integration', (el)=>act(()=>api.patch('/api/org/settings', { inspectxEnabled: document.getElementById('inspectxToggle').checked, inspectxBaseUrl: document.getElementById('inspectxUrl').value.trim() }), 'Settings saved', el));
on('resend-verification', (el)=>act(()=>api.post('/api/auth/resend-verification'), 'Confirmation email sent', el));
on('leave-demo', async ()=>{
  try{ await api.post('/api/auth/logout'); }catch{ /* ignore */ }
  S.authView = 'signup'; S.nav='dashboard'; S.activeSiteId=null; S.moreView=null;
  await reload();
});

on('agent-go', (el)=>{
  const f = ((S.boot.agent||{}).findings||[])[Number(el.dataset.i)];
  if(!f) return;
  const a = f.action || {};
  if(a.kind==='site' && a.siteId && S.state.sites[a.siteId]){
    S.nav='sites'; S.activeSiteId=a.siteId; S.siteTab = a.tab==='safety' ? 'activity' : 'compliance';
  } else if(a.kind==='workforce'){ S.nav='more'; S.moreView='workforce'; }
  else if(a.kind==='library'){ S.nav='passport'; }
  else if(a.kind==='safety'){ S.nav='more'; S.moreView='safety'; }
  else if(a.kind==='studio'){ S.nav='more'; S.moreView='studio'; }
  else { showToast('That item is no longer available'); return; }
  render(); window.scrollTo(0,0);
});
on('agent-run', async (el)=>{
  el.disabled = true; el.textContent = 'Checking…';
  try{
    const r = await api.post('/api/agent/run');
    await reload();
    showToast(r.findings.length ? r.findings.length+' item'+(r.findings.length===1?'':'s')+' need attention' : 'All clear');
  }catch(e){ showToast(e.message); el.disabled = false; el.textContent = 'Check now'; }
});
