/**
 * Giá theo ngày (RoomRate).
 *  - price        : giá áp dụng cho kênh trực tiếp (website, JoyBot, đặt tay) — cùng thang với giá gốc phòng (Settings)
 *  - airbnbPrice  : giá đang niêm yết trên Airbnb (đọc về) · airbnbTip: "Gợi ý giá" của Airbnb
 *  - airbnbTarget : giá cần đặt trên Airbnb sau khi bấm "Áp dụng" → hiện trong danh sách "Cần chỉnh trên Airbnb"
 * Giá Airbnb và giá gốc PMS lệch nhau (Airbnb niêm yết cao hơn để bù phí) → quy đổi bằng tỉ lệ airbnbPrice / giá gốc.
 */
import { prisma } from "@/lib/prisma";
import { DAY, dayKey } from "@/lib/housekeeping";

type RoomPrice = { id: string; pricePerNight: number | null; weekendPricePerNight: number | null };
export const isWeekendNight = (d: Date) => [5, 6].includes(d.getUTCDay());
export const baseOf = (r: RoomPrice, d: Date) => (isWeekendNight(d) ? r.weekendPricePerNight ?? r.pricePerNight : r.pricePerNight) ?? 0;
export const toDate = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
const r10k = (n: number) => Math.round(n / 10_000) * 10_000;
/** chạy song song theo lô (tránh quá thời gian hàm Vercel khi lưu nhiều đêm) */
async function inBatches<T>(items: T[], fn: (x: T) => Promise<unknown>, size = 10) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

export async function ratesBetween(from: Date, to: Date, roomId?: string) {
  return prisma.roomRate.findMany({ where: { date: { gte: from, lt: to }, ...(roomId ? { roomId } : {}) }, orderBy: { date: "asc" } });
}

/** Tỉ lệ giá Airbnb / giá gốc của phòng (trung vị các đêm đã đọc được), mặc định 1 */
export async function airbnbRatio(room: RoomPrice): Promise<number> {
  const rows = await prisma.roomRate.findMany({ where: { roomId: room.id, airbnbPrice: { not: null } }, orderBy: { tipAt: "desc" }, take: 60 });
  const xs = rows.map((r) => (r.airbnbPrice ?? 0) / (baseOf(room, r.date) || 1)).filter((x) => x > 0.5 && x < 3).sort((a, b) => a - b);
  return xs.length ? xs[Math.floor(xs.length / 2)] : 1;
}

export interface ApplyItem { roomId: string; date: string; price?: number | null; airbnbTarget?: number | null; useTip?: boolean; source?: string }

/** Áp giá cho các đêm: cập nhật price (kênh trực tiếp) + airbnbTarget (cần đặt trên Airbnb) */
export async function applyRates(items: ApplyItem[]) {
  const roomIds = [...new Set(items.map((i) => i.roomId))];
  const rooms = await prisma.room.findMany({ where: { id: { in: roomIds } } });
  const ratio = new Map<string, number>();
  for (const r of rooms) ratio.set(r.id, await airbnbRatio(r));
  let n = 0;
  await inBatches(items, async (it) => {
    const room = rooms.find((r) => r.id === it.roomId);
    if (!room) return;
    const date = toDate(it.date);
    const existing = await prisma.roomRate.findUnique({ where: { roomId_date: { roomId: room.id, date } } });
    const k = ratio.get(room.id) ?? 1;
    let price = it.price ?? null;
    let target: number | null = null;
    if (it.useTip && existing?.airbnbTip) {
      target = existing.airbnbTip;
      price = r10k(existing.airbnbTip / k);
    } else if (it.airbnbTarget != null) {
      // nhập theo thang giá Airbnb → suy ra giá trực tiếp
      target = r10k(it.airbnbTarget);
      price = price ?? r10k(it.airbnbTarget / k);
    } else if (price != null) {
      target = r10k(price * k);
    }
    const data = {
      price, airbnbTarget: target, airbnbDoneAt: target != null && existing?.airbnbPrice === target ? new Date() : null,
      appliedAt: new Date(), source: it.useTip ? "AIRBNB_TIP" : it.source ?? "MANUAL",
    };
    await prisma.roomRate.upsert({ where: { roomId_date: { roomId: room.id, date } }, create: { roomId: room.id, date, ...data }, update: data });
    n++;
  });
  return n;
}

/** Bỏ giá áp dụng (quay về giá gốc) */
export async function clearRates(items: { roomId: string; date: string }[]) {
  let n = 0;
  for (const it of items) {
    const r = await prisma.roomRate.updateMany({
      where: { roomId: it.roomId, date: toDate(it.date) },
      data: { price: null, airbnbTarget: null, airbnbDoneAt: null, appliedAt: null, source: null },
    });
    n += r.count;
  }
  return n;
}

/** Lưu giá & gợi ý giá đọc từ lịch Airbnb */
export async function saveAirbnbTips(items: { roomId: string; date: string; airbnbPrice?: number | null; airbnbTip?: number | null }[]) {
  let n = 0;
  await inBatches(items, async (it) => {
    const date = toDate(it.date);
    const data = { airbnbPrice: it.airbnbPrice ?? null, airbnbTip: it.airbnbTip ?? null, tipAt: new Date() };
    const ex = await prisma.roomRate.findUnique({ where: { roomId_date: { roomId: it.roomId, date } } });
    // nếu giá Airbnb hiện tại đã đúng giá cần đặt → tự đánh dấu đã chỉnh
    const done = ex?.airbnbTarget != null && it.airbnbPrice != null && Math.abs(ex.airbnbTarget - it.airbnbPrice) < 15_000 ? { airbnbDoneAt: ex.airbnbDoneAt ?? new Date() } : {};
    await prisma.roomRate.upsert({ where: { roomId_date: { roomId: it.roomId, date } }, create: { roomId: it.roomId, date, ...data }, update: { ...data, ...done } });
    n++;
  });
  return n;
}

export async function markAirbnbDone(items: { roomId: string; date: string }[]) {
  let n = 0;
  for (const it of items) n += (await prisma.roomRate.updateMany({ where: { roomId: it.roomId, date: toDate(it.date) }, data: { airbnbDoneAt: new Date() } })).count;
  return n;
}

/** Báo giá kênh trực tiếp theo giá ngày (website / JoyBot) */
export async function quoteDirect(roomId: string, checkIn: string, checkOut: string) {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) return null;
  const from = toDate(checkIn), to = toDate(checkOut);
  const rates = await ratesBetween(from, to, roomId);
  const nights: { date: string; price: number; custom: boolean }[] = [];
  for (let t = from.getTime(); t < to.getTime(); t += DAY) {
    const d = new Date(t);
    const r = rates.find((x) => x.date.getTime() === t && x.price != null);
    nights.push({ date: dayKey(d), price: r?.price ?? baseOf(room, d), custom: Boolean(r) });
  }
  return { roomId, checkIn, checkOut, nights, total: nights.reduce((s, n) => s + n.price, 0) };
}
