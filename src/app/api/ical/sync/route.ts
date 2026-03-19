import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as ical from "node-ical";

export async function POST() {
  const rooms = await prisma.room.findMany({
    where: { icalUrl: { not: null } },
  });

  if (rooms.length === 0) {
    return NextResponse.json({
      message: "No rooms have an Airbnb iCal URL saved. Go to Settings and add them first.",
    });
  }

  let totalImported = 0;
  let totalSkipped = 0;
  const errors: string[] = [];

  for (const room of rooms) {
    if (!room.icalUrl) continue;

    try {
      const events = await ical.async.fromURL(room.icalUrl);

      for (const event of Object.values(events)) {
        if (event.type !== "VEVENT") continue;
        if (!event.start || !event.end) continue;

        const externalId = event.uid ?? null;
        const checkIn = new Date(event.start as Date);
        const checkOut = new Date(event.end as Date);

        // Skip invalid or past bookings
        if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) continue;
        if (checkOut <= checkIn) continue;

        const rawSummary = typeof event.summary === "string" ? event.summary : "";
        const guestName =
          rawSummary && rawSummary.toLowerCase() !== "reserved" && rawSummary !== "Airbnb (Not available)"
            ? rawSummary
            : "Airbnb Guest";

        try {
          if (externalId) {
            await prisma.booking.upsert({
              where: { roomId_externalId: { roomId: room.id, externalId } },
              update: { checkIn, checkOut, guestName },
              create: {
                roomId: room.id,
                guestName,
                checkIn,
                checkOut,
                source: "AIRBNB",
                status: "CONFIRMED",
                externalId,
              },
            });
          } else {
            // No UID — check for overlap before creating
            const overlap = await prisma.booking.findFirst({
              where: {
                roomId: room.id,
                source: "AIRBNB",
                checkIn: { lte: checkOut },
                checkOut: { gte: checkIn },
              },
            });
            if (!overlap) {
              await prisma.booking.create({
                data: {
                  roomId: room.id,
                  guestName,
                  checkIn,
                  checkOut,
                  source: "AIRBNB",
                  status: "CONFIRMED",
                },
              });
            }
          }
          totalImported++;
        } catch {
          totalSkipped++;
        }
      }
    } catch (error) {
      errors.push(
        `${room.name}: ${error instanceof Error ? error.message : "Failed to fetch iCal URL"}`
      );
    }
  }

  return NextResponse.json({
    message: `Sync complete. ${totalImported} bookings imported/updated, ${totalSkipped} skipped.`,
    ...(errors.length > 0 && { errors }),
  });
}
