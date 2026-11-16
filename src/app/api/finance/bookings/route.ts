import { NextResponse } from "next/server";
import { bookingSummary } from "@/lib/ota-ledger";

export const dynamic = "force-dynamic";

// GET /api/finance/bookings?from=2026-11-01&to=2026-12-01&by=checkIn|bookedAt — tổng hợp từng đặt phòng mọi kênh
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const d = (s: string | null, def: Date) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : def);
  const now = new Date(Date.now() + 7 * 3_600_000);
  const from = d(sp.get("from"), new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const to = d(sp.get("to"), new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)));
  const by = sp.get("by") === "bookedAt" ? "bookedAt" : "checkIn";
  return NextResponse.json({ from, to, by, rows: await bookingSummary(from, to, by) });
}
