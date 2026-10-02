// The signed-out front page: what SiteGuard is, who it's for, how it works, and a
// clear way in (create an account, sign in, or try the demo with a guided tour).
// Static content only; every button is a data-action handled in auth.js.

const tick = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ic = (d) => '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">'+d+'</svg>';
const I = {
  file: ic('<path d="M7 3h7l5 5v13H7z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 3v5h5M10 13h6M10 17h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  pen: ic('<path d="M4 20l4-1 11-11-3-3L5 16z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 6l3 3" stroke="currentColor" stroke-width="1.8"/>'),
  gate: ic('<rect x="4" y="4" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.8"/><rect x="13" y="4" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.8"/><rect x="4" y="13" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.8"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2" stroke="currentColor" stroke-width="1.8"/>'),
  bell: ic('<path d="M6 16V11a6 6 0 1112 0v5l2 2H4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 20a2 2 0 004 0" stroke="currentColor" stroke-width="1.8"/>'),
  check: ic('<path d="M4 6h10M4 12h7M4 18h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M15 12l2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  share: ic('<circle cx="6" cy="12" r="2.5" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="6" r="2.5" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="18" r="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M8.2 11l7.6-3.8M8.2 13l7.6 3.8" stroke="currentColor" stroke-width="1.8"/>'),
  shield: ic('<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  audit: ic('<path d="M9 4h6v3H9z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M7 5H5v16h14V5h-2" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 12l2 2 4-4M8 17h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
};

function mock(){
  const row = (name, badge, cls) => '<div class="lp-mrow"><span>'+name+'</span><span class="lp-mbadge '+cls+'">'+badge+'</span></div>';
  return '<div class="lp-mock" aria-hidden="true">'
    +'<div class="lp-mcard"><div class="lp-mhead"><div><div class="lp-meyebrow">Safety file</div><div class="lp-mtitle">Plant 2 Expansion</div><div class="lp-msub">Volt Electrical · 18 of 20 in</div></div>'
    +'<div class="lp-gauge"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" stroke-opacity=".15" stroke-width="4"/><circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="87.7 97.4" stroke-linecap="round" transform="rotate(-90 18 18)"/></svg><b>90%</b></div></div>'
    + row('Letter of Good Standing', 'Approved', 'ok')
    + row('Risk assessment — MCC upgrade', 'In review', 'rev')
    + row('Medical — S. Nkosi', 'Expires in 12 days', 'warn')
    + row('Fall protection plan', 'Missing', 'bad')
    +'</div>'
    +'<div class="lp-mgate"><div class="lp-mgate-q">'+I.gate+'</div><div><div class="lp-mgate-s">CLEARED</div><div class="lp-msub">Sipho Nkosi · Electrician</div></div></div>'
    +'</div>';
}

/* ---------- the public site: one question per page ---------- */
export const PUBLIC_PAGES = {
  landing: '/', features: '/features', builder: '/safety-file-builder', contractors: '/for-contractors',
  sites: '/for-sites', pricing: '/pricing', how: '/how-it-works', contact: '/contact',
};
export function publicPageFor(path){
  const hit = Object.entries(PUBLIC_PAGES).find(([k, p])=>p===path && k!=='landing');
  return hit ? hit[0] : null;
}
const NAV = [['features','Features'],['builder','Safety File Builder'],['contractors','Contractors'],['sites','Sites & mines'],['pricing','Pricing'],['contact','Contact']];
const go = (page, label, cls) => '<a href="'+PUBLIC_PAGES[page]+'" class="'+(cls||'')+'" data-action="public-go" data-page="'+page+'">'+label+'</a>';
const trial = (label, kind) => '<button class="btn primary" data-action="auth-go" data-view="signup"'+(kind?' data-kind="'+kind+'"':'')+'>'+(label||'Start free trial')+'</button>';

function header(current){
  return '<header class="lp-top"><a href="/" class="brand lp-brand" data-action="public-go" data-page="landing" aria-label="SiteGuard home"><div class="brand-mark"></div><div class="brand-text"><div class="brand-name">SiteGuard</div></div></a>'
    +'<div class="lp-actions"><button class="linkish" data-action="auth-go" data-view="signin">Sign in</button>'+trial('Start free trial')+'</div>'
    +'<nav class="lp-nav" aria-label="Main">'+NAV.map(([k,l])=>go(k, l, 'lp-link'+(current===k?' active':''))).join('')+'</nav></header>';
}
function footer(){
  return '<footer class="lp-foot"><span>SiteGuard</span>'
    +'<span class="lp-foot-links">'+NAV.map(([k,l])=>go(k,l)).join(' · ')+' · '+go('how','How it works')+' · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></span>'
    +'<span>Requirement lists are a starting point, not legal advice. SiteGuard shows the status held in its records; it does not certify legal compliance.</span></footer>';
}
const page = (current, body) => '<div class="lp">'+header(current)+body+footer()+'</div>';
const intro = (eyebrow, title, lead) => '<section class="lp-page-head"><p class="lp-eyebrow">'+eyebrow+'</p><h1>'+title+'</h1>'+(lead?'<p class="lp-lead">'+lead+'</p>':'')+'</section>';
const closing = (title, text) => '<section class="lp-close"><h2>'+title+'</h2><p>'+text+'</p><div class="lp-cta">'+trial()+go('pricing','View pricing','btn secondary')+'</div></section>';
const list = (items) => '<ul class="lp-list">'+items.map(x=>'<li>'+tick+'<span>'+x+'</span></li>').join('')+'</ul>';

export function renderPublic(name, features, ctx){
  const f = features || {};
  switch(name){
    case 'features': return page(name, featuresPage());
    case 'builder': return page(name, builderPage());
    case 'contractors': return page(name, contractorsPage());
    case 'sites': return page(name, sitesPage());
    case 'pricing': return page(name, pricingPage(ctx && ctx.pricing));
    case 'how': return page(name, howPage());
    case 'contact': return page(name, contactPage(f.contact || {}, ctx || {}));
    default: return renderLanding(f);
  }
}

function featureGrid(){
  const feat = (icon, title, text) => '<div class="lp-feat"><div class="lp-feat-ic">'+icon+'</div><h3>'+title+'</h3><p>'+text+'</p></div>';
  return '<div class="lp-grid">'
    + feat(I.file, 'Safety File Builder', 'Pick a site or client, see every document it needs, reuse what you have, create the rest, and compile one professional PDF.')
    + feat(I.pen, 'Document Studio', 'Risk assessments, method statements, policies and appointment letters, branded as yours, in PDF and Word, for you to check and sign.')
    + feat(I.check, 'Requirements that make sense', 'Starter lists for mines and construction, each marked as a legal, site or best-practice requirement, and required or optional.')
    + feat(I.audit, 'Review and approval', 'Sites review section by section, ask for changes, and mark Site Ready with a verification code.')
    + feat(I.gate, 'Gate clearance', 'Each worker is cleared only with a valid medical and induction, on a file that is approved.')
    + feat(I.bell, 'Nothing expires quietly', 'Reminders at the days you choose, and a compliance agent that tells the right person what needs attention.')
    + feat(I.share, 'Share securely', 'Expiring links for auditors and clients, and individual documents or a merged PDF for the site.')
    + feat(I.shield, 'Built for POPIA', 'Every company sees only its own data. ID numbers are never stored in full. Every action is logged.')
    + '</div>';
}

function featuresPage(){
  return intro('Features', 'Everything a safety file needs, in one place.', 'SiteGuard covers the whole life of a safety file: what is required, the documents themselves, review, the people on site, and keeping it all current.')
    + '<section class="lp-feats">'+featureGrid()+'</section>'
    + '<section class="lp-sides"><div class="lp-side"><h2>On site</h2>'+list(['Toolbox talks, inductions and training signed on one phone or tablet', 'Tools and equipment that add their hazards, checks and PPE to talks and risk assessments', 'Permits to work, incidents, a site diary and inspections', 'Monthly contractor audits with findings tracked to closure'])+'</div>'
    + '<div class="lp-side"><h2>In the office</h2>'+list(['A document library you file once and reuse on every safety file', 'SiteGuard Assistant answers questions from your own records', 'An append-only audit trail of who did what, and when', 'Download all your data at any time'])+'</div></section>'
    + closing('See it with your own files.', 'Every account starts with 14 days of the full product. No card needed.');
}

function builderPage(){
  const steps = [
    ['Choose the site or client', 'A site on SiteGuard (type its code) or a client who isn\'t. Each safety file belongs to one site or project.'],
    ['See what it needs', 'Every required and optional document, grouped and explained. Sites set their own lists; starter lists help you begin.'],
    ['Reuse what you already have', 'Company documents are filed once. SiteGuard offers them to every file, so nothing is uploaded twice.'],
    ['Create what is missing', 'Document Studio drafts risk assessments, method statements, plans and appointment letters from your answers, with AI help where it is switched on.'],
    ['Review and edit', 'Every draft is yours to check, change and sign. Nothing is treated as final until a person approves it.'],
    ['Check readiness', 'Before you build the PDF, SiteGuard shows what is present, what is waiting for review, what expires soon and what is missing.'],
    ['Preview, build and share', 'One bound PDF with a cover, contents, section dividers and page numbers. Download it, send a secure link, or submit it to the site.'],
  ];
  return intro('Safety File Builder', 'From blank page to a professional safety file.', 'The Safety File Builder walks you through every document a site or client needs — and tells you exactly what is still outstanding.')
    + '<section class="lp-how"><ol class="lp-steps">'+steps.map((x,i)=>'<li><b>'+(i+1)+'</b><div><h3>'+x[0]+'</h3><p>'+x[1]+'</p></div></li>').join('')+'</ol></section>'
    + '<section class="lp-note"><h2>What SiteGuard does not do</h2><p>SiteGuard does not certify that a file is legally compliant, and it is not legal advice. Requirement lists show whether each item is a legal, site or best-practice requirement so you can check them with your SHE advisor. Drafts must be reviewed and signed by a competent person.</p></section>'
    + closing('Build your first safety file.', 'Start a 14-day trial, choose a site or client, and follow the steps.');
}

function contractorsPage(){
  return intro('For contractors', 'Your documents, your safety files, every site.', 'SiteGuard is your company\'s own document and safety file platform. Build files for every client — mines, construction companies and private clients — from one library.')
    + '<section class="lp-sides"><div class="lp-side"><h2>What you can create</h2>'+list(['Site-specific risk assessments and method statements, with the tools you use', 'Health and safety plans, policies and safe work procedures', 'Statutory appointment letters and registers', 'Toolbox talk, induction and training records signed on site', 'Complete, bound safety files for each site or client'])+'</div>'
    + '<div class="lp-side"><h2>Who pays?</h2><p class="lp-p">You subscribe to SiteGuard for your own company. That covers every safety file you build, for any client.</p><p class="lp-p">When a mine or site on SiteGuard invites you, it may <strong>sponsor</strong> your file for its site. A sponsorship covers that one site\'s requirements and safety file. Files for other clients need your own plan.</p>'+go('pricing','See contractor plans','btn secondary small')+'</div></section>'
    + closing('Start building today.', 'Every account starts with 14 days of the full product. No card needed.');
}

function sitesPage(){
  return intro('For sites and mines', 'Know which contractors are ready to work — today.', 'Set what every contractor\'s safety file must contain, review what they submit, and see who is cleared at the gate.')
    + '<section class="lp-sides"><div class="lp-side"><h2>What you can do</h2>'+list(['Define your requirements per site: required or optional, legal, site or best practice', 'Share one site code; each contractor gets its own file for your site', 'Review documents section by section, request updates, and mark Site Ready', 'Pick contractor documents and download them one by one or as one merged PDF', 'Gate clearance with QR cards, inductions, toolbox talks, audits, permits and incidents'])+'</div>'
    + '<div class="lp-side"><h2>Sponsored contractor access</h2><p class="lp-p">Your subscription lets the contractors you invite complete your site\'s requirements without paying — that is a <strong>sponsorship</strong>. It covers your site\'s file only, and you can end or resume it at any time.</p><p class="lp-p">You can see and download the documents contractors submit to your site. You cannot edit or delete a contractor\'s own documents.</p>'+go('pricing','See site plans','btn secondary small')+'</div></section>'
    + closing('Set up your first site.', 'It takes about ten minutes. Every account starts with a 14-day trial.');
}

function howPage(){
  return intro('How it works', 'One platform for contractors and the sites they work on.', '')
    + '<section class="lp-sides"><div class="lp-side"><p class="lp-eyebrow">Contractors</p><ol class="lp-olist"><li>Create your account and company profile.</li><li>File your company documents once.</li><li>Create a safety file for a site (with its code) or for your own client.</li><li>Fill the gaps with Document Studio, check readiness, and send or submit the PDF.</li><li>Keep it current: reminders tell you before anything expires.</li></ol></div>'
    + '<div class="lp-side"><p class="lp-eyebrow">Sites and mines</p><ol class="lp-olist"><li>Create a site and choose what every safety file must contain.</li><li>Share the site code or invite contractors by email.</li><li>Review submissions in one queue; ask for updates where needed.</li><li>Mark files Site Ready and clear workers at the gate.</li><li>Run inductions, toolbox talks, audits and permits on the same record.</li></ol></div></section>'
    + '<section class="lp-note"><h2>Who pays for what</h2><p>Contractors subscribe for their own company and safety files. Sites and mines subscribe to manage contractor compliance, and sponsor their contractors\' files for their own sites. Everyone starts with a 14-day trial of the full product; when it ends nothing is deleted, and you choose a plan to keep working.</p></section>'
    + closing('Try it with a real site or client.', 'Start the trial and build one safety file end to end.');
}

const rands = (c)=> 'R'+Math.round(c/100).toLocaleString('en-ZA');
function pricingPage(pricing){
  const head = intro('Pricing', 'Simple plans for contractors and for sites.', 'Every account starts with 14 days of the full product. No card needed. When the trial ends nothing is deleted.');
  if(!pricing) return head + '<section class="lp-feats"><div class="empty"><p>Loading prices…</p></div></section>';
  if(pricing.error) return head + '<section class="lp-feats"><div class="empty"><p>Prices couldn\'t load. Please try again, or contact us.</p></div></section>';
  const card = (p) => '<div class="lp-price"><h3>'+p.name+'</h3><div class="lp-amount">'+(p.priceCents===null ? 'Contact us' : rands(p.priceCents)+'<span> / '+p.per+'</span>')+'</div>'
    + '<p class="lp-p">'+p.blurb+'</p>'+list(p.highlights)
    + (p.priceCents===null ? go('contact','Talk to us','btn secondary block') : trial('Start free trial', p.kind))+'</div>';
  const group = (kind, title, sub) => { const ps = pricing.plans.filter(p=>p.kind===kind); return ps.length ? '<section class="lp-feats"><h2>'+title+'</h2><p class="lp-p">'+sub+'</p><div class="lp-prices">'+ps.map(card).join('')+'</div></section>' : ''; };
  return head
    + group('contractor', 'Contractors', 'Your own company account: build and manage safety files for every client.')
    + group('host', 'Sites and mines', 'Manage contractor compliance, and sponsor your contractors\' files for your own sites.')
    + '<section class="lp-note"><h2>Good to know</h2>'+list([
        'A site\'s sponsorship covers your file for that site only. Files for other clients need your own contractor plan.',
        'Safety files are often bought or compiled one job at a time. A subscription covers every file you build while it runs.',
        'Plans are billed monthly. You can change or cancel your plan at any time; your data stays readable.',
        'Prices are shown in South African rand. The price for your plan is confirmed at checkout.'])+'</section>'
    + closing('Start with the full product.', 'Fourteen days, every feature, no card.');
}

function contactPage(c, ctx){
  return intro('Contact', 'Talk to the SiteGuard team.', 'Most people get going on their own with the trial. If you have a question, need help, or want SiteGuard for a group of sites, get in touch.')
    + '<section class="lp-sides"><div class="lp-side"><h2>Reach us</h2>'
    + (c.email ? '<p class="lp-p">Email: <a href="mailto:'+c.email+'">'+c.email+'</a></p>' : '')
    + (c.phone ? '<p class="lp-p">Phone: <a href="tel:'+c.phone.replace(/[^+0-9]/g,'')+'">'+c.phone+'</a></p>' : '')
    + (!c.email && !c.phone ? '<p class="lp-p">Use the form and we\'ll reply by email.</p>' : '')
    + '<p class="lp-p">Already a customer? Use <strong>Report a problem</strong> in the app\'s More menu so we can see the screen you were on.</p></div>'
    + '<div class="lp-side">'+(ctx.sent ? '<h2>Thank you</h2><p class="lp-p">Your message is with us. We\'ll reply to the email address you gave.</p>' :
      '<h2>Send an enquiry</h2>'
      + (ctx.error ? '<div class="notice alert-red">'+ctx.error+'</div>' : '')
      + '<label class="field-label" for="ctName">Name</label><input type="text" id="ctName" maxlength="200" autocomplete="name">'
      + '<label class="field-label" for="ctEmail">Email</label><input type="email" id="ctEmail" maxlength="200" autocomplete="email">'
      + '<label class="field-label" for="ctPhone">Phone (optional)</label><input type="tel" id="ctPhone" maxlength="40" autocomplete="tel">'
      + '<label class="field-label" for="ctCompany">Company (optional)</label><input type="text" id="ctCompany" maxlength="200" autocomplete="organization">'
      + '<label class="field-label" for="ctTopic">About</label><select id="ctTopic"><option value="general">A general question</option><option value="help">Help using SiteGuard</option><option value="sales">Plans for my company or sites</option><option value="enterprise">Enterprise / group of sites</option><option value="partnership">Partnership</option></select>'
      + '<label class="field-label" for="ctMessage">Message</label><textarea id="ctMessage" maxlength="4000" style="min-height:120px;"></textarea>'
      + '<div class="hp" aria-hidden="true"><label for="ctWebsite">Leave this empty</label><input type="text" id="ctWebsite" tabindex="-1" autocomplete="off"></div>'
      + '<button class="btn primary block" style="margin-top:12px;" data-action="contact-send">Send</button>')+'</div></section>';
}

export function renderLanding(features){
  const demo = features && features.demo;
  return page('landing', ''
    +'<section class="lp-hero"><div class="lp-hero-text">'
    +'<p class="lp-eyebrow">Safety files and contractor compliance · South Africa</p>'
    +'<h1>Build, manage and prove your safety files — for every site.</h1>'
    +'<p class="lp-lead">SiteGuard is where contractors keep their safety documents, create what is missing and build a professional safety file for each site or client. Mines and sites use it to set requirements, review files and see who is cleared to work.</p>'
    +'<div class="lp-cta">'+trial('Start free trial')+'<button class="btn secondary" data-action="auth-go" data-view="signup" data-kind="contractor">Build a safety file</button>'
    +(demo?'<button class="btn secondary" data-action="start-demo" data-tour="1">Watch the 2-minute tour</button>':'')+'</div>'
    +'<p class="lp-sub-links">'+go('how','See how it works')+' · '+go('pricing','View pricing')+' · '+go('contact','Contact us')+'</p>'
    +'<ul class="lp-proof"><li>'+tick+'14-day trial of everything, no card</li><li>'+tick+'Works on any phone</li><li>'+tick+'You see only your own data</li></ul>'
    +'</div>'+mock()+'</section>'
    +'<section class="lp-sides"><div class="lp-side"><p class="lp-eyebrow">For contractors</p><h2>Build a professional safety file in minutes.</h2>'
      +list(['Keep your company documents once and reuse them on every site', 'Document Studio drafts the risk assessments, method statements and policies you don\'t have yet', 'One bound PDF with a cover, contents and page numbers, versioned as it changes', 'Files for mines on SiteGuard and for any other client'])
      +'<div class="lp-cta">'+go('contractors','For contractors','btn secondary small')+go('builder','How the builder works','linkish')+'</div></div>'
    +'<div class="lp-side"><p class="lp-eyebrow">For mines and sites</p><h2>Know who is ready to work, today.</h2>'
      +list(['Set what every safety file must contain, from researched South African starter lists', 'Share one site code; every contractor gets its own file for your site', 'Review section by section, then mark Site Ready with a verification code', 'Gate clearance with QR cards, inductions, audits, permits and incidents'])
      +'<div class="lp-cta">'+go('sites','For sites and mines','btn secondary small')+'</div></div></section>'
    +'<section class="lp-how"><h2>How the Safety File Builder works</h2><ol>'
      +'<li><b>1</b><div><h3>Choose the site or client</h3><p>Type a site\'s code, or start a file for a client who isn\'t on SiteGuard.</p></div></li>'
      +'<li><b>2</b><div><h3>Fill the gaps</h3><p>Reuse your company documents, upload certificates, and let SiteGuard draft the rest for you to check.</p></div></li>'
      +'<li><b>3</b><div><h3>Check, build, send</h3><p>See exactly what is outstanding, preview the file, then download it, share a link or submit it.</p></div></li></ol></section>'
    +'<section class="lp-note"><h2>Who pays?</h2><p><strong>Contractors</strong> subscribe for their own company and every safety file they build. <strong>Sites and mines</strong> subscribe to manage contractor compliance, and can sponsor their contractors\' files for their own sites. A sponsorship covers that site only.</p><div class="lp-cta">'+go('pricing','View pricing','btn secondary small')+'</div></section>'
    +'<section class="lp-feats"><h2>Everything a safety file needs</h2>'+featureGrid()+'</section>'
    + closing('Start with your next safety file.', 'Set-up takes about ten minutes. Every account starts with a 14-day trial of the full product.'));
}
