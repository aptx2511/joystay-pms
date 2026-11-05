import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as ical from "node-ical";
import { differenceInDays } from "date-fns";
import { calcAutoPrice, BookingSource } from "@/types";
import { generateCleaningTasks, newToken, vnToday } from "@/lib/housekeeping";
import { ensurePortals, parseAirbnbDescription, purgeOldIds } from "@/lib/stay";

type PlatformConfig = {
  source: BookingSource;
  defaultGuestName: string;
  /** SUMMARY chắc chắn là KHOÁ LỊCH (không phải lượt ở) */
  blockSummaries: string[];
};

// Airbnb phân biệt rõ: "Reserved" = khách thật, "Airbnb (Not available)" = khoá lịch
// (gồm cả ngày bị khoá do Airbnb nhập lại lịch của PMS → bản phản chiếu).
// Booking/Agoda/Traveloka ghi "CLOSED - Not available" cho cả hai → dùng luật phản chiếu bên dưới.
const PLATFORMS: Record<string, PlatformConfig> = {
  icalUrl:          { source: "AIRBNB",    defaultGuestName: "Airbnb Guest",      blockSummaries: ["not available"] },
  airbnbIcalUrl2:   { source: "AIRBNB",    defaultGuestName: "Airbnb Guest",      blockSummaries: ["not available"] },
  bookingIcalUrl:   { source: "BOOKING",   defaultGuestName: "Booking.com Guest", blockSummaries: [] },
  agodaIcalUrl:     { source: "AGODA",     defaultGuestName: "Agoda Guest",       blockSummaries: [] },
  travelokaIcalUrl: { source: "TRAVELOKA", defaultGuestName: "Traveloka Guest",   blockSummaries: [] },
};

const GENERIC_SUMMARIES = ["reserved", "closed", "not available", "booked", "unavailable"];

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

