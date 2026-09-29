import { route, send, readBody, clientIp, checkPassword, passwordConfigured, newToken, sessionCookie, SESSION_TTL, HttpError } from '../lib/http.js';
import { store } from '../lib/store.js';

const MAX_FAILS = 5, WINDOW = 600; // 5 wrong passwords → locked 10 minutes

export default route({
  POST: async (req, res) => {
    if (!(await passwordConfigured())) throw new HttpError(503, 'Chưa đặt mật khẩu admin. Thêm biến môi trường ADMIN_PASSWORD trên Vercel rồi Redeploy.');
    const key = `login:${clientIp(req)}`;
    if ((await store.count(key)) >= MAX_FAILS) throw new HttpError(429, 'Sai quá nhiều lần, thử lại sau 10 phút');
    const { password } = await readBody(req, 4096);
    if (!(await checkPassword(String(password || '')))) {
      await store.hit(key, WINDOW);
      throw new HttpError(401, 'Mật khẩu không đúng');
    }
    await store.reset(key);
    const tok = newToken();
    await store.createSession(tok, SESSION_TTL);
    send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(tok, SESSION_TTL) });
  },
});
