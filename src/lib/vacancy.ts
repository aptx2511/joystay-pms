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
// Làm việc theo THANG GIÁ AIRBNB (kênh ~90% khách): "đang" = giá đang niêm yết trên Airbnb,
// "đề xuất" = giá nên đặt trên Airbnb. Giá trực tiếp (website/JoyBot) = đề xuất Airbnb ÷ tỉ lệ Airbnb/giá gốc.
// Phân loại theo TỪNG ĐÊM (không theo cả khoảng trống):
//   Sát ngày  : đêm đó còn ≤ 3 ngày nữa      → giảm để bán nốt (đêm trống là mất trắng)
//   Sắp tới   : còn 4–14 ngày                → giảm nhẹ / theo Airbnb gợi ý
//   Còn xa    : còn > 14 ngày                → giữ giá, chỉ chỉnh nếu Airbnb gợi ý khác nhiều
//   + Đêm lẻ  : khoảng trống ≤ 2 đêm kẹp giữa 2 booking (khó bán) → giảm thêm 5%
const FLOOR = Number(process.env.PRICE_FLOOR_RATIO ?? "0.75"); // không thấp hơn 75% giá Airbnb đang niêm yết
const round1k = (n: number) => Math.round(n / 10_000) * 10_000;
const isWeekend = (d: Date) => [5, 6].includes(d.getUTCDay()); // đêm thứ 6, thứ 7
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

export type NightCat = "satngay" | "saptoi" | "conxa";
export interface NightAdvice {
  date: string; weekday: number; weekend: boolean; lead: number; cat: NightCat; orphan: boolean;
  base: number;            // giá gốc trực tiếp (Settings)
  abNow: number;           // giá Airbnb đang niêm yết (hoặc ước tính nếu chưa đọc được)
  abNowKnown: boolean;
  abSuggested: number;     // giá ĐỀ XUẤT đặt trên Airbnb
  abChangePct: number;     // % thay đổi so với đang (âm = giảm)
  suggested: number;       // giá trực tiếp tương ứng
  why: string;             // lý do ngắn
  applied: number | null; airbnbPrice: number | null; airbnbTip: number | null; airbnbTarget: number | null; airbnbDone: boolean;
}
export interface GapAdvice {
  roomId: string; roomLabel: string; from: string; to: string; nights: number; lead: number; orphan: boolean;
  nightsAdvice: NightAdvice[]; totalAb: number; reasons: string[];
  channels: { name: string; why: string; connected: boolean; listPrice?: number }[];
}

export const CAT_RULES = {
  satngay: "≤ 3 ngày nữa",
  saptoi: "4–14 ngày nữa",
  conxa: "> 14 ngày nữa",
};

