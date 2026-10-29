import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { redactUrl } from '../src/app.js';

describe('request logs never hold link tokens', () => {
  it('redacts links and token parameters, and leaves ordinary URLs alone', () => {
    assert.equal(redactUrl('/x/AbCdEfGhIjKlMnOpQrStUv'), '/x/[redacted]');
    assert.equal(redactUrl('/gate/zzzzzzzzzzzzzzzz'), '/gate/[redacted]');
    assert.equal(redactUrl('/api/auth/invite/abcdefghijklmnop123/accept'), '/api/auth/invite/[redacted]/accept');
    assert.equal(redactUrl('/api/review-links/abcdefghijklmnop123/pdf'), '/api/review-links/[redacted]/pdf');
    assert.equal(redactUrl('/reset-password?token=abc123&x=1'), '/reset-password?token=[redacted]&x=1');
    assert.equal(redactUrl('/api/sites?q=1'), '/api/sites?q=1');
  });
});
