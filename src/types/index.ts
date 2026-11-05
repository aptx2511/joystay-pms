export type BookingSource = "DIRECT" | "AIRBNB" | "BOOKING" | "AGODA" | "TRAVELOKA" | "OFFLINE";
// BLOCKED = ngày bị khoá trên kênh OTA (không phải lượt ở thật / hoặc là bản phản chiếu
// của booking đã có ở kênh khác). Vẫn tính là "không còn trống", KHÔNG tính doanh thu,
// KHÔNG sinh việc dọn, KHÔNG xuất ngược ra iCal.
export type BookingStatus = "CONFIRMED" | "PENDING" | "CANCELLED" | "BLOCKED";

export interface Room {
  id: string;
  name: string;
  size: number;
  pricePerNight: number | null;
  weekendPricePerNight: number | null;
  icalUrl: string | null;
  bookingIcalUrl: string | null;
  agodaIcalUrl: string | null;
  travelokaIcalUrl: string | null;
  airbnbIcalUrl2?: string | null;
  roomNumber?: string | null;
  createdAt: string;
}

/**
 * Phí kênh (phần trăm bị trừ trên giá khách trả) — dùng để ƯỚC TÍNH tiền thực nhận
 * khi kênh không gửi giá qua iCal. Số thật lấy từ file chi trả (payout) của OTA.
 * Airbnb 15,5%: đo từ báo cáo thu nhập T9/2026 (12.252.500 thực nhận / 14.500.000 gộp).
 * Sửa ở đây nếu biểu phí thay đổi.
 */
export const CHANNEL_FEE: Record<BookingSource, number> = {
  AIRBNB:    0.155,
  BOOKING:   0.15,
  AGODA:     0.18,
  TRAVELOKA: 0.15,
  DIRECT:    0,
  OFFLINE:   0,
};

/**
 * Calculate total price for a stay, using weekend pricing for Fri & Sat nights,
 * minus the channel fee (CHANNEL_FEE) for OTA sources.
 */
export function calcAutoPrice(
  checkIn: Date, checkOut: Date,
  pricePerNight: number,
  weekendPricePerNight: number | null,
  source: BookingSource
): number {
  const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000);
  if (nights <= 0) return 0;
  const weekend = weekendPricePerNight ?? pricePerNight;
  let total = 0;
  for (let i = 0; i < nights; i++) {
    const d = new Date(checkIn);
    d.setDate(checkIn.getDate() + i);
    const dow = d.getDay(); // 5=Fri, 6=Sat
    total += (dow === 5 || dow === 6) ? weekend : pricePerNight;
  }
  return Math.round(total * (1 - (CHANNEL_FEE[source] ?? 0)));
}

export interface Guest {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
}

export interface Booking {
  id: string;
  roomId: string;
  guestId: string | null;
  guestName: string;
  checkIn: string; // ISO date string
  checkOut: string; // ISO date string
  source: BookingSource;
  status: BookingStatus;
  totalPrice: number | null;
  notes: string | null;
  externalId: string | null;
  createdAt: string;
  updatedAt: string;
  room?: Room;
  guest?: Guest | null;
}

export interface BookingWithRoom extends Booking {
  room: Room;
}

// Used for create/update forms
export interface BookingFormData {
  roomId: string;
  guestName: string;
  checkIn: string;
  checkOut: string;
  source: BookingSource;
  status: BookingStatus;
  totalPrice: string;
  notes: string;
}

// Source metadata for display
export const SOURCE_META: Record<
  BookingSource,
  { label: string; color: string; bgClass: string; textClass: string; borderClass: string }
> = {
  AIRBNB: {
    label: "Airbnb",
    color: "#FF385C",
    bgClass: "bg-rose-500",
    textClass: "text-rose-700",
    borderClass: "border-rose-400",
  },
  DIRECT: {
    label: "Direct",
    color: "#3B82F6",
    bgClass: "bg-blue-500",
    textClass: "text-blue-700",
    borderClass: "border-blue-400",
  },
  BOOKING: {
    label: "Booking.com",
    color: "#003580",
    bgClass: "bg-blue-700",
    textClass: "text-blue-800",
    borderClass: "border-blue-600",
  },
  AGODA: {
    label: "Agoda",
    color: "#E91E2C",
    bgClass: "bg-red-500",
    textClass: "text-red-700",
    borderClass: "border-red-400",
  },
  TRAVELOKA: {
    label: "Traveloka",
    color: "#0194F3",
    bgClass: "bg-sky-500",
    textClass: "text-sky-700",
    borderClass: "border-sky-400",
  },
  OFFLINE: {
    label: "Offline / Zalo",
    color: "#10B981",
    bgClass: "bg-emerald-500",
    textClass: "text-emerald-700",
    borderClass: "border-emerald-400",
  },
};

export const STATUS_META: Record<
  BookingStatus,
  { label: string; bgClass: string; textClass: string }
> = {
  CONFIRMED: { label: "Confirmed", bgClass: "bg-green-100", textClass: "text-green-800" },
  PENDING:   { label: "Pending",   bgClass: "bg-yellow-100", textClass: "text-yellow-800" },
  CANCELLED: { label: "Cancelled", bgClass: "bg-gray-100",   textClass: "text-gray-500" },
  BLOCKED:   { label: "Blocked",   bgClass: "bg-slate-100",  textClass: "text-slate-500" },
};
