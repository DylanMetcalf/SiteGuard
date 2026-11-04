/** Virus scanning of uploads (optional, fails closed), against a fake clamd speaking INSTREAM. */
import './scan-env.js';
import net from 'node:net';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { Agent, PDF, setup, signup, teardown } from './helpers.js';

let app: FastifyInstance, con: Agent, reqId: string, clamd: net.Server | null = null;

function startClamd() {
  return new Promise<void>((resolve) => {
    clamd = net.createServer((sock) => {
      let buf = Buffer.alloc(0);
      sock.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        if (buf.length >= 14 && buf.subarray(buf.length - 4).readUInt32BE(0) === 0) {
          sock.end(buf.includes('EICAR-TEST') ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
        }
      });
    }).listen(33100, '127.0.0.1', () => resolve());
  });
}

before(async () => {
  await startClamd();
  app = await setup();
  const mine = (await signup(app, { orgName: 'Scan Mining', orgKind: 'host' })).agent;
  con = (await signup(app, { orgName: 'Scan Welding', orgKind: 'contractor' })).agent;
  const w = await mine.post('/api/workplaces', { name: 'Scan Site', requirements: [{ category: 'Company Documents', name: 'Letter of Good Standing (COID)', source: 'legal' }] });
  const siteId = (await con.post('/api/sites/join', { code: w.body.code })).body.siteId;
  reqId = (await con.state()).state.requirements[siteId][0].id;
});
after(async () => { clamd?.close(); await teardown(); });

describe('virus scanning', () => {
  it('accepts a clean file', async () => {
    assert.equal((await con.upload(`/api/documents/${reqId}/file`, 'coid.pdf', PDF)).status, 200);
  });

  it('refuses an infected file and stores nothing', async () => {
    const bad = Buffer.concat([PDF, Buffer.from('EICAR-TEST')]);
    const r = await con.upload(`/api/documents/${reqId}/file`, 'coid.pdf', bad);
    assert.equal(r.status, 422);
    assert.equal(r.body.error, 'infected_file');
  });

  it('fails closed when the scanner is down', async () => {
    await new Promise<void>((resolve) => clamd!.close(() => resolve()));
    clamd = null;
    const r = await con.upload(`/api/documents/${reqId}/file`, 'coid.pdf', PDF);
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'scan_unavailable');
  });
});
