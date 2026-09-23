// Signed-out screens and the pages that emailed links land on.

import { api } from './api.js';
import { S, on, reload, render, showToast, escapeHtml, val } from './core.js';

const brand = '<div class="brand" style="justify-content:center;margin-bottom:18px;"><div class="brand-mark"></div><div class="brand-text"><div class="brand-name">SiteGuard</div><div class="brand-tag">Site Operations &amp; Compliance</div></div></div>';
const wrap = (inner) => '<div class="onboard-wrap">'+brand+inner+'</div>';
const errorBox = () => S.authContext.error ? '<div class="form-error" role="alert">'+escapeHtml(S.authContext.error)+'</div>' : '';
const okBox = () => S.authContext.ok ? '<div class="form-ok" role="status">'+escapeHtml(S.authContext.ok)+'</div>' : '';

function go(view, extra){
  S.authView = view;
  S.authContext = Object.assign({}, S.authContext, { error:'', ok:'' }, extra || {});
  render();
}
function fail(e){ S.authContext.error = e.message || 'Something went wrong'; render(); }
function finish(){
  S.authView = null;
  S.authContext = {};
  history.replaceState(null, '', '/');
  return reload();
}

/** Reads ?token= links from emails. Returns true if the URL was handled. */
export async function handleDeepLink(){
  const url = new URL(location.href);
  const token = url.searchParams.get('token') || '';
  const path = url.pathname;
  if(path === '/reset-password' && token){ S.authView = 'reset'; S.authContext = { token }; return true; }
  if(path === '/verify-email' && token){
    try{ await api.post('/api/auth/verify-email', { token }); S.authContext = { ok:'Email confirmed — thanks.' }; }
    catch(e){ S.authContext = { error:e.message }; }
    history.replaceState(null, '', '/');
    S.pendingToast = S.authContext.ok || S.authContext.error;
    S.authContext = {};
    return false;
  }
  if(path === '/invite' && token){
    S.authView = 'invite';
    try{ S.authContext = { token, invite: await api.get('/api/auth/invite/'+encodeURIComponent(token)) }; }
    catch(e){ S.authContext = { token, error:e.message }; }
    return true;
  }
  if(path === '/site-invite' && token){
    S.authView = 'site-invite';
    try{ S.authContext = { token, siteInvite: await api.get('/api/auth/site-invite/'+encodeURIComponent(token)) }; }
    catch(e){ S.authContext = { token, error:e.message }; }
    return true;
  }
  const billing = url.searchParams.get('billing');
  if(billing){
    S.pendingToast = billing==='success' ? 'Thanks — your subscription is being activated.' : 'Checkout cancelled — nothing was charged.';
    history.replaceState(null, '', '/');
  }
  return false;
}

