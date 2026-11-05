import { NextResponse } from "next/server";
import { DAY, dayKey, roomLabel, vnToday } from "@/lib/housekeeping";
import { doorCodesOf, idPhotosOf, lookupLink, portalLink, staysBetween, stayPhase } from "@/lib/stay";

export const dynamic = "force-dynamic";

// GET /api/stay/admin?days=4 → khách đang ở + khách đến (hôm qua → +days) cho trang Lưu trú
export async function GET(request: Request) {
  const days = Math.min(Number(new URL(request.url).searchParams.get("days")) || 4, 14);
  const today = vnToday();
  const list = await staysBetween(new Date(today.getTime() - DAY), new Date(today.getTime() + days * DAY));
  return NextResponse.json({
    today: dayKey(today),
    lookupLink: lookupLink(),
    stays: list.map((b) => {
      const p = b.portal;
      return {
        bookingId: b.id,
        guestName: b.guestName,
        source: b.source,
        confirmationCode: b.confirmationCode,
        room: roomLabel(b.room),
        roomNumber: b.room.roomNumber,
        checkIn: dayKey(b.checkIn),
        checkOut: dayKey(b.checkOut),
        phase: stayPhase(b).phase,
        link: p ? portalLink(p) : null,
        phoneLast4: p?.phoneLast4 ?? null,
        idCount: idPhotosOf(p).length,
        idPhotos: idPhotosOf(p).map((u) => `/api/stay/admin/photo?u=${encodeURIComponent(u)}`),
        idSubmittedAt: p?.idSubmittedAt ?? null,
        idPurged: Boolean(p?.idPurgedAt),
        registeredAt: p?.registeredAt ?? null,
        doorCodes: doorCodesOf(p),
        codesSource: p?.codesSource ?? null,
        firstViewAt: p?.firstViewAt ?? null,
        codesViewedAt: p?.codesViewedAt ?? null,
        arrivalTime: p?.arrivalTime ?? null,
        guests: p?.guests ?? null,
        issues: Array.isArray(p?.issues) ? p!.issues : [],
        feedback: p?.feedback ?? null,
      };
    }),
  });
}
