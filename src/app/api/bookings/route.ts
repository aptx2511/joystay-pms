import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { quoteDirect } from "@/lib/rates";
import { tgNotify } from "@/lib/telegram";
import { WEB_HOLD_MINUTES, WEB_TAG, ensurePortalLink, newPayCode, paymentView, withPayTag } from "@/lib/payment";
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

    // Chưa đăng nhập (xem công khai): ẩn liên hệ, giấy tờ, ghi chú của khách
    if (request.headers.get("x-pms-auth") !== "1") {
      return NextResponse.json(bookings.map(({ guest, cccdFrontUrl, cccdBackUrl, notes, ...b }) => {
        void guest; void cccdFrontUrl; void cccdBackUrl; void notes;
        return { ...b, guest: null, notes: null, room: b.room ? { ...b.room, icalUrl: null, airbnbIcalUrl2: null, bookingIcalUrl: null, agodaIcalUrl: null, travelokaIcalUrl: null } : b.room };
      }));
    }
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
    const { roomId, guestName, guestEmail, guestPhone, checkIn, checkOut, source, status, totalPrice, notes, cccdFrontUrl, cccdBackUrl, confirmationCode } = body;

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

    // Khách tự đặt trên website (không phải PMS đăng nhập, không phải JoyBot) → mã thanh toán JOY + giữ chỗ có hạn
    const viaUi = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
    const isWeb = !viaUi && !String(notes ?? "").startsWith("[JoyBot");
    let price = totalPrice ? parseFloat(totalPrice) : null;
    if (isWeb && !price) price = (await quoteDirect(roomId, checkIn.slice(0, 10), checkOut.slice(0, 10)))?.total ?? null;
    const payCode = isWeb ? await newPayCode() : null;
    const booking = await prisma.booking.create({
      data: {
        roomId,
        guestId,
        guestName,
        checkIn:    ciDate,
        checkOut:   coDate,
        source:     source ?? "DIRECT",
        // chưa đăng nhập (website khách tự đặt) → luôn chờ duyệt
        status:     request.headers.get("x-pms-auth") === "1" ? status ?? "PENDING" : "PENDING",
        totalPrice:   price,
        notes:        payCode ? withPayTag(`${notes ?? ""} ${WEB_TAG}`, payCode) : notes ?? null,
        cccdFrontUrl: cccdFrontUrl ?? null,
        cccdBackUrl:  cccdBackUrl  ?? null,
        confirmationCode: payCode ?? (confirmationCode ? String(confirmationCode).trim().toUpperCase() : null),
      },
      include: { room: true, guest: true },
    });

    if (payCode) {
      const pay = await paymentView(booking).catch(() => null);
      const payUrl = await ensurePortalLink(booking.id).catch(() => null);
      await tgNotify(
        `🌐 Đơn website mới: ${guestName}${guestPhone ? ` (${guestPhone})` : ""} · phòng ${booking.room.roomNumber ?? booking.room.name} · ` +
        `${checkIn.slice(0, 10)}→${checkOut.slice(0, 10)} · ${price ? price.toLocaleString("vi-VN") + "đ" : "chưa có giá"}\n` +
        `Mã thanh toán ${payCode} — tiền về là tự xác nhận; quá ${WEB_HOLD_MINUTES}' chưa có tiền sẽ tự huỷ, nhả lịch.` +
        (pay ? "" : "\n⚠️ PMS chưa có BANK_ID/BANK_ACCOUNT_NO nên khách chưa thấy QR theo đơn."),
      ).catch(() => {});
      return NextResponse.json({ ...booking, payment: pay ? { ...pay, payUrl, holdMinutes: WEB_HOLD_MINUTES } : null }, { status: 201, headers: CORS });
    }

    return NextResponse.json(booking, { status: 201, headers: CORS });
  } catch (error) {
    console.error("[POST /api/bookings]", error);
    return NextResponse.json({ error: "Failed to create booking" }, { status: 500, headers: CORS });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS });
}
