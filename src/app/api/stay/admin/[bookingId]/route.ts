import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { newToken } from "@/lib/housekeeping";
import { portalLink, type DoorCode } from "@/lib/stay";

type Params = { params: Promise<{ bookingId: string }> };

/**
 * PATCH /api/stay/admin/:bookingId
 *   { doorCodes: [{door, code}], source?: "TTLOCK" | "MANUAL" }  → lưu mã cửa (JoyBot tự gọi khi cấp mã TTLock)
 *   { registered: true | false }                                 → đã/chưa khai báo lưu trú
 *   { phoneLast4: "1234" }                                       → mã cửa đề xuất Airbnb (4 số cuối ĐT) để bot cài TTLock
 */
export async function PATCH(request: Request, { params }: Params) {
  const { bookingId } = await params;
  const body = (await request.json().catch(() => ({}))) as { doorCodes?: DoorCode[]; source?: string; registered?: boolean; phoneLast4?: string | null };
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) return NextResponse.json({ error: "Không thấy booking" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (Array.isArray(body.doorCodes)) {
    const codes = body.doorCodes
      .map((c) => ({ door: String(c.door ?? "").trim().slice(0, 40), code: String(c.code ?? "").replace(/[^\d#*]/g, "").slice(0, 12) }))
      .filter((c) => c.door && c.code);
    data.doorCodes = codes;
    data.codesSource = body.source === "TTLOCK" ? "TTLOCK" : "MANUAL";
    data.codesIssuedAt = codes.length ? new Date() : null;
  }
  if (body.registered !== undefined) data.registeredAt = body.registered ? new Date() : null;
  // "Mã cửa đề xuất" của Airbnb (= 4 số cuối ĐT khách) — bot dùng số này để cài lên TTLock
  if (body.phoneLast4 !== undefined) {
    const v = String(body.phoneLast4 ?? "").replace(/\D/g, "");
    data.phoneLast4 = /^\d{4}$/.test(v) ? v : null;
  }

  const portal = await prisma.stayPortal.upsert({
    where: { bookingId },
    update: data,
    create: { bookingId, token: newToken(), ...data },
  });
  return NextResponse.json({ ok: true, link: portalLink(portal) });
}
