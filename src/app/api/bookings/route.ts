import { NextResponse } from "next/server";
import { parseISO } from "date-fns";
import prisma from "@/lib/prisma";

// GET /api/bookings?start=YYYY-MM-DD&end=YYYY-MM-DD
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const start = searchParams.get("start");
    const end   = searchParams.get("end");

    const where = start && end
      ? {
          AND: [
            { checkIn:  { lt: parseISO(end) } },
            { checkOut: { gt: parseISO(start) } },
          ],
        }
      : {};

    const bookings = await prisma.booking.findMany({
      where,
      include: { room: true, guest: true },
      orderBy: { checkIn: "asc" },
    });

    return NextResponse.json(bookings);
  } catch (error) {
    console.error("[GET /api/bookings]", error);
    return NextResponse.json({ error: "Failed to fetch bookings" }, { status: 500 });
  }
}

// POST /api/bookings
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { roomId, guestName, checkIn, checkOut, source, status, totalPrice, notes } = body;

    if (!roomId || !guestName || !checkIn || !checkOut) {
      return NextResponse.json(
        { error: "roomId, guestName, checkIn, checkOut are required" },
        { status: 400 }
      );
    }

    const ciDate = parseISO(checkIn);
    const coDate = parseISO(checkOut);
    if (coDate <= ciDate) {
      return NextResponse.json({ error: "checkOut must be after checkIn" }, { status: 400 });
    }

    // Check for overlapping bookings in the same room (excluding cancelled)
    const overlap = await prisma.booking.findFirst({
      where: {
        roomId,
        status: { not: "CANCELLED" },
        AND: [
          { checkIn:  { lt: coDate } },
          { checkOut: { gt: ciDate } },
        ],
      },
    });

    if (overlap) {
      return NextResponse.json(
        { error: `Room is already booked from ${overlap.checkIn.toISOString()} to ${overlap.checkOut.toISOString()}` },
        { status: 409 }
      );
    }

    const booking = await prisma.booking.create({
      data: {
        roomId,
        guestName,
        checkIn:    ciDate,
        checkOut:   coDate,
        source:     source ?? "DIRECT",
        status:     status ?? "CONFIRMED",
        totalPrice: totalPrice ? parseFloat(totalPrice) : null,
        notes:      notes ?? null,
      },
      include: { room: true },
    });

    return NextResponse.json(booking, { status: 201 });
  } catch (error) {
    console.error("[POST /api/bookings]", error);
    return NextResponse.json({ error: "Failed to create booking" }, { status: 500 });
  }
}
