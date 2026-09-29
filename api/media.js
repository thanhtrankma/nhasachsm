import { route, send } from '../lib/http.js';
import { listUploads } from '../lib/media.js';
import { loadContent, contentImages } from '../lib/site.js';

export default route({
  GET: {
    auth: true,
    fn: async (req, res) => {
      const uploads = await listUploads().catch(() => []);
      const seen = new Set(uploads.map(u => u.path));
      const used = contentImages(await loadContent()).filter(p => !seen.has(p) && !p.includes('/thumbs/'));
      send(res, 200, { ok: true, items: [...uploads, ...used.map(path => ({ path }))] });
    },
  },
});
