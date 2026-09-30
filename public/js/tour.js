// The Walkthrough: a guided tour of SiteGuard for demos and new users.
// It moves through the real screens, highlights the part being explained and
// says what it is for, with Back / Next, auto-play and a progress bar. It only
// reads and navigates — it never changes data. Start it from More → Walkthrough,
// the first-run welcome card, or a link ending in ?tour=1.

import { S, ICONS, on, render, isHost, isContractor, org } from './core.js';

const AUTOPLAY_MS = 7000;
let steps = [], idx = 0, playing = false, timer = null, ticker = null, saved = null, root = null;

const first = (obj) => Object.values(obj || {})[0];
const go = (patch) => () => { Object.assign(S, patch); render(); window.scrollTo(0, 0); };
const firstFile = () => {
  const files = Object.values(S.state.sites || {}).filter((s) => s.status !== 'declined' && s.status !== 'invited');
  return files.find((s) => (S.state.requirements[s.id] || []).length) || files[0];
};

function hostSteps(){
  const wp = first(S.state.workplaces);
  const file = firstFile();
  const out = [
    { title: 'Welcome to SiteGuard', body: 'SiteGuard is where a mine and its contractors keep every contractor\'s safety file in one place: what the site requires, what has been submitted, what is approved, what is expiring, and who is cleared to enter. This walkthrough takes about two minutes.', go: go({ nav: 'dashboard', activeSiteId: null, activeWorkplaceId: null, moreView: null }) },
    { title: 'What needs your attention', body: 'The dashboard answers the first question every morning: what is OK, what needs attention, and what happens next. The compliance agent checks every site in the background and lists anything that needs you.', target: '.hero, .dash-hero, .view-head' },
    { title: 'Your sites', body: 'Each site has its own safety file requirements and a site code. Contractors type the code and get their own safety file for that site, so one site can have many contractors.', go: go({ nav: 'sites', activeSiteId: null, activeWorkplaceId: null }), target: '.wp-card, [data-action="new-site"], .view-head' },
  ];
  if(wp){
    out.push(
      { title: wp.name + ' at a glance', body: 'How many contractors are on the site, how many documents are waiting for you, what is outstanding, and who is Site Ready — tap any number to go straight there.', go: go({ nav: 'sites', activeSiteId: null, activeWorkplaceId: wp.id, wpTab: 'contractors' }), target: '.attn-grid' },
      { title: 'One review queue', body: 'Every document contractors submit for this site lands here. Open it, read it, and approve it or send it back with a note. Documents written in SiteGuard can be approved section by section.', go: go({ wpTab: 'queue' }), target: '[data-action="wp-tab"][data-tab="queue"]' },
      { title: 'Gate clearance', body: 'Who may enter today. A worker is cleared only when their company\'s safety file is Site Ready, the company isn\'t suspended, and their medical and induction are valid under your rules. Print a gate list or QR gate cards that security can scan.', go: go({ wpTab: 'gate' }), target: '[data-action="wp-tab"][data-tab="gate"]' },
      { title: 'What every safety file must contain', body: 'The site\'s requirements, each marked as a legal, site or best-practice requirement so nobody mistakes a site rule for the law. New requirements go to every contractor\'s file at once, and you can send one request to all contractors.', go: go({ wpTab: 'requirements' }), target: '[data-action="wp-tab"][data-tab="requirements"]' },
    );
  }
  if(file){
    out.push(
      { title: 'A contractor\'s safety file', body: 'Readiness for one contractor on one site: each requirement, its status and expiry. When everything is approved you mark it Site Ready, and a verification code proves it. Download the whole file as one bound PDF, with revisions recorded.', go: go({ nav: 'sites', activeWorkplaceId: null, activeSiteId: file.id, siteTab: 'compliance' }), target: '.readiness-hero, .bundle-link, .view-head' },
      { title: 'Audits, permits and incidents', body: 'Site activity holds your monthly contractor audits (scored, with findings tracked until you close them), permits to work, incidents, the site diary and inspections.', go: go({ siteTab: 'activity' }), target: '[data-action="site-tab"][data-tab="activity"]' },
      { title: 'People on site', body: 'The contractor\'s workers for this site, their medicals and inductions, gate clearance, toolbox talks signed on one device, and statutory appointments.', go: go({ siteTab: 'people' }), target: '[data-action="site-tab"][data-tab="people"]' },
    );
  }
  out.push(
    { title: 'Contractors', body: 'Every contractor you work with, searchable and filtered by trade. Their company details are theirs to keep up to date. From a contractor\'s profile you can suspend them on all your sites at once if you need to.', go: go({ nav: 'passport', activeSiteId: null, activeWorkplaceId: null }), target: '[data-action="nav"][data-nav="passport"]' },
    { title: 'Log anything, anywhere', body: 'The + button is always there: report an incident, issue a permit, log the diary or record a toolbox talk from site.', go: go({ nav: 'dashboard' }), target: '.fab' },
    { title: 'Everything else', body: 'More holds Document Studio, the compliance agent, the assistant, the Safety Centre, the audit trail, verification, your team, and settings — including your validity rules for medicals, inductions, COID letters and insurance.', go: go({ nav: 'more', moreView: null }), target: '[data-action="nav"][data-nav="more"]' },
  );
  return out;
}

