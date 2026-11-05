import { NextResponse } from "next/server";
import { blobReady, putPrivate } from "@/lib/blob";
import { prisma } from "@/lib/prisma";
import { DEMO_TOKEN, demoView, findByToken, guestView, idPhotosOf, stayLine } from "@/lib/stay";
import { tgNotify } from "@/lib/telegram";
import { publicBaseUrl } from "@/lib/housekeeping";

// POST multipart file=<ảnh hộ chiếu/CCCD>  |  POST JSON { action: "submit" } chốt gửi
type Params = { params: Promise<{ token: string }> };
const MAX_BYTES = 4 * 1024 * 1024;

/** Ảnh giấy tờ lưu ở kho riêng tư — chỉ xem được qua PMS (sau đăng nhập) */
const storeId = (path: string, file: File) => putPrivate(path, file, file.type);

export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  if (token === DEMO_TOKEN) return NextResponse.json({ ...demoView("chieu-ngay-den"), idSubmitted: true, idCount: 1 });
  const b = await findByToken(token);
  if (!b) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  const p = b.portal!;

  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const { action } = (await request.json().catch(() => ({}))) as { action?: string };
    if (action !== "submit") return NextResponse.json({ error: "action không hợp lệ" }, { status: 400 });
    if (idPhotosOf(p).length === 0) return NextResponse.json({ error: "Please add at least one photo / Thêm ít nhất 1 ảnh" }, { status: 400 });
    const first = !p.idSubmittedAt;
    await prisma.stayPortal.update({ where: { id: p.id }, data: { idSubmittedAt: new Date() } });
    if (first) {
      await tgNotify(`🪪 Khách đã gửi giấy tờ (${idPhotosOf(p).length} ảnh)\n${stayLine(b)}\n→ Khai báo lưu trú rồi tích "Đã khai báo": ${publicBaseUrl()}/luu-tru`);
    }
    return NextResponse.json(guestView((await findByToken(token))!));
  }

  if (!blobReady()) {
    return NextResponse.json({ error: "Upload is not available right now — please send your passport photo via chat" }, { status: 503 });
  }
  if (idPhotosOf(p).length >= 8) return NextResponse.json({ error: "Max 8 photos" }, { status: 400 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.type.startsWith("image/")) return NextResponse.json({ error: "Image only" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Image too large" }, { status: 413 });

  const url = await storeId(`guest-id/${b.id}/id.jpg`, file);
  await prisma.stayPortal.update({ where: { id: p.id }, data: { idPhotos: [...idPhotosOf(p), url] } });
  return NextResponse.json(guestView((await findByToken(token))!));
}
