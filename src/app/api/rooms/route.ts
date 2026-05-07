import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET() {
  try {
    const rooms = await prisma.room.findMany({ orderBy: { sortOrder: "asc" } });
    return NextResponse.json(rooms);
  } catch (error) {
    console.error("[GET /api/rooms]", error);
    return NextResponse.json({ error: "Failed to fetch rooms" }, { status: 500 });
  }
}

// Update room settings (icalUrl, pricePerNight, weekendPricePerNight)
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, icalUrl, bookingIcalUrl, agodaIcalUrl, travelokaIcalUrl, pricePerNight, weekendPricePerNight } = body as {
      id: string;
      icalUrl?: string;
      bookingIcalUrl?: string;
      agodaIcalUrl?: string;
      travelokaIcalUrl?: string;
      pricePerNight?: number | null;
      weekendPricePerNight?: number | null;
    };

    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const room = await prisma.room.update({
      where: { id },
      data: {
        ...(icalUrl              !== undefined && { icalUrl:              icalUrl              || null }),
        ...(bookingIcalUrl       !== undefined && { bookingIcalUrl:       bookingIcalUrl       || null }),
        ...(agodaIcalUrl         !== undefined && { agodaIcalUrl:         agodaIcalUrl         || null }),
        ...(travelokaIcalUrl     !== undefined && { travelokaIcalUrl:     travelokaIcalUrl     || null }),
        ...(pricePerNight !== undefined && {
          pricePerNight: pricePerNight ? Number(pricePerNight) : null,
        }),
        ...(weekendPricePerNight !== undefined && {
          weekendPricePerNight: weekendPricePerNight ? Number(weekendPricePerNight) : null,
        }),
      },
    });
    return NextResponse.json(room);
  } catch (error) {
    console.error("[PATCH /api/rooms]", error);
    return NextResponse.json({ error: "Failed to update room" }, { status: 500 });
  }
}
