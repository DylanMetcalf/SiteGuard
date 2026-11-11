// Document style for everything created in Document Studio: logo, colours (suggested from the logo), an
// accent colour, a monochrome option, the industry (which decides the legal references) and document numbers.
// Colours and the greyscale logo are worked out here in the browser (canvas); the server only stores the result.
import { api } from './api.js';
import { S, on, act, openSheet, sheetHead, showToast, org } from './core.js';

const SWATCHES = [['#16325C', 'Navy'], ['#3F6E55', 'Sage'], ['#0F6B6B', 'Teal'], ['#B8430F', 'Safety orange'], ['#A51C24', 'Red'], ['#5B2A86', 'Purple'], ['#1C1C1C', 'Black']];
const INDUSTRIES = [['mining', 'Mining'], ['quarrying', 'Quarrying'], ['construction', 'Construction'], ['energy', 'Energy and utilities'], ['manufacturing', 'Manufacturing'], ['petrochemical', 'Petrochemical'], ['other', 'Other']];
const hexOk = (v) => /^#[0-9a-fA-F]{6}$/.test(v || '');

export function docStyleBody(ro){
  const b = org().branding || {};
  const brand = b.brandColor || '#16325C', accent = b.accentColor || '';
  const sw = (target, current) => SWATCHES.map(([c, n]) => '<button class="swatch' + (c.toLowerCase() === (current || '').toLowerCase() ? ' active' : '') + '" style="background:' + c + ';" data-action="pick-swatch" data-target="' + target + '" data-color="' + c + '" aria-label="' + n + '" title="' + n + '"' + (ro ? ' disabled' : '') + '></button>').join('');
  if(b.logoFileId) setTimeout(paintLogoSwatches, 0);
  return '<div class="site-card-sub">Applied to every document created in Document Studio: your logo on the cover and every page header, your colours on headings and tables, and your document numbers.</div>'
    + '<label class="field-label">Logo</label><div class="logo-preview">' + (b.logoFileId ? '<img id="brandLogoImg" src="/api/files/' + b.logoFileId + '" alt="Company logo">' : '<span class="site-card-sub">No logo yet — documents show your company name instead.</span>') + '</div>'
    + (ro ? '' : '<div class="row-actions"><label class="btn secondary small" for="logoInput" style="cursor:pointer;">' + (b.logoFileId ? 'Replace logo' : 'Upload logo') + '</label><input type="file" id="logoInput" accept="image/png,image/jpeg" class="sr-only" data-action-change="upload-logo">'
      + (b.logoFileId ? '<button class="btn danger small" data-action="remove-logo">Remove</button>' : '') + '</div><div class="site-card-sub" style="margin-top:6px;">PNG or JPG, under 2 MB. A wide logo on a transparent background looks best.</div>')
    + (b.logoFileId ? '<div id="logoSwatches" class="logo-swatches" aria-live="polite"></div>' : '')
    + '<label class="field-label">Main colour</label><div class="swatch-row">' + sw('brandColor', brand) + '<input type="color" id="brandColor" value="' + brand + '" aria-label="Custom main colour"' + (ro ? ' disabled' : '') + '></div>'
    + '<label class="field-label">Accent colour <span class="muted" style="font-weight:400;">(optional)</span></label><div class="swatch-row">' + sw('accentColor', accent) + '<input type="color" id="accentColor" value="' + (accent || '#6E9C80') + '" aria-label="Custom accent colour"' + (ro ? ' disabled' : '') + '>'
      + '<label class="toggle-row" style="border:none;padding:0 0 0 8px;gap:6px;"><input type="checkbox" id="accentOn"' + (accent ? ' checked' : '') + (ro ? ' disabled' : '') + '> Use it</label></div>'
    + '<label class="toggle-row" style="border:none;padding:12px 0 4px;"><span><b>Monochrome</b><br><span class="site-card-sub">Black and grey only, with a greyscale copy of your logo. Good for printing and faxing.</span></span><input type="checkbox" id="monoOn"' + (b.monochrome ? ' checked' : '') + (ro ? ' disabled' : '') + '></label>'
    + '<label class="field-label" for="industrySel">Industry</label><select id="industrySel" class="field"' + (ro ? ' disabled' : '') + '>' + INDUSTRIES.map(([v, l]) => '<option value="' + v + '"' + ((b.industry || 'mining') === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>'
    + '<div class="site-card-sub" style="margin-top:4px;">Decides which laws documents refer to: mines and quarries the Mine Health and Safety Act, construction the Construction Regulations, and every industry the OHS Act.</div>'
    + '<label class="field-label" for="docPrefix">Document number prefix</label><input type="text" id="docPrefix" value="' + (b.docPrefix || '') + '" maxlength="12" style="text-transform:uppercase;" placeholder="e.g. ABC"' + (ro ? ' disabled' : '') + '>'
    + '<div class="site-card-sub" style="margin-top:4px;">Documents are numbered like ' + (b.docPrefix || 'ABC') + '-RA-001.</div>'
    + '<div class="style-preview" id="stylePreview" aria-hidden="true"></div>'
    + (ro ? '' : '<button class="btn primary block" style="margin-top:12px;" data-action="save-branding">Save document style</button>');
}

export function openDocStyle(){
  const ro = !['owner', 'admin'].includes(S.boot.org.role) || S.boot.org.standing === 'lapsed';
  openSheet(sheetHead('Document style', ro ? 'Only an owner or admin can change this.' : 'How documents you create in Document Studio look') + docStyleBody(ro));
  paintPreview();
}

/* ---------- colours from the logo ---------- */
const toHex = (r, g, b) => '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
function loadImage(src){ return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
/** The most common distinct colours, skipping transparent, near-white and near-grey pixels. */
export async function logoColours(src, max = 5){
  const img = await loadImage(src);
  const c = document.createElement('canvas'), n = 72;
  c.width = n; c.height = Math.max(1, Math.round((img.height / img.width) * n));
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, c.width, c.height);
  const px = x.getImageData(0, 0, c.width, c.height).data, buckets = new Map();
  for(let i = 0; i < px.length; i += 4){
    const [r, g, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]];
    if(a < 160) continue;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if(mn > 225) continue; // background white
    const key = (r >> 4) + ',' + (g >> 4) + ',' + (b >> 4), e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0, sat: mx - mn };
    e.n++; e.r += r; e.g += g; e.b += b; buckets.set(key, e);
  }
  const ranked = [...buckets.values()].sort((a, b) => (b.n * (1 + b.sat / 128)) - (a.n * (1 + a.sat / 128)));
  const out = [];
  for(const e of ranked){
    const col = [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)];
    if(out.every((o) => Math.abs(o[0] - col[0]) + Math.abs(o[1] - col[1]) + Math.abs(o[2] - col[2]) > 90)) out.push(col);
    if(out.length >= max) break;
  }
  return out.map((v) => toHex(...v));
}
async function paintLogoSwatches(){
  const box = document.getElementById('logoSwatches'), img = document.getElementById('brandLogoImg');
  if(!box || !img) return;
  try{
    const cols = await logoColours(img.src);
    if(!cols.length){ box.innerHTML = ''; return; }
    box.innerHTML = '<div class="field-label" style="margin-top:12px;">Colours from your logo</div><div class="swatch-row">'
      + cols.map((c, i) => '<button class="swatch" style="background:' + c + ';" data-action="pick-swatch" data-target="' + (i === 0 ? 'brandColor' : 'accentColor') + '" data-color="' + c + '" title="' + c + (i === 0 ? ' — main colour' : ' — accent') + '" aria-label="Use ' + c + '"></button>').join('')
      + '<button class="btn secondary small" data-action="use-logo-colours" data-colours="' + cols.join(',') + '">Use these</button></div>';
  }catch{ box.innerHTML = ''; }
}

