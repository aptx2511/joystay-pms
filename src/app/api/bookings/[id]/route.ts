import { NextResponse } from "next/server";
import { parseISO } from "date-fns";
import prisma from "@/lib/prisma";

// GET /api/bookings/:id
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const booking = await prisma.booking.findUnique({
      where: { id },
      include: { room: true, guest: true },
    });
    if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(booking);
  } catch (error) {
    console.error("[GET /api/bookings/:id]", error);
    return NextResponse.json({ error: "Failed to fetch booking" }, { status: 500 });
  }
}

// PUT /api/bookings/:id
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { roomId, guestName, checkIn, checkOut, source, status, totalPrice, notes } = body;

    const ciDate = checkIn ? parseISO(checkIn) : undefined;
    const coDate = checkOut ? parseISO(checkOut) : undefined;

    if (ciDate && coDate && coDate <= ciDate) {
      return NextResponse.json({ error: "checkOut must be after checkIn" }, { status: 400 });
    }

    // If dates or room changed, re-check overlap
    if (ciDate && coDate && roomId) {
      const overlap = await prisma.booking.findFirst({
        where: {
          id:     { not: id },
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
          { error: `Room is already booked for those dates` },
          { status: 409 }
        );
      }
    }

    const booking = await prisma.booking.update({
      where: { id },
      data: {
        ...(roomId     && { roomId }),
        ...(guestName  && { guestName }),
        ...(ciDate     && { checkIn: ciDate }),
        ...(coDate     && { checkOut: coDate }),
        ...(source     && { source }),
        ...(status     && { status }),
        totalPrice: totalPrice !== undefined ? (totalPrice ? parseFloat(totalPrice) : null) : undefined,
        ...(notes !== undefined && { notes }),
      },
      include: { room: true },
    });

    return NextResponse.json(booking);
  } catch (error) {
    console.error("[PUT /api/bookings/:id]", error);
    return NextResponse.json({ error: "Failed to update booking" }, { status: 500 });
  }
}

// DELETE /api/bookings/:id
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await prisma.booking.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/bookings/:id]", error);
    return NextResponse.json({ error: "Failed to delete booking" }, { status: 500 });
  }
}
