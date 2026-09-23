/**
 * Object storage for uploaded documents. Objects are private: the browser
 * never gets a bucket URL, only /api/files/:id, which checks permissions and
 * then streams the object (local) or redirects to a 60-second presigned URL (S3).
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Either a URL to redirect to, or a stream to send. */
  get(key: string, filename: string, contentType: string): Promise<{ url: string } | { stream: Readable; size: number }>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

class LocalStorage implements Storage {
  constructor(private root: string) {}
  private file(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error('bad key');
    return p;
  }
  async put(key: string, body: Buffer) {
    const p = this.file(key);
    await mkdir(path.dirname(p), { recursive: true });
    await pipeline(Readable.from(body), createWriteStream(p));
  }
  async get(key: string) {
    const p = this.file(key);
    const s = await stat(p);
    return { stream: createReadStream(p), size: s.size };
  }
  async read(key: string) {
    const chunks: Buffer[] = [];
    for await (const c of createReadStream(this.file(key))) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }
  async remove(key: string) {
    await unlink(this.file(key)).catch(() => {});
  }
}

class S3Storage implements Storage {
  private s3: S3Client;
  constructor(private bucket: string) {
    this.s3 = new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT || undefined,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials:
        config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY }
          : undefined,
    });
  }
  async put(key: string, body: Buffer, contentType: string) {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'AES256' }),
    );
  }
  async get(key: string, filename: string, contentType: string) {
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: contentType,
        ResponseContentDisposition: contentDisposition(filename),
      }),
      { expiresIn: 60 },
    );
    return { url };
  }
  async read(key: string) {
    const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async remove(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export function contentDisposition(filename: string, inline = true): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export const storage: Storage =
  config.STORAGE_DRIVER === 's3' ? new S3Storage(config.S3_BUCKET!) : new LocalStorage(config.LOCAL_STORAGE_DIR);

/** Types we accept for compliance documents. Anything else is rejected. */
export const ALLOWED_TYPES: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/heic': ['.heic'],
  'text/plain': ['.txt'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
};

/** Sniffs magic bytes so a renamed executable can't pass as a PDF. */
export function sniffType(buf: Buffer, declared: string, filename: string): string | null {
  const ext = path.extname(filename).toLowerCase();
  const starts = (sig: number[], offset = 0) => sig.every((b, i) => buf[offset + i] === b);
  if (starts([0x25, 0x50, 0x44, 0x46])) return 'application/pdf';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  if (starts([0x66, 0x74, 0x79, 0x70], 4) && /^(heic|heix|mif1|msf1)$/.test(buf.subarray(8, 12).toString())) return 'image/heic';
  if (starts([0x50, 0x4b, 0x03, 0x04])) {
    if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return null;
  }
  if (declared === 'text/plain' || ext === '.txt') {
    // Plain text: must be valid UTF-8 without NUL bytes.
    if (buf.includes(0)) return null;
    return 'text/plain';
  }
  return null;
}
