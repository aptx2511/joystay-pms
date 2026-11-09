/**
 * Phòng trống: tìm các đêm còn trống, khoá/mở khẩn, và gợi ý giá + kênh bán.
 * Đêm d bị chiếm khi có booking CONFIRMED/PENDING/BLOCKED với checkIn <= d < checkOut.
 * Ngày lưu dạng UTC 00:00 của ngày VN (giống phần còn lại của PMS).
 */
import { prisma } from "@/lib/prisma";
import { CHANNEL_FEE } from "@/types";
import { DAY, dayKey, vnToday } from "@/lib/housekeeping";
import { airbnbRatio, ratesBetween } from "@/lib/rates";

export const EMERGENCY_TAG = "[KHOA_KHAN]";
export const EMERGENCY_NAME = "🚨 Khoá khẩn";
const OCCUPYING = ["CONFIRMED", "PENDING", "BLOCKED"];

type RoomLite = {
  id: string; name: string; roomNumber: string | null; pricePerNight: number | null; weekendPricePerNight: number | null;
  icalUrl: string | null; airbnbIcalUrl2: string | null; bookingIcalUrl: string | null; agodaIcalUrl: string | null; travelokaIcalUrl: string | null;
  weeklyDiscount: number | null;
};
export interface Gap { roomId: string; from: Date; to: Date; nights: number; bookedBefore: boolean; bookedAfter: boolean }

/** Khoảng đêm trống [from, to) của từng phòng trong cửa sổ [start, end) */
export async function findGaps(start: Date, end: Date) {
  const rooms = (await prisma.room.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] })) as unknown as RoomLite[];
  const bookings = await prisma.booking.findMany({
    where: { status: { in: OCCUPYING }, checkIn: { lt: end }, checkOut: { gt: new Date(start.getTime() - 60 * DAY) } },
    select: { roomId: true, checkIn: true, checkOut: true, status: true, notes: true },
  });
  const gaps: Gap[] = [];
  for (const r of rooms) {
    const mine = bookings.filter((b) => b.roomId === r.id);
    const busy = (d: Date) => mine.some((b) => b.checkIn <= d && d < b.checkOut);
    let cur: Date | null = null;
    for (let t = start.getTime(); t < end.getTime(); t += DAY) {
      const d = new Date(t);
      if (!busy(d)) { if (!cur) cur = d; continue; }
      if (cur) { gaps.push(mkGap(r.id, cur, d, busy)); cur = null; }
    }
    if (cur) gaps.push(mkGap(r.id, cur, end, busy));
  }
  return { rooms, gaps };
}
function mkGap(roomId: string, from: Date, to: Date, busy: (d: Date) => boolean): Gap {
  return {
    roomId, from, to, nights: Math.round((to.getTime() - from.getTime()) / DAY),
    bookedBefore: busy(new Date(from.getTime() - DAY)), bookedAfter: busy(to),
  };
}

// ── Khoá / mở khoá khẩn ─────────────────────────────────────────────────────
export async function emergencyStatus() {
  const items = await prisma.booking.findMany({
    where: { notes: { contains: EMERGENCY_TAG }, status: "BLOCKED" },
    select: { createdAt: true, checkIn: true, checkOut: true },
    orderBy: { createdAt: "asc" },
  });
  const nights = items.reduce((s, b) => s + Math.round((b.checkOut.getTime() - b.checkIn.getTime()) / DAY), 0);
  return { active: items.length > 0, blocks: items.length, nights, since: items[0]?.createdAt ?? null };
}

