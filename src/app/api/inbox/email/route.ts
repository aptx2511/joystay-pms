import { NextResponse, after } from "next/server";
import { timingSafeEqual } from "crypto";
import { ingestEmail, inboxToken } from "@/lib/inbox";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JOYBOT_URL = (process.env.JOYBOT_URL || "https://joybot-production-186f.up.railway.app").replace(/\/$/, "");
const DEBOUNCE_MS = 60_000;

/**
 * Email đặt / huỷ / đổi phòng vừa tới → đồng bộ iCal NGAY (không chờ lượt 10–15') rồi báo JoyBot cấp mã cửa.
 * Chống dồn: tối đa 1 lần / phút (Apps Script gửi nhiều email cùng lúc).
 */
async function syncNow(origin: string) {
  const key = "email_sync_at";
  const last = await prisma.appSetting.findUnique({ where: { key } });
  if (last && Date.now() - Date.parse(last.value) < DEBOUNCE_MS) return;
  await prisma.appSetting.upsert({ where: { key }, update: { value: new Date().toISOString() }, create: { key, value: new Date().toISOString() } });
  const auth = { Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` };
  try {
    await fetch(`${origin}/api/ical/sync`, { headers: auth, cache: "no-store", signal: AbortSignal.timeout(45_000) });
    await fetch(`${JOYBOT_URL}/hooks/pms-changed`, { method: "POST", headers: auth, signal: AbortSignal.timeout(8_000) });
  } catch (e) {
    console.warn("[inbox] đồng bộ ngay lỗi:", (e as Error).message);
  }
}

// POST — Apps Script trong Gmail gửi email đặt phòng sang (header x-inbox-token)
export async function POST(request: Request) {
  const got = Buffer.from(request.headers.get("x-inbox-token") ?? "");
  const want = Buffer.from(await inboxToken());
  if (got.length !== want.length || !timingSafeEqual(got, want)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json().catch(() => null);
  if (!b?.messageId || !b?.subject) return NextResponse.json({ error: "messageId, subject" }, { status: 400 });
  const r = await ingestEmail({ messageId: String(b.messageId), from: String(b.from ?? ""), replyTo: b.replyTo ? String(b.replyTo) : null, subject: String(b.subject), date: b.date, text: String(b.text ?? "") });
  const kind = (r as { parsed?: { kind?: string } }).parsed?.kind;
  if (!("duplicate" in r) && kind && ["NEW", "CANCEL", "CHANGE"].includes(kind) && process.env.CRON_SECRET) {
    const origin = new URL(request.url).origin;
    after(() => syncNow(origin));
  }
  return NextResponse.json(r);
}