export function renderAuth(){
  const v = S.authView || 'signin';
  const signedIn = S.boot && S.boot.authenticated;
  const features = (S.boot && S.boot.features) || {};

  if(v === 'invite'){
    const inv = S.authContext.invite;
    if(!inv) return wrap('<div class="card"><h3>Invitation unavailable</h3>'+errorBox()+'<button class="btn secondary block" style="margin-top:12px;" data-action="auth-go" data-view="signin">Go to sign in</button></div>');
    const head = '<div class="view-head" style="text-align:center;"><h1>Join '+escapeHtml(inv.org_name)+'</h1><p>You\'ve been invited as '+escapeHtml(inv.role)+' · '+escapeHtml(inv.email)+'</p></div>';
    if(signedIn){
      return wrap(head+'<div class="card"><div class="site-card-sub">Signed in as '+S.boot.me.email+'.</div>'
        +'<button class="btn orange block" style="margin-top:12px;" data-action="accept-user-invite">Accept and join</button>'
        +'<button class="btn secondary block" style="margin-top:8px;" data-action="auth-signout">Use a different account</button>'+errorBox()+'</div>');
    }
    if(inv.has_account){
      return wrap(head+signInCard('Sign in as '+escapeHtml(inv.email)+' to accept.', inv.email));
    }
    return wrap(head+'<div class="card">'
      +'<label class="field-label" for="suName">Your name</label><input type="text" id="suName" autocomplete="name">'
      +'<label class="field-label" for="suEmail">Email</label><input type="email" id="suEmail" value="'+escapeHtml(inv.email)+'" readonly>'
      +'<label class="field-label" for="suPassword">Choose a password</label><input type="password" id="suPassword" autocomplete="new-password" minlength="10">'
      +'<div class="site-card-sub" style="margin-top:4px;">At least 10 characters. A short phrase works well.</div>'
      +'<button class="btn orange block" style="margin-top:14px;" data-action="signup" data-mode="invite">Create account and join</button>'+errorBox()+'</div>');
  }

  if(v === 'site-invite'){
    const si = S.authContext.siteInvite;
    if(!si) return wrap('<div class="card"><h3>Invitation unavailable</h3>'+errorBox()+'<button class="btn secondary block" style="margin-top:12px;" data-action="auth-go" data-view="signin">Go to sign in</button></div>');
    const head = '<div class="view-head" style="text-align:center;"><h1>Site invitation</h1><p>'+escapeHtml(si.host_name)+' invited '+escapeHtml(si.contractor_name)+'</p></div>'
      +'<div class="card checkpoint"><div class="site-card-title">'+escapeHtml(si.site_name)+'</div><div class="site-card-sub">'+escapeHtml(si.location||'')+'</div>'
      +'<div class="site-card-sub" style="margin-top:8px;">Accepting shows you exactly which documents the site needs and tracks your readiness as you upload them. SiteGuard is free for contractors.</div></div>';
    if(si.status !== 'pending'){
      return wrap(head+'<div class="card"><div class="site-card-sub">This invitation was already '+escapeHtml(si.status)+'.</div><button class="btn secondary block" style="margin-top:12px;" data-action="auth-done">Continue</button></div>');
    }
    if(signedIn){
      const kind = S.boot.org && S.boot.org.kind;
      const contractorOrgs = (S.boot.orgs||[]).filter(o=>o.kind==='contractor');
      let body = '<div class="card">';
      if(kind === 'contractor'){
        body += '<div class="site-card-sub">You\'ll accept on behalf of <strong>'+S.boot.org.name+'</strong>.</div>'
          +'<div style="display:flex;gap:8px;margin-top:12px;"><button class="btn orange" style="flex:1;" data-action="site-invite-decide" data-decision="accept">Accept</button>'
          +'<button class="btn secondary" style="flex:1;" data-action="site-invite-decide" data-decision="decline">Decline</button></div>';
      } else if(contractorOrgs.length){
        body += '<div class="site-card-sub">Switch to your contractor organisation to respond:</div>'
          + contractorOrgs.map(o=>'<button class="btn secondary block" style="margin-top:8px;" data-action="switch-org" data-org="'+o.id+'">'+o.name+'</button>').join('');
      } else {
        body += '<div class="site-card-sub">You\'re signed in to a site-owner organisation. Create a contractor organisation to accept this invitation:</div>'
          +'<label class="field-label" for="newOrgName">Contractor company name</label><input type="text" id="newOrgName" value="'+escapeHtml(si.contractor_name)+'">'
          +'<button class="btn orange block" style="margin-top:10px;" data-action="create-org" data-kind="contractor" data-then="site-invite">Create and continue</button>';
      }
      return wrap(head+body+errorBox()+'</div>');
    }
    if(S.authContext.showSignin){
      return wrap(head+signInCard('Sign in to your contractor account to respond.', si.email||'')
        +'<button class="linkish" style="margin-top:6px;" data-action="auth-show-signin" data-show="0">New to SiteGuard? Create an account</button>');
    }
    return wrap(head+'<div class="card"><div class="site-card-title" style="font-size:14px;">New to SiteGuard?</div>'
      +'<label class="field-label" for="suName">Your name</label><input type="text" id="suName" autocomplete="name">'
      +'<label class="field-label" for="suOrgName">Company name</label><input type="text" id="suOrgName" value="'+escapeHtml(si.contractor_name)+'">'
      +'<label class="field-label" for="suEmail">Work email</label><input type="email" id="suEmail" autocomplete="email" value="'+escapeHtml(si.email||'')+'">'
      +'<label class="field-label" for="suPassword">Choose a password</label><input type="password" id="suPassword" autocomplete="new-password">'
      +'<button class="btn orange block" style="margin-top:14px;" data-action="signup" data-mode="site-invite">Create account and accept</button>'+errorBox()
      +'<div class="auth-links"><button class="linkish" data-action="auth-show-signin" data-show="1">Already have an account? Sign in</button></div></div>');
  }

  if(v === 'reset'){
    return wrap('<div class="view-head" style="text-align:center;"><h1>Choose a new password</h1><p>This signs you out on every other device.</p></div><div class="card">'
      +'<label class="field-label" for="rpPassword">New password</label><input type="password" id="rpPassword" autocomplete="new-password" autofocus>'
      +'<div class="site-card-sub" style="margin-top:4px;">At least 10 characters.</div>'
      +'<button class="btn orange block" style="margin-top:14px;" data-action="reset-password">Save and sign in</button>'+errorBox()+'</div>');
  }

  if(v === 'forgot'){
    return wrap('<div class="view-head" style="text-align:center;"><h1>Reset your password</h1><p>We\'ll email you a link that works once, for an hour.</p></div><div class="card">'
      +'<label class="field-label" for="fpEmail">Email</label><input type="email" id="fpEmail" autocomplete="email" autofocus>'
      +'<button class="btn orange block" style="margin-top:14px;" data-action="forgot">Send reset link</button>'+errorBox()+okBox()
      +'<div class="auth-links"><button class="linkish" data-action="auth-go" data-view="signin">Back to sign in</button></div></div>');
  }

  if(v === 'signup'){
    return wrap('<div class="view-head" style="text-align:center;"><h1>Create your organisation</h1><p>Site owners get a 14-day trial with no card. Contractors are always free.</p></div><div class="card">'
      +'<label class="field-label" for="suName">Your name</label><input type="text" id="suName" autocomplete="name" placeholder="e.g. Thandi Nkosi" autofocus>'
      +'<label class="field-label" for="suEmail">Work email</label><input type="email" id="suEmail" autocomplete="email">'
      +'<label class="field-label" for="suPassword">Password</label><input type="password" id="suPassword" autocomplete="new-password">'
      +'<div class="site-card-sub" style="margin-top:4px;">At least 10 characters.</div>'
      +'<label class="field-label" for="suOrgName">Organisation name</label><input type="text" id="suOrgName" placeholder="e.g. Riverside Mining Group, or your own company name">'
      +'<label class="field-label" for="suOrgKind">What best describes your organisation?</label>'
      +'<select id="suOrgKind" class="field"><option value="host">A site / mining company that hosts contractors and needs safety files from them</option><option value="contractor">A contractor company that submits safety files to sites</option></select>'
      +'<button class="btn orange block" style="margin-top:14px;" data-action="signup" data-mode="new">Create my organisation</button>'+errorBox()
      +'<div class="auth-links"><button class="linkish" data-action="auth-go" data-view="signin">Already have an account? Sign in</button></div></div>'
      + demoCard(features));
  }

  // sign in
  return wrap('<div class="view-head" style="text-align:center;"><h1>Sign in</h1><p>Contractor compliance, safety files and site operations.</p></div>'
    + signInCard('', '') + demoCard(features));
}

