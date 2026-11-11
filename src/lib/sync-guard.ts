/**
 * Lá chắn đồng bộ lịch (11/2026) — phát hiện sớm lỗi map lịch giữa PMS ↔ Airbnb/Booking/Agoda.
 *  1. Đơn "nhảy phòng": cùng một mã đặt (UID) xuất hiện ở 2 phòng → link iCal của kênh đang nối chéo.
 *  2. Trùng lịch: 2 lượt ở thật chồng ngày trong cùng phòng → nguy cơ overbooking.
 *  3. Kiểm tra chéo Airbnb (hằng ngày): đơn thật trong PMS mà listing Airbnb của phòng đó KHÔNG chặn
 *     → lịch PMS chưa sang được Airbnb (link sai / lỗi tải). Và Airbnb đang chặn ngày mà PMS trống → khoá thừa.
 * Mỗi cảnh báo chỉ gửi Telegram 1 lần (bảng SyncAlert).
 */
import * as ical from "node-ical";
import { prisma } from "@/lib/prisma";
import { tgNotify } from "@/lib/telegram";
import { vnToday } from "@/lib/housekeeping";

const REAL = ["CONFIRMED", "PENDING"];
const day = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (d: Date) => { const s = day(d); return `${s.slice(8, 10)}/${s.slice(5, 7)}`; };
const SRC: Record<string, string> = { AIRBNB: "Airbnb", BOOKING: "Booking.com", AGODA: "Agoda", TRAVELOKA: "Traveloka", DIRECT: "Đặt trực tiếp", OFFLINE: "Offline" };

export async function alertOnce(key: string, text: string): Promise<boolean> {
  const seen = await prisma.syncAlert.findUnique({ where: { key } });
  if (seen) return false;
  await prisma.syncAlert.create({ data: { key } });
  await tgNotify(text);
  return true;
}

const roomLabel = (r: { roomNumber: string | null; name: string }) => `${r.roomNumber ?? ""} ${r.name}`.trim();

/** 1 + 2: chạy sau mỗi lần sync */
export async function checkBookingIntegrity(): Promise<string[]> {
  const today = vnToday();
  const found: string[] = [];
  const bookings = await prisma.booking.findMany({
    where: { checkOut: { gte: today }, OR: [{ status: { in: REAL } }, { status: "CANCELLED", cancelledAt: { gte: new Date(Date.now() - 3 * 86_400_000) } }] },
    include: { room: { select: { name: true, roomNumber: true } } },
    orderBy: { checkIn: "asc" },
  });

  // 1. Nhảy phòng — cùng externalId ở ≥2 phòng
  const byUid = new Map<string, typeof bookings>();
  for (const b of bookings) {
    if (!b.externalId || b.externalId.includes("@joystay")) continue;
    byUid.set(b.externalId, [...(byUid.get(b.externalId) ?? []), b]);
  }
  for (const [uid, list] of byUid) {
    const rooms = [...new Set(list.map((b) => b.roomId))];
    if (rooms.length < 2) continue;
    const live = list.find((b) => REAL.includes(b.status)) ?? list[0];
    const text =
      `⚠️ ĐƠN NHẢY PHÒNG — ${SRC[live.source] ?? live.source}\n` +
      `Khách: ${live.guestName} · ${fmt(live.checkIn)}→${fmt(live.checkOut)}${live.confirmationCode ? ` · mã ${live.confirmationCode}` : ""}\n` +
      `Xuất hiện ở: ${list.map((b) => `${roomLabel(b.room)} (${b.status === "CANCELLED" ? "đã gỡ" : "hiện tại"})`).join(" + ")}\n` +
      `→ Link iCal của ${SRC[live.source] ?? live.source} có thể đang nối chéo giữa các phòng. Kiểm tra mục Đồng bộ lịch trên kênh đó và các listing đang khoá ngày này.`;
    if (await alertOnce(`jump:${uid}:${rooms.sort().join(",")}`, text)) found.push(text);
  }

  // 2. Trùng lịch — 2 lượt ở thật chồng ngày trong cùng phòng
  const real = bookings.filter((b) => REAL.includes(b.status));
  const byRoom = new Map<string, typeof real>();
  for (const b of real) byRoom.set(b.roomId, [...(byRoom.get(b.roomId) ?? []), b]);
  for (const list of byRoom.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (b.checkIn >= a.checkOut) continue; // đã sắp xếp theo ngày nhận
        if (a.externalId && a.externalId === b.externalId) continue;
        const text =
          `🚨 TRÙNG LỊCH (nguy cơ overbooking) — phòng ${roomLabel(a.room)}\n` +
          `• ${a.guestName} (${SRC[a.source] ?? a.source}) ${fmt(a.checkIn)}→${fmt(a.checkOut)}\n` +
          `• ${b.guestName} (${SRC[b.source] ?? b.source}) ${fmt(b.checkIn)}→${fmt(b.checkOut)}\n` +
          `→ Xử lý ngay: chuyển phòng / liên hệ kênh để huỷ miễn phí.`;
        if (await alertOnce(`overlap:${[a.id, b.id].sort().join(",")}`, text)) found.push(text);
      }
    }
  }
  return found;
}

