// COMVERA interactive walkthrough (public/walkthrough.html, served at /walkthrough).
// One page, nine chapters. Every interactive piece reads one state object, so what a
// visitor does in the workflow demo shows up again in the issue, outcome and value
// chapters. Nothing here talks to the server or touches real records: the companies,
// people and documents are fictional, and the screens are simplified illustrations of
// COMVERA's real workflow (requirements, statuses, review and send-back, requests,
// expiry and validity rules, activity history).

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ================= content ================= */

const CHAPTERS = [
  { id: 'intro', n: 'Intro', t: 'Start here' },
  { id: 'problem', n: '01', t: 'The problem' },
  { id: 'process', n: '02', t: 'Current process' },
  { id: 'meet', n: '03', t: 'Meet COMVERA' },
  { id: 'workflow', n: '04', t: 'The workflow' },
  { id: 'issue', n: '05', t: 'Handle an issue' },
  { id: 'outcome', n: '06', t: 'The outcome' },
  { id: 'value', n: '07', t: 'Business value' },
  { id: 'next', n: '08', t: 'Next step' },
];

const SOURCES = [
  {
    id: 'email', label: 'Email', sub: '14 messages in one thread', ic: 'ic-mail', head: 'Inbox · RE: RE: FW: Safety file — Shaft 3 conveyor',
    body: `<div class="mail-meta"><span><b>From:</b> Naledi Khumalo, Highveld Mining Group</span><span><b>To:</b> Johan Pretorius, Voltrix Electrical</span><span><b>Date:</b> Thursday, 16:42</span></div>
      <p>Hi Johan,</p><p style="margin-top:8px">Thanks for the files. Before Monday's induction we still need the method statement for the rewire, the updated Working at Heights records, and Sipho's medical. Can you send the latest versions?</p>
      <p class="mail-quote">On Tuesday, Johan wrote: “Attached the risk assessment (final) and the COID letter. Thabo is doing the method statement…”</p>`,
    insight: '<b>The request was sent.</b> But nothing shows whether the person responsible has started, or which of the attachments are the latest.',
  },
  {
    id: 'chat', label: 'WhatsApp', sub: 'Site office group', ic: 'ic-chat', head: 'Site office · 23 members',
    body: `<div class="chat"><p>Is Sipho's medical the new one? Gate won't let him in<small>Security · 06:12</small></p>
      <p class="me">Sent it last week I think 🤔<small>Johan · 06:40</small></p>
      <p>Which email? Can you resend<small>Security · 06:41</small></p>
      <p class="me">📎 IMG_4471.jpg<small>Johan · 07:05</small></p></div>`,
    insight: '<b>A photo of a certificate arrived.</b> Is it the current one? Will anyone file it where the reviewer can find it next month?',
  },
  {
    id: 'folder', label: 'Shared folder', sub: 'Safety file 2026', ic: 'ic-folder', head: 'Shared drive › Contractors › Voltrix › Safety file 2026',
    body: `<div class="table-scroll"><table class="folder-table"><thead><tr><th>Name</th><th>Modified</th><th>By</th></tr></thead><tbody>
      <tr><td>Risk_Assessment_FINAL.pdf</td><td>12 Feb</td><td>Johan</td></tr>
      <tr><td>Risk_Assessment_FINAL_v2 (1).pdf</td><td>3 Mar</td><td>Thabo</td></tr>
      <tr><td>Risk Assessment - Shaft 3 REVISED.docx</td><td>28 Sep</td><td>Johan</td></tr>
      <tr><td>WAH_certs_scan.jpg</td><td>2025</td><td>Office</td></tr>
      <tr><td>Medical_Sipho_old?.pdf</td><td>Aug 2025</td><td>Office</td></tr></tbody></table></div>`,
    insight: '<b>You found the risk assessment.</b> Three of them. Can you tell which version the mine actually approved?',
  },
  {
    id: 'sheet', label: 'Tracker spreadsheet', sub: 'Tracker.xlsx', ic: 'ic-sheet', head: 'Tracker.xlsx · last edited 9 days ago',
    body: `<div class="table-scroll"><table class="sheet-table"><thead><tr><th>Document</th><th>Status</th><th>Who</th><th>Expiry</th></tr></thead><tbody>
      <tr><td>COID letter</td><td>✓</td><td>Office</td><td>Mar 2027</td></tr>
      <tr><td>Risk assessment</td><td>sent</td><td>Johan</td><td></td></tr>
      <tr><td>Method statement</td><td class="q">asked Thabo?</td><td></td><td></td></tr>
      <tr><td>Heights training</td><td class="q">??</td><td></td><td class="q">check</td></tr>
      <tr><td>Medicals</td><td>sent</td><td>Johan</td><td></td></tr></tbody></table></div>`,
    insight: '<b>The tracker is only as current as the last person who updated it.</b> “Sent” doesn\'t say whether it was received, checked or accepted.',
  },
  {
    id: 'missing', label: 'The requirement', sub: 'What the site asked for', ic: 'ic-alert', head: 'Highveld Mining · Contractor requirements (PDF, page 4 of 11)',
    body: `<p><b>4.7 Working at heights.</b> All persons working at heights shall hold a current Working at Heights certificate. Copies must be submitted before access is granted.</p>
      <p style="margin-top:10px">Lerato Nkosi's certificate, from the folder: <b>valid until 30 September 2026</b>.</p>
      <p class="rule">Today in this example is 9 October 2026. It expired nine days ago, and nothing flagged it.</p>`,
    insight: '<b>The requirement was always there,</b> in a PDF. Checking every certificate against it is a manual job, every time.',
  },
];

