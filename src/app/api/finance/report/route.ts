import { NextResponse } from "next/server";
import { monthReport } from "@/lib/finance";

export const dynamic = "force-dynamic";

// GET ?month=YYYY-MM
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("month");
  const month = q && /^\d{4}-\d{2}$/.test(q) ? q : new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7);
  return NextResponse.json(await monthReport(month));
}
