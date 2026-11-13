import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensurePortalLink, isOta, paymentView, setPayTag } from "@/lib/payment";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/bookings/<id>/pay-link { amount? } — (đã đăng nhập) tạo mã thanh toán + link cổng khách có QR.
 * Đơn OTA (Booking/Agoda trả tại chỗ): bắt buộc amount = số khách phải trả (giá kênh, chưa trừ hoa hồng).
 * Trả { url, code, due, message } — message song ngữ để dán vào chat với khách.
 */
export async function POST(request: Request, { params }: Params) {
  if (request.headers.get("x-pms-auth") !== "1") return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  const { id } = await params;
  const b = await prisma.booking.findUnique({ where: { id }, include: { room: true } });
  if (!b) return NextResponse.json({ error: "Không có đơn" }, { status: 404 });
  if (b.source === "AIRBNB") return NextResponse.json({ error: "Đơn Airbnb đã thanh toán qua Airbnb — không gửi QR." }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as { amount?: number | string };
  const amount = Math.round(Number(String(body.amount ?? "").replace(/[^\d]/g, "")) || 0);
  if (isOta(b.source) && !amount && !/\[TT \w+ =\d+\]/.test(b.notes ?? ""))
    return NextResponse.json({ error: "Đơn kênh OTA: nhập số tiền khách cần trả (giá trên đơn Booking/Agoda)." }, { status: 400 });

  const { notes } = await setPayTag(b, amount || null);
  const pay = await paymentView({ ...b, notes });
  if (!pay) return NextResponse.json({ error: "Chưa cấu hình BANK_ID / BANK_ACCOUNT_NO trên Vercel, hoặc đơn đã thu đủ." }, { status: 400 });
  const url = await ensurePortalLink(b.id);
  const vnd = (n: number) => n.toLocaleString("vi-VN");
  const message = [
    `Hi! You can pay for your Joystay stay (room ${b.room.roomNumber ?? b.room.name}) by bank transfer here — the QR code has the amount (${vnd(pay.due)} VND) and reference ${pay.note} filled in: ${url}`,
    `Cash on arrival is also fine.`,
    ``,
    `Bạn có thể thanh toán bằng chuyển khoản tại đây — mã QR đã điền sẵn số tiền ${vnd(pay.due)}đ và nội dung ${pay.note}: ${url}`,
  ].join("\n");
  return NextResponse.json({ url, code: pay.code, due: pay.due, message, notes });
}
