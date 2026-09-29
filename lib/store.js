// Persistence layer. setContent(c, prev) stores `prev` as a backup (callers pass what was live).
//  • On Vercel: Upstash Redis (env KV_REST_API_URL/KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL/TOKEN).
//  • Locally without those env vars: a JSON file in .local-data/ (for `npm run dev` only).
import fs from 'node:fs';
import path from 'node:path';

const MAX_BACKUPS = 30;
const K = {
  content: 'site:content',
  backups: 'site:content:backups',
  bookings: 'site:bookings',
  admin: 'admin:password',
  sessions: 'admin:sessions',
  sess: t => `sess:${t}`,
  rl: k => `rl:${k}`,
};

const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

function configError() {
  const e = new Error('Chưa kết nối Upstash Redis. Vào Vercel → Storage → tạo Upstash Redis và kết nối với project, rồi Redeploy.');
  e.expose = true;
  return e;
}

/* ============================ Redis ============================ */
function redisStore() {
  let clientP;
  const r = () => (clientP ??= import('@upstash/redis').then(({ Redis }) =>
    new Redis({ url: redisUrl, token: redisToken, automaticDeserialization: false })));
  const parse = s => (s == null ? null : JSON.parse(s));

  return {
    kind: 'redis',
    async getContent() { return parse(await (await r()).get(K.content)); },
    async setContent(c, prev) {
      const db = await r();
      if (prev) {
        await db.lpush(K.backups, JSON.stringify({ id: Date.now().toString(36), time: new Date().toISOString(), content: prev }));
        await db.ltrim(K.backups, 0, MAX_BACKUPS - 1);
      }
      await db.set(K.content, JSON.stringify(c));
    },
    async listBackups() {
      return ((await (await r()).lrange(K.backups, 0, -1)) || []).map(s => {
        const b = JSON.parse(s); return { id: b.id, time: b.time, size: s.length };
      });
    },
    async getBackup(id) {
      const hit = ((await (await r()).lrange(K.backups, 0, -1)) || []).map(JSON.parse).find(b => b.id === id);
      return hit?.content ?? null;
    },

    async listBookings() {
      const all = (await (await r()).hgetall(K.bookings)) || {};
      return Object.values(all).map(v => (typeof v === 'string' ? JSON.parse(v) : v));
    },
    async getBooking(id) { return parse(await (await r()).hget(K.bookings, id)); },
    async putBooking(b) { await (await r()).hset(K.bookings, { [b.id]: JSON.stringify(b) }); },
    async deleteBooking(id) { await (await r()).hdel(K.bookings, id); },

    async getAdmin() { return parse(await (await r()).get(K.admin)); },
    async setAdmin(rec) { await (await r()).set(K.admin, JSON.stringify(rec)); },

    async createSession(tok, ttl) {
      const db = await r();
      await db.set(K.sess(tok), '1', { ex: ttl });
      await db.sadd(K.sessions, tok);
    },
    async touchSession(tok, ttl) { return (await (await r()).expire(K.sess(tok), ttl)) === 1; },
    async deleteSession(tok) {
      const db = await r();
      await db.del(K.sess(tok)); await db.srem(K.sessions, tok);
    },
    async deleteOtherSessions(keep) {
      const db = await r();
      for (const t of (await db.smembers(K.sessions)) || []) if (t !== keep) { await db.del(K.sess(t)); await db.srem(K.sessions, t); }
    },

    async hit(key, windowSec) {
      const db = await r();
      const n = await db.incr(K.rl(key));
      if (n === 1) await db.expire(K.rl(key), windowSec);
      return n;
    },
    async count(key) { return Number(await (await r()).get(K.rl(key))) || 0; },
    async reset(key) { await (await r()).del(K.rl(key)); },
  };
}

/* ============================ Local file (dev only) ============================ */
function fileStore() {
  const file = path.join(process.cwd(), '.local-data', 'store.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
  const save = d => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(d, null, 2)); };
  const now = () => Date.now() / 1000;
  const alive = (d, k) => d.ttl?.[k] == null || d.ttl[k] > now();
  const tx = fn => { const d = load(); const out = fn(d); save(d); return out; };

  return {
    kind: 'file',
    async getContent() { return load().content ?? null; },
    async setContent(c, prev) {
      tx(d => {
        if (prev) (d.backups ??= []).unshift({ id: Date.now().toString(36), time: new Date().toISOString(), content: prev });
        d.backups = (d.backups || []).slice(0, MAX_BACKUPS);
        d.content = c;
      });
    },
    async listBackups() { return (load().backups || []).map(b => ({ id: b.id, time: b.time, size: JSON.stringify(b.content).length })); },
    async getBackup(id) { return (load().backups || []).find(b => b.id === id)?.content ?? null; },

    async listBookings() { return Object.values(load().bookings || {}); },
    async getBooking(id) { return load().bookings?.[id] ?? null; },
    async putBooking(b) { tx(d => { (d.bookings ??= {})[b.id] = b; }); },
    async deleteBooking(id) { tx(d => { delete d.bookings?.[id]; }); },

    async getAdmin() { return load().admin ?? null; },
    async setAdmin(rec) { tx(d => { d.admin = rec; }); },

    async createSession(tok, ttl) { tx(d => { (d.sessions ??= {})[tok] = now() + ttl; }); },
    async touchSession(tok, ttl) {
      return tx(d => {
        if (!(d.sessions?.[tok] > now())) { delete d.sessions?.[tok]; return false; }
        d.sessions[tok] = now() + ttl; return true;
      });
    },
    async deleteSession(tok) { tx(d => { delete d.sessions?.[tok]; }); },
    async deleteOtherSessions(keep) { tx(d => { for (const t of Object.keys(d.sessions || {})) if (t !== keep) delete d.sessions[t]; }); },

    async hit(key, windowSec) {
      return tx(d => {
        d.rl ??= {}; d.ttl ??= {};
        if (!alive(d, key)) delete d.rl[key];
        if (!d.rl[key]) d.ttl[key] = now() + windowSec;
        return (d.rl[key] = (d.rl[key] || 0) + 1);
      });
    },
    async count(key) { const d = load(); return alive(d, key) ? d.rl?.[key] || 0 : 0; },
    async reset(key) { tx(d => { delete d.rl?.[key]; }); },
  };
}

/* ============================ pick ============================ */
function unconfigured() {
  return new Proxy({}, { get: (_, p) => (p === 'kind' ? 'none' : async () => { throw configError(); }) });
}

export const store = redisUrl && redisToken ? redisStore() : process.env.VERCEL ? unconfigured() : fileStore();
