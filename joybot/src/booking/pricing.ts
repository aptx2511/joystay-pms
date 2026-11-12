import { RoomConfig, LONG_STAY } from "./rooms";
import { config } from "../config";

export interface Quote {
  pmsRoomId: string;
  roomName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  weekdayNights: number;
  weekendNights: number;
  subtotal: number;
  discountPct: number;
  discount: number;
  total: number;
  depositPercent: number;
  deposit: number;
  balance: number;
  breakdown: string;
}

const DAY = 24 * 60 * 60 * 1000;
const vnd = (n: number) => n.toLocaleString("vi-VN") + "đ";
const round1000 = (n: number) => Math.round(n / 1000) * 1000;

export function parseDate(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Ngày không hợp lệ: ${s} (cần YYYY-MM-DD)`);
  const d = new Date(`${s}T00:00:00Z`);
  if (isNaN(d.getTime())) throw new Error(`Ngày không hợp lệ: ${s}`);
  return d;
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  const n = Math.round((parseDate(checkOut).getTime() - parseDate(checkIn).getTime()) / DAY);
  if (n <= 0) throw new Error("Ngày trả phòng phải sau ngày nhận phòng");
  return n;
}

/** Tính giá từ bảng giá cấu hình. Đêm cuối tuần = đêm thứ Sáu và thứ Bảy. */
export function quote(room: RoomConfig, checkIn: string, checkOut: string, nightPrices?: number[] | null): Quote {
  const nights = nightsBetween(checkIn, checkOut);
  const start = parseDate(checkIn).getTime();
  let weekendNights = 0;
  let subtotal = 0;
  for (let i = 0; i < nights; i++) {
    const dow = new Date(start + i * DAY).getUTCDay(); // 5 = thứ 6, 6 = thứ 7
    const isWeekend = dow === 5 || dow === 6;
    if (isWeekend) weekendNights++;
    // giá theo ngày từ PMS (chủ đã "Áp dụng") ưu tiên hơn bảng giá cấu hình
    subtotal += nightPrices && nightPrices.length === nights ? nightPrices[i] : isWeekend ? room.weekendPrice ?? room.basePrice : room.basePrice;
  }
  const discountPct =
    nights >= LONG_STAY.monthlyNights
      ? LONG_STAY.monthlyDiscountPct
      : nights >= LONG_STAY.weeklyNights
      ? LONG_STAY.weeklyDiscountPct
      : 0;
  const discount = round1000((subtotal * discountPct) / 100);
  const total = subtotal - discount;
  const depositPercent = config.booking.depositPercent;
  const deposit = round1000((total * depositPercent) / 100);
  const balance = total - deposit;

  const daily = nightPrices && nightPrices.length === nights;
  const lines = [
    daily
      ? `${nights} đêm theo giá từng ngày (${nightPrices!.map((x) => vnd(x)).join(" + ")}) = ${vnd(subtotal)}`
      : `${nights} đêm (${nights - weekendNights} đêm thường × ${vnd(room.basePrice)}` +
        (weekendNights ? `, ${weekendNights} đêm cuối tuần × ${vnd(room.weekendPrice ?? room.basePrice)}` : "") +
        `) = ${vnd(subtotal)}`,
  ];
  if (discount) lines.push(`Giảm ở dài ${discountPct}%: −${vnd(discount)}`);
  lines.push(`Tổng: ${vnd(total)} · Cọc ${depositPercent}%: ${vnd(deposit)} · Còn lại: ${vnd(balance)}`);

  return {
    pmsRoomId: room.pmsRoomId,
    roomName: room.name,
    checkIn,
    checkOut,
    nights,
    weekdayNights: nights - weekendNights,
    weekendNights,
    subtotal,
    discountPct,
    discount,
    total,
    depositPercent,
    deposit,
    balance,
    breakdown: lines.join("\n"),
  };
}

export { vnd };
