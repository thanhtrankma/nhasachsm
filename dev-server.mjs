// Local stand-in for Vercel: serves static files and runs api/*.js handlers.
//   npm run dev                      → http://127.0.0.1:3000  (data saved in .local-data/)
//   ADMIN_PASSWORD=... npm run dev   → set the admin password for local testing
// If .env.local exists (e.g. from `vercel env pull .env.local`), its variables are loaded,
// so the dev server can talk to the real Upstash Redis / Vercel Blob.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 3000);

if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const HIDDEN = /^\/(lib|node_modules|\.local-data|dev-server\.mjs|package(-lock)?\.json|vercel\.json)(\/|$)|\/\./;

async function handleApi(req, res, name) {
  const file = path.join(ROOT, 'api', `${name}.js`);
  if (!/^[\w-]+$/.test(name) || !fs.existsSync(file)) { res.statusCode = 404; return res.end('{"ok":false,"error":"Không tìm thấy"}'); }
  // Parse the body like Vercel does, so handlers see req.body.
  if (!['GET', 'HEAD'].includes(req.method)) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString('utf8');
    req.body = String(req.headers['content-type'] || '').includes('application/json') ? (raw ? JSON.parse(raw) : {}) : raw;
  }
  const mod = await import(pathToFileURL(file).href);
  await mod.default(req, res);
}

function serveStatic(req, res, urlPath) {
  if (urlPath === '/admin') urlPath = '/admin.html';
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const file = path.join(ROOT, path.normalize(urlPath));
  if (HIDDEN.test(urlPath) || !file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.statusCode = 404; return res.end('Not found');
  }
  res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}

http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    const m = urlPath.match(/^\/api\/([^/]+)\/?$/);
    if (m) return await handleApi(req, res, m[1]);
    serveStatic(req, res, urlPath);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) { res.statusCode = 500; res.end('{"ok":false,"error":"Lỗi máy chủ"}'); }
  }
}).listen(PORT, '127.0.0.1', async () => {
  const { store } = await import('./lib/store.js');
  console.log(`Dev server: http://127.0.0.1:${PORT}   ·   Admin: http://127.0.0.1:${PORT}/admin`);
  console.log(`Lưu trữ: ${store.kind === 'redis' ? 'Upstash Redis (từ .env.local)' : '.local-data/store.json'}   ·   Ảnh: ${process.env.BLOB_READ_WRITE_TOKEN ? 'Vercel Blob' : 'assets/uploads/'}`);
  if (!process.env.ADMIN_PASSWORD) console.log('Gợi ý: chạy với ADMIN_PASSWORD=matkhau npm run dev để đăng nhập admin lần đầu.');
});
