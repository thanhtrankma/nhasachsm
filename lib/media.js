// Image storage: Vercel Blob in production (env BLOB_READ_WRITE_TOKEN), assets/uploads locally.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError } from './http.js';

const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN;
const LOCAL_DIR = path.join(process.cwd(), 'assets', 'uploads');

export const MEDIA_MISSING_MSG = 'Chưa kết nối Vercel Blob. Vào Vercel → Storage → tạo Blob store và kết nối với project, rồi Redeploy.';

export function detectImage(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', type: 'image/png' };
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return { ext: 'webp', type: 'image/webp' };
  return null; // SVG/GIF/others rejected on purpose (SVG can carry scripts)
}

const slug = s => (String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'anh');

export async function saveImage(buf, originalName) {
  const kind = detectImage(buf);
  if (!kind) throw new HttpError(400, 'Chỉ nhận ảnh JPG, PNG hoặc WebP');
  const stem = slug(path.parse(String(originalName || 'anh')).name);
  const name = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}-${stem}.${kind.ext}`;

  if (useBlob) {
    const { put } = await import('@vercel/blob');
    const blob = await put(`uploads/${name}`, buf, { access: 'public', contentType: kind.type, addRandomSuffix: false });
    return blob.url;
  }
  if (process.env.VERCEL) { const e = new Error(MEDIA_MISSING_MSG); e.expose = true; throw e; }
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  fs.writeFileSync(path.join(LOCAL_DIR, name), buf);
  return `assets/uploads/${name}`;
}

/** Uploaded images (newest first). Static images referenced by content are added by the caller. */
export async function listUploads() {
  if (useBlob) {
    const { list } = await import('@vercel/blob');
    const out = []; let cursor;
    do {
      const page = await list({ prefix: 'uploads/', limit: 1000, cursor });
      out.push(...page.blobs.map(b => ({ path: b.url, time: new Date(b.uploadedAt).getTime() })));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out.sort((a, b) => b.time - a.time);
  }
  if (!fs.existsSync(LOCAL_DIR)) return [];
  return fs.readdirSync(LOCAL_DIR)
    .filter(f => /\.(jpe?g|png|webp)$/i.test(f))
    .map(f => ({ path: `assets/uploads/${f}`, time: fs.statSync(path.join(LOCAL_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
}
