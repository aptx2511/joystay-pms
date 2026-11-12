/**
 * PMS client — KHÔNG có dữ liệu giả. PMS lỗi → ném lỗi để bot báo khách chờ và báo chủ.
 */
import axios, { AxiosError } from "axios";
import { config } from "../config";

const pms = axios.create({
  baseURL: config.pms.baseUrl,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
    ...(config.pms.apiKey ? { "x-api-key": config.pms.apiKey } : {}),
  },
});

export class PmsConflictError extends Error {}

function wrap(e: unknown, what: string): never {
  const ax = e as AxiosError<{ error?: string }>;
  if (ax?.response?.status === 409) throw new PmsConflictError("Phòng vừa có người đặt trùng ngày");
  const detail = ax?.response?.data?.error ?? (e as Error)?.message ?? String(e);
  throw new Error(`PMS ${what} lỗi: ${detail}`);
}

export async function getAvailableRoomIds(checkIn: string, checkOut: string): Promise<Set<string>> {
  try {
    const { data } = await pms.get("/availability", { params: { checkIn, checkOut } });
    // PMS trả { available: Room[] } — available là MẢNG
    const list: Array<{ id: string }> = Array.isArray(data?.available) ? data.available : [];
    return new Set(list.map((r) => r.id));
  } catch (e) {
    wrap(e, "availability");
  }
}

/** Giá theo ngày chủ đã "Áp dụng" trong PMS (Giá & phòng trống). Lỗi / không có → null (dùng bảng giá cấu hình). */
export async function getNightPrices(roomId: string, checkIn: string, checkOut: string): Promise<{ prices: number[]; custom: boolean } | null> {
  try {
    const { data } = await pms.get("/quote", { params: { roomId, checkIn, checkOut } });
    const nights: Array<{ price: number; custom: boolean }> = Array.isArray(data?.nights) ? data.nights : [];
    // chỉ dùng khi chủ đã áp giá riêng cho ít nhất 1 đêm; còn lại giữ bảng giá cấu hình của bot
    if (!nights.length || nights.some((n) => !(n.price > 0)) || !nights.some((n) => n.custom)) return null;
    return { prices: nights.map((n) => n.price), custom: nights.some((n) => n.custom) };
  } catch {
    return null;
  }
}

export interface PmsBooking {
  id: string;
  roomId: string;
  status: string;
  checkIn: string;
  checkOut: string;
  guestName: string;
  totalPrice?: number | null;
  notes?: string | null;
}

export async function createPendingBooking(p: {
  roomId: string;
  guestName: string;
  guestPhone?: string;
  guestEmail?: string;
  checkIn: string;
  checkOut: string;
  totalPrice: number;
  notes: string;
}): Promise<PmsBooking> {
  try {
    const { data } = await pms.post("/bookings", { ...p, source: "DIRECT", status: "PENDING" });
    return data;
  } catch (e) {
    wrap(e, "tạo booking");
  }
}

export async function updateBooking(id: string, patch: { status?: string; notes?: string }) {
  try {
    const { data } = await pms.put(`/bookings/${id}`, patch);
    return data as PmsBooking;
  } catch (e) {
    wrap(e, "cập nhật booking");
  }
}

/** Cổng khách (Ops 2.0): lưu mã cửa vào PMS, trả về link cổng khách /s/<token> */
export async function saveStayCodes(
  bookingId: string,
  codes: { door: string; code: string }[],
  source: "TTLOCK" | "MANUAL" = "TTLOCK"
): Promise<string | null> {
  try {
    const { data } = await pms.patch(`/stay/admin/${bookingId}`, { doorCodes: codes, source });
    return (data?.link as string) ?? null;
  } catch (e) {
    console.warn("[PMS] lưu mã cổng khách lỗi:", (e as Error).message);
    return null;
  }
}

/** Kéo lịch Airbnb/Booking/Agoda về PMS ngay (dùng CRON_SECRET của PMS) */
export async function syncOtaCalendars(): Promise<boolean> {
  if (!config.pms.cronSecret) return false;
  try {
    await pms.get("/ical/sync", {
      headers: { Authorization: `Bearer ${config.pms.cronSecret}` },
      timeout: 60000,
    });
    return true;
  } catch (e) {
    console.warn("[PMS] Đồng bộ iCal OTA lỗi:", (e as Error).message);
    return false;
  }
}
