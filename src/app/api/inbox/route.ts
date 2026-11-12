import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appsScript, inboxToken, rematchEmails, reparseEmails } from "@/lib/inbox";

export const dynamic = "force-dynamic";

// GET — (đã đăng nhập) danh sách email gần đây + đoạn Apps Script có sẵn mã bí mật để chủ dán vào Gmail
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base = url.origin;
  const one = url.searchParams.get("id");
  if (one) return NextResponse.json(await prisma.inboundEmail.findUnique({ where: { id: one } })); // xem nguyên văn để chỉnh bộ đọc
  const list = await prisma.inboundEmail.findMany({ orderBy: { receivedAt: "desc" }, take: 60, select: { id: true, channel: true, kind: true, subject: true, receivedAt: true, status: true, bookingId: true, parsed: true } });
  const counts = await prisma.inboundEmail.groupBy({ by: ["status"], _count: true });
  return NextResponse.json({ script: appsScript(await inboxToken(), base), list, counts });
}

// POST — đọc lại email chưa khớp bằng bộ đọc mới + thử khớp lại
export async function POST() {
  const r = await reparseEmails();
  return NextResponse.json({ ...r, rematched: await rematchEmails() });
}