type Range = { start: string; end: string };
const nights = (r: Range) => {
  const out: string[] = [];
  for (let d = new Date(r.start + "T00:00:00Z"); day(d) < r.end; d = new Date(d.getTime() + 86_400_000)) out.push(day(d));
  return out;
};

/** 3: kiểm tra chéo PMS ↔ Airbnb (chạy hằng ngày) */
export async function auditAirbnb(): Promise<string[]> {
  const today = day(vnToday());
  const horizon = day(new Date(Date.now() + 120 * 86_400_000));
  const rooms = await prisma.room.findMany({
    include: { bookings: { where: { status: { in: [...REAL, "BLOCKED"] }, checkOut: { gte: vnToday() } } } },
  });
  const issues: string[] = [];

  for (const room of rooms) {
    const feeds = [["icalUrl", room.icalUrl], ["airbnbIcalUrl2", room.airbnbIcalUrl2]].filter((f): f is [string, string] => !!f[1]);
    for (const [feedKey, url] of feeds) {
      let events: ical.CalendarResponse;
      try {
        events = await ical.async.fromURL(url);
      } catch (e) {
        const t = `⚠️ Không tải được lịch Airbnb của phòng ${roomLabel(room)} (${feedKey}): ${e instanceof Error ? e.message : e}`;
        if (await alertOnce(`fetch:${room.id}:${feedKey}:${today}`, t)) issues.push(t);
        continue;
      }
      const covered = new Set<string>();
      const airBlocks: Range[] = [];
      for (const ev of Object.values(events)) {
        if (ev.type !== "VEVENT" || !ev.start || !ev.end) continue;
        const r = { start: day(new Date(ev.start as Date)), end: day(new Date(ev.end as Date)) };
        nights(r).forEach((n) => covered.add(n));
        const s = typeof ev.summary === "string" ? ev.summary.toLowerCase() : "";
        if (s.includes("not available")) airBlocks.push(r);
      }

      // a) Đơn thật ở kênh khác (hoặc listing Airbnb kia) mà listing này chưa chặn
      const others = room.bookings.filter((b) => REAL.includes(b.status) && b.feedKey !== feedKey);
      for (const b of others) {
        const missing = nights({ start: day(b.checkIn), end: day(b.checkOut) }).filter((n) => n >= today && n < horizon && !covered.has(n));
        if (!missing.length) continue;
        const t =
          `⚠️ AIRBNB CHƯA CHẶN NGÀY — phòng ${roomLabel(room)}${feedKey === "airbnbIcalUrl2" ? " (listing thứ 2)" : ""}\n` +
          `Đơn ${SRC[b.source] ?? b.source}: ${b.guestName} ${fmt(b.checkIn)}→${fmt(b.checkOut)}\n` +
          `Đêm còn mở trên Airbnb: ${missing.map((n) => `${n.slice(8)}/${n.slice(5, 7)}`).join(", ")}\n` +
          `→ Kiểm tra listing có nhập đúng link lịch PMS của phòng này không, rồi bấm "Tải lại".`;
        if (await alertOnce(`air-miss:${room.id}:${feedKey}:${b.id}:${missing.join(",")}`, t)) issues.push(t);
      }

      // b) Airbnb đang chặn mà PMS không có lượt ở / khoá tay nào → khoá thừa (mất doanh thu) hoặc nối nhầm
      const pmsNights = new Set(room.bookings.filter((b) => b.feedKey !== feedKey).flatMap((b) => nights({ start: day(b.checkIn), end: day(b.checkOut) })));
      const stray = airBlocks.flatMap(nights).filter((n) => n >= today && n < horizon && !pmsNights.has(n));
      if (stray.length >= 2) {
        const t =
          `ℹ️ AIRBNB ĐANG KHOÁ THỪA — phòng ${roomLabel(room)}${feedKey === "airbnbIcalUrl2" ? " (listing thứ 2)" : ""}\n` +
          `${stray.length} đêm bị chặn trên Airbnb nhưng PMS trống: ${stray.slice(0, 12).map((n) => `${n.slice(8)}/${n.slice(5, 7)}`).join(", ")}${stray.length > 12 ? "…" : ""}\n` +
          `→ Nếu không phải anh khoá tay, mở lại ngày trên Airbnb (có thể do link lịch nối nhầm phòng).`;
        if (await alertOnce(`air-stray:${room.id}:${feedKey}:${stray[0]}:${stray.length}`, t)) issues.push(t);
      }
    }
  }
  return issues;
}
