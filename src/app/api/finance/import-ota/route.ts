import { NextResponse } from "next/server";
import { importOtaBookings, importOtaLines, LEDGER_CHANNELS, LedgerChannel, OtaBookingRow, OtaRow } from "@/lib/ota-ledger";
import { tgNotify } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/finance/import-ota  (đăng nhập PMS hoặc x-api-key)
 * { channel: "AIRBNB"|"BOOKING"|"AGODA", snapshot?: boolean, rows: OtaRow[], notify?: boolean }
 * Dữ liệu do Claude đọc từ trang quản lý của kênh (Chrome của chủ) mỗi thứ Hai.
 */
export async function POST(request: Request) {
  const b = (await request.json().catch(() => ({}))) as { channel?: string; snapshot?: boolean; rows?: OtaRow[]; bookings?: OtaBookingRow[]; notify?: boolean };
  const channel = String(b.channel ?? "").toUpperCase() as LedgerChannel;
  if (!LEDGER_CHANNELS.includes(channel) || (!Array.isArray(b.rows) && !Array.isArray(b.bookings))) return NextResponse.json({ ok: false, error: "Thiếu channel / rows" }, { status: 400 });
  if (!Array.isArray(b.rows)) return NextResponse.json({ ok: true, channel, ...(await importOtaBookings(channel, b.bookings!)) });
  if (b.rows.length > 5000) return NextResponse.json({ ok: false, error: "Quá nhiều dòng" }, { status: 400 });
  const r = { ...(await importOtaLines(channel, b.rows, !!b.snapshot)), ...(Array.isArray(b.bookings) && b.bookings.length ? await importOtaBookings(channel, b.bookings) : {}) };
  if (b.notify && (r.missingInPms.length || r.pmsOnly.length || r.noRoom)) {
    await tgNotify(
      `🧾 Sổ OTA ${channel}: ${r.rows} khoản` +
      (r.noRoom ? `\n⚠️ ${r.noRoom} khoản chưa ghép được phòng` : "") +
      (r.missingInPms.length ? `\n⚠️ Kênh có, PMS chưa có: ${r.missingInPms.join(", ")}` : "") +
      (r.pmsOnly.length ? `\n⚠️ PMS có, kênh không có:\n- ${r.pmsOnly.join("\n- ")}` : ""),
    );
  }
  return NextResponse.json(r);
}
