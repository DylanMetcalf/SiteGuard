// Thin client for the SiteGuard API. Every request carries the session cookie
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
    throw new ApiError(0, 'network', "Can't reach SiteGuard — check your connection and try again.");
  }
  return handle(res);
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  patch: (url, body = {}) => request('PATCH', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  del: (url) => request('DELETE', url),

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
  async stream(url, body, onText, signal) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}) },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
    if (!res.ok) return handle(res);
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
