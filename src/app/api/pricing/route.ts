import { NextResponse } from "next/server";
import { pricingAdvice } from "@/lib/vacancy";

export const dynamic = "force-dynamic";

// GET /api/pricing?month=YYYY-MM — gợi ý giá & kênh cho các đêm còn trống
export async function GET(request: Request) {
  const month = new URL(request.url).searchParams.get("month") ?? undefined;
  if (month && !/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "month dạng YYYY-MM" }, { status: 400 });
  return NextResponse.json(await pricingAdvice(month));
}