function signInCard(note, email){
  return '<div class="card">'+(note?'<div class="site-card-sub" style="margin-bottom:4px;">'+note+'</div>':'')
    +'<label class="field-label" for="siEmail">Email</label><input type="email" id="siEmail" autocomplete="email" value="'+escapeHtml(email)+'"'+(email?'':' autofocus')+'>'
    +'<label class="field-label" for="siPassword">Password</label><input type="password" id="siPassword" autocomplete="current-password"'+(email?' autofocus':'')+'>'
    +'<button class="btn orange block" style="margin-top:14px;" data-action="signin">Sign in</button>'+errorBox()+okBox()
    +'<div class="auth-links"><button class="linkish" data-action="auth-go" data-view="forgot">Forgot password?</button>'
    +(S.authView==='invite' ? '' : '<button class="linkish" data-action="auth-go" data-view="signup">Create an account</button>')+'</div></div>';
}

function demoCard(features){
  if(!features.demo) return '';
  return '<div class="card" style="margin-top:10px;text-align:center;">'
    +'<div class="site-card-sub" style="margin-bottom:8px;">Not ready to enter real information? Explore SiteGuard in a private sandbox with realistic sample data — an example mine, contractors and safety files. It\'s separate from any real account and deleted after a few days.</div>'
    +'<button class="btn secondary block" data-action="start-demo">Explore the demo</button></div>';
}

export function renderNoOrg(){
  return wrap('<div class="view-head" style="text-align:center;"><h1>Set up an organisation</h1><p>Signed in as '+S.boot.me.email+'. You\'re not part of an organisation yet — create one, or ask a colleague to invite you.</p></div>'
    +'<div class="card"><label class="field-label" for="newOrgName">Organisation name</label><input type="text" id="newOrgName">'
    +'<label class="field-label" for="newOrgKind">Type</label><select id="newOrgKind" class="field"><option value="host">Site / mining company</option><option value="contractor">Contractor company</option></select>'
    +'<button class="btn orange block" style="margin-top:12px;" data-action="create-org">Create organisation</button></div>'
    +'<button class="btn secondary block" data-action="auth-signout">Sign out</button>');
}

