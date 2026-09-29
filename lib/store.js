// Persistence layer. setContent(c, prev) stores `prev` as a backup (callers pass what was live).
//  • Supabase (env SUPABASE_URL + SUPABASE_SECRET_KEY) – run supabase/schema.sql once first.
//  • Locally without those env vars: a JSON file in .local-data/ (for `npm run dev` only).
import fs from 'node:fs';
import path from 'node:path';

const MAX_BACKUPS = 30;
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

let clientP;
/** Server-only client (secret key bypasses RLS). Shared with lib/media.js. */
export function supabase() {
  return (clientP ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })));
}
export const hasSupabase = !!(url && secretKey);

function exposed(message) { const e = new Error(message); e.expose = true; return e; }

function ok({ data, error }) {
  if (!error) return data;
  const missing = /relation .* does not exist|Could not find the (table|function)/i.test(error.message);
  throw missing
    ? exposed('Chưa tạo bảng trên Supabase. Mở Supabase → SQL Editor, chạy file supabase/schema.sql.')
    : new Error(`[supabase] ${error.message}`);
}

/* ============================ Supabase ============================ */
const toRow = b => ({
  id: b.id, created_at: b.createdAt, status: b.status, type: b.type, name: b.name, phone: b.phone,
  address: b.address, date: b.date, slot: b.slot, note: b.note, admin_note: b.adminNote,
  service: b.service ?? null, items: b.items ?? null, total: b.total ?? null, original: b.original ?? null,
});
const fromRow = r => ({
  id: r.id, createdAt: r.created_at, status: r.status, type: r.type, name: r.name, phone: r.phone,
  address: r.address, date: r.date, slot: r.slot, note: r.note, adminNote: r.admin_note,
  ...(r.type === 'survey' ? { service: r.service } : { items: r.items, total: Number(r.total), original: Number(r.original) }),
});

function supabaseStore() {
  const db = supabase;
  const getSetting = async key => ok(await (await db()).from('site_settings').select('value').eq('key', key).maybeSingle())?.value ?? null;
  const setSetting = async (key, value) => ok(await (await db()).from('site_settings').upsert({ key, value, updated_at: new Date().toISOString() }));

  return {
    kind: 'supabase',
    getContent: () => getSetting('content'),
    async setContent(c, prev) {
      const sb = await db();
      if (prev) {
        ok(await sb.from('content_backups').insert({ content: prev }));
        const old = ok(await sb.from('content_backups').select('id').order('id', { ascending: false }).range(MAX_BACKUPS, MAX_BACKUPS + 500));
        if (old?.length) ok(await sb.from('content_backups').delete().in('id', old.map(o => o.id)));
      }
      await setSetting('content', c);
    },
    async listBackups() {
      const rows = ok(await (await db()).from('content_backups').select('id, created_at, content').order('id', { ascending: false }).limit(MAX_BACKUPS));
      return rows.map(r => ({ id: String(r.id), time: r.created_at, size: JSON.stringify(r.content).length }));
    },
    async getBackup(id) {
      if (!/^\d+$/.test(id)) return null;
      return ok(await (await db()).from('content_backups').select('content').eq('id', id).maybeSingle())?.content ?? null;
    },

    async listBookings() {
      return ok(await (await db()).from('bookings').select('*').order('created_at', { ascending: false }).limit(2000)).map(fromRow);
    },
    async getBooking(id) {
      const r = ok(await (await db()).from('bookings').select('*').eq('id', id).maybeSingle());
      return r ? fromRow(r) : null;
    },
    async putBooking(b) { ok(await (await db()).from('bookings').upsert(toRow(b))); },
    async deleteBooking(id) { ok(await (await db()).from('bookings').delete().eq('id', id)); },

    getAdmin: () => getSetting('admin_password'),
    setAdmin: rec => setSetting('admin_password', rec),

    async hit(key, windowSec) { return ok(await (await db()).rpc('hit_rate_limit', { p_key: key, p_window_seconds: windowSec })); },
    async count(key) {
      const r = ok(await (await db()).from('rate_limits').select('count, reset_at').eq('key', key).maybeSingle());
      return r && new Date(r.reset_at) > new Date() ? r.count : 0;
    },
    async reset(key) { ok(await (await db()).from('rate_limits').delete().eq('key', key)); },
  };
}

/* ============================ Local file (dev only) ============================ */
function fileStore() {
  const file = path.join(process.cwd(), '.local-data', 'store.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
  const save = d => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(d, null, 2)); };
  const now = () => Date.now() / 1000;
  const tx = fn => { const d = load(); const out = fn(d); save(d); return out; };

  return {
    kind: 'file',
    async getContent() { return load().content ?? null; },
    async setContent(c, prev) {
      tx(d => {
        if (prev) (d.backups ??= []).unshift({ id: Date.now().toString(), time: new Date().toISOString(), content: prev });
        d.backups = (d.backups || []).slice(0, MAX_BACKUPS);
        d.content = c;
      });
    },
    async listBackups() { return (load().backups || []).map(b => ({ id: b.id, time: b.time, size: JSON.stringify(b.content).length })); },
    async getBackup(id) { return (load().backups || []).find(b => b.id === id)?.content ?? null; },

    async listBookings() { return Object.values(load().bookings || {}).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); },
    async getBooking(id) { return load().bookings?.[id] ?? null; },
    async putBooking(b) { tx(d => { (d.bookings ??= {})[b.id] = b; }); },
    async deleteBooking(id) { tx(d => { delete d.bookings?.[id]; }); },

    async getAdmin() { return load().admin ?? null; },
    async setAdmin(rec) { tx(d => { d.admin = rec; }); },

    async hit(key, windowSec) {
      return tx(d => {
        const r = (d.rl ??= {})[key];
        if (!r || r.resetAt < now()) d.rl[key] = { count: 0, resetAt: now() + windowSec };
        return ++d.rl[key].count;
      });
    },
    async count(key) { const r = load().rl?.[key]; return r && r.resetAt > now() ? r.count : 0; },
    async reset(key) { tx(d => { delete d.rl?.[key]; }); },
  };
}

/* ============================ pick ============================ */
function unconfigured() {
  const err = () => exposed('Chưa cấu hình Supabase. Thêm SUPABASE_URL và SUPABASE_SECRET_KEY trong Vercel → Settings → Environment Variables, rồi Redeploy.');
  return new Proxy({}, { get: (_, p) => (p === 'kind' ? 'none' : async () => { throw err(); }) });
}

export const store = hasSupabase ? supabaseStore() : process.env.VERCEL ? unconfigured() : fileStore();
