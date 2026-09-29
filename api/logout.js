import { route, send, sessionToken, sessionCookie } from '../lib/http.js';
import { store } from '../lib/store.js';

export default route({
  POST: async (req, res) => {
    const tok = sessionToken(req);
    if (tok) await store.deleteSession(tok);
    send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
  },
});