function contractorSteps(){
  const file = firstFile();
  const out = [
    { title: 'Welcome to SiteGuard', body: 'SiteGuard keeps your company\'s safety files for every site you work on. Your documents are stored once and reused wherever they are needed; each site sees only its own file. This walkthrough takes about two minutes.', go: go({ nav: 'dashboard', activeSiteId: null, moreView: null }) },
    { title: 'What you need to do', body: 'The dashboard puts your to-do list first: missing and expiring documents, corrections the site asked for, audit findings to fix, and requests with due dates.', target: '.hero, .dash-hero, .view-head' },
    { title: 'Join a site with its code', body: 'The site gives you a code. Type it under More → Join a site with a code, and your safety file for that site starts straight away with the site\'s requirements.', go: go({ nav: 'more', moreView: null }), target: '[data-action="join-site"], .view-head' },
  ];
  if(file){
    out.push(
      { title: 'Your safety file for ' + file.name, body: 'Each requirement with its status. The guide walks you through what is missing: upload it, reuse it from your library, or create it in Document Studio. Download the whole file as one bound PDF — SiteGuard records a revision whenever it changes.', go: go({ nav: 'sites', activeSiteId: file.id, siteTab: 'compliance' }), target: '.guide-card, .readiness-hero, .view-head' },
      { title: 'Audits and permits', body: 'When the site audits your work, the score and each finding appear here. Fix it, say what was done, and the site closes it. Request permits to work here too.', go: go({ siteTab: 'activity' }), target: '[data-action="site-tab"][data-tab="activity"]' },
      { title: 'Your people and gate cards', body: 'Assign your workers to the site. Each one shows whether they are cleared at the gate and, if not, exactly why. Print QR gate cards for security to scan.', go: go({ siteTab: 'people' }), target: '[data-action="site-tab"][data-tab="people"]' },
    );
  }
  out.push(
    { title: 'Your document library', body: 'Every document you hold, grouped by status, with expiry dates. Replace one here and SiteGuard shows every site file it affects.', go: go({ nav: 'passport', activeSiteId: null }), target: '[data-action="nav"][data-nav="passport"]' },
    { title: 'Document Studio', body: 'Don\'t have a document? Create it: risk assessments, method statements (tick the work activities and the hazards, controls and PPE are filled in), policies, appointment letters and more, branded as yours. Drafts are for you to check and sign — they are not a certification.', go: go({ nav: 'more', moreView: 'studio' }), target: '.view-head' },
    { title: 'Log anything, anywhere', body: 'The + button is always there: upload a document, record a toolbox talk with signatures on one device, report an incident or log the diary.', go: go({ nav: 'dashboard', moreView: null }), target: '.fab' },
  );
  return out;
}

