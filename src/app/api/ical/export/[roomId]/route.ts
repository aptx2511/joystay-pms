import { prisma } from "@/lib/prisma";
import { subDays } from "date-fns";

function toICalDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function toICalDateTime(date: Date): string {
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const mi = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");
  return `${y}${mo}${d}T${h}${mi}${s}Z`;
}

function escapeText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      bookings: {
        where: {
          status: { not: "CANCELLED" },
          checkOut: { gte: subDays(new Date(), 1) },
        },
        orderBy: { checkIn: "asc" },
      },
    },
  });

  if (!room) {
    return new Response("Room not found", { status: 404 });
  }

  const dtstamp = toICalDateTime(new Date());

  const events = room.bookings
    .map((booking) => {
      const uid = `${booking.id}@joystay-pms`;
      const dtstart = toICalDate(new Date(booking.checkIn));
      const dtend = toICalDate(new Date(booking.checkOut));

      return [
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;VALUE=DATE:${dtstart}`,
        `DTEND;VALUE=DATE:${dtend}`,
        `SUMMARY:${escapeText(booking.source === "AIRBNB" ? "Airbnb (Imported)" : "Blocked")}`,
        `DESCRIPTION:${escapeText(booking.source)} booking`,
        "STATUS:CONFIRMED",
        "TRANSP:OPAQUE",
        "END:VEVENT",
      ].join("\r\n");
    })
    .join("\r\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Joystay PMS//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:Joystay - ${escapeText(room.name)}`,
    "X-WR-CALDESC:Joystay Property Management System",
    "X-WR-TIMEZONE:Asia/Ho_Chi_Minh",
    events,
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");

  return new Response(lines, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="${roomId}.ics"`,
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