async function runSync() {
  const rooms = await prisma.room.findMany();
  const now = new Date();
  const today = vnToday();

  let imported = 0, blocked = 0, cancelled = 0, skipped = 0;
  const errors: string[] = [];

  for (const room of rooms) {
    for (const [feedKey, platform] of Object.entries(PLATFORMS)) {
      const url = room[feedKey as keyof typeof room] as string | null;
      if (!url) continue;

      let events: ical.CalendarResponse;
      try {
        events = await ical.async.fromURL(url);
      } catch (error) {
        errors.push(`${room.name} (${platform.source}): ${error instanceof Error ? error.message : "Failed to fetch iCal"}`);
        continue;
      }

      const seenUids = new Set<string>();

      for (const event of Object.values(events)) {
        if (event.type !== "VEVENT" || !event.start || !event.end) continue;

        const externalId = event.uid ?? null;
        const checkIn    = new Date(event.start as Date);
        const checkOut   = new Date(event.end as Date);
        if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime()) || checkOut <= checkIn) continue;
        if (externalId) seenUids.add(externalId);

        const rawSummary = typeof event.summary === "string" ? event.summary.trim() : "";
        const lower = rawSummary.toLowerCase();
        let isBlock = platform.blockSummaries.some((s) => lower.includes(s));
        const surelyReal = platform.source === "AIRBNB" && lower.includes("reserved");

        const existing = externalId
          ? await prisma.booking.findUnique({ where: { roomId_externalId: { roomId: room.id, externalId } } })
          : null;

        // Luật phản chiếu: sự kiện trùng KHÍT ngày nhận + trả với một booking CÓ TRƯỚC của nguồn
        // KHÁC trong cùng phòng → đó là lịch PMS đã xuất sang kênh này rồi bị kéo về lại → BLOCKED.
        if (!isBlock && !surelyReal) {
          const sameDates = await prisma.booking.findMany({
            where: {
              roomId: room.id,
              source: { not: platform.source },
              status: { in: ["CONFIRMED", "PENDING"] },
              createdAt: { lt: existing?.createdAt ?? now },
              checkIn: { gte: new Date(checkIn.getTime() - 86_400_000), lte: new Date(checkIn.getTime() + 86_400_000) },
            },
            select: { checkIn: true, checkOut: true },
          });
          isBlock = sameDates.some((b) => dayKey(b.checkIn) === dayKey(checkIn) && dayKey(b.checkOut) === dayKey(checkOut));
        }

        const isGeneric = !rawSummary || GENERIC_SUMMARIES.some((s) => lower.includes(s));
        const guestName = isBlock ? `${platform.defaultGuestName} (khoá lịch)` : isGeneric ? platform.defaultGuestName : rawSummary;
        const status    = isBlock ? "BLOCKED" : "CONFIRMED";

        // Airbnb: mã xác nhận (HMXXXX) + 4 số cuối ĐT → khách tự tra cứu cổng khách
        const air = platform.source === "AIRBNB" && !isBlock ? parseAirbnbDescription(event.description) : { code: null, last4: null };

        const nights    = differenceInDays(checkOut, checkIn);
        const autoPrice = !isBlock && room.pricePerNight && nights > 0
          ? calcAutoPrice(checkIn, checkOut, room.pricePerNight, room.weekendPricePerNight, platform.source)
          : null;

        try {
          if (externalId) {
            if (existing) {
              const keepPrice = existing.priceSource === "MANUAL" || existing.priceSource === "IMPORT";
              await prisma.booking.update({
                where: { id: existing.id },
                data: {
                  checkIn, checkOut, guestName, feedKey, lastSyncedAt: now,
                  status, cancelledAt: null,
                  ...(air.code && { confirmationCode: air.code }),
                  ...(!keepPrice && { totalPrice: autoPrice }),
                },
              });
            } else {
              await prisma.booking.create({
                data: {
                  roomId: room.id, guestName, checkIn, checkOut,
                  source: platform.source, status, externalId, feedKey,
                  totalPrice: autoPrice, lastSyncedAt: now,
                  confirmationCode: air.code,
                },
              });
            }
            if (air.last4) {
              const b = await prisma.booking.findUnique({ where: { roomId_externalId: { roomId: room.id, externalId } }, select: { id: true } });
              if (b) {
                await prisma.stayPortal.upsert({
                  where: { bookingId: b.id },
                  update: { phoneLast4: air.last4 },
                  create: { bookingId: b.id, token: newToken(), phoneLast4: air.last4 },
                });
              }
            }
          } else {
            const overlap = await prisma.booking.findFirst({
              where: { roomId: room.id, source: platform.source, checkIn: { lte: checkOut }, checkOut: { gte: checkIn } },
            });
            if (!overlap) {
              await prisma.booking.create({
                data: {
                  roomId: room.id, guestName, checkIn, checkOut,
                  source: platform.source, status, feedKey,
                  totalPrice: autoPrice, lastSyncedAt: now,
                },
              });
            }
          }
          if (isBlock) blocked++; else imported++;
        } catch {
          skipped++;
        }
      }

      // Booking biến mất khỏi lịch kênh (khách huỷ / chủ mở khoá) → CANCELLED.
      // Chỉ xét booking chưa tới ngày nhận phòng (lịch kênh tự bỏ ngày đã qua).
      const stale = await prisma.booking.findMany({
        where: {
          roomId: room.id,
          source: platform.source,
          externalId: { not: null },
          status: { in: ["CONFIRMED", "BLOCKED"] },
          checkIn: { gte: today },
          OR: feedKey === "icalUrl" ? [{ feedKey }, { feedKey: null }] : [{ feedKey }],
        },
        select: { id: true, externalId: true },
      });
      const gone = stale.filter((b) => b.externalId && !seenUids.has(b.externalId)).map((b) => b.id);
      if (gone.length) {
        await prisma.booking.updateMany({
          where: { id: { in: gone } },
          data: { status: "CANCELLED", cancelledAt: now },
        });
        cancelled += gone.length;
      }
    }
  }

  let housekeeping = "";
  try {
    const r = await generateCleaningTasks();
    housekeeping = ` Lịch dọn: +${r.created} mới, ${r.updated} cập nhật, ${r.skipped} bỏ.`;
  } catch (e) {
    errors.push(`Housekeeping: ${e instanceof Error ? e.message : String(e)}`);
  }

  try {
    await ensurePortals();
    await purgeOldIds();
  } catch (e) {
    errors.push(`Cổng khách: ${e instanceof Error ? e.message : String(e)}`);
  }

  return NextResponse.json({
    message: `Sync xong: ${imported} lượt ở, ${blocked} khoá lịch, ${cancelled} huỷ, ${skipped} lỗi.${housekeeping}`,
    imported, blocked, cancelled, skipped,
    ...(errors.length > 0 && { errors }),
  });
}

// Manual trigger từ Settings page (đã qua lớp đăng nhập ở middleware)
export async function POST() {
  return runSync();
}

// Cron (Vercel 08:00 + JoyBot mỗi 15 phút) — cần Authorization: Bearer CRON_SECRET
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  return runSync();
}
