/**
 * Sổ tiền OTA (17/11/2026) — doanh thu Airbnb / Booking.com / Agoda lấy THẲNG từ trang quản lý của kênh,
 * không ước tính. Mỗi tuần (thứ Hai) phiên Claude theo lịch mở trang kênh trong Chrome của chủ, đọc dữ liệu
 * rồi gửi về POST /api/finance/import-ota.
 *
 * Quy tắc doanh thu:
 *  - OTA: tiền chủ THỰC NHẬN của từng khoản (đặt phòng, điều chỉnh, phí huỷ, bồi thường) chia đều theo đêm ở.
 *    Khoản không có ngày ở → tính vào ngày tiền về.
 *  - Đơn OTA trong PMS chưa có trong sổ (vừa đặt, chưa nhập) → giá ước tính, đánh dấu "chưa đối soát".
 *  - Trực tiếp / khác: như cũ (tiền SePay / tiền đã ghi, chưa có thì giá PMS).
 */
import { prisma } from "@/lib/prisma";
import { DAY, dayKey, vnToday } from "@/lib/housekeeping";

export const LEDGER_CHANNELS = ["AIRBNB", "BOOKING", "AGODA"] as const;
export type LedgerChannel = (typeof LEDGER_CHANNELS)[number];

export type OtaRow = {
  ref?: string; code?: string | null; kind?: string; roomId?: string | null; roomRef?: string | null; guest?: string | null;
  checkIn?: string | null; checkOut?: string | null; nights?: number | null;
  gross?: number | null; commission?: number | null; amount: number; status?: string | null; payoutDate?: string | null;
};

