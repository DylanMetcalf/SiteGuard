// Uploaded documents (Document Studio → Uploaded): pick several files, see each one's progress, retry
// failures, and describe them (type, site, area, dates, who can see them). Also the document sheet with
// its versions. Everything goes through /api/org-docs; the server decides who may see what.
import { api, csrf } from './api.js';
import { S, ICONS, escapeHtml, on, openSheet, closeSheet, sheetHead, showToast, render, val } from './core.js';

export const DOC_TYPES = [
  ['policy', 'Policy'], ['procedure', 'Procedure'], ['template', 'Template'], ['induction', 'Induction'], ['emergency', 'Emergency procedure'],
  ['risk_assessment', 'Risk assessment'], ['method_statement', 'Method statement'], ['certificate', 'Certificate'], ['registration', 'Company registration'],
  ['insurance', 'Insurance'], ['training', 'Training or competency record'], ['equipment', 'Equipment document'], ['report', 'Report'], ['other', 'Other'],
];
export const typeLabel = (t) => (DOC_TYPES.find((x) => x[0] === t) || [t, t])[1];
const SCOPES_HOST = [['company', 'Company-wide'], ['site', 'One site']];
const SCOPES_CONTRACTOR = [['company', 'Company document (reusable)'], ['site', 'For one site'], ['project', 'For a project'], ['personnel', 'About a person'], ['equipment', 'About equipment']];
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,.heic,.txt,.csv';

let store = { docs: null, shared: null, archived: null, loading: false };
export function invalidateDocstore(){ store = { docs: null, shared: null, archived: null, loading: false }; }
export async function loadDocstore(force){
  if(store.loading && !force) return store;
  if(store.docs && !force) return store;
  store.loading = true;
  try{
    const kind = S.boot.org && S.boot.org.kind;
    const [d, sh] = await Promise.all([api.get('/api/org-docs'), kind === 'contractor' ? api.get('/api/org-docs/shared') : Promise.resolve({ documents: [] })]);
    store.docs = d.documents; store.shared = sh.documents;
  } finally { store.loading = false; }
  return store;
}
export const docstore = () => store;

/* ---------- the upload sheet ---------- */
let queue = []; // [{ file, name, state: 'ready'|'uploading'|'done'|'failed', pct, error }]
let uploadOpts = {};
const workplacesForUpload = () => (uploadOpts.workplaces || Object.values((S.state && S.state.workplaces) || {}).map((w) => ({ id: w.id, name: w.name, areas: w.areas || [] })));

