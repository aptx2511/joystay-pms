import { NextResponse } from "next/server";
import { arrivalsDigest, codesAudit, pendingCodes, portalLink } from "@/lib/stay";
import { prisma } from "@/lib/prisma";
import { paymentView } from "@/lib/payment";

export const dynamic = "force-dynamic";

// GET /api/stay/bot?kind=pending-codes|arrivals — cho JoyBot (x-api-key hoặc Bearer CRON_SECRET)
export async function GET(request: Request) {
  const key = request.headers.get("x-api-key");
  const auth = request.headers.get("authorization");
  const ok =
    (process.env.PMS_API_KEY && key === process.env.PMS_API_KEY) ||
    (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`);
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const kind = new URL(request.url).searchParams.get("kind");
  try {
    if (kind === "pending-codes") {
      // + link cổng khách & số tiền còn phải trả (QR) để JoyBot ghép vào tin gửi khách Booking/Agoda
      const items = await Promise.all((await pendingCodes()).map(async (it) => {
        const b = await prisma.booking.findUnique({ where: { id: it.bookingId }, include: { portal: true } });
        if (!b?.portal) return it;
        const pay = await paymentView(b).catch(() => null);
        return { ...it, portalUrl: portalLink(b.portal), payDue: pay?.due ?? null };
      }));
      return NextResponse.json({ items });
    }
    if (kind === "arrivals") return NextResponse.json(await arrivalsDigest());
    if (kind === "codes-audit") return NextResponse.json({ items: await codesAudit() });
    return NextResponse.json({ error: "kind = pending-codes | arrivals | codes-audit" }, { status: 400 });
  } catch (e) {
    console.error("[GET /api/stay/bot]", e);
    return NextResponse.json({ error: "Lỗi máy chủ" }, { status: 500 });
  }
}
