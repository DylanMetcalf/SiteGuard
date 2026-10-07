// Platform overview for the people who run this COMVERA service (PLATFORM_ADMIN_EMAILS).
// The server decides who may see it; this screen only shows what it returns.

import { api } from './api.js';
import { escapeHtml, timeAgo, render, showToast, on, act } from './core.js';

let cache = null;
async function load(){
  const [overview, promos, pricing, orgs] = await Promise.all([api.get('/api/admin/overview'), api.get('/api/admin/promos'), api.get('/api/admin/pricing'), api.get('/api/admin/orgs?q='+encodeURIComponent(orgQuery))]);
  cache = { ...overview, promos: promos.promos, pricing: pricing.plans, orgs: orgs.orgs };
  render();
}
let orgQuery = '';
export function invalidatePlatform(){ cache = null; }

const PLAN_OPTIONS = [['contractor_starter','Contractor Starter'],['contractor_pro','Contractor Pro'],['host_starter','Site Starter'],['host_pro','Site Professional'],['host_enterprise','Enterprise']];
const rands = (c)=> c===null || c===undefined ? 'Quote' : 'R'+(c/100).toLocaleString('en-ZA', { maximumFractionDigits: 2 });
const day = (v)=> v ? escapeHtml(String(v).slice(0,10)) : '';

const stat = (label, value) => '<div class="kv"><span>'+escapeHtml(label)+'</span><span>'+escapeHtml(value)+'</span></div>';

export function renderPlatform(){
  if(!cache){ load().catch(e=>showToast(e.message)); return '<div class="empty"><p>Loading…</p></div>'; }
  const c = cache, u = c.usage, h = c.health;
  const kinds = Object.fromEntries(c.organisations.map(o=>[o.kind, o]));
  const host = kinds.host || {total:0,last30:0}, con = kinds.contractor || {total:0,last30:0};
  let html = '<div class="view-head"><h1>Platform</h1><p>Everyone on this COMVERA service · demo accounts left out</p></div>';
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
    + '</div>';
  html += '<div class="section-title">Enquiries from the contact page</div><div class="card">'
    + ((c.enquiries||[]).length ? c.enquiries.map(q=>'<div style="padding:6px 0;border-bottom:1px solid var(--line);"><div class="site-card-sub">'+escapeHtml(q.topic)+' · '+escapeHtml(q.name)+(q.company?' · '+escapeHtml(q.company):'')+' · '+timeAgo(q.createdAt)+'</div><div>'+escapeHtml(q.message)+'</div><div class="site-card-sub"><a href="mailto:'+escapeHtml(q.email)+'">'+escapeHtml(q.email)+'</a>'+(q.phone?' · '+escapeHtml(q.phone):'')+'</div></div>').join('') : '<div class="site-card-sub">No enquiries yet.</div>')
    + '</div>';
  html += promosSection(c) + grantsSection(c) + pricingSection(c);
  html += '<div class="site-card-sub">Updated '+timeAgo(c.generatedAt)+'. <button class="linkish" data-action="platform-refresh">Refresh</button></div>';
  return html;
}

function promosSection(c){
  return '<div class="section-title">Promo codes</div><div class="card">'
    + '<div class="site-card-sub" style="margin-bottom:8px;">Free or discounted access for family, testers or partners, without changing public prices. A 100% code needs no payment; a smaller discount needs a matching Stripe coupon.</div>'
    + (c.promos.length ? c.promos.map(p=>'<div class="kv"><span><strong>'+escapeHtml(p.code)+'</strong> <span class="site-card-sub">· '+escapeHtml((PLAN_OPTIONS.find(o=>o[0]===p.plan)||[0,p.plan])[1])+' · '+p.percentOff+'% off · '+(p.durationDays?p.durationDays+' days':'no end date')+' · used '+p.redemptions+(p.maxRedemptions?' of '+p.maxRedemptions:'')+(p.expiresAt?' · code expires '+day(p.expiresAt):'')+(p.orgName?' · only '+escapeHtml(p.orgName):'')+(p.description?' · '+escapeHtml(p.description):'')+'</span></span>'
        +'<button class="btn '+(p.active?'secondary':'primary')+' small" data-action="promo-active" data-id="'+p.id+'" data-active="'+(p.active?'0':'1')+'">'+(p.active?'Switch off':'Switch on')+'</button></div>').join('') : '<div class="site-card-sub">No codes yet.</div>')
    + '<details style="margin-top:10px;"><summary class="linkish">Create a code</summary>'
    + '<label class="field-label" for="pcCode">Code</label><input type="text" id="pcCode" maxlength="40" placeholder="FAMILYFREE">'
    + '<label class="field-label" for="pcPlan">Plan</label><select id="pcPlan">'+PLAN_OPTIONS.map(o=>'<option value="'+o[0]+'">'+o[1]+'</option>').join('')+'</select>'
    + '<label class="field-label" for="pcPercent">Discount (%)</label><input type="number" id="pcPercent" min="1" max="100" value="100">'
    + '<label class="field-label" for="pcDays">Lasts for (days after redeeming — blank for no end date)</label><input type="number" id="pcDays" min="1" max="3650">'
    + '<label class="field-label" for="pcMax">How many organisations can use it (blank for no limit)</label><input type="number" id="pcMax" min="1">'
    + '<label class="field-label" for="pcExpires">Code can be redeemed until (optional)</label><input type="date" id="pcExpires">'
    + '<label class="field-label" for="pcCoupon">Stripe coupon id (only for discounts under 100%)</label><input type="text" id="pcCoupon" maxlength="100">'
    + '<label class="field-label" for="pcDesc">Note (who it is for)</label><input type="text" id="pcDesc" maxlength="200">'
    + '<button class="btn primary block" style="margin-top:10px;" data-action="promo-create">Create code</button></details></div>';
}

