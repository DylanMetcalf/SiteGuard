// Thin client for the COMVERA API. Every request carries the session cookie
// (same origin) and, for writes, the per-session CSRF token.

let csrfToken = '';
export function setCsrf(token) { csrfToken = token || ''; }

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function handle(res) {
  let body = null;
  try { body = await res.json(); } catch { /* empty or non-JSON */ }
  if (res.status === 401 && !/\/api\/auth\//.test(res.url)) {
    // Signed out elsewhere or the session expired: send the person back to sign in.
    window.dispatchEvent(new CustomEvent('sg:signed-out'));
  }
  if (!res.ok) {
    const message = (body && body.message) || (res.status === 0 ? 'Network error' : 'Request failed (' + res.status + ')');
    throw new ApiError(res.status, body && body.error, message);
  }
  return body;
}

export async function request(method, url, body) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network', "Can't reach COMVERA — check your connection and try again.");
  }
  const out = await handle(res);
  // A site's validity rule shortened an expiry date: tell the person (core.js shows it).
  if (out && typeof out.ruleNote === 'string' && out.ruleNote) window.dispatchEvent(new CustomEvent('sg-rule-note', { detail: out.ruleNote }));
  return out;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  patch: (url, body = {}) => request('PATCH', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  del: (url) => request('DELETE', url),

  /** POSTs and saves the file the server sends back (e.g. a merged PDF). */
  async download(url, body, fallbackName) {
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: JSON.stringify(body || {}), credentials: 'same-origin' });
    } catch {
      throw new ApiError(0, 'network', "Can't reach COMVERA — check your connection and try again.");
    }
    if (!res.ok) return handle(res);
    const blob = await res.blob();
    const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get('content-disposition') || '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = m ? decodeURIComponent(m[1]) : fallbackName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  },

  /** Multipart upload of a single file (field name "file"). */
  async upload(url, file, filename) {
    const form = new FormData();
    form.append('file', file, filename || file.name);
    let res;
    try {
      res = await fetch(url, { method: 'POST', body: form, headers: csrfToken ? { 'x-csrf-token': csrfToken } : {}, credentials: 'same-origin' });
    } catch {
      throw new ApiError(0, 'network', 'Upload failed — check your connection and try again.');
    }
    return handle(res);
  },

  /** POSTs JSON and streams a text/plain response, calling onText with the accumulated text. */
  async stream(url, body, onText, signal, onHeaders) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
    if (!res.ok) return handle(res);
    if (onHeaders) onHeaders(res.headers);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      const marker = text.indexOf('\u0000ERROR:');
      if (marker >= 0) throw new ApiError(502, 'stream', text.slice(marker + 7));
      onText(text);
    }
    return text;
  },
};
