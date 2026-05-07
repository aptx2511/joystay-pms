import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// Parse "YYYY-MM-DD" → UTC midnight Date
function toUTCDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month"); // "YYYY-MM"

  let where = {};
  if (month) {
    const [y, m] = month.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end   = new Date(Date.UTC(y, m, 1)); // first of next month
    where = { workDate: { gte: start, lt: end } };
  }

  const shifts = await prisma.shift.findMany({
    where,
    orderBy: { workDate: "asc" },
  });

  return NextResponse.json(
    shifts.map((s) => ({
      id:       s.id,
      workDate: s.workDate.toISOString().split("T")[0], // "YYYY-MM-DD"
      hours:    s.hours,
      note:     s.note,
    }))
  );
}

export async function POST(request: Request) {
  const { workDate, hours, note } = await request.json() as {
    workDate: string;
    hours: number;
    note?: string;
  };

  const date = toUTCDate(workDate);
  const h    = Math.min(24, Math.max(1, Number(hours)));

  const shift = await prisma.shift.upsert({
    where:  { workDate: date },
    update: { hours: h, note: note ?? null },
    create: { workDate: date, hours: h, note: note ?? null },
  });

  return NextResponse.json({
    id:       shift.id,
    workDate: shift.workDate.toISOString().split("T")[0],
    hours:    shift.hours,
    note:     shift.note,
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date"); // "YYYY-MM-DD"

  if (!date) return NextResponse.json({ error: "date required" }, { status: 400 });

  await prisma.shift.deleteMany({ where: { workDate: toUTCDate(date) } });
  return NextResponse.json({ ok: true });
}
