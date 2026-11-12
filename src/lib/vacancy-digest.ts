/**
 * Bản tin phòng trống hằng ngày (JoyBot gửi Telegram lúc 08:00).
 * - Đêm trống 14 ngày tới theo phòng, lấp đầy 7/30 ngày so với mốc hoà vốn
 * - Phương án đề xuất theo luật đơn giản, KHÔNG bao giờ dưới giá sàn (= 83% giá trực tiếp)
 */
import { prisma } from "@/lib/prisma";
import { DAY, dayKey, vnToday } from "@/lib/housekeeping";

const BREAKEVEN_CASH = Number(process.env.OCC_BREAKEVEN_CASH ?? 35); // % lấp đầy đủ chi tiền mặt
const BREAKEVEN_FULL = Number(process.env.OCC_BREAKEVEN_FULL ?? 53); // % lấp đầy hoàn vốn 5 năm
const FLOOR_RATIO = Number(process.env.PRICE_FLOOR_RATIO ?? 0.83);
const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const k = (n: number) => `${Math.round(n / 1000).toLocaleString("vi-VN")}k`;
const dm = (d: Date) => `${WD[d.getUTCDay()]} ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;

export async function buildVacancyDigest() {
  const today = vnToday();
  const end14 = new Date(today.getTime() + 14 * DAY);
  const end30 = new Date(today.getTime() + 30 * DAY);
  const rooms = await prisma.room.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const bookings = await prisma.booking.findMany({
    where: { status: { in: ["CONFIRMED", "PENDING", "BLOCKED"] }, checkIn: { lt: end30 }, checkOut: { gt: new Date(today.getTime() - 3 * DAY) } },
    select: { roomId: true, checkIn: true, checkOut: true, status: true },
  });
  const state = (roomId: string, d: Date): "free" | "sold" | "block" => {
    const b = bookings.find((x) => x.roomId === roomId && x.checkIn <= d && d < x.checkOut);
    return !b ? "free" : b.status === "BLOCKED" ? "block" : "sold";
  };

  const occ = (days: number) => {
    let sold = 0, sellable = 0;
    for (const r of rooms) for (let i = 0; i < days; i++) {
      const s = state(r.id, new Date(today.getTime() + i * DAY));
      if (s !== "block") sellable++;
      if (s === "sold") sold++;
    }
    return sellable ? Math.round((sold / sellable) * 100) : 0;
  };
  const occ7 = occ(7), occ30 = occ(30);

  const lines: string[] = [];
  const actions: string[] = [];
  let tonightFree: string[] = [];
  const weekdayFree3to7: Record<string, string[]> = {};
  const idle: string[] = [];

  for (const r of rooms) {
    const label = r.roomNumber ?? r.name;
    const direct = r.pricePerNight ?? 0;
    const floor = Math.round((direct * FLOOR_RATIO) / 1000) * 1000;
    const free: Date[] = [];
    for (let t = today.getTime(); t < end14.getTime(); t += DAY) {
      const d = new Date(t);
      if (state(r.id, d) === "free") free.push(d);
    }
    const sold14 = 14 - free.length - Array.from({ length: 14 }, (_, i) => state(r.id, new Date(today.getTime() + i * DAY))).filter((s) => s === "block").length;
    if (!free.length) { lines.push(`✅ ${label}: kín 14 ngày`); continue; }
    lines.push(`🛏 ${label}: trống ${free.length}/14 đêm — ${free.slice(0, 8).map(dm).join(", ")}${free.length > 8 ? "…" : ""}`);
    if (sold14 === 0) idle.push(label);

    // đêm nay
    if (free[0] && free[0].getTime() === today.getTime()) {
      const p = Math.max(floor, Math.round((direct * 0.9) / 1000) * 1000);
      tonightFree.push(`${label} ${k(p)}`);
    }
    // đêm lẻ (1–2 đêm kẹp giữa 2 booking) trong 14 ngày
    for (let i = 0; i < free.length; i++) {
      const s = free[i];
      let j = i; while (j + 1 < free.length && free[j + 1].getTime() - free[j].getTime() === DAY) j++;
      const n = j - i + 1;
      const before = state(r.id, new Date(s.getTime() - DAY)) !== "free";
      const after = state(r.id, new Date(free[j].getTime() + DAY)) !== "free";
      if (n <= 2 && before && after && s.getTime() > today.getTime()) {
        const p = Math.max(floor, Math.round((direct * 0.9) / 1000) * 1000);
        actions.push(`🧩 ${label} đêm lẻ ${free.slice(i, j + 1).map(dm).join(", ")}: cho phép ở tối thiểu ${n} đêm, giảm tối đa 10% (trực tiếp ${k(p)}, sàn ${k(floor)})`);
      }
      i = j;
    }
    // ngày thường trống 3–7 ngày tới
    for (const d of free) {
      const lead = Math.round((d.getTime() - today.getTime()) / DAY);
      const dow = d.getUTCDay();
      if (lead >= 2 && lead <= 7 && dow !== 5 && dow !== 6) (weekdayFree3to7[dm(d)] ??= []).push(label);
    }
  }

  if (tonightFree.length) actions.unshift(`🌙 Đêm nay còn trống: ${tonightFree.join(" · ")} → đăng bán trực tiếp (Zalo/FB/khách cũ) ở giá trên, Airbnb đã tự giảm 10% phút chót — KHÔNG giảm thêm.`);
  const hot = Object.entries(weekdayFree3to7).filter(([, v]) => v.length >= Math.ceil(rooms.length / 2));
  if (hot.length) actions.push(`📉 Ngày thường còn ≥ nửa phòng trống: ${hot.map(([d]) => d).join(", ")} → tạo "khuyến mãi tuỳ chỉnh" Airbnb 8% cho đúng các ngày này (vẫn trên sàn).`);
  if (idle.length) actions.push(`🔎 ${idle.join(", ")}: 14 ngày chưa có khách → kiểm tra ảnh bìa/tiêu đề, mở thêm kênh, xem giá đối thủ.`);
  if (occ30 < BREAKEVEN_CASH) actions.push(`⚠️ 30 ngày tới mới ${occ30}% (< ${BREAKEVEN_CASH}% hoà vốn tiền mặt) → đẩy bán: nhắn khách cũ, đăng nội dung, bật giá quốc gia VN trên Booking. Không hạ giá niêm yết.`);
  else if (occ30 >= BREAKEVEN_FULL) actions.push(`🚀 30 ngày tới đạt ${occ30}% (≥ ${BREAKEVEN_FULL}%): có thể tăng giá cuối tuần +5% cho đêm còn trống.`);

  // OTA rẻ hơn Airbnb > 10% ở đêm trống 14 ngày tới
  try {
    const cp = await prisma.channelPrice.findMany({ where: { date: { gte: today, lt: end14 } } });
    const cheap = new Set<string>();
    for (const r of rooms) for (let t = today.getTime(); t < end14.getTime(); t += DAY) {
      const d = new Date(t);
      if (state(r.id, d) !== "free") continue;
      const of = (ch: string) => cp.find((x) => x.roomId === r.id && x.channel === ch && x.date.getTime() === t)?.price;
      const ab = of("AIRBNB");
      for (const ch of ["BOOKING", "AGODA"]) { const p = of(ch); if (ab && p && p < ab * 0.9) cheap.add(`${r.roomNumber ?? r.name} ${ch === "BOOKING" ? "Booking" : "Agoda"}`); }
    }
    if (cheap.size) actions.push(`💸 Lệch giá: ${[...cheap].slice(0, 6).join(", ")} rẻ hơn Airbnb >10% ở đêm trống → chỉnh lại cho bằng giá niêm yết.`);
  } catch { /* chưa có dữ liệu quét giá */ }

  const text = [
    `📊 PHÒNG TRỐNG ${dayKey(today).split("-").reverse().join("/")}`,
    `Lấp đầy 7 ngày: ${occ7}% · 30 ngày: ${occ30}% (mốc: ${BREAKEVEN_CASH}% đủ chi · ${BREAKEVEN_FULL}% hoàn vốn)`,
    "",
    ...lines,
    "",
    actions.length ? "👉 ĐỀ XUẤT HÔM NAY" : "👉 Không cần hành động gì thêm hôm nay.",
    ...actions.map((a, i) => `${i + 1}. ${a}`),
  ].join("\n");
  return { date: dayKey(today), occ7, occ30, text };
}
