import { NextResponse } from "next/server";
import { blobReady, putPrivate, streamBlob } from "@/lib/blob";
import { prisma } from "@/lib/prisma";
import { readChecklist } from "@/lib/housekeeping";

// POST multipart: key = mã mục checklist hoặc "issue", file = ảnh (đã nén ở trình duyệt)
type Params = { params: Promise<{ token: string }> };

const MAX_BYTES = 4 * 1024 * 1024; // giới hạn body của Vercel ~4.5MB — trang đã nén ảnh ~1600px

export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  if (!blobReady()) {
    return NextResponse.json({ error: "Chưa kết nối kho ảnh (Vercel Blob) — báo chủ nhà" }, { status: 503 });
  }
  const t = token && token.length >= 16 ? await prisma.cleaningTask.findUnique({ where: { token } }) : null;
  if (!t) return NextResponse.json({ error: "Link không đúng" }, { status: 404 });
  if (["APPROVED", "SKIPPED"].includes(t.status)) return NextResponse.json({ error: "Việc này đã khoá" }, { status: 409 });

  const form = await request.formData();
  const key = String(form.get("key") ?? "");
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Thiếu ảnh" }, { status: 400 });
  if (!file.type.startsWith("image/")) return NextResponse.json({ error: "Chỉ nhận ảnh" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Ảnh quá lớn" }, { status: 413 });

  const list = readChecklist(t);
  const item = key === "issue" ? null : list.find((i) => i.key === key);
  if (key !== "issue" && !item) return NextResponse.json({ error: "Không có mục này" }, { status: 400 });

  const blob = { url: await putPrivate(`housekeeping/${t.date.toISOString().slice(0, 10)}/${t.id}/${key}.jpg`, file, file.type) };

  if (item) {
    item.photos = [...item.photos, blob.url].slice(-6);
    await prisma.cleaningTask.update({
      where: { id: t.id },
      data: {
        checklist: list as unknown as object,
        ...(["TODO", "ASSIGNED", "REJECTED"].includes(t.status) ? { status: "IN_PROGRESS", startedAt: t.startedAt ?? new Date() } : {}),
      },
    });
  } else {
    const photos = [...(Array.isArray(t.issuePhotos) ? (t.issuePhotos as string[]) : []), blob.url].slice(-10);
    await prisma.cleaningTask.update({ where: { id: t.id }, data: { issuePhotos: photos, hasIssue: true } });
  }
  return NextResponse.json({ url: blob.url });
}

// GET ?u=<url ảnh> — lao công xem lại ảnh của CHÍNH việc này (kho ảnh riêng tư)
export async function GET(request: Request, { params }: Params) {
  const { token } = await params;
  const u = new URL(request.url).searchParams.get("u") ?? "";
  const t = token && token.length >= 16 ? await prisma.cleaningTask.findUnique({ where: { token } }) : null;
  if (!t) return new Response("Not found", { status: 404 });
  const own = [...readChecklist(t).flatMap((i) => i.photos), ...(Array.isArray(t.issuePhotos) ? (t.issuePhotos as string[]) : [])];
  if (!own.includes(u)) return new Response("Forbidden", { status: 403 });
  return streamBlob(u);
}
