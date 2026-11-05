import { NextResponse } from "next/server";
import { buildDigest } from "@/lib/housekeeping";

export const dynamic = "force-dynamic";

// GET /api/housekeeping/digest?kind=weekly|daily|alert
// Cho JoyBot gửi Telegram. Cần x-api-key (PMS_API_KEY) hoặc Authorization: Bearer CRON_SECRET.
export async function GET(request: Request) {
  const key = request.headers.get("x-api-key");
  const auth = request.headers.get("authorization");
  const okKey = process.env.PMS_API_KEY && key === process.env.PMS_API_KEY;
  const okCron = process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!okKey && !okCron) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const kind = new URL(request.url).searchParams.get("kind");
  if (kind !== "weekly" && kind !== "daily" && kind !== "alert") {
    return NextResponse.json({ error: "kind = weekly | daily | alert" }, { status: 400 });
  }
  try {
    return NextResponse.json(await buildDigest(kind));
  } catch (error) {
    console.error("[GET /api/housekeeping/digest]", error);
    return NextResponse.json({ error: "Không tạo được bản tin" }, { status: 500 });
  }
}
