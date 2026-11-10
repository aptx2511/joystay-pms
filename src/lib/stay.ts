/**
 * Cổng khách — Ops 2.0 Module 3
 * Mỗi lượt ở (booking CONFIRMED) có 1 link riêng /s/<token>:
 *   giấy tờ (khai báo lưu trú) → mã cửa (hiện từ 10:00 một ngày trước ngày nhận phòng; mã mở được cửa từ 12:00 ngày nhận phòng)
 *   → hướng dẫn vào nhà → báo sự cố → hướng dẫn trả phòng → góp ý / đánh giá.
 */
import type { Booking, Room, StayPortal } from "@prisma/client";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { DAY, dayKey, newToken, publicBaseUrl, roomLabel, vnToday } from "@/lib/housekeeping";

export const CHECKIN_TIME = process.env.STAY_CHECKIN_TIME || "15:00";
export const CHECKOUT_TIME = process.env.STAY_CHECKOUT_TIME || "12:00";
export const CODES_OPEN_TIME = process.env.STAY_CODES_OPEN_TIME || "10:00"; // giờ VN mã cửa bắt đầu hiện
export const CODES_OPEN_DAYS_BEFORE = Number(process.env.STAY_CODES_OPEN_DAYS_BEFORE ?? "1"); // hiện trước ngày nhận phòng bao nhiêu ngày
export const ID_RETENTION_DAYS = Number(process.env.STAY_ID_RETENTION_DAYS || 30);
export const HOTLINE = process.env.STAY_HOTLINE || "+84 854 777 730";
export const WHATSAPP = process.env.STAY_WHATSAPP || "https://wa.me/84854777730";
export const GOOGLE_REVIEW = process.env.STAY_GOOGLE_REVIEW_URL || "https://g.page/r/CdJ1fHrqKevREAE/review";
// Mặc định KHÔNG bắt buộc giấy tờ mới hiện mã (chủ quyết định 05/11). Đặt STAY_REQUIRE_ID=true để bật lại.
const requireId = () => process.env.STAY_REQUIRE_ID === "true";

export interface DoorCode { door: string; code: string }
export type BookingWithStay = Booking & { room: Room; portal: StayPortal | null };

/** Tên miền cho khách (vd https://stay.joystay.vn) — chưa đặt thì dùng địa chỉ PMS */
export const stayBaseUrl = () => (process.env.STAY_PUBLIC_URL || publicBaseUrl()).replace(/\/$/, "");
export const portalLink = (p: Pick<StayPortal, "token">) => `${stayBaseUrl()}/s/${p.token}`;
export const lookupLink = () => `${stayBaseUrl()}/s`;
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
export const idPhotosOf = (p: StayPortal | null) => arr<string>(p?.idPhotos);
export const doorCodesOf = (p: StayPortal | null) => arr<DoorCode>(p?.doorCodes);

