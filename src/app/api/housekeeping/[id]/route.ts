import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cleanerMessage, taskLink } from "@/lib/housekeeping";

type Params = { params: Promise<{ id: string }> };

// GET /api/housekeeping/:id → chi tiết + tin nhắn soạn sẵn cho lao công
export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const task = await prisma.cleaningTask.findUnique({ where: { id }, include: { room: true, cleaner: true } });
  if (!task) return NextResponse.json({ error: "Không thấy việc" }, { status: 404 });
  return NextResponse.json({ ...task, link: taskLink(task), message: cleanerMessage(task) });
}

/**
 * PATCH /api/housekeeping/:id
 *  { cleanerId }                 → giao việc (null = bỏ giao)
 *  { action: "approve" }         → duyệt: phòng sẵn sàng
 *  { action: "reject", reason }  → yêu cầu làm lại
 *  { action: "skip" | "reopen" } → bỏ qua / mở lại
 *  { note, windowStart, windowEnd }
 */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  try {
    const body = (await request.json()) as {
      cleanerId?: string | null; action?: string; reason?: string;
      note?: string; windowStart?: string; windowEnd?: string;
    };
    const task = await prisma.cleaningTask.findUnique({ where: { id } });
    if (!task) return NextResponse.json({ error: "Không thấy việc" }, { status: 404 });

    const data: Record<string, unknown> = {};

    if (body.cleanerId !== undefined) {
      data.cleanerId = body.cleanerId || null;
      if (["TODO", "ASSIGNED"].includes(task.status)) data.status = body.cleanerId ? "ASSIGNED" : "TODO";
    }
    if (body.note !== undefined) data.note = body.note || null;
    if (body.windowStart && /^\d{2}:\d{2}$/.test(body.windowStart)) data.windowStart = body.windowStart;
    if (body.windowEnd && /^\d{2}:\d{2}$/.test(body.windowEnd)) data.windowEnd = body.windowEnd;

    switch (body.action) {
      case "approve":
        data.status = "APPROVED";
        data.approvedAt = new Date();
        data.rejectReason = null;
        break;
      case "reject":
        data.status = "REJECTED";
        data.rejectReason = body.reason?.trim() || "Chủ nhà yêu cầu làm lại — xem lại các mục và chụp ảnh rõ hơn";
        break;
      case "skip":
        data.status = "SKIPPED";
        data.note = body.reason?.trim() || task.note || "Chủ nhà bỏ qua";
        break;
      case "reopen":
        data.status = task.cleanerId ? "ASSIGNED" : "TODO";
        break;
      case undefined:
        break;
      default:
        return NextResponse.json({ error: "action không hợp lệ" }, { status: 400 });
    }

    const updated = await prisma.cleaningTask.update({ where: { id }, data, include: { room: true, cleaner: true } });
    return NextResponse.json({ ...updated, link: taskLink(updated), message: cleanerMessage(updated) });
  } catch (error) {
    console.error("[PATCH /api/housekeeping/:id]", error);
    return NextResponse.json({ error: "Không cập nhật được" }, { status: 500 });
  }
}
