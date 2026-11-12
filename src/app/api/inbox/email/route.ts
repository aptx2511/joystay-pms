import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { ingestEmail, inboxToken } from "@/lib/inbox";

export const dynamic = "force-dynamic";

// POST — Apps Script trong Gmail gửi email đặt phòng sang (header x-inbox-token)
export async function POST(request: Request) {
  const got = Buffer.from(request.headers.get("x-inbox-token") ?? "");
  const want = Buffer.from(await inboxToken());
  if (got.length !== want.length || !timingSafeEqual(got, want)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json().catch(() => null);
  if (!b?.messageId || !b?.subject) return NextResponse.json({ error: "messageId, subject" }, { status: 400 });
  return NextResponse.json(await ingestEmail({ messageId: String(b.messageId), from: String(b.from ?? ""), replyTo: b.replyTo ? String(b.replyTo) : null, subject: String(b.subject), date: b.date, text: String(b.text ?? "") }));
}
