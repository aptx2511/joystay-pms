import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Public endpoint — returns only blocked date ranges, NO guest details
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;

  const bookings = await prisma.booking.findMany({
    where: {
      roomId,
      status: { not: "CANCELLED" },
    },
    select: {
      checkIn:  true,
      checkOut: true,
    },
    orderBy: { checkIn: "asc" },
  });

  const blockedDates = bookings.map((b) => ({
    start: b.checkIn.toISOString().split("T")[0],
    end:   b.checkOut.toISOString().split("T")[0],
  }));

  return NextResponse.json(blockedDates, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
    },
  });
}
