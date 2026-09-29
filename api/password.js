import { route, send, readBody, checkPassword, hashPassword, createSession, sessionCookie, SESSION_TTL, HttpError } from '../lib/http.js';
import { store } from '../lib/store.js';

export default route({
  POST: {
    auth: true,
    fn: async (req, res) => {
      const { current, new: next } = await readBody(req, 4096);
      if (!(await checkPassword(String(current || '')))) throw new HttpError(400, 'Mật khẩu hiện tại không đúng');
      if (String(next || '').length < 8) throw new HttpError(400, 'Mật khẩu mới cần ít nhất 8 ký tự');
      await store.setAdmin(hashPassword(String(next)));
      // Sessions are bound to the password version: every other device is now signed out,
      // so hand this browser a fresh cookie.
      send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(await createSession(), SESSION_TTL) });
    },
  },
});