const d0 = (s?: string | null) => {
  const m = (s ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
};
const GENERIC_NAME = /^(airbnb|booking\.com|agoda|traveloka) guest/i;
const MAP_KEY = "ota_room_map";

async function roomMap(): Promise<Record<string, string>> {
  const s = await prisma.appSetting.findUnique({ where: { key: MAP_KEY } });
  try { return s ? JSON.parse(s.value) : {}; } catch { return {}; }
}

/** Phòng của 1 dòng: roomId gửi kèm → listing Airbnb trong link iCal → bảng ghép đã học → null */
async function resolver() {
  const rooms = await prisma.room.findMany({ select: { id: true, icalUrl: true, airbnbIcalUrl2: true } });
  const map = await roomMap();
  return {
    map,
    room(channel: string, r: OtaRow): string | null {
      if (r.roomId) return r.roomId;
      const ref = (r.roomRef ?? "").trim();
      if (!ref) return null;
      if (channel === "AIRBNB") {
        const hit = rooms.find((x) => [x.icalUrl, x.airbnbIcalUrl2].some((u) => u && u.includes(ref)));
        if (hit) return hit.id;
      }
      return map[`${channel}:${ref}`] ?? null;
    },
  };
}

/**
 * Nhập sổ của 1 kênh. snapshot=true: rows là TOÀN BỘ sổ hiện có của kênh → dòng cũ không còn thấy bị xoá
 * (vd khoản "sắp tới" bị huỷ). Trả về số liệu + danh sách lệch để báo chủ.
 */
export async function importOtaLines(channel: LedgerChannel, rows: OtaRow[], snapshot = false) {
  const startedAt = new Date();
  const R = await resolver();
  const learned: Record<string, string> = {};
  const seenRef = new Map<string, number>();
  let upserted = 0, noRoom = 0;

  // học bảng ghép phòng từ đơn PMS cùng mã / cùng ngày
  const codes = [...new Set(rows.map((r) => r.code).filter(Boolean) as string[])];
  const pmsByCode = new Map(
    (await prisma.booking.findMany({ where: { confirmationCode: { in: codes } }, select: { confirmationCode: true, roomId: true } }))
      .map((b) => [b.confirmationCode!, b.roomId]),
  );

  for (const r of rows) {
    const amount = Math.round(Number(r.amount));
    if (!Number.isFinite(amount)) continue;
    const kind = (r.kind ?? "RESERVATION").toUpperCase();
    let base = r.ref?.trim() || `${r.code ?? "?"}|${kind}|${amount}`;
    base = `${channel}|${base}`;
    const n = (seenRef.get(base) ?? 0) + 1; seenRef.set(base, n);
    const ref = n > 1 ? `${base}#${n}` : base;

    let roomId = R.room(channel, r);
    if (!roomId && r.code && pmsByCode.has(r.code)) roomId = pmsByCode.get(r.code)!;
    if (!roomId && r.roomRef && channel !== "AIRBNB" && r.checkIn && r.checkOut) {
      const b = await prisma.booking.findMany({ where: { source: channel, checkIn: d0(r.checkIn)!, checkOut: d0(r.checkOut)!, status: { not: "BLOCKED" } }, select: { roomId: true } });
      const ids = [...new Set(b.map((x) => x.roomId))];
      if (ids.length === 1) roomId = ids[0];
    }
    if (roomId && r.roomRef && channel !== "AIRBNB" && !R.map[`${channel}:${r.roomRef}`]) learned[`${channel}:${r.roomRef}`] = roomId;
    if (!roomId) noRoom++;

    const checkIn = d0(r.checkIn), checkOut = d0(r.checkOut);
    const nights = r.nights ?? (checkIn && checkOut ? Math.round((checkOut.getTime() - checkIn.getTime()) / DAY) : null);
    const data = {
      channel, code: r.code ?? null, kind, roomId, roomRef: r.roomRef ?? null, guestName: r.guest?.slice(0, 80) ?? null,
      checkIn, checkOut, nights, gross: r.gross ?? null, commission: r.commission ?? null, amount,
      status: r.status ?? null, payoutDate: d0(r.payoutDate), seenAt: startedAt,
    };
    await prisma.otaLine.upsert({ where: { ref }, create: { ref, ...data }, update: data });
    upserted++;
  }

  if (Object.keys(learned).length) {
    const value = JSON.stringify({ ...R.map, ...learned });
    await prisma.appSetting.upsert({ where: { key: MAP_KEY }, create: { key: MAP_KEY, value }, update: { value } });
  }
  let removed = 0;
  if (snapshot && rows.length) removed = (await prisma.otaLine.deleteMany({ where: { channel, seenAt: { lt: startedAt } } })).count;
  const sync = await syncBookings(channel, snapshot);
  await prisma.appSetting.upsert({
    where: { key: `ota_import_at:${channel}` },
    create: { key: `ota_import_at:${channel}`, value: startedAt.toISOString() },
    update: { value: startedAt.toISOString() },
  });
  return { ok: true, channel, rows: rows.length, upserted, removed, noRoom, learned: Object.keys(learned).length, ...sync };
}

/** Đưa số tiền thật vào đơn PMS; đơn Airbnb ảo (khoá lịch cũ, không mã) đã qua → BLOCKED; lượt ở đã qua thiếu trong PMS → tạo */
async function syncBookings(channel: LedgerChannel, snapshot: boolean) {
  const lines = await prisma.otaLine.findMany({ where: { channel } });
  const byCode = new Map<string, typeof lines>();
  for (const l of lines) if (l.code) byCode.set(l.code, [...(byCode.get(l.code) ?? []), l]);
  const today = vnToday();
  let updated = 0, created = 0, ghosts = 0;
  const missingInPms: string[] = [];

  for (const [code, ls] of byCode) {
    const total = Math.round(ls.reduce((s, l) => s + l.amount, 0));
    const res = ls.find((l) => l.kind === "RESERVATION" && l.checkIn && l.checkOut) ?? ls.find((l) => l.checkIn && l.checkOut);
    let b = await prisma.booking.findFirst({ where: { confirmationCode: code }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }] });
    if (!b && res?.roomId) {
      b = await prisma.booking.findFirst({ where: { source: channel, roomId: res.roomId, checkIn: res.checkIn!, checkOut: res.checkOut!, confirmationCode: null, status: { not: "CANCELLED" } } });
    }
    if (b) {
      const data: Record<string, unknown> = {};
      if (b.totalPrice !== total || b.priceSource !== "IMPORT") { data.totalPrice = total; data.priceSource = "IMPORT"; }
      if (!b.confirmationCode) data.confirmationCode = code;
      if (b.status === "BLOCKED" && res) data.status = "CONFIRMED";
      if (res?.guestName && (!b.guestName || GENERIC_NAME.test(b.guestName))) data.guestName = res.guestName;
      if (Object.keys(data).length) { await prisma.booking.update({ where: { id: b.id }, data }); updated++; }
    } else if (res?.roomId && res.checkOut! <= today && total > 0) {
      await prisma.booking.create({ data: {
        roomId: res.roomId, guestName: res.guestName ?? `${channel[0]}${channel.slice(1).toLowerCase()} guest`, checkIn: res.checkIn!, checkOut: res.checkOut!,
        source: channel, status: "CONFIRMED", totalPrice: total, priceSource: "IMPORT", confirmationCode: code,
        notes: "[Sổ OTA] Tạo từ dữ liệu thu nhập của kênh",
      } });
      created++;
    } else if (res && res.checkOut! > today) missingInPms.push(code);
  }

  // Đơn Airbnb ảo: khoá lịch "Not available" cũ bị nhập nhầm thành đặt phòng (không mã HM) và đã qua
  if (channel === "AIRBNB" && snapshot) {
    const r = await prisma.booking.updateMany({
      where: { source: "AIRBNB", status: "CONFIRMED", confirmationCode: null, checkOut: { lte: today } },
      data: { status: "BLOCKED" },
    });
    ghosts = r.count;
  }
  // Đơn PMS còn hiệu lực của kênh nhưng kênh không có (đơn ma / huỷ chưa cập nhật)
  const pmsOnly = snapshot
    ? (await prisma.booking.findMany({
        where: { source: channel, status: "CONFIRMED", checkIn: { gte: new Date(today.getTime() - 60 * DAY) }, confirmationCode: { notIn: [...byCode.keys()] } },
        include: { room: { select: { roomNumber: true } } }, orderBy: { checkIn: "asc" }, take: 20,
      })).map((b) => `${b.room.roomNumber ?? "?"} ${dayKey(b.checkIn)}→${dayKey(b.checkOut)} ${b.guestName}${b.confirmationCode ? ` (${b.confirmationCode})` : " (không mã)"}`)
    : [];
  return { updated, created, ghosts, missingInPms, pmsOnly };
}

