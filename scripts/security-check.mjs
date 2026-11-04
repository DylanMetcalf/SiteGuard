// Read-only weekly check of the live site: security headers present and the TLS certificate not close to
// expiry. Changes nothing. Usage: COMVERA_URL=https://comvera.co.za node scripts/security-check.mjs
import tls from 'node:tls';

const base = process.env.COMVERA_URL;
if (!base) { console.log('COMVERA_URL not set; skipping.'); process.exit(0); }
const url = new URL(base);
const problems = [];

const res = await fetch(url, { redirect: 'manual' });
const h = (n) => res.headers.get(n) || '';
if (!/script-src 'self'/.test(h('content-security-policy'))) problems.push('Content-Security-Policy missing or weakened');
if (url.protocol === 'https:' && !/max-age=\d{7,}/.test(h('strict-transport-security'))) problems.push('Strict-Transport-Security missing');
if (h('x-content-type-options') !== 'nosniff') problems.push('X-Content-Type-Options missing');
if (!h('permissions-policy')) problems.push('Permissions-Policy missing');
if (/x-powered-by/i.test([...res.headers.keys()].join(' '))) problems.push('X-Powered-By header exposed');

if (url.protocol === 'https:') {
  const days = await new Promise((resolve, reject) => {
    const s = tls.connect({ host: url.hostname, port: 443, servername: url.hostname }, () => {
      const cert = s.getPeerCertificate();
      s.end();
      resolve((new Date(cert.valid_to).getTime() - Date.now()) / 86400000);
    });
    s.on('error', reject);
  });
  if (days < 14) problems.push(`TLS certificate expires in ${Math.floor(days)} days`);
  else console.log(`Certificate valid for ${Math.floor(days)} more days.`);
}

if (problems.length) { console.error('Security check failed:\n- ' + problems.join('\n- ')); process.exit(1); }
console.log('Security headers and certificate OK.');
