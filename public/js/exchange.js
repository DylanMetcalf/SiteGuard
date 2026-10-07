/* COMVERA Exchange portal: the page behind an emailed exchange link.
   Link → confirm email → one-time code → this one exchange. No account, no dashboard.
   Everything shown comes from the server and is escaped before it touches the page. */

const root = document.getElementById('xp');
const ESC = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const fmtDate = (v) => v ? new Date(v).toLocaleDateString('en-ZA', { day:'numeric', month:'short', year:'numeric' }) : '';
const fmtTime = (v) => v ? new Date(v).toLocaleString('en-ZA', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : '';

const token = (/^\/x\/([A-Za-z0-9_-]{20,100})$/.exec(location.pathname) || [])[1] || '';
const X = { step:'cover', cover:null, email:'', csrf:'', data:null, error:'', info:'', busy:false, submitted:false, consent:null };

async function call(method, url, body, isForm){
  const headers = {};
  if(X.csrf && method !== 'GET') headers['x-exchange-csrf'] = X.csrf;
  if(body !== undefined && !isForm) headers['content-type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body), credentials:'same-origin' });
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  if(!res.ok){ const e = new Error((json && json.message) || 'Something went wrong. Try again.'); e.status = res.status; e.code = json && json.error; throw e; }
  return json;
}

const lock = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
const top = () => '<div class="xp-top"><div class="xp-brand"><img src="/icons/icon-small.svg" alt="">COMVERA</div><div class="xp-lock">'+lock+'Secure exchange</div></div>';
const foot = () => '<div class="xp-foot">This page shows one exchange only. Documents are never sent as email attachments; they stay here, and every view, upload and download is recorded for both sides. '
  + 'COMVERA is a contractor-compliance platform used by the sender. <a href="/privacy" target="_blank" rel="noopener">Privacy</a> · <a href="/terms" target="_blank" rel="noopener">Terms</a>'
  + (X.step === 'exchange' ? ' · <button class="linkish" data-x="signout">Sign out of this exchange</button>' : '') + '</div>';
const errorBox = () => X.error ? '<div class="form-error" role="alert">'+esc(X.error)+'</div>' : '';
const infoBox = () => X.info ? '<div class="form-ok">'+esc(X.info)+'</div>' : '';

function render(){
  let h = top();
  if(X.step === 'gone') h += '<div class="card"><h1>This exchange isn\'t available</h1><p class="xp-sub">'+esc(X.error)+'</p></div>';
  else if(X.step === 'cover' || X.step === 'code') h += renderGate();
  else if(X.step === 'exchange') h += renderExchange();
  root.innerHTML = h + foot();
  const focus = root.querySelector('[data-autofocus]');
  if(focus) focus.focus();
}

function renderGate(){
  const c = X.cover || {};
  const what = c.direction === 'share' ? 'shared '+(c.itemCount === 1 ? 'a document' : c.itemCount+' documents')+' with you' : 'requested '+(c.itemCount === 1 ? 'a document' : c.itemCount+' documents')+' from you';
  let h = '<div class="card"><div class="xp-sub">'+esc(c.ref)+'</div><h1>'+esc(c.senderName)+' has '+what+'</h1>'
    + '<p class="xp-sub">To keep it private, confirm the email address this was sent to ('+esc(c.maskedEmail)+'). We\'ll email you a 6-digit code. No account or password is needed.</p>';
  if(X.step === 'cover'){
    h += '<form data-x-form="code"><label class="field-label" for="xEmail">Your email address</label>'
      + '<input id="xEmail" type="email" autocomplete="email" required value="'+esc(X.email)+'" data-autofocus>'
      + errorBox() + '<div class="xp-row"><button class="btn primary" type="submit"'+(X.busy?' disabled':'')+'>Email me a code</button></div></form>';
  } else {
    h += '<form data-x-form="verify">' + infoBox() + '<label class="field-label" for="xCode">6-digit code</label>'
      + '<input id="xCode" class="xp-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required data-autofocus>'
      + errorBox() + '<div class="xp-row"><button class="btn primary" type="submit"'+(X.busy?' disabled':'')+'>Continue</button>'
      + '<button class="btn ghost" type="button" data-x="resend-code">Send a new code</button><button class="btn ghost" type="button" data-x="change-email">Use a different email</button></div></form>';
  }
  h += '<div class="xp-sub" style="margin-top:14px;">Link valid until '+esc(fmtDate(c.accessExpiresAt))+'.</div></div>';
  return h;
}

const STATUS = {
  requested: ['Needed', 'grey'], submitted: ['Under review', 'blue'], approved: ['Accepted', 'green'], rejected: ['Replacement needed', 'missing'], shared: ['Shared with you', 'sage'],
};

function renderExchange(){
  const { exchange:x, items } = X.data;
  const request = x.direction === 'request';
  let h = '<div class="card"><div class="xp-sub">'+esc(x.ref)+(x.siteName ? ' · '+esc(x.siteName) : '')+'</div>'
    + '<h1>'+(request ? 'Documents requested by ' : 'Documents shared by ')+esc(x.senderName)+'</h1>'
    + '<div class="xp-sub">For '+esc(x.recipientName || x.email)+(x.recipientOrgName ? ', '+esc(x.recipientOrgName) : '')+'</div>'
    + (x.message ? '<p style="margin-top:12px; white-space:pre-wrap;">“'+esc(x.message)+'”</p>' : '')
    + '<div class="xp-row">'+(request && x.deadline ? '<span class="badge amber expiring">Needed by '+esc(fmtDate(x.deadline))+'</span>' : '')
    + '<span class="badge grey">Access until '+esc(fmtDate(x.accessExpiresAt))+'</span></div></div>';

  h += '<div class="section-title">'+(request ? 'What\'s needed' : 'Documents')+'</div><div class="card">';
  for(const it of items){
    const [label, cls] = STATUS[it.status] || [it.status, 'grey'];
    const canUpload = request && (it.status === 'requested' || it.status === 'rejected');
    let meta = '';
    if(it.personName) meta += 'For '+esc(it.personName);
    if(it.note) meta += (meta ? ' · ' : '')+esc(it.note);
    h += '<div class="xp-item"><div class="xp-item-main"><div class="xp-item-name">'+esc(it.documentType)+'</div>'
      + (meta ? '<div class="xp-item-meta">'+meta+'</div>' : '')
      + '<div class="xp-item-meta"><span class="badge '+cls+'">'+esc(label)+'</span>'
      + (it.draft && canUpload ? ' &nbsp;Ready to submit: '+esc(it.draft.filename) : '')
      + (it.submitted && !(it.draft && canUpload) ? ' &nbsp;Sent: '+esc(it.submitted.filename)+(it.submitted.version > 1 ? ' (version '+it.submitted.version+')' : '')+' · '+esc(fmtTime(it.submitted.submittedAt)) : '')
      + (!request && it.filename ? ' &nbsp;'+esc(it.filename) : '') + '</div>'
      + (it.status === 'rejected' && it.reviewNote ? '<div class="xp-review"><strong>What to fix:</strong> '+esc(it.reviewNote)+'</div>' : '')
      + '</div><div class="xp-item-actions">';
    if(canUpload){
      h += '<label class="btn small '+(it.draft ? 'secondary' : 'primary')+'">'+(it.draft || it.status === 'rejected' ? 'Replace file' : 'Upload file')
        + '<input class="xp-file" type="file" data-x-upload="'+esc(it.id)+'" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,.xls,.xlsx,.txt,application/pdf,image/*"></label>';
    }
    if(!request){
      h += '<a class="btn small secondary" href="/api/x/items/'+encodeURIComponent(it.id)+'/file" target="_blank" rel="noopener">View</a>';
      if(x.allowDownload) h += '<a class="btn small primary" href="/api/x/items/'+encodeURIComponent(it.id)+'/file?download=1" data-x="downloaded">Download</a>';
    }
    h += '</div></div>';
  }
  h += '</div>';
  if(!request && !x.allowDownload) h += '<p class="xp-sub">The sender allows viewing only.</p>';

  if(request){
    const ready = items.filter((i) => i.draft && (i.status === 'requested' || i.status === 'rejected')).length;
    const open = items.filter((i) => i.status === 'requested' || i.status === 'rejected').length;
    if(open){
      h += '<div class="card"><label class="field-label" for="xMsg" style="margin-top:0;">Message to '+esc(x.senderName)+' (optional)</label>'
        + '<textarea id="xMsg" maxlength="2000" placeholder="Anything they should know about these documents"></textarea>'
        + errorBox() + infoBox()
        + '<div class="xp-row"><button class="btn primary" data-x="submit"'+(!ready || X.busy ? ' disabled' : '')+'>'+(ready ? 'Submit '+ready+' document'+(ready === 1 ? '' : 's') : 'Upload a file to submit')+'</button>'
        + (ready && ready < open ? '<span class="xp-sub">You can send the rest later with the same link.</span>' : '')+'</div></div>';
    } else {
      h += errorBox() + infoBox();
      const done = items.every((i) => i.status === 'approved');
      h += '<div class="card"><strong>'+(done ? 'All done — '+esc(x.senderName)+' has accepted everything.' : 'Thanks — everything is with '+esc(x.senderName)+' for review.')+'</strong>'
        + '<p class="xp-sub" style="margin-top:6px;">'+(done ? 'Nothing more is needed.' : 'If anything needs changing, you\'ll get an email with a new link.')+'</p></div>';
    }
  }

  // Optional, never in the way: the exchange works fully without it.
  h += '<div class="card xp-upgrade"><strong>Keep your compliance documents ready for every site</strong>'
    + '<p class="xp-sub" style="margin-top:6px;">A COMVERA workspace keeps your company documents, worker certificates and safety files in one place, with expiry reminders. It\'s optional — this exchange works without one, and nothing is created unless you sign up yourself.</p>'
    + '<div class="xp-row"><a class="btn secondary small" href="/signup?kind='+(x.direction === 'request' ? 'contractor' : 'host')+'" target="_blank" rel="noopener">Create your COMVERA workspace</a></div>'
    + '<label class="xp-consent"><input type="checkbox" data-x="consent"'+(X.consent ? ' checked' : '')+'> Email me occasional COMVERA product news. (Optional — leave unticked if you don\'t want it.)</label></div>';
  return h;
}

async function loadExchange(){
  X.data = await call('GET', '/api/x/exchange');
  X.csrf = X.data.csrf;
  X.step = 'exchange';
}

async function start(){
  if(!token){ X.step = 'gone'; X.error = 'This link is incomplete. Open it again from your email.'; return render(); }
  try{
    X.cover = await call('POST', '/api/x/open', { token });
    if(X.cover.signedIn){
      try{ await loadExchange(); }catch{ X.step = 'cover'; }
    }
  }catch(e){
    // An older link (replaced by a newer email) still works while this browser's verified session lasts.
    try{ if(e.code === 'exchange_link') await loadExchange(); else throw e; }
    catch{ X.step = 'gone'; X.error = e.message; }
  }
  render();
}

async function busy(fn){
  if(X.busy) return;
  X.busy = true; X.error = ''; X.info = '';
  try{ await fn(); }
  catch(e){
    if(e.status === 410 || e.code === 'exchange_link'){ X.step = 'gone'; }
    else if(e.status === 401 && X.step === 'exchange'){ X.step = 'cover'; }
    X.error = e.message;
  }
  finally{ X.busy = false; render(); }
}

root.addEventListener('submit', (ev) => {
  const form = ev.target.closest('[data-x-form]');
  if(!form) return;
  ev.preventDefault();
  if(form.dataset.xForm === 'code'){
    const email = root.querySelector('#xEmail').value.trim();
    busy(async () => { X.email = email; const r = await call('POST', '/api/x/code', { token, email }); X.step = 'code'; X.info = r.message; });
  } else {
    const code = root.querySelector('#xCode').value.trim();
    busy(async () => { const r = await call('POST', '/api/x/verify', { token, email:X.email, code }); X.csrf = r.csrf; await loadExchange(); });
  }
});

root.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-x]');
  if(!el) return;
  const a = el.dataset.x;
  if(a === 'resend-code') busy(async () => { const r = await call('POST', '/api/x/code', { token, email:X.email }); X.info = r.message; });
  else if(a === 'change-email'){ X.step = 'cover'; X.error = ''; X.info = ''; render(); }
  else if(a === 'submit'){
    const message = (root.querySelector('#xMsg') || {}).value || '';
    busy(async () => { X.data = await call('POST', '/api/x/submit', { message }); X.info = 'Sent. '+X.data.exchange.senderName+' has been told.'; });
  }
  else if(a === 'signout') busy(async () => { await call('POST', '/api/x/signout', {}); X.csrf = ''; X.data = null; X.step = 'cover'; });
  else if(a === 'downloaded') setTimeout(() => busy(loadExchange), 1500);
});

root.addEventListener('change', (ev) => {
  const input = ev.target;
  if(input.dataset.xUpload){
    const file = input.files && input.files[0];
    if(!file) return;
    const fd = new FormData();
    fd.append('file', file);
    busy(async () => { X.data = await call('POST', '/api/x/items/'+encodeURIComponent(input.dataset.xUpload)+'/upload', fd, true); X.info = 'Uploaded '+file.name+'. Submit when you\'re ready.'; });
  } else if(input.dataset.x === 'consent'){
    const consented = input.checked;
    busy(async () => { await call('POST', '/api/x/consent', { consented }); X.consent = consented; X.info = consented ? 'Thanks — you can unsubscribe from any email.' : 'Okay — no product news.'; });
  }
});

start();
