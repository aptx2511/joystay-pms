/**
 * Thanh toán QR (11/2026): mỗi đơn chưa thu đủ (không phải Airbnb) có 1 mã thanh toán JOY + 6 số,
 * lưu trong ghi chú đơn dạng "[TT JOY123456]". QR VietQR có sẵn số tiền + nội dung = mã đó.
 * Khách chuyển → SePay gọi /api/payments/sepay → khớp mã → ghi Thu chi, đơn web PENDING → CONFIRMED.
 * Thông tin tài khoản nhận: biến môi trường Vercel BANK_ID (mã VietQR: VCB, TCB, MB, ICB…), BANK_ACCOUNT_NO, BANK_ACCOUNT_NAME
 * (giống JoyBot trên Railway). Thiếu → không hiện QR.
 */
import type { Booking } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { newToken } from "@/lib/housekeeping";
import { portalLink } from "@/lib/stay";

export const PAY_PREFIX = (process.env.BOOKING_CODE_PREFIX || "JOY").toUpperCase();
// "[TT JOY123456]" (đơn trực tiếp: số tiền = tổng đơn) hoặc "[TT JOY123456 =1250000]" (đơn OTA trả tại chỗ: số tiền chủ nhập)
const TAG_RE = new RegExp(`\\[TT (${PAY_PREFIX}\\d{6})(?: =(\\d+))?\\]`);
/** Kênh mà tổng đơn trong PMS KHÔNG phải số khách phải trả (đã trừ hoa hồng / có thể đã trả qua kênh) */
export const isOta = (source: string) => source !== "DIRECT" && source !== "OFFLINE";
export const WEB_TAG = "[WEB]";
export const WEB_HOLD_MINUTES = Number(process.env.WEB_HOLD_MINUTES || 60);
/** Đơn web: đã trả ≥ tỉ lệ này của tổng → tự xác nhận (thiếu → báo Telegram, không huỷ) */
export const CONFIRM_RATIO = Number(process.env.WEB_CONFIRM_RATIO || 1); // website thu trước 100% (13/11)

export function bank() {
  const bankId = (process.env.BANK_ID || "").trim();
  const accountNo = (process.env.BANK_ACCOUNT_NO || "").trim();
  if (!bankId || !accountNo) return null;
  return { bankId, accountNo, accountName: (process.env.BANK_ACCOUNT_NAME || "").trim() };
}

export const payCodeOf = (notes: string | null | undefined) => (notes ?? "").match(TAG_RE)?.[1] ?? null;
export const payAmountOf = (notes: string | null | undefined) => { const m = (notes ?? "").match(TAG_RE)?.[2]; return m ? Number(m) : null; };

/** Nội dung CK: VietinBank cần tiền tố SEVQR để SePay nhận */
export function transferNote(code: string) {
  const b = bank();
  return b && /^(ICB|VIETINBANK|CTG|970415)$/i.test(b.bankId) ? `SEVQR ${code}` : code;
}

export function qrUrl(amount: number, code: string) {
  const b = bank();
  if (!b) return null;
  const q = new URLSearchParams({ amount: String(Math.round(amount)), addInfo: transferNote(code), ...(b.accountName ? { accountName: b.accountName } : {}) });
  return `https://img.vietqr.io/image/${encodeURIComponent(b.bankId)}-${encodeURIComponent(b.accountNo)}-compact2.png?${q}`;
}

/** Mã chưa dùng: JOY + 6 số */
export async function newPayCode() {
  for (let i = 0; i < 20; i++) {
    const code = `${PAY_PREFIX}${Math.floor(100000 + Math.random() * 900000)}`;
    if (!(await prisma.booking.findFirst({ where: { notes: { contains: code } }, select: { id: true } }))) return code;
  }
  return `${PAY_PREFIX}${Date.now().toString().slice(-6)}`;
}

export const withPayTag = (notes: string | null | undefined, code: string, amount?: number | null) =>
  `${(notes ?? "").replace(TAG_RE, "").replace(/\s+/g, " ").trim()} [TT ${code}${amount ? ` =${Math.round(amount)}` : ""}]`.trim();

/** Gắn / cập nhật mã + số tiền cần thu (đơn OTA bắt buộc có số tiền) */
export async function setPayTag(b: Pick<Booking, "id" | "notes">, amount?: number | null) {
  const code = payCodeOf(b.notes) ?? (await newPayCode());
  const notes = withPayTag(b.notes, code, amount ?? payAmountOf(b.notes));
  await prisma.booking.update({ where: { id: b.id }, data: { notes } });
  return { code, notes };
}

export async function paidOf(bookingId: string) {
  const r = await prisma.txn.aggregate({ where: { kind: "IN", bookingId }, _sum: { amount: true } });
  return r._sum.amount ?? 0;
}

/**
 * Số tiền khách phải trả qua QR. CHỈ đơn đã có mã "[TT …]" (đơn website, hoặc chủ bấm "Tạo link thanh toán") —
 * đơn trực tiếp khác có thể đã trả tiền mặt nên không tự hiện QR.
 * Đơn trực tiếp = tổng đơn; đơn OTA = số chủ nhập khi tạo link.
 */
export function payTarget(b: Pick<Booking, "source" | "status" | "totalPrice" | "notes">) {
  if (b.source === "AIRBNB" || (b.status !== "CONFIRMED" && b.status !== "PENDING") || !payCodeOf(b.notes)) return 0;
  return Math.round(isOta(b.source) ? payAmountOf(b.notes) ?? 0 : b.totalPrice ?? 0);
}

export interface PaymentView {
  code: string; note: string; total: number; paid: number; due: number; qrUrl: string;
  bank: { bankId: string; accountNo: string; accountName: string };
}

/** Thông tin thanh toán cho khách (null = không cần / chưa cấu hình ngân hàng / đã đủ) */
export async function paymentView(b: Pick<Booking, "id" | "notes" | "source" | "status" | "totalPrice">): Promise<PaymentView | null> {
  const bk = bank();
  const total = payTarget(b);
  if (!bk || total <= 0) return null;
  const paid = Math.round(await paidOf(b.id));
  const due = total - paid;
  if (due <= 1000) return null;
  const code = payCodeOf(b.notes)!;
  return { code, note: transferNote(code), total, paid, due, qrUrl: qrUrl(due, code)!, bank: bk };
}

/** Link cổng khách (tạo cổng nếu chưa có) */
export async function ensurePortalLink(bookingId: string) {
  const p = await prisma.stayPortal.upsert({ where: { bookingId }, update: {}, create: { bookingId, token: newToken() } });
  return portalLink(p);
}

/** Đơn web giữ chỗ quá hạn chưa có tiền → huỷ, nhả lịch. Trả danh sách đã huỷ. */
export async function expireWebHolds(now = new Date()) {
  const list = await prisma.booking.findMany({
    where: { status: "PENDING", source: "DIRECT", notes: { contains: WEB_TAG }, createdAt: { lt: new Date(now.getTime() - WEB_HOLD_MINUTES * 60_000) } },
    include: { room: { select: { roomNumber: true, name: true } } },
  });
  const out: typeof list = [];
  for (const b of list) {
    if ((await paidOf(b.id)) > 0) continue;
    await prisma.booking.update({ where: { id: b.id }, data: { status: "CANCELLED", cancelledAt: now, notes: `${b.notes ?? ""} · Tự huỷ: quá ${WEB_HOLD_MINUTES}' chưa nhận tiền`.trim() } });
    out.push(b);
  }
  return out;
}