export async function pricingAdvice(month?: string) {
  const today = vnToday();
  const [y, m] = (month ?? dayKey(today).slice(0, 7)).split("-").map(Number);
  const monthStart = new Date(Date.UTC(y, m - 1, 1));
  const monthEnd = new Date(Date.UTC(y, m, 1));
  const start = monthStart < today ? today : monthStart;
  const totalNightsMonth = Math.round((monthEnd.getTime() - monthStart.getTime()) / DAY);

  const { rooms, gaps } = start < monthEnd ? await findGaps(start, monthEnd) : { rooms: [] as RoomLite[], gaps: [] as Gap[] };
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
    const kRatio = ratios.get(r.id) ?? 1;
    const lead = Math.round((g.from.getTime() - today.getTime()) / DAY);
    const orphan = g.nights <= 2 && g.bookedBefore && g.bookedAfter;
    const occ = 1 - (freeByRoom.get(r.id) ?? 0) / totalNightsMonth;
    const nightsAdvice: NightAdvice[] = [];
    for (let t = g.from.getTime(); t < g.to.getTime(); t += DAY) {
      const d = new Date(t);
      const nl = Math.round((t - today.getTime()) / DAY);
      const wk = isWeekend(d);
      const base = wk ? r.weekendPricePerNight ?? r.pricePerNight : r.pricePerNight;
      const rt = rateOf(r.id, t);
      const abNowKnown = rt?.airbnbPrice != null;
      const abNow = rt?.airbnbPrice ?? round1k(base * kRatio);
      const tip = rt?.airbnbTip ?? null;
      const cat: NightCat = nl <= 3 ? "satngay" : nl <= 14 ? "saptoi" : "conxa";
      let target: number; let why: string;
      if (cat === "conxa") {
        if (tip != null && Math.abs(tip - abNow) / abNow >= 0.1) { target = clamp(tip, abNow * 0.9, abNow * 1.15); why = `Còn xa — Airbnb gợi ý ${tip > abNow ? "cao" : "thấp"} hơn nhiều, chỉnh nhẹ theo`; }
        else { target = abNow; why = "Còn xa — giữ giá, xem lại khi còn ≤ 14 ngày"; }
      } else {
        let disc = cat === "satngay" ? (nl <= 1 ? 15 : 10) : (nl <= 7 ? 7 : 3);
        if (orphan) disc += 5;
        if (occ < 0.4) disc += 3;
        if (wk) disc = Math.round(disc / 2);
        const rule = abNow * (1 - disc / 100);
        if (tip != null) {
          target = cat === "satngay" ? Math.min(tip, rule) : clamp(tip, abNow * 0.85, abNow * 1.1);
          why = cat === "satngay" ? "Sát ngày — lấy mức thấp hơn giữa Airbnb gợi ý và giảm " + disc + "%" : "Sắp tới — theo Airbnb gợi ý (giới hạn −15%…+10%)";
        } else { target = rule; why = `${cat === "satngay" ? "Sát ngày" : "Sắp tới"} — giảm ${disc}%`; }
        if (orphan) why += " · đêm lẻ";
      }
      target = Math.max(target, abNow * FLOOR);
      let abSuggested = round1k(target);
      if (Math.abs(abSuggested - abNow) < 10_000) abSuggested = abNow;
      nightsAdvice.push({
        date: dayKey(d), weekday: d.getUTCDay(), weekend: wk, lead: nl, cat, orphan, base,
        abNow, abNowKnown, abSuggested, abChangePct: Math.round((abSuggested / abNow - 1) * 100),
        suggested: round1k(abSuggested / kRatio), why,
        applied: rt?.price ?? null, airbnbPrice: rt?.airbnbPrice ?? null, airbnbTip: tip,
        airbnbTarget: rt?.airbnbTarget ?? null, airbnbDone: Boolean(rt?.airbnbDoneAt),
      });
    }
    const cnt = (c: NightCat) => nightsAdvice.filter((n) => n.cat === c).length;
    const reasons: string[] = [];
    if (cnt("satngay")) reasons.push(`${cnt("satngay")} đêm sát ngày (≤ 3 ngày nữa) — giảm 10–15% để bán nốt.`);
    if (cnt("saptoi")) reasons.push(`${cnt("saptoi")} đêm sắp tới (4–14 ngày) — giảm nhẹ 3–7% hoặc theo Airbnb gợi ý.`);
    if (cnt("conxa")) reasons.push(`${cnt("conxa")} đêm còn xa (> 14 ngày) — giữ giá.`);
    if (orphan) reasons.push(`Đêm lẻ: chỉ ${g.nights} đêm kẹp giữa 2 booking — giảm thêm 5%, kiểm tra Airbnb cho phép ở tối thiểu 1 đêm.`);
    if (g.nights >= 7) reasons.push(`Trống liền ${g.nights} đêm — nên có giảm giá theo tuần ${r.weeklyDiscount ? `(đang ${r.weeklyDiscount}%)` : "(gợi ý 10%)"} trên Airbnb.`);
    if (occ < 0.4) reasons.push(`Phòng mới lấp ${Math.round(occ * 100)}% tháng này — giảm thêm 3% cho đêm trong 14 ngày tới.`);

    const totalAb = nightsAdvice.reduce((s, n) => s + n.abSuggested, 0);
    const directAvg = nightsAdvice.reduce((s, n) => s + n.suggested, 0) / g.nights;
    const has = { airbnb: Boolean(r.icalUrl || r.airbnbIcalUrl2), booking: Boolean(r.bookingIcalUrl), agoda: Boolean(r.agodaIcalUrl) };
    const ota = (fee: number) => round1k(directAvg / (1 - fee)); // niêm yết sao cho thực nhận ≈ giá trực tiếp
    const near = cnt("satngay") + cnt("saptoi") > 0;
    const channels: GapAdvice["channels"] = [];
    channels.push({ name: "Airbnb", connected: has.airbnb, listPrice: round1k(totalAb / g.nights), why: "Kênh chính — đặt giá theo cột “Đề xuất” trên lịch Airbnb." });
    if (near) channels.push({ name: "Agoda", connected: has.agoda, listPrice: ota(CHANNEL_FEE.AGODA), why: "Khách châu Á hay đặt sát ngày, ở 1–2 đêm (đã cộng bù phí)." });
    if (near) channels.push({ name: "Booking.com", connected: has.booking, listPrice: ota(CHANNEL_FEE.BOOKING), why: "Khách công tác/đi ngắn ngày (đã cộng bù phí)." });
    if (g.nights >= 7) channels.push({ name: "Nhóm Facebook thuê ngắn/dài hạn", connected: true, why: "Khách ở 1–4 tuần — chào giá tuần trọn gói." });
    channels.push({ name: "Trực tiếp (website / Zalo khách cũ)", connected: true, listPrice: round1k(directAvg), why: "Không mất phí — giá này đã tương đương thực nhận từ Airbnb." });

    out.push({
      roomId: r.id, roomLabel: r.roomNumber ? `${r.roomNumber} · ${r.name}` : r.name,
      from: dayKey(g.from), to: dayKey(g.to), nights: g.nights, lead, orphan, nightsAdvice, totalAb, reasons, channels,
    });
  }

  const roomsSummary = all.rooms.map((r) => {
    const free = freeByRoom.get(r.id) ?? 0;
    const freeAhead = gaps.filter((g) => g.roomId === r.id).reduce((s, g) => s + g.nights, 0);
    return { roomId: r.id, roomLabel: r.roomNumber ? `${r.roomNumber} · ${r.name}` : r.name, occupancy: Math.round((1 - free / totalNightsMonth) * 100), freeAhead, ratio: Math.round((ratios.get(r.id) ?? 1) * 100) / 100 };
  });
  const freeKey = new Set(out.flatMap((g) => g.nightsAdvice.map((n) => `${g.roomId}|${n.date}`)));
  const airbnbTodo = rates
    .filter((x) => x.airbnbTarget != null && !x.airbnbDoneAt && freeKey.has(`${x.roomId}|${dayKey(x.date)}`) && Math.abs((x.airbnbPrice ?? 0) - x.airbnbTarget) >= 15_000)
    .map((x) => {
      const r = rooms.find((rr) => rr.id === x.roomId)!;
      return { roomId: x.roomId, roomLabel: r.roomNumber ? `${r.roomNumber} · ${r.name}` : r.name, date: dayKey(x.date), current: x.airbnbPrice, target: x.airbnbTarget! };
    });
  const tipsAt = rates.reduce<Date | null>((a, x) => (x.tipAt && (!a || x.tipAt > a) ? x.tipAt : a), null);

  return {
    airbnbTodo, tipsAt, floorPct: Math.round(FLOOR * 100),
    month: `${y}-${String(m).padStart(2, "0")}`,
    today: dayKey(today),
    rooms: roomsSummary,
    gaps: out.sort((a, b) => a.from.localeCompare(b.from) || a.roomLabel.localeCompare(b.roomLabel)),
    potentialAb: out.reduce((s, g) => s + g.totalAb, 0),
    freeNights: out.reduce((s, g) => s + g.nights, 0),
  };
}
