import { NextResponse } from "next/server";
import { parseISO } from "date-fns";
import prisma from "@/lib/prisma";

// Public API — GET /api/availability?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD
// Returns available rooms for the given date range.
// Your external website calls this endpoint.

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const checkIn  = searchParams.get("checkIn");
    const checkOut = searchParams.get("checkOut");

    if (!checkIn || !checkOut) {
      return NextResponse.json(
        { error: "checkIn and checkOut query params are required (YYYY-MM-DD)" },
        { status: 400 }
      );
    }

    const ciDate = parseISO(checkIn);
    const coDate = parseISO(checkOut);

    if (isNaN(ciDate.getTime()) || isNaN(coDate.getTime())) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
    }
    if (coDate <= ciDate) {
      return NextResponse.json({ error: "checkOut must be after checkIn" }, { status: 400 });
    }

    // Find rooms that have NO overlapping CONFIRMED/PENDING booking
    const allRooms = await prisma.room.findMany({ orderBy: { sortOrder: "asc" } });

    const bookedRoomIds = await prisma.booking.findMany({
      where: {
        status: { in: ["CONFIRMED", "PENDING"] },
        AND: [
          { checkIn:  { lt: coDate } },
          { checkOut: { gt: ciDate } },
        ],
      },
      select: { roomId: true },
    });

    const bookedSet = new Set(bookedRoomIds.map((b) => b.roomId));

    const available = allRooms
      .filter((r) => !bookedSet.has(r.id))
      .map((r) => ({
        id:   r.id,
        name: r.name,
        size: r.size,
      }));

    return NextResponse.json(
      { checkIn, checkOut, available, total: available.length },
      {
        headers: {
          // Allow your website domain to call this endpoint
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    console.error("[GET /api/availability]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Preflight for CORS
export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
