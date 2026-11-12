/**
 * BẢNG PHÒNG & GIÁ ĐẶT TRỰC TIẾP — nguồn sự thật duy nhất cho JoyBot.
 *
 * ⚠️ CHỦ PHẢI ĐIỀN: pmsRoomId (lấy trong PMS → /api/rooms), tên, giá.
 * Phòng nào `active: false` hoặc thiếu giá → bot KHÔNG báo giá, KHÔNG nhận đặt phòng đó
 * (chuyển cho chủ), thay vì bịa số.
 *
 * Có thể ghi đè toàn bộ bảng bằng biến môi trường ROOMS_JSON (cùng cấu trúc, dạng JSON).
 */
export interface RoomConfig {
  pmsRoomId: string;
  roomNo?: string;        // số phòng thật (101, 201, 202, 301, 302…) — dùng để chọn khoá TTLock
  name: string;
  concept: string;
  sizeM2?: number;
  maxGuests: number;
  hasKitchen: boolean;
  basePrice: number;      // giá đêm thường (VND) — giá đặt trực tiếp
  weekendPrice?: number;  // giá đêm thứ 6 & thứ 7 (VND); bỏ trống = basePrice
  active: boolean;
  description: string;    // 1–2 câu đúng sự thật để bot tư vấn
}

const DEFAULT_ROOMS: RoomConfig[] = [
  // Cập nhật 05/11/2026 theo PMS + Daily Ops. Giá = giá đặt trực tiếp (website). ROOMS_JSON trên Railway sẽ ghi đè bảng này.
  {
    pmsRoomId: "cmmuucxqc0000shoxx69vkmqg", roomNo: "202", name: "Pop Art Studio", concept: "Pop Art",
    sizeM2: 25, maxGuests: 2, hasKitchen: true, basePrice: 850000, weekendPrice: 900000, active: true,
    description: "Studio 25m² phong cách Pop Art màu sắc, giường King + sofa, có bếp, cửa sổ.",
  },
  {
    pmsRoomId: "cmmuucxsp0001shoxo578c9h3", roomNo: "302", name: "Black & White / Parisian Chic", concept: "Monochrome / Parisian",
    sizeM2: 25, maxGuests: 2, hasKitchen: true, basePrice: 850000, weekendPrice: 900000, active: true,
    description: "Studio 25m² tông đen trắng kiểu Paris, giường King, có bếp, cửa sổ lớn nhiều ánh sáng.",
  },
  {
    pmsRoomId: "cmmuucxts0002shoxwvoivyh7", roomNo: "101", name: "Cozy Indochine Sleep Cave", concept: "Indochine",
    sizeM2: 15, maxGuests: 2, hasKitchen: false, basePrice: 650000, weekendPrice: 700000, active: true,
    description: "Phòng 15m² phong cách Đông Dương, giường Queen, tủ lạnh mini, KHÔNG có cửa sổ nên rất yên tĩnh và tối — hợp ngủ sâu.",
  },
  {
    pmsRoomId: "cmmuucxvx0004shoxebjdm3y1", roomNo: "201", name: "The Indochine Midnight Hideout", concept: "Indochine",
    sizeM2: 15, maxGuests: 2, hasKitchen: false, basePrice: 650000, weekendPrice: 700000, active: true,
    description: "Phòng 15m² Đông Dương tông tối, giường Queen, tủ lạnh mini, KHÔNG có cửa sổ — yên tĩnh, riêng tư.",
  },
  {
    pmsRoomId: "cmmuucxuu0003shoxub87vpgi", roomNo: "301", name: "The Tropical Oasis Room", concept: "Tropical",
    sizeM2: 15, maxGuests: 2, hasKitchen: false, basePrice: 650000, weekendPrice: 700000, active: true,
    description: "Phòng 15m² phong cách nhiệt đới, giường Queen, tủ lạnh mini, cửa sổ lớn.",
  },
  {
    pmsRoomId: "cmw0v9j3w0000dzhkqie99lh2", roomNo: "401", name: "The Matcha Bath Loft", concept: "Matcha / Wabi-sabi",
    sizeM2: 50, maxGuests: 4, hasKitchen: true, basePrice: 1490000, weekendPrice: 1590000, active: true,
    description: "Nguyên tầng trên 50m², bồn tắm trong nhà, có bếp, giường King 1m8 + sofa giường 1m8, tối đa 4 khách.",
  },
];

function load(): RoomConfig[] {
  const raw = process.env.ROOMS_JSON;
  if (raw) {
    try {
      return JSON.parse(raw) as RoomConfig[];
    } catch (e) {
      console.error("[Rooms] ROOMS_JSON không hợp lệ, dùng bảng mặc định:", e);
    }
  }
  return DEFAULT_ROOMS;
}

export const ROOMS: RoomConfig[] = load();

export const bookableRooms = () =>
  ROOMS.filter((r) => r.active && r.pmsRoomId && r.basePrice > 0);

export const findRoom = (idOrName: string) => {
  const q = idOrName.trim().toLowerCase();
  return bookableRooms().find(
    (r) => r.pmsRoomId.toLowerCase() === q || r.name.toLowerCase() === q
  );
};

/** Chính sách giảm giá ở dài (đặt trực tiếp) — chỉnh qua env */
export const LONG_STAY = {
  weeklyNights: Number(process.env.WEEKLY_MIN_NIGHTS ?? 7),
  weeklyDiscountPct: Number(process.env.WEEKLY_DISCOUNT_PCT ?? 10),
  monthlyNights: Number(process.env.MONTHLY_MIN_NIGHTS ?? 28),
  monthlyDiscountPct: Number(process.env.MONTHLY_DISCOUNT_PCT ?? 29),
};
