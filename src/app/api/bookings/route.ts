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

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// POST /api/bookings
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { roomId, guestName, guestEmail, guestPhone, checkIn, checkOut, source, status, totalPrice, notes, cccdFrontUrl, cccdBackUrl } = body;

    if (!roomId || !guestName || !checkIn || !checkOut) {
      return NextResponse.json(
        { error: "roomId, guestName, checkIn, checkOut are required" },
        { status: 400, headers: CORS }
      );
    }

    const ciDate = parseISO(checkIn);
    const coDate = parseISO(checkOut);
    if (coDate <= ciDate) {
      return NextResponse.json({ error: "checkOut must be after checkIn" }, { status: 400, headers: CORS });
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
        { error: "Room is already booked for these dates. Please choose different dates." },
        { status: 409, headers: CORS }
      );
    }

    // Create Guest record if contact info provided
    let guestId: string | null = null;
    if (guestEmail || guestPhone) {
      const guest = await prisma.guest.create({
        data: {
          name:  guestName,
          email: guestEmail ?? null,
          phone: guestPhone ?? null,
        },
      });
      guestId = guest.id;
    }

    const booking = await prisma.booking.create({
      data: {
        roomId,
        guestId,
        guestName,
        checkIn:    ciDate,
        checkOut:   coDate,
        source:     source ?? "DIRECT",
        status:     status ?? "PENDING",
        totalPrice:   totalPrice ? parseFloat(totalPrice) : null,
        notes:        notes ?? null,
        cccdFrontUrl: cccdFrontUrl ?? null,
        cccdBackUrl:  cccdBackUrl  ?? null,
      },
      include: { room: true, guest: true },
    });

    return NextResponse.json(booking, { status: 201, headers: CORS });
  } catch (error) {
    console.error("[POST /api/bookings]", error);
    return NextResponse.json({ error: "Failed to create booking" }, { status: 500, headers: CORS });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS });
}
