import { route, send, isAuthed, passwordConfigured } from '../lib/http.js';
import { store } from '../lib/store.js';

export default route({
  GET: async (req, res) => send(res, 200, {
    ok: true,
    authed: await isAuthed(req),
    passwordSet: await passwordConfigured(),
    storage: store.kind, // 'supabase' | 'file' | 'none'
  }),
});