/** "YYYY-MM-DD" + "HH:MM" giờ VN → Date */
export const vnAt = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+07:00`);

/** Lấy mã xác nhận + 4 số cuối ĐT từ DESCRIPTION iCal của Airbnb */
export function parseAirbnbDescription(desc: unknown) {
  const s = typeof desc === "string" ? desc : "";
  const code = s.match(/reservations\/details\/([A-Z0-9]{6,14})/i)?.[1]?.toUpperCase() ?? null;
  const last4 = s.match(/Last 4 Digits\)\s*:\s*(\d{4})/i)?.[1] ?? null;
  return { code, last4 };
}

/** Tạo link cho mọi lượt ở đang/ sắp diễn ra (30 ngày tới) */
export async function ensurePortals() {
  const today = vnToday();
  const missing = await prisma.booking.findMany({
    where: {
      status: "CONFIRMED",
      checkOut: { gte: today },
      checkIn: { lt: new Date(today.getTime() + 30 * DAY) },
      portal: null,
    },
    select: { id: true },
  });
  for (const b of missing) {
    await prisma.stayPortal.create({ data: { bookingId: b.id, token: newToken() } }).catch(() => {});
  }
  return missing.length;
}

/** Xoá ảnh giấy tờ sau ID_RETENTION_DAYS ngày kể từ trả phòng (bảo vệ dữ liệu cá nhân) */
export async function purgeOldIds() {
  const cutoff = new Date(vnToday().getTime() - ID_RETENTION_DAYS * DAY);
  const old = await prisma.stayPortal.findMany({
    where: { idPurgedAt: null, idSubmittedAt: { not: null }, booking: { checkOut: { lt: cutoff } } },
    take: 50,
  });
  for (const p of old) {
    const urls = idPhotosOf(p);
    try {
      if (urls.length && process.env.BLOB_READ_WRITE_TOKEN) await del(urls);
      await prisma.stayPortal.update({ where: { id: p.id }, data: { idPhotos: [], idPurgedAt: new Date() } });
    } catch (e) {
      console.error("[stay] xoá ảnh giấy tờ lỗi", p.id, e);
    }
  }
  return old.length;
}

export function stayPhase(b: Booking, now = new Date()) {
  const ci = dayKey(b.checkIn), co = dayKey(b.checkOut);
  const codesOpenAt = vnAt(dayKey(new Date(b.checkIn.getTime() - CODES_OPEN_DAYS_BEFORE * DAY)), CODES_OPEN_TIME);
  const checkoutAt = vnAt(co, CHECKOUT_TIME);
  const today = dayKey(vnToday(now));
  const phase =
    now >= new Date(checkoutAt.getTime() + 6 * 3_600_000) ? "after"
    : today === co ? "checkout"
    : today >= ci ? "staying"
    : "before";
  return { phase, codesOpenAt, checkoutAt };
}

/** Dữ liệu trả cho trang khách (KHÔNG gồm ảnh giấy tờ, chỉ số lượng) */
export function guestView(b: BookingWithStay, now = new Date()) {
  const p = b.portal!;
  const { phase, codesOpenAt, checkoutAt } = stayPhase(b, now);
  const idOk = !requireId() || Boolean(p.idSubmittedAt);
  const timeOk = now >= codesOpenAt && now < new Date(checkoutAt.getTime() + 2 * 3_600_000);
  const codes = doorCodesOf(p);
  const codesVisible = idOk && timeOk && codes.length > 0;
  const firstName = b.guestName.replace(/\(.*\)/, "").trim().split(/\s+/)[0] || "";
  const generic = /guest$/i.test(b.guestName.trim());

  return {
    guestName: generic ? "" : firstName,
    room: roomLabel(b.room),
    roomNumber: b.room.roomNumber,
    checkIn: dayKey(b.checkIn),
    checkOut: dayKey(b.checkOut),
    checkInTime: CHECKIN_TIME,
    checkOutTime: CHECKOUT_TIME,
    phase,
    lang: p.lang,
    requireId: requireId(),
    idCount: idPhotosOf(p).length,
    idSubmitted: Boolean(p.idSubmittedAt),
    arrivalTime: p.arrivalTime,
    guests: p.guests,
    codes: codesVisible ? codes : [],
    codesState: codesVisible ? "visible"
      : !idOk ? "need_id"
      : !timeOk && now < codesOpenAt ? "too_early"
      : codes.length === 0 ? "preparing"
      : "expired",
    codesOpenAt: codesOpenAt.toISOString(),
    wifi: codesVisible && process.env.STAY_WIFI_NAME
      ? { name: process.env.STAY_WIFI_NAME, password: process.env.STAY_WIFI_PASSWORD ?? "" }
      : null,
    hotline: HOTLINE,
    whatsapp: WHATSAPP,
    googleReview: GOOGLE_REVIEW,
    feedbackSent: Boolean(p.feedback),
    issuesCount: arr(p.issues).length,
  };
}

export async function findByToken(token: string) {
  if (!token || token.length < 16) return null;
  const p = await prisma.stayPortal.findUnique({
    where: { token },
    include: { booking: { include: { room: true, portal: true } } },
  });
  if (!p || p.booking.status === "CANCELLED") return null;
  return p.booking as BookingWithStay;
}

export function stayLine(b: BookingWithStay) {
  return `${b.guestName} · ${roomLabel(b.room)} · ${dayKey(b.checkIn).slice(5)}→${dayKey(b.checkOut).slice(5)} · ${b.source}`;
}

/** Danh sách cho trang Lưu trú + bản tin: khách đến trong [from, to) và khách đang ở */
export async function staysBetween(from: Date, to: Date) {
  await ensurePortals();
  return prisma.booking.findMany({
    where: {
      status: "CONFIRMED",
      OR: [
        { checkIn: { gte: from, lt: to } },
        { checkIn: { lt: from }, checkOut: { gt: from } },
      ],
    },
    include: { room: true, portal: true, guest: true },
    orderBy: [{ checkIn: "asc" }],
  });
}

/** Bản tin cho JoyBot: tình trạng khách đến hôm nay (giấy tờ / mã / đã xem / đã khai báo) */
export async function arrivalsDigest() {
  const today = vnToday();
  const list = (await staysBetween(today, new Date(today.getTime() + DAY))).filter((b) => dayKey(b.checkIn) === dayKey(today));
  const yes = (v: unknown) => (v ? "✅" : "❌");
  const lines = list.map((b) => {
    const p = b.portal;
    return `• ${stayLine(b)}\n   Giấy tờ ${yes(p?.idSubmittedAt)} · Mã ${yes(doorCodesOf(p).length)} · Khách đã xem mã ${yes(p?.codesViewedAt)} · Khai báo ${yes(p?.registeredAt)}${p?.arrivalTime ? ` · Đến ~${p.arrivalTime}` : ""}`;
  });
  const needRegister = list.filter((b) => b.portal?.idSubmittedAt && !b.portal.registeredAt).length;
  return {
    empty: list.length === 0,
    text: [
      `🛎 Khách nhận phòng hôm nay ${dayKey(today).slice(8)}/${dayKey(today).slice(5, 7)}: ${list.length}`,
      ...lines,
      needRegister ? `\n⚠️ ${needRegister} khách đã gửi giấy tờ nhưng CHƯA khai báo lưu trú (khách VN: trước 23:00; khách nước ngoài: trong 12 giờ).` : "",
      `\nXem chi tiết: ${publicBaseUrl()}/luu-tru`,
    ].filter(Boolean).join("\n"),
  };
}

/** Cho JoyBot cấp mã TTLock: khách đến hôm nay/ngày mai (hoặc đang ở, nhận phòng ≤2 ngày trước), chưa có mã */
export async function pendingCodes() {
  const today = vnToday();
  const list = await staysBetween(today, new Date(today.getTime() + 2 * DAY));
  return list
    // khách sắp đến (hôm nay/mai) HOẶC đã nhận phòng ≤ 2 ngày trước mà vẫn chưa có mã (lần cấp trước lỗi, vd bộ phát mất mạng)
    // → bot tiếp tục thử lại, không bỏ cuộc khi qua ngày nhận phòng
    .filter((b) => dayKey(b.checkIn) >= dayKey(new Date(today.getTime() - 2 * DAY)) && dayKey(b.checkOut) > dayKey(today)
      && b.portal && doorCodesOf(b.portal).length === 0)
    .map((b) => ({
      bookingId: b.id,
      code: b.confirmationCode ?? b.id.slice(-6).toUpperCase(),
      roomNo: b.room.roomNumber,
      roomName: b.room.name,
      guestName: b.guestName,
      checkIn: dayKey(b.checkIn),
      checkOut: dayKey(b.checkOut),
      // mã chung 4 số = 4 số cuối ĐT khách (Airbnb iCal hoặc ĐT khách đặt trực tiếp)
      phoneLast4: b.portal?.phoneLast4 ?? (b.guest?.phone ? b.guest.phone.replace(/\D/g, "").slice(-4) : null),
    }));
}

// ── DEMO: /s/demo?at=<bước> — dữ liệu giả, không ghi DB, không gửi Telegram ──────
export const DEMO_TOKEN = "demo";
export const DEMO_STEPS: { key: string; label: string; dayOffset: number; time: string; idSent: boolean }[] = [
  { key: "dat-phong",      label: "Vừa đặt phòng",          dayOffset: -5, time: "12:00", idSent: false },
  { key: "truoc-1-ngay",   label: "1 ngày trước 10:00",     dayOffset: -1, time: "10:00", idSent: false },
  { key: "sang-ngay-den",  label: "Ngày đến 09:00",         dayOffset: 0,  time: "09:00", idSent: true },
  { key: "chieu-ngay-den", label: "Ngày đến 16:00",         dayOffset: 0,  time: "16:00", idSent: true },
  { key: "ngay-tra",       label: "Ngày trả phòng 09:00",   dayOffset: 2,  time: "09:00", idSent: true },
  { key: "sau-tra",        label: "Sau khi trả phòng",      dayOffset: 3,  time: "10:00", idSent: true },
];

export function demoView(stepKey: string | null) {
  const step = DEMO_STEPS.find((s) => s.key === stepKey) ?? DEMO_STEPS[3];
  const ci = vnToday();
  const co = new Date(ci.getTime() + 2 * DAY);
  const now = vnAt(dayKey(new Date(ci.getTime() + step.dayOffset * DAY)), step.time);
  const fake = {
    id: "demo", guestName: "Anna Demo", source: "AIRBNB", checkIn: ci, checkOut: co,
    room: { id: "demo", name: "Pop Art Studio", roomNumber: "202", size: 25 },
    portal: {
      id: "demo", token: DEMO_TOKEN, lang: "en", idPhotos: step.idSent ? ["demo"] : [],
      idSubmittedAt: step.idSent ? new Date() : null, arrivalTime: null, guests: null,
      doorCodes: [
        { door: "Main door · Cửa nhà", code: "4821" },
        { door: "Inner gate · Cổng trong", code: "4821" },
        { door: "Room 202 · Phòng 202", code: "4821" },
      ],
      feedback: null, issues: [],
    },
  } as unknown as BookingWithStay;
  const v = guestView(fake, now);
  return {
    ...v,
    wifi: v.codes.length ? { name: "Joystay", password: "(mật khẩu thật hiện ở đây)" } : null,
    demo: { step: step.key, steps: DEMO_STEPS.map(({ key, label }) => ({ key, label })) },
  };
}
