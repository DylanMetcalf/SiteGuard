// Main screens. Rendering is ported from the original MVP; data now comes
// from the server and every button is a data-action handled in app.js.

import { api } from './api.js';
import {
  S, ICONS, SOURCE_LABEL, STATUS_LABEL, CERT_KINDS, LIBRARY_TYPES,
  org, role, isContractor, isHost, isOrgAdmin, canReview, canEdit, readOnly, myName, myContractorId, isDemoMode,
  computeReadiness, siteSubmissionStatus, statusLabelForSubmission, gauge, gaugeColor, badge, timeAgo, dateTime, initials,
  openSafetyIssues, orgOpenSafetyIssuesCount, incidentTypeInfo, permitTypeInfo, permitEffectiveStatus, effectiveStatus, certStatus,
  libraryReqId, contractorOf, daysUntil, on, act, render, reload, showToast, escapeHtml, unescapeHtml, deepEscape, printHtml, findReq,
} from './core.js';
import { computeTasks } from './sheets.js';

/* ============ SHELL ============ */
export function topbar(){
  const highCount = computeTasks().filter(t=>t.priority==='high').length;
  const personas = S.boot.personas;
  return '<div class="topbar"><div class="brand-row">'
    +'<div class="brand"><div class="brand-mark"></div><div class="brand-text"><div class="brand-name">SiteGuard'+(isDemoMode()?' <span class="demo-tag">DEMO</span>':'')+'</div>'
    +'<div class="brand-tag"><span class="live-dot'+(S.live?'':' off')+'" title="'+(S.live?'Live — changes from colleagues appear automatically':'Reconnecting…')+'"></span>'+org().name+'</div></div></div>'
    +'<div class="identity">'
    +'<button class="identity-avatar" data-action="open-search" aria-label="Search" style="background:var(--paper-raised); color:var(--ink);">'+ICONS.search+'</button>'
    +'<button class="identity-avatar" data-action="open-tasks" data-filter="all" aria-label="Tasks" style="background:var(--paper-raised); color:var(--ink); position:relative;">'+ICONS.bell+(highCount?'<span class="bell-dot"></span>':'')+'</button>'
    +(personas && personas.length ? '<select class="persona-select" id="personaSel" aria-label="Demo persona" title="Demo persona — switches to another sample user (their real permissions apply)">'
        + personas.map(p=>'<option value="'+p.userId+'"'+(p.current?' selected':'')+' title="'+p.label+'">'+p.name+' ('+p.label.split(' · ')[1]+')</option>').join('')+'</select>' : '')
    +'<button class="identity-avatar" data-action="open-profile" aria-label="Profile">'+initials(myName())+'</button></div>'
    +'</div>'+banners()+'</div>';
}

function banners(){
  const o = org(), f = S.boot.features;
  let html = '';
  if(o.isDemo) html += '<div class="banner warn"><span>Demo sandbox — sample data, deleted automatically after a few days. The persona menu switches between sample users.</span><button class="btn small secondary" data-action="leave-demo">Create a real account</button></div>';
  if(!S.boot.me.verified) html += '<div class="banner info"><span>Confirm your email address — we sent a link to '+S.boot.me.email+'.</span><button class="btn small secondary" data-action="resend-verification">Resend</button></div>';
  if(f.billing && !o.isDemo){
    if(o.standing==='lapsed') html += '<div class="banner bad"><span>Read-only: '+(o.subscriptionStatus==='trialing'?'your trial has ended':'your subscription is inactive')+'. Everything stays viewable; choose a plan to keep making changes.</span>'+(isOrgAdmin()?'<button class="btn small secondary" data-action="goto-more" data-view="billing">Billing</button>':'')+'</div>';
    else if(o.standing==='grace') html += '<div class="banner warn"><span>We couldn\'t take your last payment. Update your card to avoid interruption.</span>'+(isOrgAdmin()?'<button class="btn small secondary" data-action="billing-portal">Update card</button>':'')+'</div>';
    else if(o.subscriptionStatus==='trialing' && o.trialEndsAt){
      const days = Math.max(0, Math.ceil((new Date(o.trialEndsAt) - Date.now())/86400000));
      html += '<div class="banner info"><span>Trial: '+days+' day'+(days===1?'':'s')+' left on '+o.planName+'.</span>'+(isOrgAdmin()?'<button class="btn small secondary" data-action="goto-more" data-view="billing">Choose a plan</button>':'')+'</div>';
    }
  }
  return html;
}

