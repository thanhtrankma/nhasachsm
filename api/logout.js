import { route, send, sessionCookie } from '../lib/http.js';

export default route({
  POST: async (req, res) => send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) }),
});