const FLOW = [
  { l: 'Request received', what: 'The site emails its contractor requirements, often as a PDF and a list in the email body.', who: 'Site SHE officer, contractor admin', info: 'The requirements document, the job scope, start date', delay: 'Requirements arrive in a long PDF; different people read different versions.', cons: 'The contractor starts collecting against an incomplete list.' },
  { l: 'Documents collected', what: 'The contractor gathers company documents, job documents and worker certificates from colleagues and folders.', who: 'Contractor admin, supervisors, workers', info: 'Policies, risk assessments, certificates, appointments', delay: 'Documents live on different laptops and phones.', cons: 'Old copies get sent because they were easiest to find.', tag: 'delay' },
  { l: 'Checked manually', what: 'Someone compares each document against the requirement list, by eye.', who: 'Site SHE officer', info: 'The list, every attachment, expiry dates', delay: 'Checking depends on one person having time.', cons: 'Expiry dates and missing signatures are easy to miss.', tag: 'delay' },
  { l: 'Missing items discovered', what: 'Gaps show up: a missing method statement, an expired certificate.', who: 'Site SHE officer', info: 'Which items are missing or out of date', delay: 'Often found days later, close to the start date.', cons: 'The file goes back to the collection stage.', tag: 'loop' },
  { l: 'Follow-up requests sent', what: 'Emails and messages go out asking for the missing or updated documents.', who: 'Site SHE officer, contractor admin', info: 'What is still needed, from whom, by when', delay: 'Requests sit in inboxes; nobody can see who is acting on them.', cons: 'The same item gets chased several times.', tag: 'delay' },
  { l: 'Documents updated', what: 'New versions are sent by email, WhatsApp or a shared link.', who: 'Contractor admin, workers', info: 'The new versions', delay: 'Files arrive in different channels with similar names.', cons: 'The reviewer can\'t easily tell which copy replaces which.' },
  { l: 'Status checked again', what: 'The tracker is updated and the whole file is checked again.', who: 'Site SHE officer', info: 'The tracker, every new attachment', delay: 'Each round repeats work already done.', cons: 'Another gap found means another round.', tag: 'loop' },
  { l: 'File submitted for review', what: 'The complete file goes to whoever approves contractor access.', who: 'Site management', info: 'The full set of documents', delay: 'The approver has to trust the tracker.', cons: 'Work starts late, or starts with a gap nobody saw.' },
];
// The process plays through twice: a second gap sends it back after the re-check.
const FLOW_RUN = [0, 1, 2, 3, 4, 5, 6, 3, 4, 5, 6, 7];

const BASE_DOCS = [
  { id: 'coid', name: 'Letter of Good Standing (COID)', src: 'legal', srcLabel: 'Legal · COID Act', group: 'Company documents', status: 'complete', version: 'v2.0', expiry: '31 Mar 2027', by: 'Johan Pretorius, 2 Sep' },
  { id: 'insurance', name: 'Public liability insurance (R5m)', src: 'client', srcLabel: 'Client', group: 'Company documents', status: 'complete', version: 'v1.0', expiry: '28 Feb 2027', by: 'Johan Pretorius, 2 Sep' },
  { id: 'policy', name: 'Health & Safety policy', src: 'legal', srcLabel: 'Legal · MHSA s7', group: 'Company documents', status: 'complete', version: 'v3.1', expiry: 'Review Jan 2027', by: 'Johan Pretorius, 2 Sep' },
  { id: 'appoint', name: 'Legal appointment letters', src: 'legal', srcLabel: 'Legal', group: 'Company documents', status: 'complete', version: 'v1.0', expiry: '—', by: 'Johan Pretorius, 4 Sep' },
  { id: 'hira', name: 'Baseline risk assessment (HIRA)', src: 'legal', srcLabel: 'Legal · MHSA s11', group: 'Job documents', status: 'awaiting_review', version: 'v1.1', expiry: 'Review Mar 2027', by: 'Thabo Sithole, yesterday' },
  { id: 'method', name: 'Method statement: conveyor rewire', src: 'site', srcLabel: 'Site', group: 'Job documents', status: 'missing', version: '—', expiry: '—', by: '—' },
  { id: 'heights', name: 'Working at Heights training', person: 'Lerato Nkosi', src: 'site', srcLabel: 'Site · 4.7', group: 'People', status: 'expired', version: 'v1.0', expiry: '30 Sep 2026', by: 'Office, Oct 2024' },
  { id: 'medical', name: 'Medical certificate of fitness', person: 'Sipho Dlamini', src: 'site', srcLabel: 'Site rule · 12 months', group: 'People', status: 'awaiting_review', version: 'v1.0', expiry: 'Issued 4 Aug 2025', by: 'Johan Pretorius, today' },
];

const STATUS = {
  complete: 'Complete', awaiting_review: 'Awaiting review', missing: 'Missing', expired: 'Expired',
  correction_required: 'Correction required', requested: 'Update requested',
};
const STATUS_MEANS = {
  complete: 'Approved by the site\'s reviewer and in date.',
  awaiting_review: 'Voltrix submitted it; nobody at the site has checked it yet.',
  missing: 'Nothing has been uploaded for this requirement.',
  expired: 'Approved earlier, but past its expiry date. It no longer counts.',
  correction_required: 'Sent back with a note; waiting for a corrected copy.',
};

const STAGES = [
  { k: 'A', t: 'Open the file' },
  { k: 'B', t: 'Requirements' },
  { k: 'C', t: 'Document status' },
  { k: 'D', t: 'What needs attention' },
  { k: 'E', t: 'Take action' },
  { k: 'F', t: 'Review progress' },
];

const VALUES = [
  { id: 'visibility', t: 'Visibility', s: 'See the state of the file at a glance' },
  { id: 'organisation', t: 'Organisation', s: 'Every document filed against its requirement' },
  { id: 'follow', t: 'Follow-through', s: 'Outstanding items and their next step' },
  { id: 'coordination', t: 'Coordination', s: 'Who did what, and whose move it is' },
];

/* ================= state ================= */

const INITIAL_ACTIVITY = [
  { who: 'Johan Pretorius (Voltrix)', what: 'submitted Medical certificate of fitness — Sipho Dlamini', when: 'today, 07:05' },
  { who: 'Thabo Sithole (Voltrix)', what: 'submitted Baseline risk assessment v1.1', when: 'yesterday, 15:20' },
  { who: 'Compliance agent', what: 'flagged Working at Heights — Lerato Nkosi as expired', when: '1 Oct, 06:00' },
  { who: 'Naledi Khumalo (Highveld)', what: 'approved Letter of Good Standing (COID) v2.0', when: '3 Sep, 10:14' },
];

function freshState() {
  return {
    chapter: 0,
    seen: new Set([0]),
    explored: new Set(),
    source: 'email',
    flowSel: 0,
    flowLit: -1,
    flowDone: new Set(),
    flowTally: null,
    sorted: false,
    sortedOnce: false,
    stage: 0,
    stageDone: new Set(),
    opened: false,
    inspected: new Set(),
    selected: null,
    choice: null,
    docs: Object.fromEntries(BASE_DOCS.map((d) => [d.id, { status: d.status, requested: false, note: '', version: d.version }])),
    activity: INITIAL_ACTIVITY.map((a) => ({ ...a })),
    freshActivity: 0,
    issueChoice: null,
    issueReviewed: false,
    outNew: null,
    compare: 'before',
    value: 'visibility',
    toast: '',
  };
}
let S = freshState();
let flowTimer = null;

