import { NextResponse } from "next/server";
import { buildLastMinuteReminder, buildVacancyDigest } from "@/lib/vacancy-digest";

export const dynamic = "force-dynamic";

// GET /api/vacancy/digest — bản tin phòng trống + đề xuất cho JoyBot (đăng nhập, x-api-key hoặc Bearer CRON_SECRET)
// ?mode=evening — nhắc 18:00 các đêm còn trống trong 48 giờ tới
export async function GET(request: Request) {
  try {
    if (new URL(request.url).searchParams.get("mode") === "evening") return NextResponse.json(await buildLastMinuteReminder());
    return NextResponse.json(await buildVacancyDigest());
  } catch (error) {
    console.error("[GET /api/vacancy/digest]", error);
    return NextResponse.json({ error: "Không tạo được bản tin" }, { status: 500 });
  }
}
