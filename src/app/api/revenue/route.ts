import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { startOfMonth, endOfMonth, subMonths, format } from "date-fns";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const monthsBack = parseInt(searchParams.get("months") ?? "6");

    const now   = new Date();
    const start = startOfMonth(subMonths(now, monthsBack - 1));
    const end   = endOfMonth(now);

    // Tất cả bookings không bị huỷ trong khoảng thời gian
    const bookings = await prisma.booking.findMany({
      where: {
        status:  { not: "CANCELLED" },
        checkIn: { gte: start, lte: end },
      },
      include: { room: true },
      orderBy: { checkIn: "asc" },
    });

    // ── Summary ───────────────────────────────────────────────────────────────
    const confirmed = bookings.filter((b) => b.status === "CONFIRMED");
    const totalRevenue    = confirmed.reduce((s, b) => s + (b.totalPrice ?? 0), 0);
    const pendingRevenue  = bookings
      .filter((b) => b.status === "PENDING")
      .reduce((s, b) => s + (b.totalPrice ?? 0), 0);
    const totalNights     = confirmed.reduce((s, b) => {
      const nights = Math.round(
        (new Date(b.checkOut).getTime() - new Date(b.checkIn).getTime()) / 86_400_000
      );
      return s + nights;
    }, 0);

    // ── By Month ──────────────────────────────────────────────────────────────
    const monthMap: Record<string, { revenue: number; bookings: number; nights: number }> = {};
    for (let i = monthsBack - 1; i >= 0; i--) {
      const key = format(subMonths(now, i), "yyyy-MM");
      monthMap[key] = { revenue: 0, bookings: 0, nights: 0 };
    }
    for (const b of confirmed) {
      const key = format(new Date(b.checkIn), "yyyy-MM");
      if (monthMap[key]) {
        monthMap[key].revenue  += b.totalPrice ?? 0;
        monthMap[key].bookings += 1;
        monthMap[key].nights   += Math.round(
          (new Date(b.checkOut).getTime() - new Date(b.checkIn).getTime()) / 86_400_000
        );
      }
    }
    const byMonth = Object.entries(monthMap).map(([month, v]) => ({
      month,
      label: format(new Date(month + "-01"), "MMM yyyy"),
      ...v,
    }));

    // ── By Room ───────────────────────────────────────────────────────────────
    const roomMap: Record<string, { name: string; revenue: number; bookings: number; nights: number }> = {};
    for (const b of confirmed) {
      const rid = b.roomId;
      if (!roomMap[rid]) {
        roomMap[rid] = { name: b.room?.name ?? rid, revenue: 0, bookings: 0, nights: 0 };
      }
      roomMap[rid].revenue  += b.totalPrice ?? 0;
      roomMap[rid].bookings += 1;
      roomMap[rid].nights   += Math.round(
        (new Date(b.checkOut).getTime() - new Date(b.checkIn).getTime()) / 86_400_000
      );
    }
    const byRoom = Object.entries(roomMap)
      .map(([roomId, v]) => ({ roomId, ...v }))
      .sort((a, b) => b.revenue - a.revenue);

    // ── By Source ─────────────────────────────────────────────────────────────
    const sourceMap: Record<string, { revenue: number; bookings: number }> = {
      AIRBNB:  { revenue: 0, bookings: 0 },
      DIRECT:  { revenue: 0, bookings: 0 },
      OFFLINE: { revenue: 0, bookings: 0 },
    };
    for (const b of confirmed) {
      const src = b.source as keyof typeof sourceMap;
      if (sourceMap[src]) {
        sourceMap[src].revenue  += b.totalPrice ?? 0;
        sourceMap[src].bookings += 1;
      }
    }
    const bySource = Object.entries(sourceMap).map(([source, v]) => ({ source, ...v }));

    // ── No-price count ────────────────────────────────────────────────────────
    const noPriceCount = confirmed.filter((b) => b.totalPrice == null).length;

    return NextResponse.json({
      summary: {
        totalRevenue,
        pendingRevenue,
        totalBookings:    confirmed.length,
        avgPerBooking:    confirmed.length ? Math.round(totalRevenue / confirmed.length) : 0,
        totalNights,
        noPriceCount,
      },
      byMonth,
      byRoom,
      bySource,
    });
  } catch (error) {
    console.error("[GET /api/revenue]", error);
    return NextResponse.json({ error: "Failed to fetch revenue data" }, { status: 500 });
  }
}
