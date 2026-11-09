import { NextResponse } from "next/server";
import { applyRates, clearRates, markAirbnbDone, ratesBetween, saveAirbnbTips, toDate } from "@/lib/rates";

export const dynamic = "force-dynamic";

// GET /api/rates?from=YYYY-MM-DD&to=YYYY-MM-DD[&roomId=]
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const from = sp.get("from"), to = sp.get("to");
  if (!from || !to) return NextResponse.json({ error: "from, to bắt buộc" }, { status: 400 });
  return NextResponse.json(await ratesBetween(toDate(from), toDate(to), sp.get("roomId") ?? undefined));
}

// POST { action: "apply" | "clear" | "tips" | "airbnb-done", items: [...] }
export async function POST(request: Request) {
  const { action, items } = await request.json().catch(() => ({}));
  if (!Array.isArray(items) || items.length === 0 || items.length > 500) return NextResponse.json({ error: "items 1–500" }, { status: 400 });
  const ok = (n: number) => NextResponse.json({ ok: true, updated: n });
  if (action === "apply") return ok(await applyRates(items));
  if (action === "clear") return ok(await clearRates(items));
  if (action === "tips") return ok(await saveAirbnbTips(items));
  if (action === "airbnb-done") return ok(await markAirbnbDone(items));
  return NextResponse.json({ error: "action không hợp lệ" }, { status: 400 });
}