export function bottomNav(){
  const tabs = [['dashboard','Dashboard',ICONS.dashboard],['sites','Sites',ICONS.sites],null,['passport', isContractor()?'Documents':'Contractors', ICONS.passport],['more','More',ICONS.more]];
  return '<nav class="bottomnav"><div class="bottomnav-row">'
    + tabs.map(t=> t ? '<button data-action="nav" data-nav="'+t[0]+'" class="'+(S.nav===t[0]?'active':'')+'"'+(S.nav===t[0]?' aria-current="page"':'')+'>'+t[2]+'<span>'+t[1]+'</span></button>'
      : '<button class="fab" data-action="open-fab" aria-label="Quick actions">'+ICONS.plus+'</button>').join('')
    +'</div></nav>';
}

export function renderView(){
  if(S.nav==='dashboard') return renderDashboard();
  if(S.nav==='sites') return S.activeSiteId && S.state.sites[S.activeSiteId] ? renderSiteDetail(S.activeSiteId) : renderSitesList();
  if(S.nav==='passport') return isContractor() ? renderPassport() : renderContractorsList();
  if(S.nav==='more') return renderMore();
  return '';
}

/* ============ DASHBOARD ============ */
function greeting(){
  const h = new Date().getHours();
  const part = h<12?'Morning':h<17?'Afternoon':'Evening';
  return part+', '+myName().split(' ')[0];
}

