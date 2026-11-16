import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { DAY } from "@/lib/housekeeping";
import { ledgerFreshness, revenueSplit } from "@/lib/ota-ledger";

export const dynamic = "force-dynamic";

/**
 * Doanh thu theo THÁNG Ở (chia theo đêm), đủ mọi kênh (17/11/2026).
 * OTA = tiền chủ thực nhận lấy từ Sổ OTA (Airbnb/Booking/Agoda), đơn chưa có trong sổ = ước tính (estimated).
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const monthsBack = Math.min(24, Math.max(1, parseInt(searchParams.get("months") ?? "6")));
    const now = new Date(Date.now() + 7 * 3_600_000);
    const y = now.getUTCFullYear(), m = now.getUTCMonth();
    const months = Array.from({ length: monthsBack }, (_, i) => {
      const s = new Date(Date.UTC(y, m - (monthsBack - 1 - i), 1)), e = new Date(Date.UTC(y, m - (monthsBack - 1 - i) + 1, 1));
      return { key: s.toISOString().slice(0, 7), s, e };
    });
    const rooms = await prisma.room.findMany({ select: { id: true, name: true, roomNumber: true } });
    const nRooms = rooms.filter((r) => r.roomNumber).length;
    const roomName = new Map(rooms.map((r) => [r.id, r.roomNumber ? `${r.roomNumber} · ${r.name}` : r.name]));
    const paid = await prisma.txn.groupBy({ by: ["bookingId"], where: { kind: "IN", bookingId: { not: null } }, _sum: { amount: true } });
    const paidOf = new Map(paid.map((p) => [p.bookingId!, p._sum.amount ?? 0]));

    const byMonth = [], roomMap: Record<string, { name: string; revenue: number; estimated: number; nights: number }> = {};
    const sourceMap: Record<string, { revenue: number; estimated: number; nights: number }> = {};
    let unverified: Awaited<ReturnType<typeof revenueSplit>>["unverified"] = [];
    for (const mo of months) {
      const sp = await revenueSplit(mo.s, mo.e, paidOf);
      let rev = 0, est = 0, nights = 0;
      for (const [rid, r] of sp.rooms) {
        rev += r.verified + r.estimated; est += r.estimated; nights += r.nights;
        const x = (roomMap[rid] ??= { name: roomName.get(rid) ?? rid, revenue: 0, estimated: 0, nights: 0 });
        x.revenue += r.verified + r.estimated; x.estimated += r.estimated; x.nights += r.nights;
      }
      for (const [ch, c] of Object.entries(sp.channels)) {
        const x = (sourceMap[ch] ??= { revenue: 0, estimated: 0, nights: 0 });
        x.revenue += c.verified + c.estimated; x.estimated += c.estimated; x.nights += c.nights;
      }
      unverified = unverified.concat(sp.unverified.filter((u) => !unverified.some((v) => v.bookingId === u.bookingId)));
      const days = Math.round((mo.e.getTime() - mo.s.getTime()) / DAY);
      byMonth.push({
        month: mo.key, label: `T${Number(mo.key.slice(5))}/${mo.key.slice(2, 4)}`,
        revenue: Math.round(rev), estimated: Math.round(est), nights, bookings: 0,
        occupancy: nRooms ? Math.round((nights / (days * nRooms)) * 100) : 0,
      });
    }
    const totalRevenue = byMonth.reduce((s, x) => s + x.revenue, 0);
    const totalNights = byMonth.reduce((s, x) => s + x.nights, 0);
    const estimated = byMonth.reduce((s, x) => s + x.estimated, 0);
    const R = (o: { revenue: number; estimated: number }) => ({ ...o, revenue: Math.round(o.revenue), estimated: Math.round(o.estimated) });
    return NextResponse.json({
      summary: {
        totalRevenue, estimated, verified: totalRevenue - estimated, pendingRevenue: 0,
        totalBookings: 0, avgPerBooking: 0, totalNights, noPriceCount: 0,
        avgPerNight: totalNights ? Math.round(totalRevenue / totalNights) : 0,
      },
      byMonth,
      byRoom: Object.entries(roomMap).map(([roomId, v]) => ({ roomId, ...R(v), bookings: 0 })).sort((a, b) => b.revenue - a.revenue),
      bySource: Object.entries(sourceMap).map(([source, v]) => ({ source, ...R(v), bookings: 0 })).sort((a, b) => b.revenue - a.revenue),
      unverified: unverified.slice(0, 50),
      freshness: await ledgerFreshness(),
    });
  } catch (error) {
    console.error("[GET /api/revenue]", error);
    return NextResponse.json({ error: "Failed to fetch revenue data" }, { status: 500 });
  }
}
