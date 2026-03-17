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

// Update iCal URL for a room (PATCH by room name or id via query param)
export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, icalUrl } = body as { id: string; icalUrl: string };

    if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

    const room = await prisma.room.update({
      where: { id },
      data:  { icalUrl: icalUrl || null },
    });
    return NextResponse.json(room);
  } catch (error) {
    console.error("[PATCH /api/rooms]", error);
    return NextResponse.json({ error: "Failed to update room" }, { status: 500 });
  }
}
