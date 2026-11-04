// Two-step sign-in (authenticator app): set it up, see recovery codes once, make new ones, turn it off.
// Used from Profile → Security, and as a full page when the organisation requires it.
import { api } from './api.js';
import { S, on, openSheet, closeSheet, sheetHead, escapeHtml, showToast, render, reload } from './core.js';

const st = { info: null, setup: null, codes: null, gate: false, err: '' };
const val = (id) => (document.getElementById(id) ? document.getElementById(id).value.trim() : '');

async function load(){ st.info = await api.get('/api/me/mfa'); }

function codesHtml(){
  return '<div class="notice" style="margin:10px 0;">Save these recovery codes somewhere safe and offline (a password manager, or a printed page). Each one works once if you lose your phone. <strong>They are shown only now.</strong></div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0;">'+st.codes.map(c=>'<div style="font-family:var(--font-mono,monospace);text-align:center;padding:8px;border:1px solid var(--grey-line);border-radius:8px;">'+escapeHtml(c)+'</div>').join('')+'</div>'
    +'<button class="btn secondary block" data-action="mfa-print">Print</button>'
    +'<button class="btn primary block" style="margin-top:8px;" data-action="mfa-codes-done">I have saved them</button>';
}

export function mfaBody(){
  if(!st.info){ load().then(rerender).catch(e=>showToast(e.message)); return '<div class="site-card-sub">Loading…</div>'; }
  const err = st.err ? '<div class="notice" role="alert" style="margin-bottom:8px;">'+escapeHtml(st.err)+'</div>' : '';
  if(st.codes) return err + codesHtml();
  if(st.setup){
    const key = escapeHtml(st.setup.secret.replace(/(.{4})/g, '$1 ').trim());
    return err + '<ol style="padding-left:18px;font-size:13.5px;line-height:1.6;margin:0 0 10px;"><li>Install an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Authy or 1Password).</li><li>Choose <strong>Add account</strong>, then <strong>Enter a setup key</strong>, name it COMVERA and type this key:</li></ol>'
      +'<div style="font-family:var(--font-mono,monospace);font-size:16px;letter-spacing:.06em;text-align:center;padding:10px;border:1px dashed var(--grey-line);border-radius:8px;word-break:break-all;">'+key+'</div>'
      +'<div class="site-card-sub" style="margin:6px 0 10px;">On this phone you can also <a href="'+escapeHtml(st.setup.otpauth)+'">open it in your authenticator app</a>.</div>'
      +'<label class="field-label" for="mfaCode">Type the 6-digit code the app shows</label><input type="text" id="mfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6">'
      +'<button class="btn primary block" style="margin-top:10px;" data-action="mfa-enable">Turn on</button>';
  }
  const req = st.info.requiredBy.length ? '<div class="site-card-sub" style="margin-top:6px;">Required by '+escapeHtml(st.info.requiredBy.join(', '))+'.</div>' : '';
  if(!st.info.enabled){
    return err + '<p style="font-size:14px;">Two-step sign-in asks for a 6-digit code from an app on your phone each time you sign in, so a stolen password alone is not enough to get into your account.</p>'+req
      +'<button class="btn primary block" style="margin-top:10px;" data-action="mfa-start">Set up two-step sign-in</button>';
  }
  return err + '<div class="kv"><span>Two-step sign-in</span><span><strong>On</strong></span></div><div class="kv"><span>Recovery codes left</span><span>'+st.info.recoveryCodesLeft+'</span></div>'+req
    +'<label class="field-label" for="mfaCode">Current code from your app</label><input type="text" id="mfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="20">'
    +'<button class="btn secondary block" style="margin-top:8px;" data-action="mfa-new-codes">Make new recovery codes</button>'
    +(st.info.requiredBy.length ? '' : '<details style="margin-top:10px;"><summary style="font-size:12.5px;color:var(--grey);cursor:pointer;">Turn off two-step sign-in</summary>'
      +'<label class="field-label" for="mfaPassword">Your password</label><input type="password" id="mfaPassword" autocomplete="current-password">'
      +'<button class="btn danger block" style="margin-top:8px;" data-action="mfa-disable">Turn off (uses the code above)</button></details>');
}

function rerender(){ if(st.gate) render(); else openSheet(sheetHead('Two-step sign-in')+mfaBody()); }

/** The whole page when an organisation requires it and this person hasn't set it up. */
export function renderMfaGate(){
  st.gate = true;
  return '<div class="auth-wrap"><div class="card" style="max-width:460px;margin:40px auto;">'
    +'<h1 style="font-size:22px;margin:0 0 6px;">Set up two-step sign-in</h1>'
    +'<p class="site-card-sub" style="margin-bottom:12px;">'+escapeHtml(S.boot.org ? S.boot.org.name : 'Your organisation')+' requires a second sign-in step for everyone. It takes about two minutes.</p>'
    + mfaBody()
    +'<button class="btn ghost block" style="margin-top:12px;" data-action="auth-signout">Sign out</button></div></div>';
}

on('open-mfa', ()=>{ Object.assign(st, { info: null, setup: null, codes: null, gate: false, err: '' }); rerender(); });
on('mfa-start', async (el)=>{
  el.disabled = true; st.err = '';
  try{ st.setup = await api.post('/api/me/mfa/setup'); }catch(e){ st.err = e.message; }
  rerender();
});
on('mfa-enable', async (el)=>{
  el.disabled = true; st.err = '';
  try{ const r = await api.post('/api/me/mfa/enable', { code: val('mfaCode') }); st.codes = r.recoveryCodes; st.setup = null; await load(); }
  catch(e){ st.err = e.message; }
  rerender();
});
on('mfa-new-codes', async (el)=>{
  el.disabled = true; st.err = '';
  try{ const r = await api.post('/api/me/mfa/recovery-codes', { code: val('mfaCode') }); st.codes = r.recoveryCodes; await load(); }
  catch(e){ st.err = e.message; }
  rerender();
});
on('mfa-disable', async (el)=>{
  if(!confirm('Turn off two-step sign-in? Your account will be protected by your password only.')) return;
  el.disabled = true; st.err = '';
  try{ await api.post('/api/me/mfa/disable', { password: document.getElementById('mfaPassword').value, code: val('mfaCode') }); await load(); showToast('Two-step sign-in is off'); await reload(); }
  catch(e){ st.err = e.message; }
  rerender();
});
on('mfa-print', ()=>window.print());
on('mfa-codes-done', async ()=>{
  st.codes = null;
  if(st.gate){ st.gate = false; await reload(); render(); return; }
  await reload(); closeSheet(); showToast('Two-step sign-in is on');
});
