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

// Create a new room
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      name, size, pricePerNight, weekendPricePerNight, sortOrder,
      icalUrl, bookingIcalUrl, agodaIcalUrl, travelokaIcalUrl,
    } = body as {
      name: string;
      size: number;
      pricePerNight?: number | null;
      weekendPricePerNight?: number | null;
      sortOrder?: number;
      icalUrl?: string;
      bookingIcalUrl?: string;
      agodaIcalUrl?: string;
      travelokaIcalUrl?: string;
    };

    if (!name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (!size || Number(size) <= 0) return NextResponse.json({ error: "size is required" }, { status: 400 });

    const existing = await prisma.room.findUnique({ where: { name: name.trim() } });
    if (existing) return NextResponse.json({ error: "Room name already exists" }, { status: 409 });

    let order = sortOrder;
    if (order === undefined || order === null) {
      const last = await prisma.room.findFirst({ orderBy: { sortOrder: "desc" } });
      order = (last?.sortOrder ?? 0) + 1;
    }

    const room = await prisma.room.create({
      data: {
        name: name.trim(),
        size: Number(size),
        sortOrder: Number(order),
        pricePerNight:        pricePerNight        ? Number(pricePerNight)        : null,
        weekendPricePerNight: weekendPricePerNight ? Number(weekendPricePerNight) : null,
        icalUrl:          icalUrl          || null,
        bookingIcalUrl:   bookingIcalUrl   || null,
        agodaIcalUrl:     agodaIcalUrl     || null,
        travelokaIcalUrl: travelokaIcalUrl || null,
      },
    });
    return NextResponse.json(room, { status: 201 });
  } catch (error) {
    console.error("[POST /api/rooms]", error);
    return NextResponse.json({ error: "Failed to create room" }, { status: 500 });
  }
}

// Update room settings (icalUrl, pricePerNight, weekendPricePerNight)
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const {
      id, icalUrl, bookingIcalUrl, agodaIcalUrl, travelokaIcalUrl, pricePerNight, weekendPricePerNight,
      name, roomNumber, airbnbIcalUrl2,
    } = body as {
      id: string;
      name?: string;
      roomNumber?: string;
      airbnbIcalUrl2?: string;
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
        ...(airbnbIcalUrl2       !== undefined && { airbnbIcalUrl2:       airbnbIcalUrl2       || null }),
        ...(roomNumber           !== undefined && { roomNumber:           roomNumber?.trim()   || null }),
        ...(name?.trim()                       && { name:                 name.trim() }),
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
