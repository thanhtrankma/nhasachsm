import { route, send, readBody, HttpError } from '../lib/http.js';
import { store } from '../lib/store.js';
import { validateContent, loadContent } from '../lib/site.js';

export default route({
  GET: { auth: true, fn: async (req, res) => send(res, 200, { ok: true, items: await store.listBackups() }) },
  // Restore: the current content becomes a backup itself, so a restore can be undone.
  POST: {
    auth: true,
    fn: async (req, res) => {
      const { id } = await readBody(req, 4096);
      const content = await store.getBackup(String(id || ''));
      if (!content) throw new HttpError(404, 'Bản sao lưu không tồn tại');
      await store.setContent(validateContent(content), await loadContent());
      send(res, 200, { ok: true, content });
    },
  },
});
