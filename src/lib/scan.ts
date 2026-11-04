/**
 * Optional virus scanning of uploads with ClamAV (clamd's INSTREAM command over TCP), with no extra
 * dependency. Off unless CLAMAV_HOST is set. When it is on, it fails closed: if the scanner cannot
 * be reached the upload is refused rather than stored unscanned. Files never leave our own network
 * (the scanner is a private service), so no document is sent to a third party.
 */
import net from 'node:net';
import { config } from '../config.js';
import { HttpError } from './errors.js';

export type ScanResult = { clean: true } | { clean: false; signature: string };

export const scanningEnabled = () => !!config.CLAMAV_HOST;

export function clamdScan(buf: Buffer, host = config.CLAMAV_HOST!, port = config.CLAMAV_PORT, timeoutMs = 20_000): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    let reply = '';
    const fail = (err: Error) => { sock.destroy(); reject(err); };
    sock.setTimeout(timeoutMs, () => fail(new Error('scanner timed out')));
    sock.on('error', fail);
    sock.on('data', (d) => { reply += d.toString('utf8'); });
    sock.on('end', () => {
      const text = reply.replace(/\0/g, '').trim();
      if (/:\s*OK$/.test(text)) return resolve({ clean: true });
      const found = /:\s*(.+)\s+FOUND$/.exec(text);
      if (found) return resolve({ clean: false, signature: found[1].slice(0, 200) });
      reject(new Error('unexpected scanner reply'));
    });
    sock.on('connect', () => {
      sock.write('zINSTREAM\0');
      for (let i = 0; i < buf.length; i += 64 * 1024) {
        const chunk = buf.subarray(i, i + 64 * 1024);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        sock.write(len);
        sock.write(chunk);
      }
      sock.write(Buffer.alloc(4)); // zero-length chunk ends the stream
    });
  });
}

/** Throws a plain-language error when a file is infected, or when scanning is on but unavailable. */
export async function assertClean(buf: Buffer): Promise<void> {
  if (!scanningEnabled()) return;
  let r: ScanResult;
  try {
    r = await clamdScan(buf);
  } catch {
    throw new HttpError(503, 'scan_unavailable', 'We could not check this file for viruses just now. Please try again in a few minutes.');
  }
  if (!r.clean) throw new HttpError(422, 'infected_file', 'This file was flagged by our virus scanner and was not saved. Check it with your own antivirus, then upload a clean copy.');
}