const docMeta = (id) => BASE_DOCS.find((d) => d.id === id);
const docLabel = (d) => d.name + (d.person ? ' — ' + d.person : '');
const completeCount = () => BASE_DOCS.filter((d) => S.docs[d.id].status === 'complete').length;
const readiness = () => Math.round((completeCount() / BASE_DOCS.length) * 100);

function nextStepFor(id) {
  const st = S.docs[id];
  if (st.status === 'missing') return 'Waiting for Voltrix to upload it';
  if (st.status === 'awaiting_review') return 'Waiting for your review';
  if (st.status === 'expired') return st.requested ? 'Update requested · waiting for Voltrix' : 'Ask Voltrix for a current copy';
  if (st.status === 'correction_required') return 'Sent back · waiting for Voltrix\'s new copy';
  return '';
}
const outstanding = () => BASE_DOCS.filter((d) => S.docs[d.id].status !== 'complete');
const pill = (status, extra = '') => `<span class="pill ${status}">${esc(STATUS[status] || status)}${extra}</span>`;
const srcPill = (d) => `<span class="srcpill ${d.src === 'legal' ? 'legal' : d.src === 'site' ? 'site' : ''}">${esc(d.srcLabel)}</span>`;

function log(who, what) {
  S.activity.unshift({ who, what, when: 'just now' });
  S.freshActivity = 1;
}
function toast(msg) {
  S.toast = msg;
  const el = $('#demoToast');
  if (el) el.textContent = msg;
}

/* ================= navigation ================= */

function renderNav() {
  $('#wtSteps').innerHTML = CHAPTERS.slice(1).map((c, i) => {
    const idx = i + 1;
    const cls = ['wt-step', S.chapter === idx ? 'current' : '', S.seen.has(idx) ? 'seen' : ''].join(' ');
    return `<button class="${cls}" data-act="goto" data-ch="${idx}" ${S.chapter === idx ? 'aria-current="step"' : ''} aria-label="Chapter ${c.n}: ${esc(c.t)}${S.seen.has(idx) ? ' (seen)' : ''}"><span class="n">${c.n}</span><span class="t">${esc(c.t)}</span></button>`;
  }).join('');
  const c = CHAPTERS[S.chapter];
  $('#wtWhereN').textContent = S.chapter === 0 ? 'Intro' : c.n + ' / 08';
  $('#wtWhereT').textContent = c.t;
  $('#wtProgress').style.width = (S.chapter / (CHAPTERS.length - 1)) * 100 + '%';
  $('[data-act="prev"]').disabled = S.chapter === 0;
  $('[data-act="next"]').disabled = S.chapter === CHAPTERS.length - 1;
}

function goto(idx, focus = true) {
  const c = CHAPTERS[Math.max(0, Math.min(idx, CHAPTERS.length - 1))];
  const el = document.getElementById(c.id);
  if (!el) return;
  el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  if (focus) {
    const h = $('h1, h2', el);
    if (h) { h.setAttribute('tabindex', '-1'); setTimeout(() => h.focus({ preventScroll: true }), reduceMotion() ? 0 : 450); }
  }
}

function watchChapters() {
  const obs = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const idx = Number(e.target.dataset.ch);
      if (S.chapter !== idx || !S.seen.has(idx)) {
        S.chapter = idx;
        S.seen.add(idx);
        renderNav();
        renderDone();
      }
      if (idx === 3 && !S.sorted && !S.sortedOnce) { S.sortedOnce = true; setTimeout(() => setSorted(true), reduceMotion() ? 0 : 500); }
    }
  }, { rootMargin: '-40% 0px -55% 0px' });
  $$('.ch').forEach((s) => obs.observe(s));
}

/* ================= 01 explore ================= */

function renderExplore() {
  $('#exploreTabs').innerHTML = SOURCES.map((s) => `<button class="src" role="tab" id="tab-${s.id}" aria-controls="exploreView" aria-selected="${S.source === s.id}" tabindex="${S.source === s.id ? 0 : -1}" data-act="source" data-id="${s.id}">
      <span class="dot-ic ${s.ic === 'ic-alert' ? '' : s.ic}" style="${s.ic === 'ic-alert' ? 'background:var(--red)' : ''}" aria-hidden="true"></span>
      <span><span class="src-t">${esc(s.label)}</span><span class="src-s">${esc(s.sub)}</span></span>
      ${S.explored.has(s.id) ? '<span class="src-check">Opened</span>' : ''}</button>`).join('');
  const s = SOURCES.find((x) => x.id === S.source);
  $('#exploreView').setAttribute('aria-labelledby', 'tab-' + s.id);
  $('#exploreView').innerHTML = `<div class="mock-head"><span class="dot-ic ${s.ic}" style="${s.ic === 'ic-alert' ? 'background:var(--red)' : ''}" aria-hidden="true"></span>${esc(s.head)}</div>
    <div class="mock-body demo-fade">${s.body}</div>
    <div class="insight"><span class="insight-ic" aria-hidden="true">?</span><p>${s.insight}</p></div>`;
  const n = S.explored.size;
  $('#exploreCount').textContent = n === SOURCES.length ? 'All five opened. Here is the pattern:' : `${n} of ${SOURCES.length} opened. The pattern so far:`;
  $('#problemSummary').classList.toggle('ready', n >= 2);
}

/* ================= 02 flow ================= */

function renderFlow() {
  $('#flowList').innerHTML = FLOW.map((f, i) => {
    const cls = ['flow-node', S.flowLit === i ? 'lit' : '', S.flowDone.has(i) && S.flowLit !== i ? 'done' : ''].join(' ');
    const tag = f.tag === 'loop' ? '<span class="tag tag-loop">Can loop back</span>' : f.tag === 'delay' ? '<span class="tag tag-delay">Delays here</span>' : '';
    return `<li><button class="${cls}" data-act="flow-node" data-i="${i}" aria-pressed="${S.flowSel === i}"><span class="k">${i + 1}</span><span class="l">${esc(f.l)}</span>${tag}</button></li>`;
  }).join('');
  const f = FLOW[S.flowSel];
  $('#flowDetail').innerHTML = `<p class="ch-num">Stage ${S.flowSel + 1} of ${FLOW.length}</p><h3>${esc(f.l)}</h3>
    <dl>
      <div class="fd-row"><dt>What happens</dt><dd>${esc(f.what)}</dd></div>
      <div class="fd-row"><dt>Who's involved</dt><dd>${esc(f.who)}</dd></div>
      <div class="fd-row"><dt>Information</dt><dd>${esc(f.info)}</dd></div>
      <div class="fd-row"><dt>Where it slows</dt><dd>${esc(f.delay)}</dd></div>
      <div class="fd-row"><dt>If it's unclear</dt><dd>${esc(f.cons)}</dd></div>
    </dl>
    ${f.tag === 'loop' ? '<p class="fd-loop">↺ An incomplete item here sends the file back to an earlier stage, and every later stage is repeated.</p>' : ''}`;
  $('#flowTally').textContent = S.flowTally || '';
  $('#flowPlay').textContent = flowTimer ? 'Stop' : S.flowTally ? 'Play again' : 'Play the process';
}