/* ───────────────────────── Doanh thu theo đêm ở ───────────────────────── */

export type RevCell = { nights: number; verified: number; estimated: number };
export type RevenueSplit = {
  rooms: Map<string, RevCell & { byChannel: Record<string, RevCell> }>;
  channels: Record<string, RevCell>;
  unverified: { bookingId: string; roomId: string; source: string; guest: string; code: string | null; checkIn: string; checkOut: string; amount: number }[];
};

const empty = (): RevCell => ({ nights: 0, verified: 0, estimated: 0 });

/**
 * Doanh thu phòng trong [start, end) chia theo đêm ở.
 * paidOf: tiền đã thu ghi trong Thu chi theo booking (đơn trực tiếp) — nếu có thì dùng thay giá PMS.
 */
export async function revenueSplit(start: Date, end: Date, paidOf?: Map<string, number>): Promise<RevenueSplit> {
  const out: RevenueSplit = { rooms: new Map(), channels: {}, unverified: [] };
  const add = (roomId: string, channel: string, nights: number, amount: number, verified: boolean) => {
    const row = out.rooms.get(roomId) ?? { ...empty(), byChannel: {} };
    const ch = row.byChannel[channel] ?? empty();
    const tot = out.channels[channel] ?? empty();
    for (const c of [row, ch, tot]) { c.nights += nights; if (verified) c.verified += amount; else c.estimated += amount; }
    row.byChannel[channel] = ch; out.channels[channel] = tot; out.rooms.set(roomId, row);
  };
  const overlap = (a: Date, b: Date) => Math.max(0, Math.round((Math.min(b.getTime(), end.getTime()) - Math.max(a.getTime(), start.getTime())) / DAY));

  // 1) Sổ OTA
  const lines = await prisma.otaLine.findMany({
    where: { OR: [{ checkIn: { lt: end }, checkOut: { gt: start } }, { checkIn: null, payoutDate: { gte: start, lt: end } }] },
  });
  const ledgerCodes = new Set((await prisma.otaLine.findMany({ where: { code: { not: null } }, select: { code: true }, distinct: ["code"] })).map((l) => l.code!));
  const countedNights = new Set<string>(); // đêm của 1 mã chỉ đếm 1 lần dù có nhiều khoản
  for (const l of lines) {
    if (!l.roomId) continue;
    if (l.checkIn && l.checkOut) {
      const total = Math.max(1, Math.round((l.checkOut.getTime() - l.checkIn.getTime()) / DAY));
      const n = overlap(l.checkIn, l.checkOut);
      const key = `${l.code ?? l.id}`;
      const nightsHere = l.kind === "RESERVATION" && !countedNights.has(key) ? n : 0;
      if (nightsHere) countedNights.add(key);
      add(l.roomId, l.channel, nightsHere, (l.amount * n) / total, true);
    } else add(l.roomId, l.channel, 0, l.amount, true);
  }

  // 2) Đơn PMS không có trong sổ
  const bookings = await prisma.booking.findMany({ where: { status: "CONFIRMED", checkIn: { lt: end }, checkOut: { gt: start } } });
  for (const b of bookings) {
    if (b.confirmationCode && ledgerCodes.has(b.confirmationCode)) continue;
    const total = Math.max(1, Math.round((b.checkOut.getTime() - b.checkIn.getTime()) / DAY));
    const n = overlap(b.checkIn, b.checkOut);
    const received = paidOf?.get(b.id) ?? 0;
    const money = received > 0 ? received : b.totalPrice ?? 0;
    // đã nhận tiền (SePay / Thu chi) hoặc đơn trực tiếp chủ nhập giá tay = chính xác
    const verified = received > 0 || (b.source === "DIRECT" && b.priceSource === "MANUAL");
    add(b.roomId, b.source, n, (money * n) / total, verified);
    if (!verified && LEDGER_CHANNELS.includes(b.source as LedgerChannel))
      out.unverified.push({ bookingId: b.id, roomId: b.roomId, source: b.source, guest: b.guestName, code: b.confirmationCode, checkIn: dayKey(b.checkIn), checkOut: dayKey(b.checkOut), amount: Math.round(money) });
  }
  return out;
}

/** Ngày nhập sổ gần nhất của từng kênh */
export async function ledgerFreshness() {
  const s = await prisma.appSetting.findMany({ where: { key: { startsWith: "ota_import_at:" } } });
  return Object.fromEntries(s.map((x) => [x.key.split(":")[1], x.value]));
}