export async function emergencyLock(days = 365) {
  const start = vnToday();
  const end = new Date(start.getTime() + days * DAY);
  const { gaps } = await findGaps(start, end);
  if (gaps.length) {
    await prisma.booking.createMany({
      data: gaps.map((g) => ({
        roomId: g.roomId, guestName: EMERGENCY_NAME, checkIn: g.from, checkOut: g.to,
        source: "DIRECT", status: "BLOCKED", priceSource: "MANUAL",
        notes: `${EMERGENCY_TAG} Khoá khẩn mọi ngày trống — mở bằng nút "Mở khoá khẩn"`,
      })),
    });
  }
  return { created: gaps.length, nights: gaps.reduce((s, g) => s + g.nights, 0) };
}

export async function emergencyUnlock() {
  const r = await prisma.booking.deleteMany({ where: { notes: { contains: EMERGENCY_TAG }, status: "BLOCKED", source: "DIRECT" } });
  return { removed: r.count };
}

// ── Gợi ý giá & kênh ────────────────────────────────────────────────────────
const FLOOR = Number(process.env.PRICE_FLOOR_RATIO ?? "0.6"); // không bao giờ dưới 60% giá gốc
const round1k = (n: number) => Math.round(n / 10_000) * 10_000;
const isWeekend = (d: Date) => [5, 6].includes(d.getUTCDay()); // đêm thứ 6, thứ 7

export interface NightAdvice {
  date: string; weekday: number; weekend: boolean; lead: number; base: number; suggested: number; discountPct: number;
  applied: number | null; airbnbPrice: number | null; airbnbTip: number | null; airbnbTipBase: number | null; airbnbTarget: number | null; airbnbDone: boolean;
}
export interface GapAdvice {
  roomId: string; roomLabel: string; from: string; to: string; nights: number; lead: number;
  kind: "lastminute" | "orphan" | "long" | "normal";
  nightsAdvice: NightAdvice[]; total: number; reasons: string[];
  channels: { name: string; why: string; connected: boolean; listPrice?: number }[];
}