export const DASHBOARD_WIDGETS = {
  contractor: [['invitations','Invitations'],['focus','Site you\'re working on'],['allSites','All your sites'],['workforce','Worker certificates'],['company','Company profile']],
  host: [['safety','Safety alert'],['organisation','Organisation overview'],['attention','Needs attention'],['portfolio','Site portfolio'],['invitations','Pending invitations'],['workforce','Worker certificates']],
};
const DEFAULT_WIDGETS = {
  contractor: ['invitations','focus','allSites','workforce','company'],
  admin: ['safety','organisation','portfolio','invitations','workforce'],
  reviewer: ['safety','attention','portfolio','workforce'],
  viewer: ['safety','attention','portfolio'],
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

/** First-run checklist for site owners; disappears once the core loop has happened once. */
function gettingStarted(){
  if(!isHost() || !isOrgAdmin() || isDemoMode()) return '';
  const sites = Object.values(S.state.sites);
  const steps = [
    { done: sites.length>0, title:'Add your first site', sub:'Pick a starter pack of required documents and invite the contractor by email.', action:'new-site' },
    { done: sites.some(s=>(S.state.requirements[s.id]||[]).length), title:'Set the documents the site needs', sub:'Start from a pack, then add or remove anything specific to the site.' },
    { done: sites.some(s=>s.status==='in_progress'||s.status==='site_ready'), title:'Contractor accepts', sub:'They get an email link. Once they accept, you\'ll see their documents arrive here live.' },
    { done: sites.some(s=>(S.state.requirements[s.id]||[]).some(r=>{ const d = S.state.documents[r.id]; return d && d.version && (d.status==='complete' || d.status==='correction_required'); })), title:'Review the first submission', sub:'Approve it or request a correction — the contractor is notified either way.' },
  ];
  if(steps.every(x=>x.done)) return '';
  const next = steps.findIndex(x=>!x.done);
  return '<div class="section-title">Getting started</div><div class="card checkpoint">'
    + steps.map((x,i)=>'<div class="reqrow"><div class="qa-icon" style="width:28px;height:28px;border-radius:50%;flex:none;'+(x.done?'background:var(--green-bg);color:var(--green);':i===next?'background:var(--orange);color:#fff;':'')+'">'+(x.done?ICONS.check:(i+1))+'</div>'
      +'<div class="reqrow-main"><div class="reqrow-name"'+(x.done?' style="color:var(--grey);text-decoration:line-through;"':'')+'>'+x.title+'</div>'+(i===next?'<div class="site-card-sub">'+x.sub+'</div>':'')+'</div>'
      +(i===next && x.action && !readOnly()?'<button class="btn orange small" data-action="'+x.action+'">Start</button>':'')+'</div>').join('')
    +'</div>';
}

function renderDashboard(){
  const { order, hidden } = dashboardLayout();
  const head = '<div class="view-head"><div class="flexbetween"><h1>'+greeting()+'</h1><button class="btn secondary small" data-action="customise-dashboard">Customise</button></div>'
    +'<p class="greeting">'+(isContractor() ? org().name : org().name+' · '+(role()==='admin'?org().kindLabel:'portfolio overview'))+'</p></div>';
  const ctx = isContractor() ? contractorDashboardContext() : null;
  const parts = order.filter(id=>!hidden.includes(id)).map(id=> (isContractor() ? contractorWidget(id, ctx) : hostWidget(id)) ).filter(Boolean);
  const start = gettingStarted();
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
    if(!mySites.length) return invited.length ? '' : '<div class="empty"><h3>No sites yet</h3><p>Once a site invites '+org().name+', it will show up here. Sites invite you by email — you can accept from the link or right here.</p></div>';
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
      + (sites.length ? sites.map(portfolioRow).join('') : '<div class="empty"><h3>No sites yet</h3><p>'+(isOrgAdmin()?'Add your first site to start tracking contractor compliance.':'Once an admin adds a site, it will show up here.')+'</p>'+(isOrgAdmin()?'<button class="btn orange" data-action="new-site">Add a site</button>':'')+'</div>');
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
  const sub = site.status==='site_ready' ? 'Site Ready · '+who
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
  const sites = Object.values(S.state.sites);
  return '<div class="view-head"><div class="flexbetween"><h1>Sites</h1>'+(isHost() && isOrgAdmin() && !readOnly()?'<button class="btn orange small" data-action="new-site">+ Add site</button>':'')+'</div>'
    +'<p>'+sites.length+' site'+(sites.length===1?'':'s')+'</p></div>'
    + (sites.length ? sites.map(portfolioRow).join('') : '<div class="empty"><h3>No sites yet</h3><p>'+(isContractor()?'Sites appear here when a site owner invites your company.':'Add a site to start tracking contractor compliance.')+'</p></div>');
}

function renderSiteDetail(siteId){
  const site = S.state.sites[siteId];
  const contractor = contractorOf(site);
  const invite = Object.values(S.state.invitations).find(i=>i.siteId===siteId && i.status==='pending');

  if(isContractor() && site.status==='invited'){
    return '<div style="margin-bottom:14px;"><button class="btn secondary small" data-action="back-sites">← Sites</button></div>'
      +'<div class="view-head"><h1>You\'re invited</h1><p>'+site.name+'</p></div>'
      +'<div class="card checkpoint"><div class="site-card-title">'+site.name+'</div>'
      +'<div class="site-card-sub" style="margin-top:6px;">'+site.hostName+' · '+site.location+'</div>'
      +'<div class="site-card-sub" style="margin-top:10px;">'+site.hostName+' has invited '+org().name+' to work this site and submit a safety file. Accepting shows you the requirements and starts tracking readiness; declining removes it from your list.</div>'
      +(isOrgAdmin() && invite ? '<div style="display:flex;gap:8px;margin-top:14px;"><button class="btn orange" style="flex:1;" data-action="invitation-decide" data-id="'+invite.id+'" data-decision="accept">Accept</button>'
        +'<button class="btn secondary" style="flex:1;" data-action="invitation-decide" data-id="'+invite.id+'" data-decision="decline">Decline</button></div>'
        : '<div class="notice" style="margin-top:12px;">An owner or admin of '+org().name+' needs to accept this invitation.</div>')
      +'</div>';
  }

  const canShare = !readOnly() && (isContractor() ? isOrgAdmin() : canReview());
  let html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;justify-content:space-between;flex-wrap:wrap;">'
    +'<button class="btn secondary small" data-action="back-sites">← Sites</button>'
    +'<div style="display:flex;gap:6px;flex-wrap:wrap;">'
    +'<button class="btn danger small icon" data-action="open-emergency" data-site="'+siteId+'" title="Emergency info" aria-label="Emergency info">'+ICONS.emergency+'</button>'
    +(isHost() && isOrgAdmin() && !readOnly() ? '<button class="btn secondary small" data-action="edit-site" data-site="'+siteId+'">Edit</button>' : '')
    +(canShare && site.status!=='declined' ? '<button class="btn secondary small" data-action="new-share-link" data-site="'+siteId+'">Share</button>' : '')
    +'<button class="btn secondary small" data-action="export-site" data-site="'+siteId+'">Export</button></div></div>'
    +'<div class="view-head"><h1>'+site.name+'</h1><p>'+site.location+' · '+(isContractor()?site.hostName:contractor.name)+'</p></div>'
    +'<div class="subtabs" role="tablist">'
      +['compliance','activity','people'].map(t=>'<button role="tab" data-action="site-tab" data-tab="'+t+'" class="'+(S.siteTab===t?'active':'')+'" aria-selected="'+(S.siteTab===t)+'">'+({compliance:'Compliance',activity:'Site activity',people:'People'})[t]+'</button>').join('')
    +'</div>';

  if(S.siteTab==='activity') return html + renderSiteActivity(siteId);
  if(S.siteTab==='people') return html + renderSitePeople(siteId);

  const {items, total, counts, percent} = computeReadiness(siteId);
  const submission = siteSubmissionStatus(siteId);
  const safety = openSafetyIssues(siteId);
  const safetyBlocksApproval = safety.severeIncidents.length>0;
  const canApprove = canReview() && !readOnly() && submission==='ready_to_approve' && site.status==='in_progress' && !safetyBlocksApproval;
  const approval = S.state.approvals[siteId];

  if(site.status==='invited' && isHost()){
    html += '<div class="card checkpoint" style="margin-top:12px;"><div class="flexbetween"><div>'
      +'<div class="site-card-title" style="font-size:14px;">Awaiting contractor response</div>'
      +'<div class="site-card-sub">'+contractor.name+' was invited '+(invite?timeAgo(invite.sentAt):'')+(invite&&invite.email?' ('+invite.email+')':'')+' and hasn\'t accepted yet. Requirements are visible below but the contractor can\'t submit against them until they accept.</div>'
      +'</div><span class="badge blue">Pending</span></div>'
      +(isOrgAdmin() && !readOnly() ? '<div class="row-actions"><button class="btn secondary small" data-action="resend-invitation" data-site="'+siteId+'">Resend invitation</button><button class="btn secondary small" data-action="reassign-site" data-site="'+siteId+'">Assign a different contractor</button></div>' : '')
      +'</div>';
  } else if(site.status==='declined' && isHost()){
    html += '<div class="card checkpoint" style="margin-top:12px;border-color:var(--red);"><div class="site-card-title" style="font-size:14px;">Invitation declined</div>'
      +'<div class="site-card-sub">'+contractor.name+' declined this invitation. Assign a different contractor or follow up directly.</div>'
      +(isOrgAdmin() && !readOnly() ? '<div class="row-actions"><button class="btn orange small" data-action="reassign-site" data-site="'+siteId+'">Assign a contractor</button></div>' : '')+'</div>';
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
    html += '<div class="empty"><h3>No requirements set for this site</h3><p>'+(isContractor()?'The site hasn\'t defined what\'s required yet — check back soon.':'Add the documents this site needs from '+contractor.name+'.')+'</p>'
      +(isHost() && isOrgAdmin() && !readOnly() ? '<div class="row-actions" style="justify-content:center;"><button class="btn orange" data-action="apply-packs" data-site="'+siteId+'">Use a starter pack</button><button class="btn secondary" data-action="add-requirement" data-site="'+siteId+'">Add one by one</button></div>' : '')+'</div>';
  } else {
    html += '<div class="card checkpoint readiness-hero">'+gauge(percent, 78)
      +'<div><div class="site-card-title">Site Readiness</div><div class="site-card-sub">'+(counts.complete||0)+' of '+total+' requirements complete</div>'
      +'<button class="why-link linkish" data-action="open-why" data-site="'+siteId+'">Why '+percent+'%?</button></div></div>';
    if(submission==='changes_required') html += '<div class="notice" style="background:var(--red-bg);color:var(--red);">'+((counts.correction_required||0)+(counts.expired||0))+' item(s) need corrections or renewal before this site can be approved.</div>';
    else if(submission==='under_review') html += '<div class="notice">'+counts.awaiting_review+' item(s) awaiting reviewer sign-off.</div>';
    else if(submission==='ready_to_approve' && safetyBlocksApproval) html += '<div class="notice" style="background:var(--red-bg);color:var(--red);">All requirements complete, but this site can\'t be marked Ready while a lost time injury or fatality investigation is still open.</div>';
    else if(submission==='ready_to_approve' && !canReview()) html += '<div class="notice" style="background:var(--green-bg);color:var(--green);">All requirements complete — waiting on final site approval.</div>';
    if(canApprove) html += '<button class="btn orange block" data-action="approve-site" data-site="'+siteId+'" style="margin-bottom:14px;">Approve — Mark Site Ready</button>';
  }

  const grouped = {};
  items.forEach(it=>{ (grouped[it.req.category] = grouped[it.req.category]||[]).push(it); });
  Object.keys(grouped).forEach(cat=>{
    html += '<div class="section-title">'+cat+'</div><div class="card">';
    grouped[cat].forEach(it=>{
      html += '<div class="reqrow" data-action="open-req" data-req="'+it.req.id+'" role="button" tabindex="0" style="cursor:pointer;"><div class="reqrow-main">'
        +'<div class="reqrow-name">'+it.req.name+'</div>'
        +'<div class="reqrow-meta">'+badge(it.status)+'<span class="srctag">'+SOURCE_LABEL[it.req.source]+'</span>'+(it.doc.expiryDate?'<span class="srctag">expires '+timeAgo(it.doc.expiryDate)+'</span>':'')+'</div>'
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

function renderSiteActivity(siteId){
  const ro = readOnly();
  const permits = S.state.permits[siteId] || [];
  let html = '<div class="section-title">Permit to work register</div>';
  if(!ro && (isContractor() || canReview())) html += '<button class="btn orange block" data-action="new-permit" data-site="'+siteId+'" style="margin-bottom:10px;">'+(isContractor()?'Request a permit':'Issue a permit')+'</button>';
  html += permits.length ? '<div class="card">' + permits.map(p=>renderPermitRow(p, siteId)).join('') + '</div>'
    : '<div class="card"><div class="site-card-sub">No permits raised for this site. High-risk work — hot work, heights, confined space, excavation, lifting, electrical isolation — should have one before it starts.</div></div>';

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
  if(canReview() && !ro) html += '<button class="btn orange block" data-action="new-inspection" data-site="'+siteId+'" style="margin-bottom:14px;">Log inspection</button>';
  if(!list.length) return html + '<div class="empty"><h3>No inspections logged yet</h3><p>Scheduled inspections and spot checks will appear here.</p></div>';
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
  return html;
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
  else if(canReview() && d.status==='resolved' && !readOnly()) actions = '<button class="btn orange small" data-action="defect" data-op="verify" data-id="'+d.id+'">Verify &amp; close</button>';
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

  const talks = (S.state.toolboxTalks||{})[siteId] || [];
  html += '<div class="section-title">Toolbox talks</div>';
  if(canEdit() && !ro) html += '<button class="btn secondary block" data-action="new-toolbox-talk" data-site="'+siteId+'" style="margin-bottom:10px;">+ Record a toolbox talk</button>';
  html += talks.length ? '<div class="card">' + talks.map(t=>'<div class="reqrow" data-action="open-toolbox-talk" data-site="'+siteId+'" data-id="'+t.id+'" role="button" tabindex="0" style="cursor:pointer;"><div class="reqrow-main"><div class="reqrow-name">'+t.topic+'</div>'
      +'<div class="reqrow-meta"><span class="srctag">'+timeAgo(t.heldOn)+' · '+t.presenter+'</span><span class="badge '+(t.attendance.length?'complete':'missing')+'">'+t.attendance.length+' signed</span></div></div><div class="reqrow-chevron">'+ICONS.chevron+'</div></div>').join('')+'</div>'
    : '<div class="card"><div class="site-card-sub">No toolbox talks recorded. Record the talk, then pass the device round so each attendee signs.</div></div>';

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
  if(S.docSelectMode){
    html += '<div class="card checkpoint" style="display:flex;align-items:center;justify-content:space-between;">'
      +'<span class="site-card-sub">'+S.selectedDocs.length+' selected</span>'
      +'<div style="display:flex;gap:6px;"><button class="btn secondary small" data-action="export-selected">Export PDF</button>'
      +(readOnly()?'':'<button class="btn danger small" data-action="withdraw-selected">Withdraw</button>')+'</div></div>';
  }
  html += '<div class="section-title">Company documents</div>'
    +'<div class="site-card-sub" style="margin-bottom:8px;">Upload each once — keep one current copy here for every site you work on.</div><div class="card">'
    + LIBRARY_TYPES.map(t=>{ const id = libraryReqId(contractorId, t.id); return documentRow(id, t.name, S.state.documents[id] || {status:'missing'}); }).join('')+'</div>';
  mySites.forEach(site=>{
    const reqs = (S.state.requirements[site.id]||[]).filter(r=>{ const d = S.state.documents[r.id]; return d && (d.assetUrl || d.pendingFileId); });
    if(!reqs.length) return;
    html += '<div class="section-title">'+site.name+'</div><div class="card">' + reqs.map(r=>documentRow(r.id, r.name, S.state.documents[r.id])).join('') +'</div>';
  });
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
  const rows = allDocumentsAcrossSites();
  const counts = {all:rows.length, awaiting_review:0, expiring:0, expired:0, correction_required:0, missing:0};
  rows.forEach(r=>{ if(counts[r.status]!==undefined) counts[r.status]++; });
  const filter = S.docCentreFilter;
  const shown = filter==='all' ? rows : rows.filter(r=>r.status===filter);
  const chips = [['all','All'],['awaiting_review','Awaiting review'],['expiring','Expiring'],['expired','Expired'],['correction_required','Corrections'],['missing','Missing']];
  let html = '<div class="section-title">Document Centre</div><div class="site-picker-row" style="margin-bottom:10px;">'
    + chips.map(([key,label])=>'<button class="site-picker-chip'+(filter===key?' active':'')+'" data-action="doc-centre-filter" data-filter="'+key+'">'+label+' ('+counts[key]+')</button>').join('')+'</div>';
  if(!rows.length) return html + '<div class="empty"><h3>No documents yet</h3><p>Once contractors start submitting against site requirements, they\'ll show up here.</p></div>';
  if(!shown.length) return html + '<div class="site-card-sub" style="padding:8px 2px;">Nothing in this category.</div>';
  return html + '<div class="card">' + shown.slice(0,200).map(r=>'<div class="reqrow" data-action="open-req" data-req="'+r.req.id+'" role="button" tabindex="0" style="cursor:pointer;"><div class="reqrow-main">'
    +'<div class="reqrow-name">'+r.req.name+'</div><div class="reqrow-meta">'+badge(r.status)+'<span class="srctag">'+r.site.name+' · '+r.contractor.name+'</span></div></div>'
    +'<div class="reqrow-chevron">'+ICONS.chevron+'</div></div>').join('') + '</div>';
}
function renderContractorsList(){
  const list = Object.values(S.state.contractors);
  let html = '<div class="view-head"><h1>Documents &amp; Contractors</h1><p>'+org().name+'</p></div>' + renderDocumentCentre() + '<div class="section-title">Contractors</div>';
  if(!list.length) return html+'<div class="empty"><h3>No contractors yet</h3><p>Add your first contractor from "Add a site" — you\'ll be asked for their details the first time you invite them.</p></div>';
  return html + list.map(c=>{
    const sitesFor = Object.values(S.state.sites).filter(s=>s.contractorId===c.id);
    const rated = c.reliability>0;
    return '<div class="card checkpoint"><div class="flexbetween"><div class="site-card-title">'+c.name+'</div><span class="score-pill" style="color:'+(rated?gaugeColor(c.reliability):'var(--grey)')+';" title="Based on first-time-right submissions and on-time responses">'+(rated?c.reliability+'<span class="lbl">/100</span>':'<span class="lbl">Not yet rated</span>')+'</span></div>'
      +'<div class="site-card-sub">'+(c.trade||'Trade not set')+' · Reg '+(c.reg||'—')+' · '+(c.linked?'<span style="color:var(--green);">On SiteGuard'+(c.linkedOrgName && c.linkedOrgName!==c.name?' as '+c.linkedOrgName:'')+'</span>':'Not yet joined')+'</div>'
      +'<div class="site-card-sub">'+(c.contact||'No contact')+(c.contactEmail?' · '+c.contactEmail:'')+'</div>'
      +'<div class="site-card-sub" style="margin-top:6px;">'+(sitesFor.length?sitesFor.map(s=>s.name).join(', '):'No sites yet')+'</div>'
      +(isOrgAdmin() && !readOnly() ? '<div class="row-actions"><button class="btn secondary small" data-action="edit-contractor" data-id="'+c.id+'">Edit details</button></div>' : '')+'</div>';
  }).join('');
}

/* ============ MORE ============ */
function renderMore(){
  if(S.moreView) return '<div style="margin-bottom:14px;"><button class="btn secondary small" data-action="goto-more" data-view="">← More</button></div>' + (MORE_VIEWS[S.moreView] ? MORE_VIEWS[S.moreView]() : '');
  const item = (view, icon, title, sub) => '<button class="menu-row" data-action="goto-more" data-view="'+view+'"><div class="qa-icon">'+icon+'</div><div style="flex:1;"><div class="qa-title">'+title+'</div><div class="qa-sub">'+sub+'</div></div>'+ICONS.chevron+'</button>';
  let html = '<div class="view-head"><h1>More</h1><p>'+org().name+' · '+org().roleLabel+'</p></div><div class="card">';
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
  html += '</div><div class="section-title">Account</div><div class="card">'
    +'<button class="menu-row" data-action="open-profile"><div class="qa-icon">'+initials(myName())+'</div><div style="flex:1;"><div class="qa-title">'+myName()+'</div><div class="qa-sub">'+S.boot.me.email+'</div></div>'+ICONS.chevron+'</button>'
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
  const incRows = (f==='open'||f==='action'?openInc : f==='severe'?severe : f==='all'?incidents : []);
  const permRows = (f==='action'?pending.concat(expired) : f==='pending'?pending : f==='active'?active : f==='expired'?expired : f==='all'?permits : []);
  if(incRows.length) html += '<div class="section-title">Incidents</div><div class="card">'+incRows.map(x=>renderIncidentRow(x.inc, x.siteId, true)).join('')+'</div>';
  if(permRows.length) html += '<div class="section-title">Permits</div><div class="card">'+permRows.map(x=>renderPermitRow(x.p, x.siteId, true)).join('')+'</div>';
  if(!incRows.length && !permRows.length) html += '<div class="empty"><h3>'+(f==='action'?'All clear':'Nothing here')+'</h3><p>'+(f==='action'?'No open incidents, permits awaiting issue or expired permits across your sites.':'No items match this filter.')+'</p></div>';
  return html;
}

/* ---- Workforce ---- */
function renderWorkforce(){
  const workers = Object.values(S.state.workers||{});
  const own = workers.filter(w=>w.own), others = workers.filter(w=>!w.own);
  let html = '<div class="view-head"><div class="flexbetween"><h1>Workforce</h1>'+(canEdit() && !readOnly()?'<button class="btn orange small" data-action="new-worker">+ Add worker</button>':'')+'</div>'
    +'<p>Per-worker medical surveillance, inductions and training. Only the last 4 characters of ID numbers are stored.</p></div>';
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
  const list = S.state.appointments || [];
  const own = list.filter(a=>a.own), others = list.filter(a=>!a.own);
  let html = '<div class="view-head"><div class="flexbetween"><h1>Appointments register</h1>'+(isOrgAdmin() && !readOnly()?'<button class="btn orange small" data-action="new-appointment">+ Record</button>':'')+'</div>'
    +'<p>Statutory appointments (e.g. OHS Act s16(1)/16(2), Construction Regulations 8(1)/8(7), MHSA appointments) with their signed letters.</p></div>';
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
  const rows = filtered && S.auditRows ? S.auditRows : S.state.audit;
  return '<div class="view-head"><h1>Audit trail</h1><p>Complete, append-only history — who, what, when</p></div>'
    +'<div class="card">'
    +'<label class="field-label" for="auditFrom">From</label><input type="date" id="auditFrom" value="'+f.from+'">'
    +'<label class="field-label" for="auditTo">To</label><input type="date" id="auditTo" value="'+f.to+'">'
    +'<label class="field-label" for="auditSite">Site</label><select id="auditSite" class="field"><option value="">All sites</option>'
      + sites.map(s=>'<option value="'+s.id+'"'+(f.siteId===s.id?' selected':'')+'>'+s.name+'</option>').join('')+'</select>'
    +'<div style="display:flex;gap:8px;margin-top:10px;"><button class="btn secondary small" style="flex:1;" data-action="audit-filter">Apply filter</button>'
    +'<button class="btn orange small" style="flex:1;" data-action="audit-export">Export PDF</button></div></div>'
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
  return html + '<div class="card">'+links.map(l=>{
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
    +'<button class="btn orange block" style="margin-top:10px;" data-action="verify-code">Check code</button></div>';
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
      +'<button class="btn orange block" style="margin-top:10px;" data-action="invite-user">Send invitation</button>'
      +'<div class="site-card-sub" style="margin-top:8px;">'+roleHelp()+'</div></div>';
  }
  html += '<div class="section-title">Members</div><div class="card">'+t.members.map(m=>{
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
  if(!b.enabled){
    return html + '<div class="card"><div class="site-card-sub">Billing isn\'t configured on this server (no Stripe keys), so every organisation has full access. Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and the plan price IDs to turn on plans, trials and seat limits.</div></div>';
  }
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
    +(p.paid ? (p.purchasable ? '<button class="btn '+(p.id===b.plan?'secondary':'orange')+' small" style="margin-top:8px;" data-action="billing-choose" data-plan="'+p.id+'">'+(b.hasSubscription ? (p.id===b.plan?'Update seats':'Switch to '+escapeHtml(p.name)) : 'Subscribe')+'</button>' : '<div class="site-card-sub" style="margin-top:6px;">Not available yet.</div>') : '<div class="site-card-sub" style="margin-top:6px;">Free — no card needed.</div>')
    +'</div>').join('');
  html += '<div class="site-card-sub" style="margin-top:8px;">Plan changes are prorated. Cancel any time from “Payment method &amp; invoices”; your data stays readable.</div>';
  return html;
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
    +(ro?'':'<button class="btn orange block" style="margin-top:12px;" data-action="save-org">Save company details</button>')+'</div>';
  html += '<div class="section-title">Notifications</div><div class="card">'
    +'<div class="toggle-row"><label for="digestToggle">Email reminder digests (expiring documents &amp; certificates, open incidents, overdue requests)</label><input type="checkbox" id="digestToggle" '+(s.reminderDigest===false?'':'checked')+' '+(ro?'disabled':'data-action-change="toggle-digest"')+'></div>'
    +'<div class="site-card-sub" style="margin-top:6px;">Invitations, correction requests, requests for information, permit requests and serious incidents are always emailed.</div></div>';
  if(isHost()){
    html += '<div class="section-title">InspectX integration</div><div class="card"><div class="site-card-sub" style="margin-bottom:10px;">SiteGuard works fully without InspectX. Once enabled, inspections with an external reference link straight across.</div>'
      +'<div class="toggle-row"><label for="inspectxToggle">Enable InspectX links</label><input type="checkbox" id="inspectxToggle" '+(s.inspectxEnabled?'checked':'')+'></div>'
      +'<label class="field-label" for="inspectxUrl">InspectX base URL</label><input type="url" id="inspectxUrl" value="'+(s.inspectxBaseUrl||'')+'" placeholder="https://app.inspectx.example/i/">'
      +(ro?'':'<button class="btn secondary block" style="margin-top:10px;" data-action="save-integration">Save</button>')+'</div>';
  }
  html += '<div class="section-title">AI drafting</div><div class="card"><div class="site-card-sub">'
    +(S.boot.features.ai ? 'AI drafting and expiry-date detection are on. Requests go through SiteGuard\'s server — no API key is ever stored in your browser.'
      : S.boot.features.aiConfigured ? 'AI drafting is included in '+(isContractor()?'Contractor Pro':'Site Professional')+'. Upgrade under Plan &amp; billing to turn it on.'
      : 'AI drafting isn\'t configured on this server.')+'</div></div>';
  return html;
}

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
on('nav', (el)=>{ S.nav = el.dataset.nav; if(S.nav==='sites') S.activeSiteId=null; if(S.nav==='more') S.moreView=null; S.docSelectMode=false; render(); window.scrollTo(0,0); });
on('open-site', (el)=>{ S.activeSiteId = el.dataset.site; S.nav='sites'; S.siteTab='compliance'; render(); window.scrollTo(0,0); });
on('back-sites', ()=>{ S.activeSiteId=null; render(); });
on('focus-site', (el, e)=>{ e.stopPropagation(); S.focusSiteId = el.dataset.site; render(); });
on('site-tab', (el)=>{ S.siteTab = el.dataset.tab; render(); });
on('goto-more', (el)=>{ S.nav='more'; S.moreView = el.dataset.view || null; if(S.moreView==='team') invalidateTeam(); if(S.moreView==='billing') invalidateBilling(); render(); window.scrollTo(0,0); });
on('doc-centre-filter', (el)=>{ S.docCentreFilter = el.dataset.filter; render(); });
on('doc-centre-jump', (el)=>{ S.docCentreFilter = el.dataset.filter; S.nav='passport'; render(); });
on('safety-filter', (el)=>{ S.safetyFilter = el.dataset.filter; render(); });
on('toggle-select', ()=>{ S.docSelectMode = !S.docSelectMode; S.selectedDocs = []; render(); });
on('doc-check', (el)=>{
  const id = el.dataset.req;
  if(el.checked){ if(!S.selectedDocs.includes(id)) S.selectedDocs.push(id); } else S.selectedDocs = S.selectedDocs.filter(x=>x!==id);
  render();
});
on('export-selected', ()=>{
  if(!S.selectedDocs.length) return;
  const rows = S.selectedDocs.map(id=>({req:findReq(id), doc:S.state.documents[id]||{status:'missing'}})).filter(r=>r.req);
  printHtml('<h1>SiteGuard Document Pack</h1><div class="p-sub">'+org().name+' · '+rows.length+' document'+(rows.length===1?'':'s')+'</div>'
    +'<div class="p-sub">Exported '+new Date().toLocaleString('en-ZA')+' by '+myName()+'</div>'
    +'<table><tr><th>Document</th><th>Status</th><th>Version</th><th>Expiry</th><th>Updated</th></tr>'
    + rows.map(r=>'<tr><td>'+r.req.name+'</td><td>'+STATUS_LABEL[effectiveStatus(r.doc)]+'</td><td>'+(r.doc.version||'—')+'</td><td>'+(r.doc.expiryDate||'—')+'</td><td>'+(r.doc.updatedAt||'—')+'</td></tr>').join('')
    +'</table><div class="p-foot">Generated by SiteGuard. Open each source file in SiteGuard to view or share it individually.</div>');
});
on('withdraw-selected', async ()=>{
  if(!S.selectedDocs.length) return;
  if(!confirm('Withdraw '+S.selectedDocs.length+' document(s)? They go back to "missing" (earlier versions stay in the history).')) return;
  const ids = S.selectedDocs.slice();
  await act(async ()=>{ for(const id of ids) await api.del('/api/documents/'+encodeURIComponent(id)); }, 'Withdrawn');
  S.selectedDocs = []; S.docSelectMode = false; render();
});
on('export-site', (el)=>exportSafetyFile(el.dataset.site));
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
on('save-integration', (el)=>act(()=>api.patch('/api/org/settings', { inspectxEnabled: document.getElementById('inspectxToggle').checked, inspectxBaseUrl: document.getElementById('inspectxUrl').value.trim() }), 'Settings saved', el));
on('resend-verification', (el)=>act(()=>api.post('/api/auth/resend-verification'), 'Confirmation email sent', el));
on('leave-demo', async ()=>{
  try{ await api.post('/api/auth/logout'); }catch{ /* ignore */ }
  S.authView = 'signup'; S.nav='dashboard'; S.activeSiteId=null; S.moreView=null;
  await reload();
});