/** A greyscale copy of the logo for monochrome documents (made here, uploaded as a PNG). */
async function makeGreyLogo(src){
  const img = await loadImage(src);
  const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  const x = c.getContext('2d'); x.drawImage(img, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height), p = d.data;
  for(let i = 0; i < p.length; i += 4){ const y = Math.round(0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]); p[i] = p[i + 1] = p[i + 2] = y; }
  x.putImageData(d, 0, 0);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  await api.upload('/api/org/logo?variant=mono', blob, 'logo-greyscale.png');
}

function paintPreview(){
  const el = document.getElementById('stylePreview'); if(!el) return;
  const mono = document.getElementById('monoOn') && document.getElementById('monoOn').checked;
  const brand = mono ? '#262626' : (document.getElementById('brandColor') || {}).value || '#16325C';
  const accent = mono ? '#7A7A7A' : (document.getElementById('accentOn') && document.getElementById('accentOn').checked ? document.getElementById('accentColor').value : brand + '99');
  el.innerHTML = '<div class="sp-page"><div class="sp-band" style="background:' + brand + '"></div><div class="sp-h" style="color:' + brand + '">1. Purpose</div><div class="sp-line"></div><div class="sp-line short"></div>'
    + '<div class="sp-table"><div style="background:' + brand + '"></div><div></div><div></div></div><div class="sp-foot" style="background:' + accent + '"></div></div><div class="site-card-sub">Preview</div>';
}
document.addEventListener('input', (e) => { if(e.target && ['brandColor', 'accentColor'].includes(e.target.id)) paintPreview(); });
document.addEventListener('change', (e) => { if(e.target && ['monoOn', 'accentOn'].includes(e.target.id)) paintPreview(); });

