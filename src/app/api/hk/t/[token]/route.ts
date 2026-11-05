import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { notifyOwnerTaskDone, readChecklist, roomLabel, TYPE_LABEL } from "@/lib/housekeeping";
import { blobReady } from "@/lib/blob";

// API công khai cho trang việc dọn của lao công — chỉ ai có link (token bí mật) mới gọi được.
type Params = { params: Promise<{ token: string }> };

export const dynamic = "force-dynamic";

const photosRequired = () => blobReady();

async function find(token: string) {
  if (!token || token.length < 16) return null;
  return prisma.cleaningTask.findUnique({ where: { token }, include: { room: true, cleaner: true } });
}

function view(t: NonNullable<Awaited<ReturnType<typeof find>>>) {
  return {
    room: roomLabel(t.room),
    date: t.date.toISOString().slice(0, 10),
    type: TYPE_LABEL[t.type] ?? t.type,
    window: `${t.windowStart}–${t.windowEnd}`,
    urgent: t.priority === "URGENT",
    status: t.status,
    cleaner: t.cleaner?.name ?? null,
    note: t.note,
    rejectReason: t.status === "REJECTED" ? t.rejectReason : null,
    checklist: readChecklist(t),
    issueNote: t.issueNote ?? "",
    issuePhotos: Array.isArray(t.issuePhotos) ? (t.issuePhotos as string[]) : [],
    photosRequired: photosRequired(),
    locked: ["APPROVED", "SKIPPED"].includes(t.status),
  };
}

export async function GET(_req: Request, { params }: Params) {
  const { token } = await params;
  const t = await find(token);
  if (!t) return NextResponse.json({ error: "Link không đúng hoặc đã hết hạn" }, { status: 404 });
  return NextResponse.json(view(t));
}

/**
 * POST { action: "start" }
 *      { action: "check", key, done }
 *      { action: "issue", note }
 *      { action: "submit" }
 */
export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  const t = await find(token);
  if (!t) return NextResponse.json({ error: "Link không đúng hoặc đã hết hạn" }, { status: 404 });
  if (["APPROVED", "SKIPPED"].includes(t.status)) {
    return NextResponse.json({ error: "Việc này đã khoá" }, { status: 409 });
  }

  const body = (await request.json()) as { action?: string; key?: string; done?: boolean; note?: string };
  const list = readChecklist(t);

  if (body.action === "start") {
    const u = await prisma.cleaningTask.update({
      where: { id: t.id },
      data: { status: "IN_PROGRESS", startedAt: t.startedAt ?? new Date() },
      include: { room: true, cleaner: true },
    });
    return NextResponse.json(view(u));
  }

  if (body.action === "check") {
    const item = list.find((i) => i.key === body.key);
    if (!item) return NextResponse.json({ error: "Không có mục này" }, { status: 400 });
    if (body.done && photosRequired() && item.photos.length === 0) {
      return NextResponse.json({ error: `Chụp ít nhất 1 ảnh cho mục "${item.label}" trước khi đánh dấu xong` }, { status: 400 });
    }
    item.done = Boolean(body.done);
    const u = await prisma.cleaningTask.update({
      where: { id: t.id },
      data: {
        checklist: list as unknown as object,
        ...(t.status === "TODO" || t.status === "ASSIGNED" || t.status === "REJECTED"
          ? { status: "IN_PROGRESS", startedAt: t.startedAt ?? new Date() } : {}),
      },
      include: { room: true, cleaner: true },
    });
    return NextResponse.json(view(u));
  }

  if (body.action === "issue") {
    const note = (body.note ?? "").trim().slice(0, 1000);
    const photos = Array.isArray(t.issuePhotos) ? (t.issuePhotos as string[]) : [];
    const u = await prisma.cleaningTask.update({
      where: { id: t.id },
      data: { issueNote: note || null, hasIssue: Boolean(note) || photos.length > 0 },
      include: { room: true, cleaner: true },
    });
    return NextResponse.json(view(u));
  }

  if (body.action === "submit") {
    const missing = list.filter((i) => !i.done || (photosRequired() && i.photos.length === 0));
    if (missing.length) {
      return NextResponse.json(
        { error: `Còn ${missing.length} mục chưa xong/chưa có ảnh: ${missing.map((i) => i.label).join(", ")}` },
        { status: 400 }
      );
    }
    const u = await prisma.cleaningTask.update({
      where: { id: t.id },
      data: { status: "DONE", doneAt: new Date(), rejectReason: null },
      include: { room: true, cleaner: true },
    });
    await notifyOwnerTaskDone(u);
    return NextResponse.json(view(u));
  }

  return NextResponse.json({ error: "action không hợp lệ" }, { status: 400 });
}
