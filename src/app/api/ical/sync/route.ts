import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as ical from "node-ical";
import { differenceInDays } from "date-fns";
import { calcAutoPrice, BookingSource } from "@/types";

type PlatformConfig = {
  source: BookingSource;
  defaultGuestName: string;
  blockedSummaries: string[];
};

const PLATFORMS: Record<string, PlatformConfig> = {
  icalUrl:          { source: "AIRBNB",    defaultGuestName: "Airbnb Guest",    blockedSummaries: ["reserved", "airbnb (not available)"] },
  bookingIcalUrl:   { source: "BOOKING",   defaultGuestName: "Booking.com Guest", blockedSummaries: ["closed", "not available"] },
  agodaIcalUrl:     { source: "AGODA",     defaultGuestName: "Agoda Guest",     blockedSummaries: ["closed", "not available"] },
  travelokaIcalUrl: { source: "TRAVELOKA", defaultGuestName: "Traveloka Guest", blockedSummaries: ["closed", "not available"] },
};

async function runSync() {
  const rooms = await prisma.room.findMany();

  let totalImported = 0;
  let totalSkipped  = 0;
  const errors: string[] = [];

  for (const room of rooms) {
    for (const [urlField, platform] of Object.entries(PLATFORMS)) {
      const url = room[urlField as keyof typeof room] as string | null;
      if (!url) continue;

      try {
        const events = await ical.async.fromURL(url);

        for (const event of Object.values(events)) {
          if (event.type !== "VEVENT") continue;
          if (!event.start || !event.end) continue;

          const externalId = event.uid ?? null;
          const checkIn    = new Date(event.start as Date);
          const checkOut   = new Date(event.end as Date);

          if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) continue;
          if (checkOut <= checkIn) continue;

          const rawSummary = typeof event.summary === "string" ? event.summary.trim() : "";
          const isBlocked  = platform.blockedSummaries.some((s) =>
            rawSummary.toLowerCase().includes(s)
          );
          const guestName  = rawSummary && !isBlocked ? rawSummary : platform.defaultGuestName;

          const nights    = differenceInDays(checkOut, checkIn);
          const autoPrice = room.pricePerNight && nights > 0
            ? calcAutoPrice(checkIn, checkOut, room.pricePerNight, room.weekendPricePerNight, platform.source)
            : null;

          try {
            if (externalId) {
              await prisma.booking.upsert({
                where:  { roomId_externalId: { roomId: room.id, externalId } },
                update: { checkIn, checkOut, guestName },
                create: {
                  roomId: room.id,
                  guestName,
                  checkIn,
                  checkOut,
                  source:     platform.source,
                  status:     "CONFIRMED",
                  externalId,
                  totalPrice: autoPrice,
                },
              });
            } else {
              const overlap = await prisma.booking.findFirst({
                where: {
                  roomId:   room.id,
                  source:   platform.source,
                  checkIn:  { lte: checkOut },
                  checkOut: { gte: checkIn },
                },
              });
              if (!overlap) {
                await prisma.booking.create({
                  data: {
                    roomId:     room.id,
                    guestName,
                    checkIn,
                    checkOut,
                    source:     platform.source,
                    status:     "CONFIRMED",
                    totalPrice: autoPrice,
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
          `${room.name} (${platform.source}): ${error instanceof Error ? error.message : "Failed to fetch iCal"}`
        );
      }
    }
  }

  return NextResponse.json({
    message: `Sync complete. ${totalImported} bookings imported/updated, ${totalSkipped} skipped.`,
    ...(errors.length > 0 && { errors }),
  });
}

// Manual trigger từ Settings page
export async function POST() {
  return runSync();
}

// Vercel Cron Job — tự động sync mỗi giờ
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  return runSync();
}
