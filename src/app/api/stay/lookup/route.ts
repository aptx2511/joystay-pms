import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { newToken, vnToday, DAY } from "@/lib/housekeeping";

// POST /api/stay/lookup { code, last4 } → { token }
// code = mã xác nhận Airbnb (HM…) hoặc mã đặt trực tiếp (6 ký tự cuối booking id); last4 = 4 số cuối ĐT.
// Chống dò: phải khớp CẢ HAI, chỉ lượt ở chưa kết thúc quá 2 ngày, có độ trễ cố định.
export async function POST(request: Request) {
  const started = Date.now();
  const fail = async (msg: string, status = 404) => {
    const wait = 900 - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return NextResponse.json({ error: msg }, { status });
  };

  const { code, last4 } = (await request.json().catch(() => ({}))) as { code?: string; last4?: string };
  const c = (code ?? "").trim().toUpperCase().replace(/\s+/g, "");
  const l = (last4 ?? "").replace(/\D/g, "").slice(-4);
  if (c.length < 6 || l.length !== 4) return fail("Nhập mã đặt phòng và 4 số cuối điện thoại / Enter booking code and last 4 digits", 400);

  const since = new Date(vnToday().getTime() - 2 * DAY);
  const candidates = await prisma.booking.findMany({
    where: {
      status: "CONFIRMED",
      checkOut: { gte: since },
      OR: [{ confirmationCode: c }, { id: { endsWith: c.toLowerCase() } }],
    },
    include: { portal: true, guest: true },
    take: 5,
  });
  const match = candidates.find((b) => {
    const phones = [b.portal?.phoneLast4, b.guest?.phone?.replace(/\D/g, "").slice(-4)].filter(Boolean);
    return phones.includes(l);
  });
  if (!match) return fail("Không tìm thấy đặt phòng — kiểm tra lại hoặc nhắn Joystay / Booking not found — please check or message us");

  const portal = match.portal ?? (await prisma.stayPortal.create({ data: { bookingId: match.id, token: newToken(), phoneLast4: l } }));
  return NextResponse.json({ token: portal.token });
}