function grantsSection(c){
  return '<div class="section-title">Give a plan (enterprise deals, partners)</div><div class="card">'
    + '<div class="row-actions"><input type="search" id="orgSearch" placeholder="Find an organisation" value="'+escapeHtml(orgQuery)+'" style="flex:1;"><button class="btn secondary small" data-action="org-search">Search</button></div>'
    + c.orgs.map(o=>'<div class="kv"><span>'+escapeHtml(o.name)+' <span class="site-card-sub">· '+(o.kind==='host'?'mine':'contractor')+' · '+escapeHtml(o.status)+(o.grantPlan?' · given: '+escapeHtml((PLAN_OPTIONS.find(x=>x[0]===o.grantPlan)||[0,o.grantPlan])[1])+(o.grantUntil?' until '+day(o.grantUntil):''):'')+'</span></span>'
      + '<span class="row-actions"><select data-grant-plan="'+o.id+'" aria-label="Plan for '+escapeHtml(o.name)+'"><option value="">No plan</option>'+PLAN_OPTIONS.filter(p=>p[0].startsWith(o.kind==='host'?'host':'contractor')).map(p=>'<option value="'+p[0]+'"'+(o.grantPlan===p[0]?' selected':'')+'>'+p[1]+'</option>').join('')+'</select>'
      + '<input type="date" data-grant-until="'+o.id+'" value="'+day(o.grantUntil)+'" aria-label="Until"><button class="btn secondary small" data-action="org-grant" data-id="'+o.id+'">Save</button></span></div>').join('')
    + '</div>';
}

function pricingSection(c){
  return '<div class="section-title">Pricing page</div><div class="card"><div class="site-card-sub" style="margin-bottom:8px;">What the public pricing page shows. What customers are charged is the Stripe price for each plan, so keep them in step. Leave the price blank for "Contact us".</div>'
    + c.pricing.map(p=>'<div style="padding:8px 0;border-bottom:1px solid var(--line);"><div class="flexbetween"><strong>'+escapeHtml(p.name)+'</strong><span class="site-card-sub">'+rands(p.priceCents)+' / '+escapeHtml(p.per)+'</span></div>'
      + '<div class="row-actions" style="margin-top:6px;"><input type="number" min="0" step="1" data-price="'+p.planId+'" value="'+(p.priceCents===null?'':p.priceCents/100)+'" placeholder="Rand" style="width:110px;"><input type="text" data-per="'+p.planId+'" value="'+escapeHtml(p.per)+'" style="width:110px;" aria-label="Per">'
      + '<label class="check-chip"><input type="checkbox" data-visible="'+p.planId+'"'+(p.visible?' checked':'')+'> Show</label></div>'
      + '<textarea data-highlights="'+p.planId+'" rows="3" style="margin-top:6px;" aria-label="Highlights, one per line">'+escapeHtml(p.highlights.join('\n'))+'</textarea>'
      + '<button class="btn secondary small" style="margin-top:6px;" data-action="pricing-save" data-plan="'+p.planId+'">Save '+escapeHtml(p.name)+'</button></div>').join('')
    + '</div>';
}

const v = (id)=> (document.getElementById(id)||{}).value || '';
const num = (x)=> x==='' ? null : Number(x);
on('promo-create', (el)=>act(()=>api.post('/api/admin/promos', {
  code: v('pcCode').trim(), plan: v('pcPlan'), percentOff: Number(v('pcPercent')||100), durationDays: num(v('pcDays')), maxRedemptions: num(v('pcMax')),
  expiresAt: v('pcExpires') || null, stripeCoupon: v('pcCoupon').trim() || null, description: v('pcDesc').trim(),
}).then(()=>{ cache = null; }), 'Code created', el));
on('promo-active', (el)=>act(()=>api.post('/api/admin/promos/'+el.dataset.id+'/active', { active: el.dataset.active==='1' }).then(()=>{ cache = null; }), el.dataset.active==='1'?'Code switched on':'Code switched off', el));
on('org-search', ()=>{ orgQuery = v('orgSearch').trim(); cache = null; render(); });
on('org-grant', (el)=>{
  const id = el.dataset.id;
  const plan = document.querySelector('[data-grant-plan="'+id+'"]').value || null;
  const until = document.querySelector('[data-grant-until="'+id+'"]').value || null;
  return act(()=>api.post('/api/admin/orgs/'+id+'/grant', { plan, until }).then(()=>{ cache = null; }), plan ? 'Plan given' : 'Plan removed', el);
});
on('pricing-save', (el)=>{
  const id = el.dataset.plan, q = (a)=>document.querySelector('['+a+'="'+id+'"]');
  const price = q('data-price').value;
  return act(()=>api.put('/api/admin/pricing/'+id, { priceCents: price==='' ? null : Math.round(Number(price)*100), per: q('data-per').value.trim() || 'month',
    visible: q('data-visible').checked, highlights: q('data-highlights').value.split('\n').map(x=>x.trim()).filter(Boolean) }).then(()=>{ cache = null; }), 'Pricing saved', el);
});
