import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import * as ical from "node-ical";
import { differenceInDays } from "date-fns";
import { calcAutoPrice, BookingSource } from "@/types";
import { generateCleaningTasks, newToken, vnToday } from "@/lib/housekeeping";
import { ensurePortals, parseAirbnbDescription, purgeOldIds } from "@/lib/stay";
import { checkBookingIntegrity } from "@/lib/sync-guard";
import { migrateMovedBookings } from "@/lib/booking-move";
import { rematchEmails } from "@/lib/inbox";
import { WEB_HOLD_MINUTES, expireWebHolds } from "@/lib/payment";
import { tgNotify } from "@/lib/telegram";

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

/**
 * Phòng có 2 listing Airbnb nhưng chỉ 1 listing là lịch chính (11/2026: 302 → Parisian = airbnbIcalUrl2).
 * Listing phụ (B&W = icalUrl) sắp xoá: chỉ lấy LƯỢT Ở THẬT (vd Minh 12/2026), BỎ mọi khoá lịch của nó
 * để không làm sai số đêm trống / lấp đầy. Cấu hình: SECONDARY_FEEDS="302:icalUrl,..."
 */
const SECONDARY_FEEDS = new Set(
  (process.env.SECONDARY_FEEDS ?? "302:icalUrl").split(",").map((x) => x.trim()).filter(Boolean)
);
const isSecondary = (roomNumber: string | null, feedKey: string) => !!roomNumber && SECONDARY_FEEDS.has(`${roomNumber}:${feedKey}`);

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
              // gồm cả BLOCKED (chủ khoá lịch / "Not available" của kênh khác): Booking.com xuất lại
              // các ngày đã đóng thành sự kiện thường → không có luật này sẽ thành booking ma (vd 201 06→07/11)
              status: { in: ["CONFIRMED", "PENDING", "BLOCKED"] },
              createdAt: { lt: existing?.createdAt ?? now },
              checkIn: { gte: new Date(checkIn.getTime() - 86_400_000), lte: new Date(checkIn.getTime() + 86_400_000) },
            },
            select: { checkIn: true, checkOut: true },
          });
          isBlock = sameDates.some((b) => dayKey(b.checkIn) === dayKey(checkIn) && dayKey(b.checkOut) === dayKey(checkOut));
        }

        // listing phụ: khoá lịch → bỏ qua hoàn toàn (không đánh dấu đã thấy → bản cũ bị huỷ bên dưới)
        if (isBlock && isSecondary(room.roomNumber, feedKey)) {
          if (externalId) seenUids.delete(externalId);
          continue;
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
              const keepPrice = existing.priceSource === "MANUAL" || existing.priceSource === "IMPORT" || existing.priceSource === "EMAIL";
              await prisma.booking.update({
                where: { id: existing.id },
                data: {
                  checkIn, checkOut, feedKey, lastSyncedAt: now,
                  // giữ tên khách thật đã nhập/tra (iCal Airbnb chỉ có "Reserved") — chỉ ghi đè khi tên đang là tên mặc định
                  ...((isBlock || !existing.guestName || existing.guestName.startsWith(platform.defaultGuestName) || !isGeneric) && { guestName }),
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
          // booking nhập trước khi có feedKey (null): mỗi phòng chỉ có 1 lịch cho mỗi kênh, riêng Airbnb có
          // thể có listing thứ 2 → bản ghi cũ của Airbnb chỉ đối chiếu với listing chính (icalUrl)
          OR: feedKey === "airbnbIcalUrl2" ? [{ feedKey }] : [{ feedKey }, { feedKey: null }],
        },
        select: { id: true, externalId: true },
      });
      // listing phụ: huỷ luôn mọi khoá lịch cũ của nó (kể cả đã qua ngày) để số liệu lấp đầy đúng
      if (isSecondary(room.roomNumber, feedKey)) {
        const r = await prisma.booking.updateMany({
          where: { roomId: room.id, status: "BLOCKED", OR: [{ feedKey }, { feedKey: null, source: platform.source }] },
          data: { status: "CANCELLED", cancelledAt: now },
        });
        cancelled += r.count;
      }
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

  // Đơn chuyển phòng: chuyển tiền đã thu, mã đặt, tên khách, cổng khách… sang bản ghi mới (trước lịch dọn & cổng khách)
  try {
    await migrateMovedBookings();
  } catch (e) {
    errors.push(`Chuyển phòng: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Đơn website giữ chỗ quá hạn chưa có tiền → huỷ, nhả lịch (chạy trước lịch dọn)
  try {
    for (const b of await expireWebHolds()) {
      cancelled++;
      await tgNotify(`⌛ Huỷ đơn website ${b.guestName} · phòng ${b.room.roomNumber ?? b.room.name} · ${b.checkIn.toISOString().slice(0, 10)}→${b.checkOut.toISOString().slice(0, 10)}: quá ${WEB_HOLD_MINUTES}' chưa nhận tiền, lịch đã mở lại. Khách chuyển muộn → vào Bookings đổi lại "Xác nhận".`).catch(() => {});
    }
  } catch (e) {
    errors.push(`Giữ chỗ web: ${e instanceof Error ? e.message : String(e)}`);
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
    await rematchEmails(); // email đặt phòng về trước iCal → khớp lại
  } catch (e) {
    errors.push(`Cổng khách: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Lá chắn: đơn nhảy phòng / trùng lịch → Telegram (mỗi cảnh báo 1 lần)
  let alerts = 0;
  try {
    alerts = (await checkBookingIntegrity()).length;
  } catch (e) {
    errors.push(`Cảnh báo lịch: ${e instanceof Error ? e.message : String(e)}`);
  }

  return NextResponse.json({
    alerts,
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
