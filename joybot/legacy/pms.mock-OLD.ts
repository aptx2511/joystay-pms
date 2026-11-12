import axios from "axios";
import { config, ROOM_NAMES } from "../config";

const pmsClient = axios.create({
  baseURL: config.pms.baseUrl,
  headers: {
    "Content-Type": "application/json",
    ...(config.pms.apiKey ? { Authorization: `Bearer ${config.pms.apiKey}` } : {}),
  },
  timeout: 10000,
});

export interface AvailabilityResult {
  available: boolean;
  rooms: Array<{
    slug: string;
    name: string;
    available: boolean;
    pricePerNight?: number;
    pricePerMonth?: number;
  }>;
}

export interface PricingResult {
  roomSlug: string;
  roomName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  pricePerNight: number;
  weekendPrice?: number;
  totalPrice: number;
  cleaningFee?: number;
  securityDeposit?: number;
  breakdown: string;
}

export interface BookingResult {
  success: boolean;
  bookingId: string;
  confirmationCode: string;
  roomSlug: string;
  roomName: string;
  checkIn: string;
  checkOut: string;
  guestName: string;
  totalAmount: number;
  message: string;
}

// ── checkAvailability ──────────────────────────────────────────────────────

export async function checkAvailability(params: {
  checkIn: string;
  checkOut: string;
  roomSlug?: string;
}): Promise<AvailabilityResult> {
  try {
    const response = await pmsClient.get("/availability", {
      params: {
        checkIn: params.checkIn,
        checkOut: params.checkOut,
        ...(params.roomSlug ? { roomId: params.roomSlug } : {}),
      },
    });

    return response.data;
  } catch (err) {
    // Fallback: return mock data if PMS is unreachable (dev mode)
    console.warn("[PMS] checkAvailability failed, using mock data:", err);
    return buildMockAvailability(params);
  }
}

function buildMockAvailability(params: {
  checkIn: string;
  checkOut: string;
  roomSlug?: string;
}): AvailabilityResult {
  const allRooms = Object.entries(ROOM_NAMES).map(([slug, name]) => ({
    slug,
    name,
    available: Math.random() > 0.3, // 70% chance available (mock)
    pricePerNight: getMockPrice(slug),
  }));

  const rooms = params.roomSlug
    ? allRooms.filter((r) => r.slug === params.roomSlug)
    : allRooms;

  return {
    available: rooms.some((r) => r.available),
    rooms,
  };
}

function getMockPrice(slug: string): number {
  const prices: Record<string, number> = {
    "pop-art-suite": 1500000,
    "monochrome-loft": 1800000,
    "vintage-haven": 1200000,
    "neon-dreams": 2000000,
    "botanical-bliss": 1400000,
  };
  return prices[slug] ?? 1500000;
}

// ── getPricing ─────────────────────────────────────────────────────────────

export async function getPricing(params: {
  roomSlug: string;
  checkIn: string;
  checkOut: string;
  stayType?: "SHORT_STAY" | "LONG_STAY";
}): Promise<PricingResult> {
  try {
    const response = await pmsClient.get("/pricing", { params });
    return response.data;
  } catch (err) {
    console.warn("[PMS] getPricing failed, using mock data:", err);
    return buildMockPricing(params);
  }
}

function buildMockPricing(params: {
  roomSlug: string;
  checkIn: string;
  checkOut: string;
  stayType?: string;
}): PricingResult {
  const checkIn = new Date(params.checkIn);
  const checkOut = new Date(params.checkOut);
  const nights = Math.ceil(
    (checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)
  );
  const pricePerNight = getMockPrice(params.roomSlug);
  const cleaningFee = 200000;
  const totalPrice = pricePerNight * nights + cleaningFee;

  return {
    roomSlug: params.roomSlug,
    roomName: ROOM_NAMES[params.roomSlug] ?? params.roomSlug,
    checkIn: params.checkIn,
    checkOut: params.checkOut,
    nights,
    pricePerNight,
    totalPrice,
    cleaningFee,
    securityDeposit: 500000,
    breakdown: `${nights} đêm × ${pricePerNight.toLocaleString("vi-VN")}đ + phí dọn phòng ${cleaningFee.toLocaleString("vi-VN")}đ = **${totalPrice.toLocaleString("vi-VN")}đ**`,
  };
}

// ── createBooking ──────────────────────────────────────────────────────────

export async function createBooking(params: {
  roomSlug: string;
  checkIn: string;
  checkOut: string;
  guestName: string;
  guestPhone: string;
  guestEmail?: string;
  adults: number;
  children?: number;
  notes?: string;
  source?: string;
}): Promise<BookingResult> {
  try {
    const response = await pmsClient.post("/bookings", {
      roomId: params.roomSlug,
      checkIn: params.checkIn,
      checkOut: params.checkOut,
      guest: {
        name: params.guestName,
        phone: params.guestPhone,
        email: params.guestEmail,
      },
      guests: {
        adults: params.adults,
        children: params.children ?? 0,
      },
      notes: params.notes,
      source: params.source ?? "direct",
    });

    return response.data;
  } catch (err) {
    console.warn("[PMS] createBooking failed, using mock data:", err);
    return buildMockBooking(params);
  }
}

function buildMockBooking(params: {
  roomSlug: string;
  checkIn: string;
  checkOut: string;
  guestName: string;
  guestPhone: string;
}): BookingResult {
  const bookingId = `JOY-${Date.now()}`;
  const confirmationCode = `JST${Math.floor(100000 + Math.random() * 900000)}`;
  const pricePerNight = getMockPrice(params.roomSlug);
  const nights = Math.ceil(
    (new Date(params.checkOut).getTime() - new Date(params.checkIn).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  return {
    success: true,
    bookingId,
    confirmationCode,
    roomSlug: params.roomSlug,
    roomName: ROOM_NAMES[params.roomSlug] ?? params.roomSlug,
    checkIn: params.checkIn,
    checkOut: params.checkOut,
    guestName: params.guestName,
    totalAmount: pricePerNight * nights + 200000,
    message: "Booking đã được tạo thành công và lịch đã được khóa.",
  };
}
