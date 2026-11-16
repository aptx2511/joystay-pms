import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { DAY, dayKey, vnToday } from "@/lib/housekeeping";
import { ledgerFreshness, revenueSplit } from "@/lib/ota-ledger";

export const dynamic = "force-dynamic";

const fmt = (n: number) => `${(Math.round(n / 1000) * 1000).toLocaleString("vi-VN")}đ`;
const CH: Record<string, string> = { AIRBNB: "Airbnb", BOOKING: "Booking.com", AGODA: "Agoda", DIRECT: "Trực tiếp", OFFLINE: "Khác", TRAVELOKA: "Traveloka" };

/** GET /api/finance/weekly — báo cáo doanh thu tuần cho JoyBot gửi Telegram (thứ Hai) */
export async function GET() {
  const today = vnToday();
  const dow = (today.getUTCDay() + 6) % 7; // 0 = thứ Hai
  const wEnd = new Date(today.getTime() - dow * DAY), wStart = new Date(wEnd.getTime() - 7 * DAY); // tuần trước (T2→CN)
  const mStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const mEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
  const paid = await prisma.txn.groupBy({ by: ["bookingId"], where: { kind: "IN", bookingId: { not: null } }, _sum: { amount: true } });
  const paidOf = new Map(paid.map((p) => [p.bookingId!, p._sum.amount ?? 0]));
  const rooms = await prisma.room.findMany({ where: { roomNumber: { not: null } }, select: { id: true, roomNumber: true }, orderBy: { roomNumber: "asc" } });

  const block = async (title: string, s: Date, e: Date) => {
    const sp = await revenueSplit(s, e, paidOf);
    const days = Math.round((e.getTime() - s.getTime()) / DAY);
    let tot = 0, est = 0, n = 0;
    for (const r of sp.rooms.values()) { tot += r.verified + r.estimated; est += r.estimated; n += r.nights; }
    const lines = [`${title} (${dayKey(s).slice(5)}→${dayKey(new Date(e.getTime() - DAY)).slice(5)})`,
      `Tổng: ${fmt(tot)} · ${n} đêm · lấp đầy ${Math.round((n / (days * rooms.length)) * 100)}%` + (est ? ` · trong đó ${fmt(est)} chưa đối soát` : "")];
    for (const [ch, c] of Object.entries(sp.channels).sort((a, b) => b[1].verified + b[1].estimated - (a[1].verified + a[1].estimated)))
      lines.push(`• ${CH[ch] ?? ch}: ${fmt(c.verified + c.estimated)} (${c.nights} đêm)${c.estimated ? " ⚠️ có ước tính" : ""}`);
    lines.push("Theo phòng: " + rooms.map((r) => { const x = sp.rooms.get(r.id); return `${r.roomNumber} ${x ? fmt(x.verified + x.estimated) : "0đ"}`; }).join(" · "));
    return { text: lines.join("\n"), unverified: sp.unverified };
  };
  const w = await block("📊 Doanh thu tuần trước", wStart, wEnd);
  const mo = await block(`📅 Tháng ${today.getUTCMonth() + 1} (cả tháng, gồm đơn đã đặt)`, mStart, mEnd);
  const fresh = await ledgerFreshness();
  const stale = ["AIRBNB", "BOOKING", "AGODA"].filter((c) => !fresh[c] || Date.now() - Date.parse(fresh[c]) > 8 * DAY);
  const unv = [...w.unverified, ...mo.unverified.filter((u) => !w.unverified.some((v) => v.bookingId === u.bookingId))];
  const text = [
    w.text, "", mo.text,
    stale.length ? `\n⚠️ Sổ OTA chưa cập nhật >8 ngày: ${stale.map((c) => CH[c]).join(", ")} — số kênh này đang là ƯỚC TÍNH.` : "\n✅ Sổ OTA 3 kênh đã cập nhật trong tuần.",
    unv.length ? `\nĐơn OTA chưa có trong sổ (${unv.length}): ` + unv.slice(0, 8).map((u) => `${CH[u.source] ?? u.source} ${u.checkIn.slice(5)} ${u.guest}`).join("; ") : "",
  ].join("\n");
  return NextResponse.json({ text });
}
