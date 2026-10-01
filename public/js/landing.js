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

export function renderLanding(features){
  const demo = features && features.demo;
  const feat = (icon, title, text) => '<div class="lp-feat"><div class="lp-feat-ic">'+icon+'</div><h3>'+title+'</h3><p>'+text+'</p></div>';
  return '<div class="lp">'
    // header
    +'<header class="lp-top"><div class="brand"><div class="brand-mark"></div><div class="brand-text"><div class="brand-name">SiteGuard</div></div></div>'
    +'<nav class="lp-nav"><button class="linkish" data-action="auth-go" data-view="signin">Sign in</button><button class="btn primary small" data-action="auth-go" data-view="signup">Get started</button></nav></header>'
    // hero
    +'<section class="lp-hero"><div class="lp-hero-text">'
    +'<p class="lp-eyebrow">Contractor compliance for South African sites</p>'
    +'<h1>Every contractor\'s safety file, ready before they reach the gate.</h1>'
    +'<p class="lp-lead">SiteGuard is where mines, sites and their contractors build, vet and prove safety files. It shows what\'s required, what\'s in, what\'s expiring and who is cleared to work, without chasing paper or email.</p>'
    +'<div class="lp-cta"><button class="btn primary" data-action="auth-go" data-view="signup">Create a free account</button>'
    +(demo?'<button class="btn secondary" data-action="start-demo" data-tour="1">Watch the 2-minute tour</button>':'')+'</div>'
    +'<ul class="lp-proof"><li>'+tick+'Free for contractors</li><li>'+tick+'14-day trial for sites, no card</li><li>'+tick+'Works on any phone</li></ul>'
    +'</div>'+mock()+'</section>'
    // two sides
    +'<section class="lp-sides"><div class="lp-side"><p class="lp-eyebrow">For mines and sites</p><h2>Know who is ready to work, today.</h2><ul>'
      +'<li>'+tick+'Set what every safety file must contain, starting from researched MHSA and Construction Regulations lists</li>'
      +'<li>'+tick+'Share one site code; every contractor gets its own file</li>'
      +'<li>'+tick+'Review documents section by section, then mark Site Ready with a verification code</li>'
      +'<li>'+tick+'Gate clearance with QR cards, monthly audits, permits and incidents</li></ul>'
      +'<button class="btn secondary small" data-action="auth-go" data-view="signup" data-kind="host">Set up a site</button></div>'
    +'<div class="lp-side"><p class="lp-eyebrow">For contractors</p><h2>Build a professional safety file in minutes.</h2><ul>'
      +'<li>'+tick+'Keep your company documents once and reuse them on every site</li>'
      +'<li>'+tick+'Document Studio writes the risk assessments, method statements and policies you don\'t have yet</li>'
      +'<li>'+tick+'One bound PDF with a cover, contents and page numbers, versioned as it changes</li>'
      +'<li>'+tick+'Working for a client who isn\'t on SiteGuard? Build their file as a project and send them a link</li></ul>'
      +'<button class="btn secondary small" data-action="auth-go" data-view="signup" data-kind="contractor">Join free as a contractor</button></div></section>'
    // how it works
    +'<section class="lp-how"><h2>How it works</h2><ol>'
      +'<li><b>1</b><div><h3>The site sets the standard</h3><p>Tick the documents every contractor must provide and share the site code.</p></div></li>'
      +'<li><b>2</b><div><h3>Contractors build their file</h3><p>Reuse company documents, let SiteGuard draft the rest, add workers and medicals.</p></div></li>'
      +'<li><b>3</b><div><h3>Vet, approve, clear the gate</h3><p>Review in one queue, mark Site Ready, and let security scan gate cards. Expiries are flagged before they lapse.</p></div></li></ol></section>'
    // features
    +'<section class="lp-feats"><h2>Everything a safety file needs</h2><div class="lp-grid">'
      + feat(I.file, 'Requirements that make sense', 'Starter lists for mines and construction, each labelled as a legal, site or best-practice requirement.')
      + feat(I.pen, 'Document Studio', 'Risk assessments, method statements, policies and appointment letters, branded as yours, in PDF and Word.')
      + feat(I.check, 'Page-by-page review', 'Approve sections, highlight what needs changing, and keep approvals when only one part changes.')
      + feat(I.gate, 'Gate clearance', 'Each worker is cleared only with a valid medical and induction, on a file that\'s approved.')
      + feat(I.audit, 'Site audits', 'A scored checklist with findings tracked until they\'re fixed and closed.')
      + feat(I.bell, 'Nothing expires quietly', 'A compliance agent checks every file and tells the right person what needs attention.')
      + feat(I.share, 'Share securely', 'Expiring links for auditors and clients, and public verification codes for Site Ready.')
      + feat(I.shield, 'Built for POPIA', 'Every company sees only its own data. ID numbers are never stored in full. Every action is logged.')
    +'</div></section>'
    // closing
    +'<section class="lp-close"><h2>Start with your next contractor.</h2><p>Set up takes about ten minutes. You can invite your team and your contractors as you go.</p>'
    +'<div class="lp-cta"><button class="btn primary" data-action="auth-go" data-view="signup">Create a free account</button>'
    +(demo?'<button class="btn secondary" data-action="start-demo">Explore the demo</button>':'')
    +'<button class="linkish" data-action="auth-go" data-view="signin">I already have an account</button></div></section>'
    +'<footer class="lp-foot"><span>SiteGuard</span><span>Requirement lists are a starting point, not legal advice. SiteGuard shows the status held in its records; it does not certify legal compliance.</span><span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></span></footer>'
    +'</div>';
}