function stopFlow() { clearInterval(flowTimer); flowTimer = null; }
function playFlow() {
  if (flowTimer) { stopFlow(); renderFlow(); return; }
  S.flowDone = new Set(); S.flowTally = null;
  let step = 0, followups = 0, checks = 0, loops = 0;
  const tally = () => `Follow-ups sent: ${followups} · Manual checks: ${checks} · Times sent back: ${loops}`;
  const advance = () => {
    const i = FLOW_RUN[step];
    const prev = step > 0 ? FLOW_RUN[step - 1] : -1;
    if (prev >= 0) S.flowDone.add(prev);
    if (prev > i) loops++;
    if (i === 4) followups++;
    if (i === 2 || i === 6) checks++;
    S.flowLit = i; S.flowSel = i; S.flowTally = tally();
    renderFlow();
    if (prev > i) { const n = $(`.flow-node[data-i="${i}"]`); if (n) n.classList.add('loop'); }
    step++;
    if (step >= FLOW_RUN.length) {
      stopFlow(); S.flowDone.add(i); S.flowLit = -1;
      S.flowTally = tally() + ' · Submitted, after two rounds.';
      renderFlow();
    }
  };
  if (reduceMotion()) {
    while (step < FLOW_RUN.length) {
      const i = FLOW_RUN[step], prev = step > 0 ? FLOW_RUN[step - 1] : -1;
      if (prev > i) loops++; if (i === 4) followups++; if (i === 2 || i === 6) checks++;
      S.flowDone.add(i); step++;
    }
    S.flowSel = 3; S.flowTally = tally() + ' · Submitted, after two rounds.'; renderFlow();
    return;
  }
  advance();
  flowTimer = setInterval(advance, 750);
  renderFlow();
}

/* ================= 03 sorter + overview ================= */

const SORT_CHIPS = [
  { ic: 'ic-mail', raw: '“Thabo is doing the method statement…”', id: 'method', sx: '6%', sy: '8%', rot: '-3deg' },
  { ic: 'ic-folder', raw: 'Risk_Assessment_FINAL_v2 (1).pdf', id: 'hira', sx: '48%', sy: '14%', rot: '2deg' },
  { ic: 'ic-chat', raw: 'IMG_4471.jpg (Sipho medical?)', id: 'medical', sx: '30%', sy: '36%', rot: '-1.5deg' },
  { ic: 'ic-alert', raw: 'WAH cert · L. Nkosi — expired?', id: 'heights', sx: '4%', sy: '58%', rot: '3deg' },
  { ic: 'ic-sheet', raw: 'COID letter ✓ (tracker)', id: 'coid', sx: '52%', sy: '64%', rot: '-2.5deg' },
  { ic: 'ic-folder', raw: 'H&S_Policy_2026.pdf', id: 'policy', sx: '20%', sy: '80%', rot: '1.5deg' },
];

function renderSorter() {
  $('#sorterStage').innerHTML = SORT_CHIPS.map((c, i) => {
    const d = docMeta(c.id);
    const st = S.docs[c.id].status;
    return `<div class="chip" style="--sx:${c.sx}; --sy:${c.sy}; --rot:${c.rot}; --oy:${4 + i * 16}%; --d:${i * 0.07}s">
      <span class="src-ic dot-ic ${c.ic === 'ic-alert' ? '' : c.ic}" style="${c.ic === 'ic-alert' ? 'background:var(--red)' : ''}"></span>
      <span class="nm">${esc(S.sorted ? docLabel(d) : c.raw)}</span>${pill(st).replace('class="pill', 'class="pill st')}</div>`;
  }).join('');
  $('#sorter').classList.toggle('sorted', S.sorted);
  $('#sorterText').textContent = S.sorted
    ? 'Each piece filed against the requirement it answers, with a status anyone can read.'
    : 'The same pieces from the email, the chat, the folder and the tracker…';
  $('#sortBtn').textContent = S.sorted ? 'Show the scattered version' : 'Organise them';
}
function setSorted(v) {
  S.sorted = v;
  $('#sorter').classList.toggle('sorted', v);
  // Swap the wording once the pieces have moved.
  setTimeout(renderSorter, v && !reduceMotion() ? 700 : 0);
}

function overviewHtml(opts = {}) {
  const pct = readiness();
  const counts = { complete: 0, awaiting_review: 0, missing: 0, expired: 0, correction_required: 0 };
  BASE_DOCS.forEach((d) => { counts[S.docs[d.id].status]++; });
  const out = outstanding();
  const file = `<div class="ov-file ${opts.lit === 'file' ? 'lit' : opts.lit ? 'dimmed' : ''}">
      <div class="ov-file-head"><div class="ring" style="--p:${pct}"><b>${pct}%</b></div>
        <div><h4>Voltrix Electrical Contractors</h4><p class="sub">Leeuwpan Colliery — Shaft 3 Conveyor Rewire · starts Monday</p></div></div>
      <div class="ov-counts">${Object.entries(counts).filter(([, n]) => n).map(([k, n]) => pill(k, ` · ${n}`)).join('')}</div>
      <p class="sub" style="font-size:12.5px;color:var(--grey);margin-top:10px">${completeCount()} of ${BASE_DOCS.length} requirements complete. Site Ready can be given only when every one is.</p></div>`;
  const attn = `<div class="ov-attn ${opts.lit === 'attn' ? 'lit' : opts.lit ? 'dimmed' : ''}"><h4>Needs attention <span class="count">${out.length}</span></h4>
      ${out.length ? out.map((d) => `<div class="attn-item">${pill(S.docs[d.id].status)}<span><b>${esc(docLabel(d))}</b><span class="who">${esc(nextStepFor(d.id))}</span></span></div>`).join('') : '<p class="attn-empty">Nothing outstanding.</p>'}</div>`;
  return `<div class="ov">${file}${attn}</div>`;
}
function renderMeet() { $('#meetOverview').innerHTML = overviewHtml(); }

/* ================= 04 workflow demo ================= */

function renderStepper() {
  $('#stepper').innerHTML = STAGES.map((s, i) => `<li><button data-act="stage" data-s="${i}" class="${S.stageDone.has(i) ? 'done' : ''}" ${S.stage === i ? 'aria-current="step"' : ''}><span class="s-k">${S.stageDone.has(i) && S.stage !== i ? '✓' : s.k}</span>${esc(s.t)}</button></li>`).join('');
}

