/**
 * Đơn chuyển phòng (11/2026): cùng một mã đặt (externalId) bị kênh gỡ khỏi phòng cũ và hiện ở phòng mới
 * → PMS tạo bản ghi mới. Hàm này chuyển MỌI THỨ gắn với bản ghi cũ sang bản ghi mới để nội bộ PMS luôn liền mạch:
 *   tiền đã thu (Txn), mã đặt, tên khách thật, khách hàng, CCCD, ghi chú, giá chủ đã sửa/đối soát,
 *   cổng khách (giữ nguyên link cho khách; xoá mã cửa cũ để JoyBot cấp mã cho khoá phòng mới).
 * Lịch dọn tự sinh lại theo booking đang hiệu lực. Mỗi lần chuyển chỉ chạy 1 lần (khoá SyncAlert).
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tgNotify } from "@/lib/telegram";
import { vnToday } from "@/lib/housekeeping";

const DEFAULT_NAMES = ["Airbnb Guest", "Booking.com Guest", "Agoda Guest", "Traveloka Guest"];
const isDefaultName = (n?: string | null) => !n || DEFAULT_NAMES.some((d) => n.startsWith(d)) || n.startsWith("(trùng)");
const fmt = (d: Date) => { const s = d.toISOString().slice(0, 10); return `${s.slice(8, 10)}/${s.slice(5, 7)}`; };
const label = (r: { roomNumber: string | null; name: string }) => `${r.roomNumber ?? ""} ${r.name}`.trim();

export async function migrateMovedBookings(): Promise<string[]> {
  const since = new Date(vnToday().getTime() - 2 * 86_400_000);
  const live = await prisma.booking.findMany({
    where: { status: { in: ["CONFIRMED", "PENDING"] }, externalId: { not: null }, checkOut: { gte: since } },
    include: { room: { select: { name: true, roomNumber: true } }, portal: true },
  });
  const done: string[] = [];

  for (const nb of live) {
    if (!nb.externalId || nb.externalId.includes("@joystay")) continue;
    const olds = await prisma.booking.findMany({
      where: { externalId: nb.externalId, roomId: { not: nb.roomId }, status: "CANCELLED" },
      include: { room: { select: { name: true, roomNumber: true } }, portal: true },
      orderBy: { updatedAt: "desc" },
    });
    for (const ob of olds) {
      const key = `move:${ob.id}->${nb.id}`;
      if (await prisma.syncAlert.findUnique({ where: { key } })) continue;

      const moved: string[] = [];
      // 1) Thông tin đơn
      const patch: Record<string, unknown> = {};
      if (isDefaultName(nb.guestName) && !isDefaultName(ob.guestName)) { patch.guestName = ob.guestName; moved.push("tên khách"); }
      if (!nb.confirmationCode && ob.confirmationCode) { patch.confirmationCode = ob.confirmationCode; moved.push("mã đặt"); }
      if (!nb.guestId && ob.guestId) { patch.guestId = ob.guestId; moved.push("hồ sơ khách"); }
      if (!nb.cccdFrontUrl && ob.cccdFrontUrl) { patch.cccdFrontUrl = ob.cccdFrontUrl; patch.cccdBackUrl = ob.cccdBackUrl; moved.push("CCCD"); }
      if (ob.notes && !(nb.notes ?? "").includes(ob.notes)) { patch.notes = [nb.notes, ob.notes].filter(Boolean).join(" · "); moved.push("ghi chú"); }
      if ((ob.priceSource === "MANUAL" || ob.priceSource === "IMPORT") && nb.priceSource === "AUTO") {
        patch.totalPrice = ob.totalPrice; patch.priceSource = ob.priceSource; moved.push("giá đã chỉnh");
      }
      if (Object.keys(patch).length) await prisma.booking.update({ where: { id: nb.id }, data: patch });

      // 2) Tiền đã thu / chi gắn với đơn
      const tx = await prisma.txn.updateMany({ where: { bookingId: ob.id }, data: { bookingId: nb.id, roomId: nb.roomId } });
      if (tx.count) moved.push(`${tx.count} khoản thu/chi`);

      // 3) Cổng khách: giữ nguyên link /s/<token> của khách, cấp lại mã cửa cho khoá phòng mới
      if (ob.portal) {
        const np = nb.portal;
        const npHasData = !!np && (np.doorCodes != null || np.idPhotos != null || np.firstViewAt != null);
        if (!npHasData) {
          if (np) await prisma.stayPortal.delete({ where: { id: np.id } });
          await prisma.stayPortal.update({
            where: { id: ob.portal.id },
            data: { bookingId: nb.id, doorCodes: Prisma.DbNull, codesSource: null, codesIssuedAt: null },
          });
          moved.push("cổng khách (mã cửa sẽ cấp lại cho phòng mới)");
        }
      }

      await prisma.syncAlert.create({ data: { key } });
      // chặn cảnh báo "nhảy phòng" trùng nội dung
      const jumpKey = `jump:${nb.externalId}:${[ob.roomId, nb.roomId].sort().join(",")}`;
      await prisma.syncAlert.upsert({ where: { key: jumpKey }, update: {}, create: { key: jumpKey } });

      const text =
        `🔀 ĐƠN CHUYỂN PHÒNG — ${nb.guestName}${nb.confirmationCode ? ` · mã ${nb.confirmationCode}` : ""} · ${fmt(nb.checkIn)}→${fmt(nb.checkOut)}\n` +
        `${label(ob.room)} → ${label(nb.room)}\n` +
        `Đã chuyển theo: ${moved.length ? moved.join(", ") : "không có dữ liệu cần chuyển"}.\n` +
        `⚠️ Nếu anh KHÔNG chủ động đổi phòng: link iCal của kênh có thể đang nối chéo — kiểm tra mục Đồng bộ lịch.`;
      await tgNotify(text);
      done.push(text);
    }
  }
  return done;
}
