#!/usr/bin/env node
/**
 * Synthetic check of a deployed COMVERA: the app loads, the database is
 * reachable, the API answers, and protected endpoints stay protected.
 * Usage: COMVERA_URL=https://app.example.co.za node scripts/smoke.mjs
 * Set SMOKE_DEMO=1 to also create a demo sandbox and load its dashboard data.
 */
const base = (process.env.COMVERA_URL || process.env.SITEGUARD_URL || '').replace(/\/$/, '');
if (!base) {
  console.error('Set COMVERA_URL');
  process.exit(2);
}

const results = [];
async function check(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t, error: err.message });
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const get = (path, init) => fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(20000), ...init });

await check('health (app + database)', async () => {
  const r = await get('/healthz');
  assert(r.status === 200, `status ${r.status}`);
  assert((await r.json()).ok === true, 'not ok');
});
await check('web app loads', async () => {
  const r = await get('/');
  assert(r.status === 200, `status ${r.status}`);
  assert((await r.text()).includes('COMVERA'), 'page does not mention COMVERA');
});
await check('scripts and styles served', async () => {
  for (const p of ['/js/app.js', '/app.css']) {
    const r = await get(p);
    assert(r.status === 200, `${p} status ${r.status}`);
  }
});
await check('anonymous bootstrap', async () => {
  const r = await get('/api/bootstrap');
  assert(r.status === 200, `status ${r.status}`);
  assert((await r.json()).authenticated === false, 'anonymous request looked signed in');
});
await check('protected endpoints refuse anonymous callers', async () => {
  for (const [method, path] of [['POST', '/api/assistant'], ['GET', '/api/agent/findings'], ['POST', '/api/sites']]) {
    const r = await get(path, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    assert(r.status === 401 || r.status === 403, `${method} ${path} returned ${r.status}`);
  }
});
if (process.env.SMOKE_DEMO === '1') {
  await check('demo sandbox', async () => {
    const r = await get('/api/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert(r.status === 200, `status ${r.status}`);
    const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
    const b = await (await get('/api/bootstrap', { headers: { cookie } })).json();
    assert(b.authenticated && Object.keys(b.state.sites).length > 0, 'demo has no sites');
  });
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name} (${r.ms} ms)${r.error ? ' — ' + r.error : ''}`);
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  console.log(`\n${failed.length} check(s) failed against ${base}`);
  process.exit(1);
}
console.log(`\nAll checks passed against ${base}`);