/* ---------- drawing ---------- */
function visible(el){ const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
function findTarget(sel){
  if(!sel) return null;
  for(const s of sel.split(',')){ const el = [...document.querySelectorAll(s.trim())].find(visible); if(el) return el; }
  return null;
}
function place(){
  if(!root) return;
  const step = steps[idx];
  const spot = root.querySelector('.tour-spot'), card = root.querySelector('.tour-card');
  const el = findTarget(step.target);
  if(!el){ spot.style.display = 'none'; root.classList.add('centred'); card.style.top = ''; card.style.left = ''; return; }
  root.classList.remove('centred');
  const r = el.getBoundingClientRect(), pad = 6;
  Object.assign(spot.style, { display: 'block', top: (r.top - pad) + 'px', left: (r.left - pad) + 'px', width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px' });
  const cw = Math.min(380, window.innerWidth - 32), ch = card.offsetHeight;
  const below = r.bottom + 14 + ch < window.innerHeight;
  const top = below ? r.bottom + 14 : Math.max(12, r.top - 14 - ch);
  const left = Math.min(Math.max(16, r.left + r.width / 2 - cw / 2), window.innerWidth - cw - 16);
  Object.assign(card.style, { top: top + 'px', left: left + 'px', width: cw + 'px' });
}
function draw(){
  const step = steps[idx], last = idx === steps.length - 1;
  root.querySelector('.tour-card').innerHTML =
    '<div class="tour-top"><span class="tour-count">'+(idx + 1)+' of '+steps.length+'</span><button class="tour-x" data-tour="close" aria-label="Close the walkthrough">×</button></div>'
    +'<div class="tour-bar"><span style="width:'+((idx + 1) / steps.length * 100)+'%"></span></div>'
    +'<h2 id="tourTitle">'+step.title+'</h2><p>'+step.body+'</p>'
    +'<div class="tour-play-bar'+(playing ? ' on' : '')+'"><span></span></div>'
    +'<div class="tour-actions"><button class="btn secondary small" data-tour="back"'+(idx === 0 ? ' disabled' : '')+'>Back</button>'
    +'<button class="btn secondary small" data-tour="play" aria-pressed="'+playing+'">'+(playing ? 'Pause' : 'Auto-play')+'</button>'
    +'<button class="btn primary small" data-tour="next">'+(last ? 'Finish' : 'Next')+'</button></div>';
  if(playing){
    const bar = root.querySelector('.tour-play-bar span');
    bar.style.transition = 'none'; bar.style.width = '0';
    requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.transition = 'width ' + AUTOPLAY_MS + 'ms linear'; bar.style.width = '100%'; }));
  }
  place();
  root.querySelector('[data-tour="next"]').focus({ preventScroll: true });
}
function show(i){
  idx = Math.max(0, Math.min(i, steps.length - 1));
  const step = steps[idx];
  if(step.go) step.go();
  // Let the screen render, then bring the highlighted part into view.
  requestAnimationFrame(() => {
    const el = findTarget(step.target);
    if(el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
    draw();
  });
  clearTimeout(timer);
  if(playing) timer = setTimeout(() => (idx < steps.length - 1 ? show(idx + 1) : stop()), AUTOPLAY_MS);
}

export function startTour(opts = {}){
  if(!S.state || !S.boot || !S.boot.org) return;
  document.querySelectorAll('.overlay').forEach((o) => o.remove());
  saved = { nav: S.nav, activeSiteId: S.activeSiteId, activeWorkplaceId: S.activeWorkplaceId, siteTab: S.siteTab, wpTab: S.wpTab, moreView: S.moreView };
  steps = isContractor() ? contractorSteps() : hostSteps();
  playing = !!opts.autoplay;
  root = document.createElement('div');
  root.className = 'tour';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'tourTitle');
  root.innerHTML = '<div class="tour-block"></div><div class="tour-spot"></div><div class="tour-card"></div>';
  document.body.appendChild(root);
  document.body.classList.add('touring');
  ticker = setInterval(place, 400);
  window.addEventListener('resize', place);
  document.addEventListener('keydown', onKey, true);
  show(0);
}
function stop(){
  clearTimeout(timer); clearInterval(ticker);
  window.removeEventListener('resize', place);
  document.removeEventListener('keydown', onKey, true);
  if(root) root.remove();
  root = null; playing = false;
  document.body.classList.remove('touring');
  try{ localStorage.setItem('sg_tutorial_seen', '1'); }catch{ /* private mode */ }
  if(saved){ Object.assign(S, saved); saved = null; render(); window.scrollTo(0, 0); }
}
function onKey(e){
  if(!root) return;
  if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); stop(); }
  else if(e.key === 'ArrowRight'){ e.preventDefault(); next(); }
  else if(e.key === 'ArrowLeft'){ e.preventDefault(); if(idx > 0) show(idx - 1); }
}
function next(){ if(idx === steps.length - 1) stop(); else show(idx + 1); }

document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-tour]');
  if(!b || !root) return;
  e.preventDefault(); e.stopPropagation();
  const a = b.dataset.tour;
  if(a === 'close') stop();
  else if(a === 'back') show(idx - 1);
  else if(a === 'next') next();
  else if(a === 'play'){ playing = !playing; show(idx); }
}, true);

on('start-tour', (el) => startTour({ autoplay: el && el.dataset && el.dataset.autoplay === '1' }));

/** The first-run welcome: offer the walkthrough once per browser. */
let offered = false;
export function maybeOfferTour(){
  if(offered || !S.state || !S.boot || !S.boot.org) return;
  offered = true;
  if(/[?&]tour=1\b/.test(location.search)){ setTimeout(() => startTour({ autoplay: /[?&]autoplay=1\b/.test(location.search) }), 300); return; }
  let seen = false;
  try{ seen = localStorage.getItem('sg_tutorial_seen') === '1'; }catch{ seen = true; }
  if(seen) return;
  const o = document.createElement('div');
  o.className = 'overlay tutorial';
  o.innerHTML = '<div class="sheet tut-card" role="dialog" aria-modal="true" aria-labelledby="tutT"><div class="tut-icon">'+ICONS.sparkle+'</div>'
    +'<h2 id="tutT">Welcome to SiteGuard'+(org().name ? ', ' + org().name : '')+'</h2>'
    +'<p>'+(isHost() ? 'See how sites, contractors, reviews, audits and gate clearance fit together.' : 'See how your safety files, documents, sites and gate cards fit together.')+' The walkthrough takes about two minutes, and you can open it again any time from More → Walkthrough.</p>'
    +'<button class="btn primary block" id="tutGo">Take the walkthrough</button>'
    +'<button class="btn secondary block" style="margin-top:8px;" id="tutSkip">Not now</button></div>';
  document.body.appendChild(o);
  const done = () => { try{ localStorage.setItem('sg_tutorial_seen', '1'); }catch{ /* private mode */ } o.remove(); };
  o.querySelector('#tutGo').onclick = () => { done(); startTour(); };
  o.querySelector('#tutSkip').onclick = done;
}
