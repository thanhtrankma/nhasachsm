import { route, send, readBody, checkPassword, hashPassword, sessionToken, HttpError } from '../lib/http.js';
import { store } from '../lib/store.js';

export default route({
  POST: {
    auth: true,
    fn: async (req, res) => {
      const { current, new: next } = await readBody(req, 4096);
      if (!(await checkPassword(String(current || '')))) throw new HttpError(400, 'Mật khẩu hiện tại không đúng');
      if (String(next || '').length < 8) throw new HttpError(400, 'Mật khẩu mới cần ít nhất 8 ký tự');
      await store.setAdmin(hashPassword(String(next)));
      await store.deleteOtherSessions(sessionToken(req)); // sign out other devices
      send(res, 200, { ok: true });
    },
  },
});
