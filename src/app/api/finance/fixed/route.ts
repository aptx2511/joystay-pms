import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseAmount } from "@/lib/finance";

export const dynamic = "force-dynamic";

// POST { name, amount, category, roomId?, startMonth: YYYY-MM }
export async function POST(request: Request) {
  const b = await request.json().catch(() => ({}));
  const amount = parseAmount(b.amount ?? "");
  if (!b.name || !Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}$/.test(b.startMonth ?? ""))
    return NextResponse.json({ error: "Cần tên, số tiền và tháng bắt đầu" }, { status: 400 });
  const f = await prisma.fixedCost.create({ data: { name: String(b.name).slice(0, 60), amount, category: b.category || "Khác", roomId: b.roomId || null, startMonth: b.startMonth } });
  return NextResponse.json({ ok: true, id: f.id });
}

// PATCH { id, endMonth: YYYY-MM | null } → dừng / áp dụng lại
export async function PATCH(request: Request) {
  const b = await request.json().catch(() => ({}));
  if (!b.id) return NextResponse.json({ error: "id" }, { status: 400 });
  await prisma.fixedCost.update({ where: { id: b.id }, data: { endMonth: b.endMonth ?? null } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id" }, { status: 400 });
  await prisma.fixedCost.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
