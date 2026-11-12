import { NextResponse } from "next/server";
import { buildVacancyDigest } from "@/lib/vacancy-digest";

export const dynamic = "force-dynamic";

// GET /api/vacancy/digest — bản tin phòng trống + đề xuất cho JoyBot (đăng nhập, x-api-key hoặc Bearer CRON_SECRET)
export async function GET() {
  try {
    return NextResponse.json(await buildVacancyDigest());
  } catch (error) {
    console.error("[GET /api/vacancy/digest]", error);
    return NextResponse.json({ error: "Không tạo được bản tin" }, { status: 500 });
  }
}