function reqTable(mode) {
  const rows = BASE_DOCS.map((d) => {
    const st = S.docs[d.id];
    const clickable = mode === 'status';
    const cls = [clickable ? 'clickable' : '', S.selected === d.id && mode === 'status' ? 'sel' : '', mode === 'attention' && d.id === 'heights' ? 'hl' : ''].join(' ');
    const name = clickable
      ? `<button class="req-btn" data-act="doc" data-id="${d.id}"><span class="req-name">${esc(d.name)}</span>${d.person ? `<span class="req-who">${esc(d.person)}</span>` : ''}</button>`
      : `<span class="req-name">${esc(d.name)}</span>${d.person ? `<span class="req-who">${esc(d.person)}</span>` : ''}`;
    const statusCell = mode === 'requirements'
      ? '<td class="hide-sm"><span class="req-who">Voltrix uploads · you review</span></td>'
      : `<td>${pill(st.status)}${st.requested && st.status === 'expired' ? ' <span class="pill requested">Update requested</span>' : ''}</td>`;
    return `<tr class="${cls}" ${clickable ? `data-act="doc" data-id="${d.id}"` : ''}><td>${name}</td><td class="hide-sm">${srcPill(d)}</td>${statusCell}</tr>`;
  }).join('');
  return `<div class="table-scroll"><table class="req-table"><thead><tr><th>Requirement</th><th class="hide-sm">Source</th><th${mode === 'requirements' ? ' class="hide-sm"' : ''}>${mode === 'requirements' ? 'Who' : 'Status'}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function drawerHtml(id) {
  if (!id) return '<div class="drawer"><p class="drawer-empty">Select a document to inspect its status.</p></div>';
  const d = docMeta(id), st = S.docs[id];
  return `<div class="drawer demo-fade"><h4>${esc(d.name)}</h4>${d.person ? `<p class="req-who">${esc(d.person)}</p>` : ''}
    <div class="doc-thumb">${st.status === 'missing' ? 'No file yet' : esc(d.id + '_' + st.version + '.pdf')}</div>
    <div class="kv"><span>Status</span><span>${pill(st.status)}</span></div>
    <div class="kv"><span>Means</span><span>${esc(STATUS_MEANS[st.status])}</span></div>
    <div class="kv"><span>Version</span><span>${esc(st.version)}</span></div>
    <div class="kv"><span>Expiry</span><span>${esc(d.expiry)}</span></div>
    <div class="kv"><span>Submitted by</span><span>${esc(d.by)}</span></div>
    <div class="kv"><span>Required by</span><span>${srcPill(d)}</span></div></div>`;
}

function activityHtml(n = 5) {
  return `<ul class="activity">${S.activity.slice(0, n).map((a, i) => `<li class="${i < S.freshActivity ? 'new' : ''}"><span class="dot" aria-hidden="true"></span><span><b>${esc(a.who)}</b> ${esc(a.what)}<span class="who"> · ${esc(a.when)}</span></span></li>`).join('')}</ul>`;
}

const COACH = [
  { hint: 'Step A', text: 'Open Voltrix\'s safety file for the Shaft 3 job. Each contractor has one file per site, holding everything that site asked for.' },
  { hint: 'Step B', text: 'These are the site\'s requirements for this job. Each one says where it comes from: the law, the client, or a site rule. They are examples; every site sets its own list.' },
  { hint: 'Step C', text: 'Select a document to inspect its status. Each status means one specific thing, so nobody has to guess.' },
  { hint: 'Step D', text: 'One item needs your attention before Monday. The file says what is wrong, why it matters and whose move it is.' },
  { hint: 'Step E', text: 'How would you like to proceed? Choose an action and watch the file change.' },
  { hint: 'Step F', text: 'Follow the item to the end: Voltrix uploads a current certificate, you check it, and the file updates.' },
];

function renderDemo() {
  renderStepper();
  const body = $('#demoBody');
  const crumbs = ['COMVERA · Sites', 'COMVERA · Shaft 3 Conveyor Rewire · Voltrix', 'COMVERA · Shaft 3 · Voltrix · Documents', 'COMVERA · Shaft 3 · Voltrix · Needs attention', 'COMVERA · Shaft 3 · Voltrix · Working at Heights', 'COMVERA · Shaft 3 · Voltrix · Progress'];
  $('#demoCrumb').textContent = crumbs[S.stage];
  let h = '';
  const d = S.docs.heights;

  if (S.stage === 0) {
    const pct = readiness();
    h = `<p class="req-who" style="margin-bottom:12px">Highveld Mining Group · Leeuwpan Colliery — Shaft 3 Conveyor Rewire · 3 contractors</p>
      <button class="site-card ${S.opened ? '' : 'pulse'}" data-act="open-file"><div class="ring" style="--p:${pct}"><b>${pct}%</b></div>
        <div><h4>Voltrix Electrical Contractors</h4><p class="sub">Electrical · starts Monday · ${outstanding().length} items need attention</p></div><span class="chev" aria-hidden="true">›</span></button>
      <div class="site-card dim" aria-hidden="true"><div class="ring" style="--p:100"><b>100%</b></div><div><h4>Ndlovu Rigging</h4><p class="sub">Rigging · Site Ready</p></div></div>
      <div class="site-card dim" aria-hidden="true"><div class="ring" style="--p:38"><b>38%</b></div><div><h4>Kgosi Civils</h4><p class="sub">Civils · starts in 3 weeks</p></div></div>`;
  } else if (S.stage === 1) {
    h = `${reqTable('requirements')}<p class="fine">Requirements depend on the work, the client, the site and the law. A site starts from a researched list and edits it; a new requirement reaches every contractor's file at once.</p>`;
  } else if (S.stage === 2) {
    h = `<div class="demo-split"><div>${reqTable('status')}</div>${drawerHtml(S.selected)}</div>`;
  } else if (S.stage === 3) {
    const meta = docMeta('heights');
    h = `<div class="demo-split"><div>${reqTable('attention')}</div>
      <div class="issue-box"><h4>${pill(d.status)} ${esc(meta.name)}</h4><dl>
        <div><dt>What</dt><dd>Lerato Nkosi's certificate expired on 30 September 2026.</dd></div>
        <div><dt>Why it matters</dt><dd>Site requirement 4.7: everyone working at heights needs a current certificate before access.</dd></div>
        <div><dt>Action needed</dt><dd>A current certificate from Voltrix, then your review.</dd></div>
        <div><dt>Whose move</dt><dd>${d.status === 'complete' ? 'Done — approved.' : d.status === 'awaiting_review' ? 'Yours: review the new copy.' : d.requested ? 'Voltrix\'s: you have asked for a current copy.' : 'Yours first: ask Voltrix for a current copy.'}</dd></div></dl></div></div>`;
  } else if (S.stage === 4) {
    const meta = docMeta('heights');
    const choices = [
      { c: 'open', t: 'Open the document', s: 'See the certificate on file and its dates.' },
      { c: 'request', t: 'Ask Voltrix for an updated copy', s: 'They get an email and a notice in COMVERA.' },
      { c: 'overview', t: 'Return to the overview', s: 'Back to the whole file.' },
    ];
    let detail = '';
    if (S.choice === 'open') {
      detail = `<div class="drawer demo-fade"><h4>${esc(meta.name)} — ${esc(meta.person)}</h4><div class="doc-thumb">heights_LNkosi_2024.pdf · valid until 30 Sep 2026</div>
        <div class="kv"><span>Status</span><span>${pill(d.status)}</span></div><div class="kv"><span>Version</span><span>${esc(d.version)}</span></div>
        <div class="kv"><span>Expiry</span><span>${d.status === 'complete' ? '30 Sep 2028' : '30 Sep 2026'}</span></div></div>`;
    } else if (S.choice === 'request') {
      detail = d.requested
        ? `<div class="outcome good"><h4>Request sent to Voltrix</h4><p>Your note is on the item. It stays <b>Expired</b> until a current certificate is uploaded and approved.</p></div>`
        : `<div class="drawer demo-fade"><div class="note-field"><label for="reqNote">Note to Voltrix</label><textarea id="reqNote">Lerato's Working at Heights certificate expired on 30 September. Please upload the current one before Monday's induction.</textarea></div>
          <button class="btn btn-primary btn-sm" style="margin-top:10px" data-act="send-request">Send request</button></div>`;
    } else if (S.choice === 'overview') {
      detail = overviewHtml();
    }
    h = `<div class="choices" role="group" aria-label="How would you like to proceed?">${choices.map((c, i) => `<button class="choice" data-act="choice" data-c="${c.c}" aria-pressed="${S.choice === c.c}"><span class="c-k">${i + 1}</span><span><b>${esc(c.t)}</b><span>${esc(c.s)}</span></span></button>`).join('')}</div>
      <div style="margin-top:16px">${detail}</div>`;
  } else if (S.stage === 5) {
    const phase = d.status === 'complete' ? 3 : d.status === 'awaiting_review' ? 2 : d.requested ? 1 : 0;
    const act = phase === 0
      ? '<button class="btn btn-primary btn-sm" data-act="send-request">Ask Voltrix for an updated copy</button>'
      : phase === 1 ? '<button class="btn btn-primary btn-sm" data-act="upload">Show Voltrix uploading the new certificate</button>'
        : phase === 2 ? '<button class="btn btn-sage btn-sm" data-act="approve">Check it and approve</button>' : '';
    h = `${overviewHtml()}
      <div class="progress-grid"><div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center">${act}${phase === 3 ? `<p style="font-size:14px"><b>Working at Heights is complete.</b> ${outstanding().length} item${outstanding().length === 1 ? '' : 's'} still outstanding, so the file isn't Site Ready yet.</p>` : ''}</div>
        <div class="diff">
          <div class="${phase >= 1 ? 'on' : ''}"><b>Requested</b><p>Voltrix knows what's needed, with your note.</p></div>
          <div class="${phase >= 2 ? 'on' : ''}"><b>Received</b><p>A new copy is on file. Received isn't the same as accepted.</p></div>
          <div class="${phase >= 3 ? 'on' : ''}"><b>Approved</b><p>You checked it and accepted it for this site's file.</p></div>
          <div><b>Site Ready</b><p>A separate decision, only when every requirement is complete.</p></div></div></div>
        <div class="drawer"><h4 style="margin-bottom:8px">Activity</h4>${activityHtml(6)}</div></div>`;
  }
  body.innerHTML = `<div class="demo-fade">${h}</div>`;
  S.freshActivity = 0;

  const c = COACH[S.stage];
  const nextLabel = S.stage < STAGES.length - 1 ? `Next: ${STAGES[S.stage + 1].t}` : 'Next chapter: handle an issue';
  const nextAct = S.stage < STAGES.length - 1 ? 'data-act="stage" data-s="' + (S.stage + 1) + '"' : 'data-act="goto" data-ch="5"';
  $('#demoCoach').innerHTML = `<p><span class="hint">${c.hint} of ${STAGES.length}</span>${esc(c.text)}</p>
    ${S.stage > 0 ? `<button class="btn btn-secondary btn-sm" data-act="stage" data-s="${S.stage - 1}">Back</button>` : ''}
    <button class="btn btn-primary btn-sm" ${nextAct}>${esc(nextLabel)}</button>`;
  $('#demoToast').textContent = S.toast;
}

function setStage(i) {
  S.stageDone.add(S.stage);
  S.stage = Math.max(0, Math.min(i, STAGES.length - 1));
  if (S.stage > 0) S.opened = true;
  S.toast = '';
  renderDemo();
}

function sendRequest() {
  const d = S.docs.heights;
  if (d.requested || d.status !== 'expired') return;
  const note = ($('#reqNote')?.value || '').trim() || 'Please upload a current Working at Heights certificate for Lerato Nkosi.';
  d.requested = true; d.note = note;
  log('Naledi Khumalo (Highveld)', 'asked Voltrix for a current Working at Heights certificate — Lerato Nkosi');
  log('COMVERA', 'emailed and notified Johan Pretorius (Voltrix)');
  S.freshActivity = 2;
  toast('Request sent. The item stays Expired until a current copy is uploaded and approved.');
  renderAll();
}
function upload() {
  const d = S.docs.heights;
  if (!d.requested || d.status !== 'expired') return;
  d.status = 'awaiting_review'; d.version = 'v2.0';
  log('Johan Pretorius (Voltrix)', 'uploaded Working at Heights v2.0 — Lerato Nkosi, valid until 30 Sep 2028');
  toast('Voltrix uploaded a new certificate. It now waits for your review; it doesn\'t count until approved.');
  renderAll();
}
function approve() {
  const d = S.docs.heights;
  if (d.status !== 'awaiting_review') return;
  d.status = 'complete';
  log('Naledi Khumalo (Highveld)', 'approved Working at Heights v2.0 — Lerato Nkosi');
  toast(`Approved. Readiness is now ${readiness()}%. Other items are still outstanding.`);
  renderAll();
}

/* ================= 05 issue ================= */

function renderIssue() {
  const st = S.docs.medical;
  const choices = [
    { c: 'ignore', t: 'Ignore it for now', s: 'Leave it in the review queue.' },
    { c: 'flag', t: 'Send it back with a note', s: 'Voltrix sees what to fix; it joins the outstanding list.' },
    { c: 'review', t: 'Check the requirement first', s: 'See the site rule, then decide.' },
  ];
  let outcome = '';
  if (S.issueChoice === 'ignore') {
    outcome = `<div class="outcome warn"><h4>Nothing changes</h4><p>The certificate stays in the review queue. Nobody at Voltrix knows it's out of date, and Sipho won't show as cleared at the gate until a medical within your 12-month rule is approved.</p></div>`;
  } else if (S.issueChoice === 'review') {
    outcome = `<div class="outcome"><h4>Requirement: medical certificate of fitness, per worker</h4>
      <p><b>Source:</b> Highveld site rule. <b>Validity:</b> accepted for 12 months from the date of issue. A site rule can only shorten how long a document counts, never extend it.</p>
      <p style="margin-top:8px"><b>This certificate:</b> issued 4 August 2025, so for this site it stopped counting on 4 August 2026.</p>
      ${st.status === 'correction_required' ? '' : '<div class="cta-row" style="margin-top:12px"><button class="btn btn-primary btn-sm" data-act="issue-send">Send it back with this note</button></div>'}</div>`;
  }
  if (st.status === 'correction_required') {
    outcome += `<div class="outcome good"><h4>Sent back to Voltrix</h4><p>“Issued 4 Aug 2025; this site accepts medicals for 12 months from issue. Please upload a current certificate for Sipho.” It's in the outstanding list until a new certificate is uploaded and approved.</p></div>`;
  }
  $('#issueMain').innerHTML = `<div class="issue-doc">
      <div class="cert" aria-hidden="true"><b>Certificate of fitness</b><span>Name: S. Dlamini</span><span>Occupation: Electrician</span><span>Date of issue: 04/08/2025</span><span>Fit for: work at heights, confined spaces</span><span class="stamp">OHP</span></div>
      <div><h3>Medical certificate of fitness — Sipho Dlamini</h3>
        <div class="meta"><span>${pill(st.status)} · submitted by Johan Pretorius today</span><span>Issued 4 August 2025 (14 months ago)</span></div>
        <p class="rule">Highveld rule for this site: medicals count for 12 months from issue.</p></div></div>
    <p style="margin-top:16px; font-weight:600">What do you do?</p>
    <div class="choices" role="group" aria-label="Choose how to handle the out-of-date certificate">${choices.map((c, i) => `<button class="choice" data-act="issue" data-c="${c.c}" aria-pressed="${S.issueChoice === c.c}"><span class="c-k">${String.fromCharCode(65 + i)}</span><span><b>${esc(c.t)}</b><span>${esc(c.s)}</span></span></button>`).join('')}</div>
    ${outcome}
    ${S.issueChoice || st.status === 'correction_required' ? '<button class="btn btn-quiet btn-sm" style="margin-top:14px" data-act="issue-reset">Try another choice</button>' : ''}`;

  const out = outstanding();
  $('#outCount').textContent = out.length;
  $('#outList').innerHTML = out.map((d) => `<li class="${S.outNew === d.id ? 'new' : ''}"><span>${pill(S.docs[d.id].status)}</span><b>${esc(docLabel(d))}</b><span class="next">${esc(nextStepFor(d.id))}</span></li>`).join('');
  S.outNew = null;
}
function issueSend() {
  const st = S.docs.medical;
  if (st.status === 'correction_required') return;
  st.status = 'correction_required';
  S.outNew = 'medical';
  log('Naledi Khumalo (Highveld)', 'sent back Medical certificate — Sipho Dlamini: issued 4 Aug 2025, outside the 12-month site rule');
  renderAll();
}

