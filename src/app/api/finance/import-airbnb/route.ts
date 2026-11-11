import { NextResponse } from "next/server";
import { importAirbnbCsv } from "@/lib/finance";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST (text/csv body) — CSV "Lịch sử giao dịch" của Airbnb
export async function POST(request: Request) {
  const text = await request.text();
  if (!text || text.length > 5_000_000) return NextResponse.json({ ok: false, error: "File rỗng hoặc quá lớn" }, { status: 400 });
  return NextResponse.json(await importAirbnbCsv(text));
}
