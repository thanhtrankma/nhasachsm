// Small helpers shared by every /api function. Uses only Node's native req/res API,
// so the same handlers run on Vercel and in dev-server.mjs.
import crypto from 'node:crypto';
import { store } from './store.js';

export const SESSION_TTL = 8 * 3600; // seconds
export const IS_VERCEL = !!process.env.VERCEL;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function send(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

export async function readBody(req, limit = 1024 * 1024) {
  // Vercel pre-parses JSON bodies into req.body (a getter that throws on bad JSON);
  // the dev server does the same.
  let body;
  try { body = req.body; } catch { throw new HttpError(400, 'JSON không hợp lệ'); }
  if (body !== undefined) {
    if (typeof body === 'string') return parseJSON(body);
    if (Buffer.isBuffer(body)) return parseJSON(body.toString('utf8'));
    return body ?? {};
  }
  const chunks = []; let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Dữ liệu gửi lên quá lớn');
    chunks.push(c);
  }
  return parseJSON(Buffer.concat(chunks).toString('utf8') || '{}');
}

function parseJSON(s) {
  try { return JSON.parse(s || '{}'); } catch { throw new HttpError(400, 'JSON không hợp lệ'); }
}

export function query(req) {
  return Object.fromEntries(new URL(req.url, 'http://x').searchParams);
}

export function clientIp(req) {
  // On Vercel these headers are set by the platform edge; locally use the socket address.
  if (IS_VERCEL) return (req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0]).trim() || 'unknown';
  return req.socket?.remoteAddress || 'local';
}

function cookie(req, name) {
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

export const sessionToken = req => cookie(req, 'sid');

export function sessionCookie(token, maxAge) {
  return `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${IS_VERCEL ? '; Secure' : ''}`;
}

export async function isAuthed(req) {
  const tok = sessionToken(req);
  return !!tok && /^[\w-]{20,}$/.test(tok) && await store.touchSession(tok, SESSION_TTL);
}

/** Reject cross-site writes (in addition to SameSite=Strict cookies). */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === (req.headers['x-forwarded-host'] || req.headers.host); } catch { return false; }
}

/** Wrap a handler: method routing, auth, origin check, uniform errors. */
export function route(methods) {
  return async (req, res) => {
    try {
      const def = methods[req.method];
      if (!def) throw new HttpError(405, 'Phương thức không hỗ trợ');
      const { auth = false, fn } = typeof def === 'function' ? { fn: def } : def;
      if (req.method !== 'GET' && !sameOrigin(req)) throw new HttpError(403, 'Sai nguồn gửi yêu cầu');
      if (auth && !(await isAuthed(req))) throw new HttpError(401, 'Vui lòng đăng nhập');
      await fn(req, res);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { ok: false, error: e.message });
      console.error(e);
      send(res, 500, { ok: false, error: e.expose ? e.message : 'Lỗi máy chủ' });
    }
  };
}

/* ---------- password hashing (scrypt) ---------- */
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return { algo: 'scrypt', salt: salt.toString('hex'), hash: hash.toString('hex') };
}

function safeEqual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export async function checkPassword(pw) {
  const rec = await store.getAdmin();
  if (rec) return safeEqual(crypto.scryptSync(pw, Buffer.from(rec.salt, 'hex'), 64).toString('hex'), rec.hash);
  // No password saved yet → fall back to the ADMIN_PASSWORD env var (set in Vercel dashboard).
  const env = process.env.ADMIN_PASSWORD;
  return !!env && env.length >= 8 && safeEqual(
    crypto.createHash('sha256').update(pw).digest('hex'),
    crypto.createHash('sha256').update(env).digest('hex'));
}

export async function passwordConfigured() {
  return !!(await store.getAdmin()) || (process.env.ADMIN_PASSWORD || '').length >= 8;
}

export const newToken = () => crypto.randomBytes(32).toString('base64url');
