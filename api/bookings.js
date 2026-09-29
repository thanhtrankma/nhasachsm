import { route, send, readBody, query, clientIp, HttpError } from '../lib/http.js';
import { store } from '../lib/store.js';
import { loadContent, buildBooking, BOOKING_STATUSES } from '../lib/site.js';

async function findOr404(id) {
  const b = id && (await store.getBooking(String(id)));
  if (!b) throw new HttpError(404, 'Không tìm thấy đơn');
  return b;
}

export default route({
  // Public: the booking form posts here.
  POST: async (req, res) => {
    const key = `booking:${clientIp(req)}`;
    if ((await store.count(key)) >= 10) throw new HttpError(429, 'Bạn đã gửi quá nhiều yêu cầu, vui lòng gọi hotline');
    const booking = buildBooking(await readBody(req, 64 * 1024), await loadContent());
    await store.putBooking(booking);
    await store.hit(key, 3600);
    send(res, 201, { ok: true, booking: { id: booking.id, total: booking.total ?? null } });
  },
  GET: {
    auth: true,
    fn: async (req, res) => {
      const items = (await store.listBookings()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      send(res, 200, { ok: true, items });
    },
  },
  PATCH: {
    auth: true,
    fn: async (req, res) => {
      const b = await findOr404(query(req).id);
      const body = await readBody(req, 8192);
      if ('status' in body) {
        if (!BOOKING_STATUSES.includes(body.status)) throw new HttpError(400, 'Trạng thái không hợp lệ');
        b.status = body.status;
      }
      if ('adminNote' in body) b.adminNote = String(body.adminNote ?? '').slice(0, 1000);
      await store.putBooking(b);
      send(res, 200, { ok: true });
    },
  },
  DELETE: {
    auth: true,
    fn: async (req, res) => {
      const b = await findOr404(query(req).id);
      await store.deleteBooking(b.id);
      send(res, 200, { ok: true });
    },
  },
});
