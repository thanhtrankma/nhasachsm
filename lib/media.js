// Image storage: Supabase Storage bucket (default "media") when configured, assets/uploads locally.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { HttpError } from './http.js';
import { supabase, hasSupabase } from './store.js';

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'media';
const LOCAL_DIR = path.join(process.cwd(), 'assets', 'uploads');

function storageError(error) {
  const e = new Error(/bucket not found/i.test(error.message)
    ? `Chưa có bucket “${BUCKET}” trên Supabase. Chạy file supabase/schema.sql trong SQL Editor.`
    : `[supabase storage] ${error.message}`);
  e.expose = /bucket not found/i.test(error.message);
  return e;
}

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

  if (hasSupabase) {
    const bucket = (await supabase()).storage.from(BUCKET);
    const { error } = await bucket.upload(`uploads/${name}`, buf, { contentType: kind.type, cacheControl: '31536000', upsert: false });
    if (error) throw storageError(error);
    return bucket.getPublicUrl(`uploads/${name}`).data.publicUrl;
  }
  if (process.env.VERCEL) throw new HttpError(503, 'Chưa cấu hình Supabase (SUPABASE_URL, SUPABASE_SECRET_KEY).');
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  fs.writeFileSync(path.join(LOCAL_DIR, name), buf);
  return `assets/uploads/${name}`;
}

/** Uploaded images (newest first). Static images referenced by content are added by the caller. */
export async function listUploads() {
  if (hasSupabase) {
    const bucket = (await supabase()).storage.from(BUCKET);
    const { data, error } = await bucket.list('uploads', { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } });
    if (error) throw storageError(error);
    return data.filter(f => f.id && /\.(jpe?g|png|webp)$/i.test(f.name)).map(f => ({
      path: bucket.getPublicUrl(`uploads/${f.name}`).data.publicUrl,
      time: new Date(f.created_at).getTime(),
    }));
  }
  if (!fs.existsSync(LOCAL_DIR)) return [];
  return fs.readdirSync(LOCAL_DIR)
    .filter(f => /\.(jpe?g|png|webp)$/i.test(f))
    .map(f => ({ path: `assets/uploads/${f}`, time: fs.statSync(path.join(LOCAL_DIR, f)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
}
