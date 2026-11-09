import { NextResponse } from "next/server";
import { emergencyLock, emergencyStatus, emergencyUnlock } from "@/lib/vacancy";
import { tgNotify } from "@/lib/telegram";

export const dynamic = "force-dynamic";

// GET: trạng thái khoá khẩn
export async function GET() {
  return NextResponse.json(await emergencyStatus());
}

// POST { action: "lock" | "unlock" }
export async function POST(request: Request) {
  const { action } = await request.json().catch(() => ({}));
  if (action === "lock") {
    const r = await emergencyLock();
    await tgNotify(`🚨 Đã KHOÁ KHẨN ${r.nights} đêm trống (${r.created} khoảng) trên mọi phòng, 12 tháng tới. Các kênh nhập lịch PMS sẽ đóng theo ở lần đồng bộ tới.`).catch(() => {});
    return NextResponse.json({ ok: true, ...r });
  }
  if (action === "unlock") {
    const r = await emergencyUnlock();
    await tgNotify(`✅ Đã MỞ khoá khẩn (${r.removed} khoảng). Lịch mở lại ở lần đồng bộ tới của các kênh.`).catch(() => {});
    return NextResponse.json({ ok: true, ...r });
  }
  return NextResponse.json({ error: "action phải là lock hoặc unlock" }, { status: 400 });
}