/* ============ actions ============ */
on('auth-go', (el)=>go(el.dataset.view));
on('auth-show-signin', (el)=>{ S.authContext.showSignin = el.dataset.show === '1'; S.authContext.error = ''; render(); });
on('auth-done', ()=>finish());

on('signin', async (el)=>{
  el.disabled = true;
  try{
    await api.post('/api/auth/login', { email: val('siEmail'), password: document.getElementById('siPassword').value });
    if(S.authView === 'invite' || S.authView === 'site-invite'){ await reload(); render(); }
    else await finish();
  }catch(e){ fail(e); }
});

on('signup', async (el)=>{
  const mode = el.dataset.mode;
  const body = { name: val('suName'), email: val('suEmail'), password: document.getElementById('suPassword').value };
  if(!body.name){ document.getElementById('suName').focus(); return; }
  if(mode === 'new'){ body.orgName = val('suOrgName'); body.orgKind = val('suOrgKind'); if(!body.orgName){ document.getElementById('suOrgName').focus(); return; } }
  if(mode === 'invite') body.inviteToken = S.authContext.token;
  if(mode === 'site-invite'){ body.siteInviteToken = S.authContext.token; body.orgName = val('suOrgName'); body.orgKind = 'contractor'; }
  el.disabled = true;
  const invitedSite = mode === 'site-invite' && S.authContext.siteInvite ? escapeHtml(S.authContext.siteInvite.site_name) : null;
  try{
    await api.post('/api/auth/signup', body);
    await finish();
    if(invitedSite){
      const site = Object.values(S.state.sites).find(x=>x.name===invitedSite);
      if(site){ S.nav='sites'; S.activeSiteId=site.id; S.siteTab='compliance'; render(); }
    }
    showToast(mode === 'new' ? 'Welcome to SiteGuard — check your email to confirm your address.' : 'Welcome to SiteGuard');
  }catch(e){ fail(e); }
});

on('forgot', async (el)=>{
  el.disabled = true;
  try{
    await api.post('/api/auth/forgot', { email: val('fpEmail') });
    S.authContext.ok = 'If that address has an account, a reset link is on its way.';
    S.authContext.error = '';
    render();
  }catch(e){ fail(e); }
});

on('reset-password', async (el)=>{
  el.disabled = true;
  try{
    await api.post('/api/auth/reset', { token: S.authContext.token, password: document.getElementById('rpPassword').value });
    await finish();
    showToast('Password changed — you\'re signed in.');
  }catch(e){ fail(e); }
});

on('accept-user-invite', async (el)=>{
  el.disabled = true;
  try{ await api.post('/api/auth/invite/'+encodeURIComponent(S.authContext.token)+'/accept'); await finish(); showToast('You\'ve joined the organisation'); }
  catch(e){ fail(e); }
});

on('site-invite-decide', async (el)=>{
  el.disabled = true;
  const decision = el.dataset.decision;
  try{
    const r = await api.post('/api/auth/site-invite/'+encodeURIComponent(S.authContext.token)+'/'+decision);
    const siteId = r && r.siteId;
    await finish();
    if(decision === 'accept' && siteId){ S.nav='sites'; S.activeSiteId = siteId; S.siteTab='compliance'; render(); }
    showToast(decision === 'accept' ? 'Invitation accepted — requirements are now open' : 'Invitation declined');
  }catch(e){ fail(e); }
});

on('switch-org', async (el)=>{
  try{
    await api.post('/api/auth/switch-org', { orgId: el.dataset.org });
    S.nav='dashboard'; S.activeSiteId=null; S.moreView=null;
    await reload();
  }catch(e){ showToast(e.message); }
});

on('create-org', async (el)=>{
  const name = val('newOrgName');
  if(!name){ document.getElementById('newOrgName').focus(); return; }
  el.disabled = true;
  try{
    await api.post('/api/orgs', { name, kind: el.dataset.kind || val('newOrgKind') });
    if(el.dataset.then === 'site-invite'){ await reload(); render(); }
    else { S.nav='dashboard'; await reload(); }
  }catch(e){ showToast(e.message); el.disabled = false; }
});

on('auth-signout', async ()=>{
  try{ await api.post('/api/auth/logout'); }catch{ /* ignore */ }
  S.nav='dashboard'; S.activeSiteId=null; S.moreView=null;
  await reload();
});

on('start-demo', async (el)=>{
  el.disabled = true; el.textContent = 'Setting up your sandbox…';
  try{ await api.post('/api/demo'); await finish(); showToast('Demo sandbox ready — this is sample data, not a real account'); }
  catch(e){ showToast(e.message); el.disabled = false; el.textContent = 'Explore the demo'; }
});
