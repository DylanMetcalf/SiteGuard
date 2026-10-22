/** The public interactive walkthrough page (/walkthrough): fictional data, no API calls. */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { setup, teardown } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = await setup(); });
after(teardown);

describe('interactive walkthrough', () => {
  it('is served publicly, without caching, under the normal security headers', async () => {
    const r = await app.inject({ method: 'GET', url: '/walkthrough' });
    assert.equal(r.statusCode, 200);
    assert.match(String(r.headers['content-type']), /text\/html/);
    assert.equal(r.headers['cache-control'], 'no-cache');
    assert.match(String(r.headers['content-security-policy']), /script-src 'self'/);
    assert.match(r.body, /Interactive walkthrough/);
    assert.match(r.body, /are fictional/);
    for (const asset of ['/walkthrough.css', '/js/walkthrough-page.js']) {
      assert.equal((await app.inject({ method: 'GET', url: asset })).statusCode, 200, asset);
    }
  });

  it('runs entirely in the browser: no inline scripts and no calls to the API', () => {
    const html = readFileSync('public/walkthrough.html', 'utf8');
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, 'no inline <script>');
    assert.doesNotMatch(html, /\son[a-z]+=/i, 'no inline event handlers');
    const js = readFileSync('public/js/walkthrough-page.js', 'utf8');
    assert.doesNotMatch(js, /fetch\(|XMLHttpRequest|\/api\//, 'the demo never talks to the server');
  });
});
