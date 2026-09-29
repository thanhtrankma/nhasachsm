import { route, send, readBody, HttpError } from '../lib/http.js';
import { saveImage } from '../lib/media.js';

// Vercel caps request bodies at 4.5MB; admin.html shrinks images before sending.
export default route({
  POST: {
    auth: true,
    fn: async (req, res) => {
      const body = await readBody(req, 4.5 * 1024 * 1024);
      const b64 = String(body.data || '').replace(/^data:[^,]*,/, '');
      if (!b64 || !/^[A-Za-z0-9+/=\s]+$/.test(b64)) throw new HttpError(400, 'Tệp ảnh không hợp lệ');
      const url = await saveImage(Buffer.from(b64, 'base64'), body.name);
      send(res, 200, { ok: true, path: url });
    },
  },
});
