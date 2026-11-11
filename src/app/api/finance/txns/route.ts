import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseAmount } from "@/lib/finance";

export const dynamic = "force-dynamic";

// POST { kind: IN|OUT, amount: "350k"|number, category, roomId?, bookingId?, channel?, date?: YYYY-MM-DD, note? }
export async function POST(request: Request) {
  const b = await request.json().catch(() => ({}));
  const amount = parseAmount(b.amount ?? "");
  if (!["IN", "OUT"].includes(b.kind) || !Number.isFinite(amount) || amount <= 0 || !b.category)
    return NextResponse.json({ error: "Cần loại (thu/chi), số tiền > 0 và hạng mục" }, { status: 400 });
  const d = b.date ? new Date(`${String(b.date).slice(0, 10)}T00:00:00.000Z`) : new Date(new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10) + "T00:00:00.000Z");
  let roomId: string | null = b.roomId || null;
  if (b.bookingId && !roomId) roomId = (await prisma.booking.findUnique({ where: { id: b.bookingId }, select: { roomId: true } }))?.roomId ?? null;
  const t = await prisma.txn.create({
    data: { kind: b.kind, amount, category: String(b.category).slice(0, 60), roomId, bookingId: b.bookingId || null, channel: b.channel || null, date: d, note: b.note ? String(b.note).slice(0, 300) : null },
  });
  return NextResponse.json({ ok: true, id: t.id, amount });
}

// DELETE ?id=
export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id" }, { status: 400 });
  await prisma.txn.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
