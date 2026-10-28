/**
 * Paystack API client (https://paystack.com/docs/api/). Server-side only: the secret key never
 * leaves this process, and COMVERA never sees card numbers (Paystack's hosted checkout takes them).
 *
 * Nothing here trusts the browser: a payment counts only after a signed webhook arrives AND the
 * transaction is re-fetched from Paystack and matches what we expected (amount, currency, reference).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { unavailable } from './errors.js';

const BASE = 'https://api.paystack.co';

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...args) => fetch(...args);
/** Tests replace the network with a fake Paystack. */
export function setPaystackFetch(f: Fetch | null) {
  fetchImpl = f ?? ((...args) => fetch(...args));
}

export class PaystackError extends Error {}

export async function paystack<T = Record<string, unknown>>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  if (!config.PAYSTACK_SECRET_KEY) throw unavailable('Online payments aren\'t switched on yet. Contact us to subscribe, or use a promo code.');
  const res = await fetchImpl(BASE + path, {
    method,
    headers: { authorization: `Bearer ${config.PAYSTACK_SECRET_KEY}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; data?: T };
  if (!res.ok || !json.status) throw new PaystackError(`Paystack ${method} ${path.split('?')[0]} failed: ${res.status} ${json.message ?? ''}`.trim());
  return json.data as T;
}

/** x-paystack-signature is the HMAC-SHA512 of the raw request body, keyed with the secret key. */
export function validSignature(raw: Buffer, signature: string | undefined): boolean {
  if (!config.PAYSTACK_SECRET_KEY || !signature) return false;
  const expected = createHmac('sha512', config.PAYSTACK_SECRET_KEY).update(raw).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface PaystackTransaction {
  reference: string;
  status: string;
  amount: number;
  currency: string;
  gateway_response?: string;
  paid_at?: string | null;
  customer?: { customer_code?: string; email?: string };
  plan?: { plan_code?: string } | string | null;
  metadata?: Record<string, unknown> | string | null;
}

export const verifyTransaction = (reference: string) => paystack<PaystackTransaction>('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
