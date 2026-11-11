/**
 * Tiền thật Airbnb từ email (11/2026). Google Apps Script trong Gmail của chủ (Joystay-Ai/automation/airbnb-email-to-pms.gs)
 * đọc email "Đặt phòng đã xác nhận / thay đổi" của Airbnb → gửi { code, payout, guestName?, kind } về đây.
 * Đơn có mã HMxxxx → totalPrice = số tiền host thực nhận, priceSource = IMPORT (iCal không ghi đè nữa).
 * Xác thực: header x-api-key = PMS_API_KEY (middleware).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { tgNotify } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const b = (await request.json().catch(() => ({}))) as { code?: string; payout?: number; nights?: number; guestName?: string; kind?: string; subject?: string };
  const code = String(b.code ?? "").toUpperCase().trim();
  const payout = Math.round(Number(b.payout ?? 0));
  if (!/^HM[A-Z0-9]{6,10}$/.test(code) || !(payout > 0)) {
    await tgNotify(`⚠️ Email Airbnb chưa đọc được số tiền/mã đặt: "${(b.subject ?? "").slice(0, 120)}" — cần chỉnh bộ đọc email.`);
    return NextResponse.json({ ok: false, error: "Thiếu mã HM… hoặc số tiền" }, { status: 400 });
  }

  const booking = await prisma.booking.findFirst({
    where: { confirmationCode: code, status: { not: "CANCELLED" } },
    include: { room: { select: { roomNumber: true, name: true } } },
    orderBy: { updatedAt: "desc" },
  });
  if (!booking) {
    // iCal có thể chưa kéo về — lưu tạm vào bảng cảnh báo để lần sau khớp lại
    return NextResponse.json({ ok: false, pending: true, error: "Chưa có đơn mang mã này trong PMS" }, { status: 404 });
  }

  // Chốt chặn: email cũ (vd xác nhận 25 đêm) mà đơn đã đổi ngày (còn 4 đêm) → KHÔNG ghi số tiền sai
  const pmsNights = Math.round((booking.checkOut.getTime() - booking.checkIn.getTime()) / 86_400_000);
  const emailNights = Math.round(Number(b.nights ?? 0));
  if (emailNights > 0 && emailNights !== pmsNights) {
    await tgNotify(
      `ℹ️ Email Airbnb ${code} (${booking.guestName}) ghi ${emailNights} đêm nhưng đơn trong PMS hiện ${pmsNights} đêm — ` +
      `có thể đơn đã đổi ngày. KHÔNG cập nhật tiền theo email này; chờ email thay đổi đặt phòng hoặc nhập CSV Airbnb.`,
    );
    return NextResponse.json({ ok: true, skipped: "nights-mismatch" });
  }

  const before = booking.totalPrice ?? 0;
  const data: Record<string, unknown> = { totalPrice: payout, priceSource: "IMPORT" };
  if (b.guestName && (!booking.guestName || booking.guestName.startsWith("Airbnb Guest"))) data.guestName = b.guestName.slice(0, 80);
  await prisma.booking.update({ where: { id: booking.id }, data });

  if (Math.abs(before - payout) >= 1000) {
    await tgNotify(
      `🧾 Airbnb ${b.kind === "change" ? "thay đổi" : "xác nhận"} — ${data.guestName ?? booking.guestName} · ${code} · phòng ${booking.room.roomNumber ?? booking.room.name}\n` +
      `Tiền thực nhận: ${payout.toLocaleString("vi-VN")}đ (PMS ước tính trước đó ${Math.round(before).toLocaleString("vi-VN")}đ).`,
    );
  }
  return NextResponse.json({ ok: true, bookingId: booking.id, payout });
}