export function openUploadSheet(opts = {}){
  uploadOpts = opts; queue = [];
  drawUpload();
}
function drawUpload(){
  const kind = S.boot.org.kind, admin = ['owner', 'admin'].includes(S.boot.org.role);
  const wps = workplacesForUpload();
  const scopes = kind === 'host' ? SCOPES_HOST : SCOPES_CONTRACTOR;
  const files = queue.length ? '<div class="up-list">' + queue.map((q, i) => '<div class="up-row ' + q.state + '"><div class="up-main"><input type="text" class="up-name" data-i="' + i + '" value="' + escapeHtml(q.name) + '" aria-label="Document name"' + (q.state === 'done' ? ' disabled' : '') + '>'
    + '<div class="site-card-sub">' + escapeHtml(q.file.name) + ' · ' + Math.max(1, Math.round(q.file.size / 1024)) + ' KB' + (q.error ? ' · <span style="color:var(--red)">' + escapeHtml(q.error) + '</span>' : '') + '</div>'
    + '<div class="up-bar"><i style="width:' + (q.state === 'done' ? 100 : q.pct || 0) + '%"></i></div></div>'
    + '<div class="up-side">' + (q.state === 'done' ? '<span class="badge complete">Uploaded</span>' : q.state === 'uploading' ? '<span class="badge grey">' + (q.pct || 0) + '%</span>'
      : q.state === 'failed' ? '<button class="btn secondary small" data-action="up-retry" data-i="' + i + '">Retry</button>' : '<button class="btn ghost small" data-action="up-remove" data-i="' + i + '" aria-label="Remove ' + escapeHtml(q.name) + '">' + (q.state === 'rejected' ? 'Remove' : ICONS.cross) + '</button>') + '</div></div>').join('') + '</div>' : '';
  openSheet(sheetHead('Upload documents', 'An upload is received, not approved. Approval stays with the site’s review.')
    + '<label class="up-drop" id="upDrop" for="upFiles"><span class="qa-icon">' + ICONS.upload + '</span><b>Choose files or drag them here</b><span class="site-card-sub">PDF, Word, Excel, photos. Several at once is fine.</span>'
    + '<input type="file" id="upFiles" multiple accept="' + ACCEPT + '" data-action-change="up-pick" style="position:absolute;opacity:0;width:1px;height:1px;"></label>'
    + files
    + '<div class="section-title" style="margin-top:14px;">Details for ' + (queue.length > 1 ? 'these documents' : 'this document') + '</div>'
    + '<label class="field-label" for="upType">Type</label><select id="upType">' + DOC_TYPES.map(([v, l]) => '<option value="' + v + '"' + (uploadOpts.docType === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>'
    + '<label class="field-label" for="upScope">Belongs to</label><select id="upScope" data-action-change="up-scope">' + scopes.map(([v, l]) => '<option value="' + v + '"' + ((uploadOpts.scope || 'company') === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>'
    + (wps.length ? '<div id="upWhere"><label class="field-label" for="upWp">Site (optional)</label><select id="upWp" data-action-change="up-wp"><option value="">Not tied to a site</option>' + wps.map((w) => '<option value="' + w.id + '"' + (uploadOpts.workplaceId === w.id ? ' selected' : '') + '>' + escapeHtml(w.name) + '</option>').join('') + '</select>'
      + '<label class="field-label" for="upArea">Department or area (optional)</label><select id="upArea"><option value="">None</option>' + areaOptions(uploadOpts.workplaceId) + '</select></div>' : '')
    + (kind === 'contractor' ? '<label class="field-label" for="upSubject">Person or equipment it is about (optional)</label><input type="text" id="upSubject" maxlength="200" placeholder="e.g. J. Mokoena, or Crane CR-02">' : '')
    + '<div class="up-two"><div><label class="field-label" for="upIssue">Issue date (optional)</label><input type="date" id="upIssue"></div><div><label class="field-label" for="upExpiry">Expiry date (optional)</label><input type="date" id="upExpiry"></div></div>'
    + (kind === 'host' ? '<label class="field-label" for="upReq">For contractors this is</label><select id="upReq"><option value="informational">For information</option><option value="recommended">Recommended</option><option value="mandatory">Mandatory</option></select>' : '')
    + '<label class="field-label" for="upVis">Who can see it</label><select id="upVis"><option value="internal">Everyone in ' + escapeHtml(S.boot.org.name) + '</option>'
      + (kind === 'host' ? '<option value="contractors"' + (uploadOpts.visibility === 'contractors' ? ' selected' : '') + '>Also contractors working on the site</option>' : '')
      + (admin ? '<option value="restricted">Only owners and admins (e.g. medical or personal records)</option>' : '') + '</select>'
    + '<label class="field-label" for="upOwner">Responsible person (optional)</label><input type="text" id="upOwner" maxlength="120">'
    + '<label class="field-label" for="upDesc">Description (optional)</label><textarea id="upDesc" rows="2" maxlength="1000"></textarea>'
    + '<button class="btn primary block" style="margin-top:14px;" data-action="up-start"' + (queue.some((q) => q.state === 'ready' || q.state === 'failed') ? '' : ' disabled') + '>Upload ' + (queue.filter((q) => q.state !== 'done').length || '') + '</button>'
    + (queue.length && queue.every((q) => q.state === 'done' || q.state === 'rejected') && queue.some((q) => q.state === 'done') ? '<button class="btn secondary block" style="margin-top:8px;" data-action="up-done">Done</button>' : ''));
  const drop = document.getElementById('upDrop');
  if(drop){
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });
  }
}
function areaOptions(wpId){
  const w = workplacesForUpload().find((x) => x.id === wpId);
  return w ? (w.areas || []).map((a) => '<option value="' + a.id + '">' + escapeHtml(a.name) + '</option>').join('') : '';
}
function keepForm(){ // the sheet is redrawn as files are added; keep what was typed
  const ids = ['upType', 'upScope', 'upWp', 'upArea', 'upSubject', 'upIssue', 'upExpiry', 'upReq', 'upVis', 'upOwner', 'upDesc'];
  const saved = Object.fromEntries(ids.map((id) => [id, document.getElementById(id) ? document.getElementById(id).value : null]));
  document.querySelectorAll('.up-name').forEach((el) => { const q = queue[Number(el.dataset.i)]; if(q) q.name = el.value; });
  return () => { for(const [id, v] of Object.entries(saved)) { const el = document.getElementById(id); if(el && v !== null) el.value = v; } };
}
function addFiles(list){
  const restore = keepForm();
  for(const f of Array.from(list || [])) queue.push({ file: f, name: f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').slice(0, 200), state: 'ready', pct: 0 });
  drawUpload(); restore();
}
function metaFor(q){
  const g = (id) => (document.getElementById(id) ? document.getElementById(id).value.trim() : '');
  return { name: q.name.trim() || q.file.name, docType: g('upType') || 'other', scope: g('upScope') || 'company', workplaceId: g('upWp') || null, areaId: g('upArea') || null,
    subject: g('upSubject'), issueDate: g('upIssue') || null, expiryDate: g('upExpiry') || null, requirement: g('upReq') || 'informational',
    visibility: g('upVis') || 'internal', ownerName: g('upOwner'), description: g('upDesc') };
}
/** XMLHttpRequest, not fetch, so each file shows real upload progress. */
function sendOne(q, meta){
  return new Promise((resolve) => {
    const form = new FormData();
    form.append('meta', JSON.stringify(meta)); // details first: the server reads them before the file
    form.append('file', q.file, q.file.name);
    const x = new XMLHttpRequest();
    x.open('POST', '/api/org-docs');
    if(csrf()) x.setRequestHeader('x-csrf-token', csrf());
    x.upload.onprogress = (e) => { if(e.lengthComputable){ q.pct = Math.round((e.loaded / e.total) * 100); const bar = document.querySelector('.up-row:nth-child(' + (queue.indexOf(q) + 1) + ') .up-bar i'); if(bar) bar.style.width = q.pct + '%'; } };
    x.onload = () => {
      if(x.status >= 200 && x.status < 300){ q.state = 'done'; q.error = ''; }
      else {
        // A file the server refuses (wrong type, infected, empty) will never succeed: no Retry, only Remove.
        q.state = x.status === 400 || x.status === 422 || x.status === 413 ? 'rejected' : 'failed';
        try{ q.error = JSON.parse(x.responseText).message; }catch{ q.error = x.status === 413 ? 'That file is too large.' : 'Upload failed (' + x.status + ')'; }
      }
      resolve();
    };
    x.onerror = () => { q.state = 'failed'; q.error = 'No connection. Check your signal and retry.'; resolve(); };
    x.send(form);
  });
}
async function startUploads(only){
  const restore = keepForm();
  const todo = queue.filter((q, i) => (only === undefined || i === only) && (q.state === 'ready' || q.state === 'failed'));
  if(!todo.length) return;
  const metas = new Map(todo.map((q) => [q, metaFor(q)]));
  todo.forEach((q) => { q.state = 'uploading'; q.pct = 0; q.error = ''; });
  drawUpload(); restore();
  for(const q of todo) await sendOne(q, metas.get(q)); // one at a time: kinder to a weak mobile connection
  const restore2 = keepForm(); drawUpload(); restore2();
  const ok = todo.filter((q) => q.state === 'done').length, retry = todo.filter((q) => q.state === 'failed').length, refused = todo.filter((q) => q.state === 'rejected').length;
  showToast(ok + ' uploaded' + (retry ? ', ' + retry + ' failed — tap Retry' : '') + (refused ? ', ' + refused + ' not accepted' : ''));
  invalidateDocstore();
  if(uploadOpts.onUploaded) uploadOpts.onUploaded();
}
on('up-pick', (el) => addFiles(el.files));
on('up-remove', (el) => { const r = keepForm(); queue.splice(Number(el.dataset.i), 1); drawUpload(); r(); });
on('up-retry', (el) => startUploads(Number(el.dataset.i)));
on('up-start', () => startUploads());
on('up-done', () => { closeSheet(); render(); });
on('up-wp', (el) => { const a = document.getElementById('upArea'); if(a) a.innerHTML = '<option value="">None</option>' + areaOptions(el.value); });
on('up-scope', () => {});

/* ---------- one document: details, versions, file, new version, archive ---------- */
export async function openDocSheet(id){
  const r = await api.get('/api/org-docs/' + encodeURIComponent(id));
  const d = r.document, mine = r.mine, admin = ['owner', 'admin'].includes(S.boot.org.role);
  const row = (k, v) => (v ? '<div class="dkv"><span>' + k + '</span><span>' + v + '</span></div>' : '');
  openSheet(sheetHead(escapeHtml(d.name), typeLabel(d.docType) + (mine ? '' : ' · shared by ' + escapeHtml(d.orgName)))
    + '<div class="card" style="padding:4px 14px;">' + row('Status', d.archivedAt ? 'Archived' : 'Received' + (d.expiryDate ? expiryText(d.expiryDate) : ''))
    + row('Belongs to', escapeHtml(d.scope === 'company' ? 'Company-wide' : d.scope)) + row('Site', escapeHtml(d.workplaceName || '')) + row('Department or area', escapeHtml(d.areaName || ''))
    + row('About', escapeHtml(d.subject || '')) + row('For contractors', d.visibility === 'contractors' ? escapeHtml(d.requirement) : '')
    + row('Who can see it', d.visibility === 'restricted' ? 'Owners and admins only' : d.visibility === 'contractors' ? 'This organisation and its contractors on the site' : 'This organisation')
    + row('Issued', escapeHtml(d.issueDate || '')) + row('Expires', escapeHtml(d.expiryDate || '')) + row('Responsible', escapeHtml(d.ownerName || ''))
    + row('Version', String(d.version)) + row('File', escapeHtml(d.filename || '') + (d.size ? ' · ' + Math.max(1, Math.round(d.size / 1024)) + ' KB' : '')) + '</div>'
    + (d.description ? '<p class="site-card-sub" style="margin:10px 0;">' + escapeHtml(d.description) + '</p>' : '')
    + '<div class="row-actions" style="margin:12px 0;"><a class="btn primary small" href="/api/org-docs/' + d.id + '/file" target="_blank" rel="noopener">Open</a><a class="btn secondary small" href="/api/org-docs/' + d.id + '/file?download=1">Download</a>'
    + (mine && !d.archivedAt ? '<label class="btn secondary small" for="verFile" style="cursor:pointer;">' + ICONS.upload + ' New version<input type="file" id="verFile" accept="' + ACCEPT + '" data-action-change="doc-version" data-id="' + d.id + '" style="position:absolute;opacity:0;width:1px;height:1px;"></label>' : '')
    + (mine ? '<button class="btn secondary small" data-action="doc-archive" data-id="' + d.id + '" data-on="' + (d.archivedAt ? '0' : '1') + '">' + (d.archivedAt ? 'Restore' : 'Archive') + '</button>' : '') + '</div>'
    + (mine && r.versions.length ? '<div class="section-title">Versions</div><div class="card">' + r.versions.map((v) => '<div class="menu-row" style="cursor:default;"><div style="flex:1;"><div class="qa-title">Version ' + v.version + (v.version === d.version ? ' (current)' : '') + '</div><div class="qa-sub">'
      + escapeHtml(v.filename) + ' · ' + escapeHtml(v.by) + ' · ' + new Date(v.at).toLocaleDateString('en-ZA') + (v.note ? ' · ' + escapeHtml(v.note) : '') + '</div></div><a class="btn secondary small" href="/api/org-docs/' + d.id + '/file?v=' + v.version + '" target="_blank" rel="noopener">Open</a></div>').join('') + '</div>' : '')
    + (admin || !mine ? '' : ''));
}
export function expiryText(date){
  const days = Math.round((new Date(date) - Date.now()) / 86400000);
  return days < 0 ? ' · <span style="color:var(--red)">expired</span>' : days <= 30 ? ' · <span style="color:var(--amber)">expires in ' + days + ' days</span>' : '';
}
on('open-orgdoc', (el) => openDocSheet(el.dataset.id).catch((e) => showToast(e.message)));
on('doc-version', async (el) => {
  const f = el.files && el.files[0]; if(!f) return;
  try{ await api.upload('/api/org-docs/' + el.dataset.id + '/version', f); showToast('New version uploaded'); invalidateDocstore(); openDocSheet(el.dataset.id); render(); }
  catch(e){ showToast(e.message); }
});
on('doc-archive', async (el) => {
  try{ await api.post('/api/org-docs/' + el.dataset.id + '/archive', { archived: el.dataset.on === '1' }); showToast(el.dataset.on === '1' ? 'Archived' : 'Restored'); invalidateDocstore(); closeSheet(); render(); }
  catch(e){ showToast(e.message); }
});
on('open-upload', (el) => openUploadSheet({ docType: el && el.dataset ? el.dataset.type : undefined, workplaceId: el && el.dataset ? el.dataset.wp : undefined, visibility: el && el.dataset ? el.dataset.vis : undefined, onUploaded: () => render() }));
void val;
