// Site content + booking rules shared by the API functions.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { store } from './store.js';
import { HttpError } from './http.js';

export const BOOKING_STATUSES = ['new', 'contacted', 'confirmed', 'done', 'cancelled'];
const PHONE_RE = /^(0|\+?84)(3|5|7|8|9)\d{8}$/;

/** Saved content, or the default data/content.json shipped with the repo. */
export async function loadContent() {
  const saved = await store.getContent();
  if (saved) return saved;
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'content.json'), 'utf8'));
}

/** Light schema check – enough to stop the site from breaking on a bad save. */
export function validateContent(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new HttpError(400, 'Nội dung không hợp lệ');
  for (const key of ['brand', 'contact', 'hero', 'services', 'pricing', 'gallery', 'faq', 'footer']) {
    if (!c[key] || typeof c[key] !== 'object') throw new HttpError(400, `Thiếu mục “${key}”`);
  }
  const ids = new Set();
  for (const p of c.pricing.packages || []) {
    if (!String(p.name || '').trim()) throw new HttpError(400, 'Mỗi gói giá cần có tên');
    for (const f of ['price', 'original']) {
      if (!Number.isInteger(p[f]) || p[f] < 0 || p[f] > 1e9) throw new HttpError(400, `Giá của gói “${p.name}” không hợp lệ`);
    }
    const id = String(p.id || '').trim();
    if (!id || ids.has(id)) throw new HttpError(400, `Mã gói “${p.name}” bị trống hoặc trùng`);
    ids.add(id);
  }
  if (!c.services.items?.length) throw new HttpError(400, 'Cần ít nhất 1 dịch vụ khảo sát');
  if (JSON.stringify(c).length > 500_000) throw new HttpError(413, 'Nội dung quá lớn');
  return c;
}

const str = (v, max) => String(v ?? '').trim().slice(0, max);

export function buildBooking(body, content) {
  const type = body.type;
  if (type !== 'survey' && type !== 'combo') throw new HttpError(400, 'Loại đặt lịch không hợp lệ');
  const name = str(body.name, 100);
  const phone = str(body.phone, 20).replace(/[\s.\-]/g, '');
  const address = str(body.address, 300);
  if (name.length < 2) throw new HttpError(400, 'Vui lòng nhập họ tên');
  if (!PHONE_RE.test(phone)) throw new HttpError(400, 'Số điện thoại không hợp lệ');
  if (address.length < 5) throw new HttpError(400, 'Vui lòng nhập địa chỉ');
  let date = str(body.date, 10);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) date = '';

  const now = new Date();
  const b = {
    id: now.toISOString().slice(2, 10).replace(/-/g, '') + '-' + crypto.randomBytes(3).toString('hex'),
    createdAt: now.toISOString(),
    status: 'new', type, name, phone, address, date,
    slot: str(body.slot, 60),
    note: str(body.note, 1000),
    adminNote: '',
  };

  if (type === 'survey') {
    const service = str(body.service, 120);
    if (!content.services.items.some(s => s.name === service)) throw new HttpError(400, 'Dịch vụ không hợp lệ');
    b.service = service;
  } else {
    // Prices always come from the server copy – never trust client totals.
    const pkgs = new Map(content.pricing.packages.map(p => [p.id, p]));
    const items = []; let total = 0, original = 0;
    for (const it of Array.isArray(body.items) ? body.items : []) {
      const p = pkgs.get(String(it?.id)); const qty = Number.parseInt(it?.qty, 10);
      if (!p || !(qty > 0 && qty <= 50)) continue;
      items.push({ id: p.id, name: p.name, qty, unitPrice: p.price });
      total += qty * p.price; original += qty * p.original;
    }
    if (!items.length) throw new HttpError(400, 'Vui lòng chọn ít nhất 1 phòng');
    Object.assign(b, { items, total, original });
  }
  return b;
}

/** Every image path referenced anywhere in the content (for the media picker). */
export function contentImages(c) {
  const out = new Set();
  JSON.stringify(c, (k, v) => {
    if (typeof v === 'string' && /\.(jpe?g|png|webp)(\?.*)?$/i.test(v)) out.add(v);
    return v;
  });
  return [...out];
}
