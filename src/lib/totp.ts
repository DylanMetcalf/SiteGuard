/**
 * Authenticator-app codes (RFC 6238: SHA-1, 30-second steps, 6 digits) with no extra dependency,
 * plus single-use recovery codes. Secrets are encrypted at rest when MFA_SECRET_KEY is set.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;

export function base32(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function unbase32(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(c);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newSecret = () => base32(randomBytes(20));

export function codeAt(secret: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/** The step a code matches (this one or one either side, for clock drift), or null. */
export function matchStep(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const want = Buffer.from(code);
  const cur = currentStep(now);
  for (const step of [cur, cur - 1, cur + 1]) {
    const got = Buffer.from(codeAt(secret, step));
    if (got.length === want.length && timingSafeEqual(got, want)) return step;
  }
  return null;
}

export const otpauthUrl = (email: string, secret: string) =>
  `otpauth://totp/COMVERA:${encodeURIComponent(email)}?secret=${secret}&issuer=COMVERA&digits=6&period=${STEP_SECONDS}`;

const key = () => (config.MFA_SECRET_KEY ? createHash('sha256').update(config.MFA_SECRET_KEY).digest() : null);

export function sealSecret(secret: string): string {
  const k = key();
  if (!k) return 'plain:' + secret;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', k, iv);
  const enc = Buffer.concat([c.update(secret, 'utf8'), c.final()]);
  return 'gcm:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

export function openSecret(stored: string): string | null {
  if (stored.startsWith('plain:')) return stored.slice(6);
  const k = key();
  if (!k || !stored.startsWith('gcm:')) return null;
  try {
    const raw = Buffer.from(stored.slice(4), 'base64');
    const d = createDecipheriv('aes-256-gcm', k, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Eight single-use codes like "k3f9-x2m7", shown once; only their hashes are stored. */
export function newRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: 8 }, () => {
    const s = base32(randomBytes(5)).toLowerCase();
    return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
  });
  return { codes, hashes: codes.map(hashRecovery) };
}
export const hashRecovery = (code: string) => createHash('sha256').update(code.trim().toLowerCase().replace(/\s/g, '')).digest('hex');
