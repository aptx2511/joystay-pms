import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appsScript, inboxToken, rematchEmails } from "@/lib/inbox";

export const dynamic = "force-dynamic";

// GET — (đã đăng nhập) danh sách email gần đây + đoạn Apps Script có sẵn mã bí mật để chủ dán vào Gmail
export async function GET(request: Request) {
  const base = new URL(request.url).origin;
  const list = await prisma.inboundEmail.findMany({ orderBy: { receivedAt: "desc" }, take: 60, select: { id: true, channel: true, kind: true, subject: true, receivedAt: true, status: true, bookingId: true, parsed: true } });
  const counts = await prisma.inboundEmail.groupBy({ by: ["status"], _count: true });
  return NextResponse.json({ script: appsScript(await inboxToken(), base), list, counts });
}

// POST — thử khớp lại email chưa khớp
export async function POST() {
  return NextResponse.json({ matched: await rematchEmails() });
}
