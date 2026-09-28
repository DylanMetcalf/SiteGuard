/** Hosting dashboards (e.g. Render) may save a blank setting as an empty value: the app must still start. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

describe('configuration', () => {
  it('treats blank settings as not set', () => {
    const blank = { APP_URL: '', SUPPORT_EMAIL: '', SMTP_URL: '', EMAIL_FROM: ' ', ANTHROPIC_API_KEY: '', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' };
    const out = execFileSync(process.execPath, ['--import', 'tsx', '-e', "import('./src/config.ts').then(m => console.log(JSON.stringify(m.config)))"], {
      env: { ...process.env, ...blank, NODE_ENV: 'production', RENDER_EXTERNAL_URL: 'https://siteguard-test.onrender.com' },
      encoding: 'utf8',
    });
    const c = JSON.parse(out.trim().split('\n').pop()!);
    assert.equal(c.APP_URL, 'https://siteguard-test.onrender.com');
    assert.equal(c.SUPPORT_EMAIL, undefined);
    assert.match(c.EMAIL_FROM, /SiteGuard/);
    assert.equal(c.ANTHROPIC_API_KEY, undefined);
  });
});
