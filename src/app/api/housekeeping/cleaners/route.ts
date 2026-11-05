import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const cleaners = await prisma.cleaner.findMany({ orderBy: [{ active: "desc" }, { createdAt: "asc" }] });
  return NextResponse.json(cleaners);
}

// POST { name, phone?, type?: "INTERNAL" | "APP" }
export async function POST(request: Request) {
  const { name, phone, type } = (await request.json()) as { name?: string; phone?: string; type?: string };
  if (!name?.trim()) return NextResponse.json({ error: "Cần nhập tên" }, { status: 400 });
  const cleaner = await prisma.cleaner.create({
    data: { name: name.trim(), phone: phone?.trim() || null, type: type === "APP" ? "APP" : "INTERNAL" },
  });
  return NextResponse.json(cleaner, { status: 201 });
}

// PATCH { id, name?, phone?, type?, active? }
export async function PATCH(request: Request) {
  const { id, name, phone, type, active } = (await request.json()) as {
    id?: string; name?: string; phone?: string; type?: string; active?: boolean;
  };
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const cleaner = await prisma.cleaner.update({
    where: { id },
    data: {
      ...(name?.trim() && { name: name.trim() }),
      ...(phone !== undefined && { phone: phone.trim() || null }),
      ...(type && { type: type === "APP" ? "APP" : "INTERNAL" }),
      ...(active !== undefined && { active }),
    },
  });
  return NextResponse.json(cleaner);
}