export async function pricingAdvice(month?: string) {
  const today = vnToday();
  const [y, m] = (month ?? dayKey(today).slice(0, 7)).split("-").map(Number);
  const monthStart = new Date(Date.UTC(y, m - 1, 1));
  const monthEnd = new Date(Date.UTC(y, m, 1));
  const start = monthStart < today ? today : monthStart;
  const totalNightsMonth = Math.round((monthEnd.getTime() - monthStart.getTime()) / DAY);

  const { rooms, gaps } = start < monthEnd ? await findGaps(start, monthEnd) : { rooms: [] as RoomLite[], gaps: [] as Gap[] };
  // ngày trống của tháng (kể cả phần đã qua để tính lấp đầy)
  const all = await findGaps(monthStart, monthEnd);
  const freeByRoom = new Map<string, number>();
  for (const g of all.gaps) freeByRoom.set(g.roomId, (freeByRoom.get(g.roomId) ?? 0) + g.nights);

  const rates = start < monthEnd ? await ratesBetween(start, monthEnd) : [];
  const rateOf = (roomId: string, t: number) => rates.find((x) => x.roomId === roomId && x.date.getTime() === t);
  const ratios = new Map<string, number>();
  for (const r of rooms) ratios.set(r.id, await airbnbRatio(r));

  const out: GapAdvice[] = [];
  for (const g of gaps) {
    const r = rooms.find((x) => x.id === g.roomId)!;
    if (!r.pricePerNight) continue;
    const lead = Math.round((g.from.getTime() - today.getTime()) / DAY);
    const orphan = g.nights <= 2 && g.bookedBefore && g.bookedAfter;
    const long = g.nights >= 7;
    const kind: GapAdvice["kind"] = lead <= 3 ? "lastminute" : orphan ? "orphan" : long ? "long" : "normal";
    const occ = 1 - (freeByRoom.get(r.id) ?? 0) / totalNightsMonth;
    const reasons: string[] = [];
    const nightsAdvice: NightAdvice[] = [];
    for (let t = g.from.getTime(); t < g.to.getTime(); t += DAY) {
      const d = new Date(t);
      const nl = Math.round((t - today.getTime()) / DAY);
      const wk = isWeekend(d);
      const base = wk ? r.weekendPricePerNight ?? r.pricePerNight : r.pricePerNight;
      let disc = nl <= 1 ? 25 : nl <= 3 ? 15 : nl <= 7 ? 10 : nl <= 14 ? 5 : 0;
      if (orphan) disc += 10;
      if (occ < 0.4 && nl <= 14) disc += 5;
      if (wk) disc = Math.round(disc / 2);
      const suggested = Math.max(round1k(base * (1 - disc / 100)), round1k(base * FLOOR));
      const rt = rateOf(r.id, t);
      const k = ratios.get(r.id) ?? 1;
      nightsAdvice.push({
        date: dayKey(d), weekday: d.getUTCDay(), weekend: wk, lead: nl, base, suggested, discountPct: Math.round((1 - suggested / base) * 100),
        applied: rt?.price ?? null, airbnbPrice: rt?.airbnbPrice ?? null, airbnbTip: rt?.airbnbTip ?? null,
        airbnbTipBase: rt?.airbnbTip ? round1k(rt.airbnbTip / k) : null, airbnbTarget: rt?.airbnbTarget ?? null, airbnbDone: Boolean(rt?.airbnbDoneAt),
      });
    }
    if (lead <= 3) reasons.push(`Còn ${Math.max(lead, 0)} ngày là tới — giảm sâu để bán sát ngày (đêm trống là mất trắng).`);
    else if (lead <= 14) reasons.push(`Còn ${lead} ngày — giảm nhẹ để kéo khách đặt sớm.`);
    else reasons.push(`Còn ${lead} ngày — giữ giá gốc, xem lại khi còn ~14 ngày.`);
    if (orphan) reasons.push(`Khoảng trống lẻ ${g.nights} đêm kẹp giữa 2 booking — đặt tối thiểu 1 đêm và giảm thêm để lấp.`);
    if (long) reasons.push(`Trống dài ${g.nights} đêm — bật/đẩy giảm giá theo tuần ${r.weeklyDiscount ? `(đang ${r.weeklyDiscount}%)` : "(gợi ý 10–15%)"} để hút khách ở dài.`);
    if (occ < 0.4) reasons.push(`Phòng mới lấp đầy ${Math.round(occ * 100)}% tháng này — ưu tiên lấp phòng hơn giữ giá.`);
    if (nightsAdvice.some((n) => n.weekend)) reasons.push("Đêm thứ 6, thứ 7 giảm ít hơn (khách cuối tuần ít nhạy giá).");
    const tips = nightsAdvice.filter((n) => n.airbnbTipBase != null);
    if (tips.length) {
      const diff = tips.reduce((s, n) => s + (n.airbnbTipBase! - n.suggested) / n.suggested, 0) / tips.length;
      if (Math.abs(diff) >= 0.12) reasons.push(`Airbnb gợi ý ${diff > 0 ? "CAO" : "THẤP"} hơn giá gợi ý của PMS ~${Math.round(Math.abs(diff) * 100)}% (theo nhu cầu & chỗ ở tương tự quanh khu) — cân nhắc ${diff > 0 ? "giữ giá cao hơn" : "hạ thêm"}.`);
      else reasons.push("Airbnb gợi ý gần khớp giá gợi ý của PMS.");
    }

    const total = nightsAdvice.reduce((s, n) => s + n.suggested, 0);
    const avg = total / g.nights;
    const has = { airbnb: Boolean(r.icalUrl || r.airbnbIcalUrl2), booking: Boolean(r.bookingIcalUrl), agoda: Boolean(r.agodaIcalUrl), traveloka: Boolean(r.travelokaIcalUrl) };
    const list = (fee: number) => round1k(avg / (1 - fee) * (1 - CHANNEL_FEE.AIRBNB)); // giữ cùng mức thực nhận như Airbnb
    const channels: GapAdvice["channels"] = [];
    channels.push({ name: "Airbnb", connected: has.airbnb, listPrice: round1k(avg),
      why: kind === "long" ? "Kênh chính (~90% khách); bật giảm giá theo tuần/tháng." : kind === "lastminute" ? "Kênh chính; đặt giá mới cho đúng các đêm này (chỉnh trực tiếp trên lịch Airbnb)." : "Kênh chính (~90% khách) — chỉnh giá các đêm này trên lịch Airbnb." });
    if (kind === "lastminute" || kind === "orphan")
      channels.push({ name: "Agoda", connected: has.agoda, listPrice: list(CHANNEL_FEE.AGODA), why: "Khách châu Á hay đặt sát ngày & ở 1–2 đêm; phí ~18% nên niêm yết cao hơn để thực nhận ngang Airbnb." });
    if (kind !== "long")
      channels.push({ name: "Booking.com", connected: has.booking, listPrice: list(CHANNEL_FEE.BOOKING), why: "Nhiều khách công tác/đi ngắn ngày, đặt sát ngày." });
    if (kind === "long")
      channels.push({ name: "Nhóm Facebook thuê ngắn/dài hạn Q1–Q3", connected: true, why: "Khách ở 1–4 tuần (expat, công tác) — chào giá tuần trọn gói, không mất phí kênh." });
    channels.push({ name: "Trực tiếp (website / Zalo khách cũ)", connected: true, listPrice: round1k(avg * (1 - CHANNEL_FEE.AIRBNB) * 1.05),
      why: "Không mất phí — có thể chào rẻ hơn giá Airbnb mà vẫn thu nhiều hơn." });

    out.push({
      roomId: r.id, roomLabel: r.roomNumber ? `${r.roomNumber} · ${r.name}` : r.name,
      from: dayKey(g.from), to: dayKey(g.to), nights: g.nights, lead, kind, nightsAdvice, total, reasons, channels,
    });
  }

  const roomsSummary = all.rooms.map((r) => {
    const free = freeByRoom.get(r.id) ?? 0;
    const freeAhead = gaps.filter((g) => g.roomId === r.id).reduce((s, g) => s + g.nights, 0);
    return { roomId: r.id, roomLabel: r.roomNumber ? `${r.roomNumber} · ${r.name}` : r.name, occupancy: Math.round((1 - free / totalNightsMonth) * 100), freeAhead };
  });
  // Danh sách "cần chỉnh trên Airbnb": đã bấm Áp dụng nhưng chưa xác nhận đã chỉnh, đêm còn trống
  const freeKey = new Set(out.flatMap((g) => g.nightsAdvice.map((n) => `${g.roomId}|${n.date}`)));
  const airbnbTodo = rates
    .filter((x) => x.airbnbTarget != null && !x.airbnbDoneAt && freeKey.has(`${x.roomId}|${dayKey(x.date)}`) && Math.abs((x.airbnbPrice ?? 0) - x.airbnbTarget) >= 15_000)
    .map((x) => {
      const r = rooms.find((rr) => rr.id === x.roomId)!;
      return { roomId: x.roomId, roomLabel: r.roomNumber ? `${r.roomNumber} · ${r.name}` : r.name, date: dayKey(x.date), current: x.airbnbPrice, target: x.airbnbTarget! };
    });
  const tipsAt = rates.reduce<Date | null>((a, x) => (x.tipAt && (!a || x.tipAt > a) ? x.tipAt : a), null);

  return {
    airbnbTodo, tipsAt,
    month: `${y}-${String(m).padStart(2, "0")}`,
    today: dayKey(today),
    rooms: roomsSummary,
    gaps: out.sort((a, b) => a.from.localeCompare(b.from) || a.roomLabel.localeCompare(b.roomLabel)),
    potential: out.reduce((s, g) => s + g.total, 0),
    freeNights: out.reduce((s, g) => s + g.nights, 0),
  };
}
