import { NextResponse } from "next/server";
import { arrivalsDigest, pendingCodes } from "@/lib/stay";

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
    if (kind === "pending-codes") return NextResponse.json({ items: await pendingCodes() });
    if (kind === "arrivals") return NextResponse.json(await arrivalsDigest());
    return NextResponse.json({ error: "kind = pending-codes | arrivals" }, { status: 400 });
  } catch (e) {
    console.error("[GET /api/stay/bot]", e);
    return NextResponse.json({ error: "Lỗi máy chủ" }, { status: 500 });
  }
}