/* ================= 06 compare ================= */

const CMP = [
  { id: 'hira', from: 'Folder', raw: 'Risk_Assessment_FINAL_v2 (1).pdf', bx: '4%', by: '6%', rot: '-3deg' },
  { id: 'coid', from: 'Tracker', raw: 'COID ✓', bx: '52%', by: '4%', rot: '2deg' },
  { id: 'method', from: 'Email', raw: '“Thabo is doing it…”', bx: '40%', by: '24%', rot: '-1deg' },
  { id: 'heights', from: 'Folder', raw: 'WAH_certs_scan.jpg', bx: '8%', by: '40%', rot: '2.5deg' },
  { id: 'medical', from: 'WhatsApp', raw: 'IMG_4471.jpg', bx: '50%', by: '50%', rot: '-2deg' },
  { id: 'insurance', from: 'Email', raw: 'Insurance 2026 (attached)', bx: '6%', by: '70%', rot: '-1.5deg' },
  { id: 'policy', from: 'Folder', raw: 'H&S_Policy_2026.pdf', bx: '46%', by: '82%', rot: '1deg' },
];
function renderCompare() {
  const after = S.compare === 'after';
  $('#compare').classList.toggle('after', after);
  $$('[data-act="compare"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === S.compare)));
  $('#compareStage').innerHTML = CMP.map((c, i) => {
    const d = docMeta(c.id);
    return `<div class="cfrag" style="--bx:${c.bx}; --by:${c.by}; --rot:${c.rot}; --ay:${3 + i * 13.6}%; --d:${i * 0.06}s"><span class="from">${esc(c.from)}</span><span class="nm">${esc(after ? docLabel(d) : c.raw)}</span>${pill(S.docs[c.id].status)}</div>`;
  }).join('');
}

/* ================= 07 value ================= */

function renderValue() {
  $('#valueTabs').innerHTML = VALUES.map((v) => `<button class="vtab" role="tab" id="vtab-${v.id}" aria-controls="valueView" aria-selected="${S.value === v.id}" tabindex="${S.value === v.id ? 0 : -1}" data-act="value" data-v="${v.id}"><b>${esc(v.t)}</b><span>${esc(v.s)}</span></button>`).join('');
  $('#valueView').setAttribute('aria-labelledby', 'vtab-' + S.value);
  let h = '';
  if (S.value === 'visibility') {
    h = `<h3>Know where the file stands</h3><p>The overview answers the first question every morning: how complete is this file, and what's left. It reflects what you did in the workflow above.</p><div class="focus-area">${overviewHtml({ lit: 'file' })}</div>`;
  } else if (S.value === 'organisation') {
    const groups = ['Company documents', 'Job documents', 'People'];
    h = `<h3>One structure instead of five places</h3><p>Every document is filed against the requirement it answers, in a file per contractor per site. The whole file can be downloaded as one bound PDF.</p>
      <ul class="tree"><li class="grp">Highveld Mining Group › Leeuwpan Colliery — Shaft 3 Conveyor Rewire › Voltrix Electrical</li>
      ${groups.map((g) => `<li class="grp">${esc(g)}</li>${BASE_DOCS.filter((d) => d.group === g).map((d) => `<li>${esc(docLabel(d))} ${pill(S.docs[d.id].status)}</li>`).join('')}`).join('')}</ul>`;
  } else if (S.value === 'follow') {
    h = `<h3>Outstanding items don't get lost</h3><p>Each open item carries its next step. The compliance agent checks files in the background for expiries, missing documents and reviews that are waiting, and lists them for the right people.</p><div class="focus-area">${overviewHtml({ lit: 'attn' })}</div>`;
  } else {
    h = `<h3>Everyone can see whose move it is</h3><p>Requests, uploads, approvals and send-backs are recorded on the item and the other side is notified by email and in COMVERA. People without a COMVERA account can still be asked for documents through a secure link.</p>
      <div class="drawer">${activityHtml(7)}</div>`;
  }
  $('#valueView').innerHTML = `<div class="demo-fade">${h}</div>`;
}

/* ================= 08 close ================= */

function renderDone() {
  const n = CHAPTERS.slice(1).filter((_, i) => S.seen.has(i + 1)).length;
  $('#doneCard').innerHTML = `<h3>Your walkthrough</h3><ul class="done-list">${CHAPTERS.slice(1).map((c, i) => {
    const seen = S.seen.has(i + 1);
    return `<li class="${seen ? 'seen' : ''}"><span class="tick" aria-hidden="true">${seen ? '✓' : c.n}</span><button data-act="goto" data-ch="${i + 1}">${esc(c.t)}${seen ? '<span class="sr-only"> (seen)</span>' : ''}</button></li>`;
  }).join('')}</ul>
    <p class="done-msg">${n === 8 ? 'You\'ve seen the whole walkthrough.' : `${n} of 8 chapters seen.`}${S.docs.heights.status === 'complete' ? ' You took one item from Expired to Complete.' : ''}</p>`;
}

function applyConfig() {
  const cfg = $('#wt-config')?.dataset || {};
  const contact = $('#ctaContact'), explore = $('#ctaExplore'), note = $('#ownerNote');
  if (cfg.contactUrl) {
    contact.href = cfg.contactUrl;
  } else if (cfg.contactEmail) {
    contact.href = 'mailto:' + cfg.contactEmail;
    note.hidden = false;
    note.innerHTML = `Or email <b style="user-select:all">${esc(cfg.contactEmail)}</b>`;
  } else {
    contact.removeAttribute('href');
    contact.setAttribute('role', 'button');
    contact.setAttribute('tabindex', '0');
    contact.dataset.act = 'contact-missing';
  }
  if (cfg.exploreUrl) explore.href = cfg.exploreUrl; else explore.hidden = true;
}

/* ================= wiring ================= */

function renderAll() {
  renderNav(); renderExplore(); renderFlow(); renderSorter(); renderMeet(); renderDemo(); renderIssue(); renderCompare(); renderValue(); renderDone();
}

function restart() {
  stopFlow();
  S = freshState();
  renderAll();
  window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
  setTimeout(() => $('.wt-brand').focus({ preventScroll: true }), 50);
}

const ACTIONS = {
  goto: (el) => goto(Number(el.dataset.ch)),
  prev: () => goto(S.chapter - 1),
  next: () => goto(S.chapter + 1),
  restart,
  source: (el) => { S.source = el.dataset.id; S.explored.add(el.dataset.id); renderExplore(); },
  'flow-node': (el) => { stopFlow(); S.flowSel = Number(el.dataset.i); S.flowLit = -1; renderFlow(); },
  'flow-play': () => playFlow(),
  sort: () => setSorted(!S.sorted),
  stage: (el) => setStage(Number(el.dataset.s)),
  'open-file': () => { S.opened = true; setStage(1); toast('File opened. Everything this site asked Voltrix for, in one place.'); },
  doc: (el) => { S.selected = el.dataset.id; S.inspected.add(el.dataset.id); renderDemo(); },
  choice: (el) => {
    S.choice = el.dataset.c;
    if (S.choice === 'open') toast('Certificate opened. It expired on 30 September 2026.');
    else if (S.choice === 'overview') toast(S.docs.heights.requested ? 'Back on the overview: the item shows that an update was requested.' : 'Back on the overview. The expired item is still waiting for your action.');
    else toast('');
    renderDemo();
  },
  'send-request': () => sendRequest(),
  upload: () => upload(),
  approve: () => approve(),
  issue: (el) => {
    S.issueChoice = el.dataset.c;
    if (S.issueChoice === 'flag') { issueSend(); return; }
    renderIssue();
  },
  'issue-send': () => { S.issueChoice = 'review'; issueSend(); },
  'issue-reset': () => {
    if (S.docs.medical.status === 'correction_required') {
      S.docs.medical.status = 'awaiting_review';
      S.activity = S.activity.filter((a) => !a.what.startsWith('sent back Medical'));
    }
    S.issueChoice = null; renderAll();
  },
  compare: (el) => { S.compare = el.dataset.v; renderCompare(); },
  value: (el) => { S.value = el.dataset.v; renderValue(); },
  'contact-missing': () => {
    const note = $('#ownerNote');
    note.hidden = false;
    note.textContent = 'Contact details haven\'t been added to this copy of the walkthrough yet. (For the COMVERA team: set data-contact-url or data-contact-email on #wt-config in walkthrough.html.)';
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'A' && el.getAttribute('href') && el.dataset.act !== 'goto') return;
  e.preventDefault();
  fn(el, e);
});
document.addEventListener('keydown', (e) => {
  // Arrow keys move between tabs in the two tab lists.
  const tab = e.target.closest('[role="tab"]');
  if (tab && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    const list = tab.parentElement;
    const tabs = $$('[role="tab"]', list);
    let i = tabs.indexOf(tab);
    if (e.key === 'Home') i = 0; else if (e.key === 'End') i = tabs.length - 1;
    else i = (i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    e.preventDefault();
    tabs[i].click();
    // The list is redrawn on click, so find the new button in the same container.
    const again = $$('[role="tab"]', list)[i];
    if (again) again.focus();
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"][data-act]')) { e.preventDefault(); e.target.click(); }
});

applyConfig();
S.explored.add(S.source);
renderAll();
watchChapters();
