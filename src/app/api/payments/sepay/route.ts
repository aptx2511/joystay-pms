/**
 * Webhook SePay → PMS (11/2026): mỗi khoản TIỀN VÀO tài khoản nhận tiền khách được ghi vào Thu chi
 * và tự khớp với đơn → đơn chuyển "Đã thu", báo cáo dùng tiền thật thay số ước tính.
 * Cấu hình trên my.sepay.vn → Tích hợp Webhook: URL = https://joystay-pms.vercel.app/api/payments/sepay,
 * Kiểu chứng thực "API Key" = biến môi trường SEPAY_API_KEY (Vercel). (JoyBot có webhook riêng để chốt cọc.)
 * Thứ tự khớp: mã JoyBot (JOY1234) / mã OTA trong nội dung CK → số tiền khớp đúng 1 đơn chưa thu.
 * Tiền Airbnb trả về: KHÔNG ghi (đã có nhập CSV Airbnb, tránh cộng 2 lần) — chỉ báo Telegram.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { tgNotify } from "@/lib/telegram";
import { vnToday } from "@/lib/housekeeping";
import { CONFIRM_RATIO, paidOf, payTarget } from "@/lib/payment";

export const dynamic = "force-dynamic";

type SePayTxn = {
  id?: number | string; gateway?: string; transactionDate?: string; accountNumber?: string;
  code?: string | null; content?: string; transferType?: "in" | "out"; transferAmount?: number;
  referenceCode?: string; description?: string;
};

const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`;
const DAY = 86_400_000;

export async function POST(request: Request) {
  const key = process.env.SEPAY_API_KEY;
  if (!key || request.headers.get("authorization") !== `Apikey ${key}`) {
    return NextResponse.json({ success: false }, { status: 401 });
  }
  const t = (await request.json().catch(() => ({}))) as SePayTxn;
  if (t.transferType !== "in") return NextResponse.json({ success: true, skipped: "out" });

  const amount = Number(t.transferAmount ?? 0);
  const ref = String(t.id ?? t.referenceCode ?? "");
  if (!amount || !ref) return NextResponse.json({ success: true, skipped: "empty" });
  if (await prisma.txn.findUnique({ where: { source_ref: { source: "SEPAY", ref } } }))
    return NextResponse.json({ success: true, skipped: "duplicate" });

  const text = `${t.code ?? ""} ${t.content ?? ""} ${t.description ?? ""}`.toUpperCase().replace(/\s+/g, " ");
  const date = t.transactionDate ? new Date(`${t.transactionDate.slice(0, 10)}T00:00:00.000Z`) : vnToday();

  // Tiền Airbnb chuyển về: đã có luồng CSV Airbnb → chỉ báo
  if (/AIRBNB/.test(text)) {
    await tgNotify(`🏦 Airbnb vừa chuyển ${vnd(amount)} về tài khoản. Nhớ tải CSV "Lịch sử giao dịch" Airbnb lên mục Thu chi để đối soát theo từng đơn.`);
    return NextResponse.json({ success: true, skipped: "airbnb" });
  }

  // 1) Khớp theo mã trong nội dung chuyển khoản
  const prefix = (process.env.BOOKING_CODE_PREFIX || "JOY").toUpperCase();
  const joy = text.match(new RegExp(`${prefix}\\s?(\\d{4,6})`));
  const today = vnToday();
  const window = { checkOut: { gte: new Date(today.getTime() - 7 * DAY) }, checkIn: { lte: new Date(today.getTime() + 120 * DAY) } };
  const candidates = await prisma.booking.findMany({
    where: { status: { in: ["CONFIRMED", "PENDING"] }, ...window },
    include: { room: { select: { roomNumber: true, name: true } } },
  });
  // ranh giới số: JOY1234 (JoyBot) không được khớp nhầm JOY123456 (mã thanh toán web/cổng khách)
  const codeRe = joy ? new RegExp(`${prefix}${joy[1]}(?!\\d)`) : null;
  let match = codeRe ? candidates.find((b) => codeRe.test((b.notes ?? "").toUpperCase())) : undefined;
  let how = joy ? `mã ${prefix}${joy[1]}` : "";
  if (!match) {
    match = candidates.find((b) => b.confirmationCode && b.confirmationCode.length >= 6 && text.includes(b.confirmationCode.toUpperCase()));
    if (match) how = `mã đặt ${match.confirmationCode}`;
  }

  // 2) Khớp theo số tiền: đúng 1 đơn chưa thu (không phải Airbnb) có tổng tiền hoặc cọc 50% bằng số tiền về
  if (!match) {
    const paid = await prisma.txn.groupBy({ by: ["bookingId"], where: { kind: "IN", bookingId: { in: candidates.map((b) => b.id) } }, _sum: { amount: true } });
    const paidMap = new Map<string, number>(paid.map((p: { bookingId: string | null; _sum: { amount: number | null } }) => [p.bookingId!, p._sum.amount ?? 0]));
    const near = (x: number) => Math.abs(x - amount) <= 1000;
    const hits = candidates.filter((b) => {
      if (b.source === "AIRBNB" || !b.totalPrice) return false;
      const remaining = b.totalPrice - (paidMap.get(b.id) ?? 0);
      return remaining > 0 && (near(b.totalPrice) || near(remaining) || near(Math.round(b.totalPrice / 2)));
    });
    if (hits.length === 1) { match = hits[0]; how = "khớp số tiền"; }
  }

  const note = `SePay ${t.gateway ?? ""} · ${(t.content ?? "").slice(0, 160)}`.trim();
  await prisma.txn.create({
    data: {
      kind: "IN", date, amount, source: "SEPAY", ref,
      category: match ? "Tiền phòng" : "Chưa khớp đơn",
      channel: "TRANSFER", bookingId: match?.id ?? null, roomId: match?.roomId ?? null, note,
    },
  });

  if (match) {
    // Đơn chờ (website / cổng khách) đã trả ≥ CONFIRM_RATIO tổng → tự xác nhận
    let confirmed = "";
    if (match.status === "PENDING" && match.source === "DIRECT" && process.env.AUTO_CONFIRM_ON_PAYMENT !== "false") {
      const paid = await paidOf(match.id);
      if (!match.totalPrice || paid >= match.totalPrice * CONFIRM_RATIO - 1000) {
        await prisma.booking.update({ where: { id: match.id }, data: { status: "CONFIRMED" } });
        confirmed = " ✅ Đơn đã tự chuyển sang XÁC NHẬN.";
      }
    }
    const target = payTarget(match);
    const left = target ? Math.max(0, target - (await paidOf(match.id))) : 0;
    await tgNotify(
      `💰 Đã thu ${vnd(amount)} — ${match.guestName}, phòng ${match.room.roomNumber ?? match.room.name}, ` +
      `${match.checkIn.toISOString().slice(5, 10)}→${match.checkOut.toISOString().slice(5, 10)} (${how}). ` +
      (target ? `Cần thu ${vnd(target)}${left > 1000 ? `, còn ${vnd(left)}` : ", đã đủ"}.` : `Tổng đơn ${vnd(match.totalPrice ?? 0)}.`) + confirmed,
    );
  } else {
    await tgNotify(
      `💰 Tiền về ${vnd(amount)} nhưng CHƯA KHỚP được đơn nào.\nNội dung: "${(t.content ?? "").slice(0, 160)}"\n` +
      `→ Vào Thu chi để gán khoản này cho đúng đơn.`,
    );
  }
  return NextResponse.json({ success: true, matched: !!match });
}
