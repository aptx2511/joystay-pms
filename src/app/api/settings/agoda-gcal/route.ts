import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Cầu lịch PMS → Google Calendar → Agoda (Apps Script "Joystay – Lịch PMS cho Agoda").
 * - AppSetting "agoda_gcal:<roomId>" = link .ics công khai của Google Calendar mà Agoda đang nhập.
 * - AppSetting "gcal_bridge_seen"    = lần cuối Apps Script đọc lịch PMS (ghi trong /api/ical/export).
 * GET  → { links: { roomId: url }, seenAt, stale }
 * PUT  { links: { roomId: url } } → lưu link
 */
const PREFIX = "agoda_gcal:";
const SEEN_KEY = "gcal_bridge_seen";
const STALE_MS = 3 * 60 * 60_000; // Apps Script chạy mỗi giờ

export async function GET() {
  const rows = await prisma.appSetting.findMany({
    where: { OR: [{ key: { startsWith: PREFIX } }, { key: SEEN_KEY }] },
  });
  const links: Record<string, string> = {};
  let seenAt: string | null = null;
  for (const r of rows) {
    if (r.key === SEEN_KEY) seenAt = r.value;
    else links[r.key.slice(PREFIX.length)] = r.value;
  }
  const stale = !seenAt || Date.now() - new Date(seenAt).getTime() > STALE_MS;
  return NextResponse.json({ links, seenAt, stale });
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { links?: Record<string, string> };
  const links = body.links ?? {};
  for (const [roomId, url] of Object.entries(links)) {
    const key = PREFIX + roomId;
    if (!url) await prisma.appSetting.deleteMany({ where: { key } });
    else await prisma.appSetting.upsert({ where: { key }, create: { key, value: url }, update: { value: url } });
  }
  return NextResponse.json({ ok: true, count: Object.keys(links).length });
}
