import { route, send, readBody } from '../lib/http.js';
import { store } from '../lib/store.js';
import { loadContent, validateContent } from '../lib/site.js';

export default route({
  // Public: the landing page renders from this.
  GET: async (req, res) => send(res, 200, await loadContent()),
  PUT: {
    auth: true,
    fn: async (req, res) => {
      const next = validateContent(await readBody(req));
      await store.setContent(next, await loadContent());
      send(res, 200, { ok: true });
    },
  },
});