on('pick-swatch', (el) => {
  const t = el.dataset.target || 'brandColor', input = document.getElementById(t);
  if(input) input.value = el.dataset.color;
  if(t === 'accentColor' && document.getElementById('accentOn')) document.getElementById('accentOn').checked = true;
  document.querySelectorAll('.swatch[data-target="' + t + '"]').forEach((s) => s.classList.toggle('active', s === el));
  paintPreview();
});
on('use-logo-colours', (el) => {
  const [a, b] = el.dataset.colours.split(',');
  if(hexOk(a)) document.getElementById('brandColor').value = a;
  if(hexOk(b)){ document.getElementById('accentColor').value = b; document.getElementById('accentOn').checked = true; }
  document.querySelectorAll('.swatch[data-target]').forEach((x) => x.classList.toggle('active', x.dataset.color.toLowerCase() === (x.dataset.target === 'brandColor' ? a : b || '').toLowerCase()));
  paintPreview(); showToast('Colours taken from your logo. Save to use them.');
});
/** After a change, redraw the style panel if it is open as a sheet (the settings page redraws itself). */
const refreshSheet = () => { if(document.querySelector('.overlay #stylePreview')) openDocStyle(); };
on('save-branding', (el) => act(async () => {
  const mono = document.getElementById('monoOn').checked;
  await api.patch('/api/org/branding', { brandColor: document.getElementById('brandColor').value, accentColor: document.getElementById('accentOn').checked ? document.getElementById('accentColor').value : '',
    monochrome: mono, industry: document.getElementById('industrySel').value, docPrefix: document.getElementById('docPrefix').value.trim() });
  const b = org().branding || {};
  if(mono && b.logoFileId && !b.logoMonoFileId) await makeGreyLogo('/api/files/' + b.logoFileId);
}, 'Document style saved', el).then(refreshSheet));
on('upload-logo', async (el) => {
  const f = el.files && el.files[0]; if(!f) return;
  await act(async () => {
    const r = await api.upload('/api/org/logo', f);
    if((org().branding || {}).monochrome) await makeGreyLogo('/api/files/' + r.fileId);
  }, 'Logo uploaded');
  refreshSheet();
});
on('remove-logo', (el) => act(() => api.del('/api/org/logo'), 'Logo removed', el).then(refreshSheet));
on('open-docstyle', () => openDocStyle());
