import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const toDate = (s: string) => new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
const CH = ["AIRBNB", "AIRBNB2", "BOOKING", "AGODA"];

// POST { items: [{ roomNo, channel, date: YYYY-MM-DD, price, listPrice?, available? }] } — tác vụ quét giá hằng ngày gửi về
export async function POST(request: Request) {
  const { items } = (await request.json().catch(() => ({}))) as { items?: { roomNo: string; channel: string; date: string; price: number; listPrice?: number | null; available?: boolean | null }[] };
  if (!Array.isArray(items) || !items.length || items.length > 2000) return NextResponse.json({ error: "items 1–2000" }, { status: 400 });
  const rooms = await prisma.room.findMany({ select: { id: true, roomNumber: true } });
  const byNo = new Map(rooms.map((r) => [String(r.roomNumber), r.id]));
  const now = new Date();
  let n = 0, skipped = 0;
  const valid = items.filter((it) => byNo.has(String(it.roomNo)) && CH.includes(it.channel) && /^\d{4}-\d{2}-\d{2}$/.test(it.date) && it.price > 0);
  skipped = items.length - valid.length;
  for (let i = 0; i < valid.length; i += 20) {
    await Promise.all(valid.slice(i, i + 20).map((it) => {
      const roomId = byNo.get(String(it.roomNo))!; const date = toDate(it.date);
      const data = { price: Math.round(it.price), listPrice: it.listPrice ? Math.round(it.listPrice) : null, available: it.available ?? null, scrapedAt: now };
      return prisma.channelPrice.upsert({ where: { roomId_date_channel: { roomId, date, channel: it.channel } }, create: { roomId, date, channel: it.channel, ...data }, update: data }).then(() => n++);
    }));
  }
  return NextResponse.json({ ok: true, saved: n, skipped });
}

// GET ?days=14 → bảng giá theo phòng × ngày × kênh (+ giá gốc PMS, giá trực tiếp đã áp dụng)
export async function GET(request: Request) {
  const days = Math.min(Number(new URL(request.url).searchParams.get("days")) || 14, 60);
  const today = toDate(new Date(Date.now() + 7 * 3_600_000).toISOString());
  const end = new Date(today.getTime() + days * 86_400_000);
  const [rooms, prices, rates, bookings] = await Promise.all([
    prisma.room.findMany({ orderBy: { roomNumber: "asc" } }),
    prisma.channelPrice.findMany({ where: { date: { gte: today, lt: end } } }),
    prisma.roomRate.findMany({ where: { date: { gte: today, lt: end }, price: { not: null } } }),
    prisma.booking.findMany({ where: { status: { in: ["CONFIRMED", "PENDING", "BLOCKED"] }, checkIn: { lt: end }, checkOut: { gt: today } }, select: { roomId: true, checkIn: true, checkOut: true, status: true, source: true } }),
  ]);
  const dates = Array.from({ length: days }, (_, i) => new Date(today.getTime() + i * 86_400_000).toISOString().slice(0, 10));
  const lastScan = prices.reduce<Date | null>((a, p) => (!a || p.scrapedAt > a ? p.scrapedAt : a), null);
  return NextResponse.json({
    dates, lastScan,
    rooms: rooms.filter((r) => r.roomNumber).map((r) => {
      const weekend = (d: string) => [5, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());
      return {
        roomId: r.id, roomNo: r.roomNumber, name: r.name, hasAirbnb2: Boolean(r.airbnbIcalUrl2),
        cells: dates.map((d) => {
          const t = toDate(d).getTime();
          const occ = bookings.find((b) => b.roomId === r.id && b.checkIn.getTime() <= t && b.checkOut.getTime() > t);
          const ch = Object.fromEntries(CH.map((c) => {
            const p = prices.find((x) => x.roomId === r.id && x.channel === c && x.date.getTime() === t);
            return [c, p ? { price: p.price, listPrice: p.listPrice, available: p.available } : null];
          }));
          const direct = rates.find((x) => x.roomId === r.id && x.date.getTime() === t)?.price ?? null;
          return { date: d, base: (weekend(d) ? r.weekendPricePerNight ?? r.pricePerNight : r.pricePerNight) ?? null, direct, booked: occ ? (occ.status === "BLOCKED" ? "BLOCKED" : occ.source) : null, ...ch };
        }),
      };
    }),
  });
}
