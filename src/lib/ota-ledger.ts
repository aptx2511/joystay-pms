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
import type { Prisma } from "@prisma/client";
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

  // Ghép phòng theo ngày cho kênh không có id listing trong link iCal (1 truy vấn cho cả lô)
  const datesNeeded = rows.filter((r) => channel !== "AIRBNB" && r.roomRef && r.checkIn && r.checkOut);
  const sameDates = datesNeeded.length
    ? await prisma.booking.findMany({ where: { source: channel, status: { not: "BLOCKED" }, OR: datesNeeded.map((r) => ({ checkIn: d0(r.checkIn)!, checkOut: d0(r.checkOut)! })) }, select: { roomId: true, checkIn: true, checkOut: true } })
    : [];
  const prepared: { ref: string; data: Record<string, unknown> }[] = [];
  for (const r of rows) {
    const amount = Math.round(Number(r.amount));
    if (!Number.isFinite(amount)) continue;
    const kind = (r.kind ?? "RESERVATION").toUpperCase();
    let base = r.ref?.trim() || `${r.code ?? "?"}|${kind}|${amount}`;
    base = `${channel}|${base}`;
    const n = (seenRef.get(base) ?? 0) + 1; seenRef.set(base, n);
    const ref = n > 1 ? `${base}#${n}` : base;
    const checkIn = d0(r.checkIn), checkOut = d0(r.checkOut);

    let roomId = R.room(channel, r) ?? (r.code ? pmsByCode.get(r.code) ?? null : null);
    if (!roomId && checkIn && checkOut && channel !== "AIRBNB") {
      const ids = [...new Set(sameDates.filter((x) => +x.checkIn === +checkIn && +x.checkOut === +checkOut).map((x) => x.roomId))];
      if (ids.length === 1) roomId = ids[0];
    }
    if (roomId && r.roomRef && channel !== "AIRBNB" && !R.map[`${channel}:${r.roomRef}`]) learned[`${channel}:${r.roomRef}`] = roomId;
    if (!roomId) noRoom++;
    const nights = r.nights ?? (checkIn && checkOut ? Math.round((checkOut.getTime() - checkIn.getTime()) / DAY) : null);
    prepared.push({ ref, data: {
      channel, code: r.code ?? null, kind, roomId, roomRef: r.roomRef ?? null, guestName: r.guest?.slice(0, 80) ?? null,
      checkIn, checkOut, nights, gross: r.gross ?? null, commission: r.commission ?? null, amount,
      status: r.status ?? null, payoutDate: d0(r.payoutDate), seenAt: startedAt,
    } });
  }
  if (snapshot) {
    // ảnh chụp toàn bộ sổ của kênh → thay hẳn (2 truy vấn, nhanh)
    await prisma.$transaction([
      prisma.otaLine.deleteMany({ where: { channel } }),
      prisma.otaLine.createMany({ data: prepared.map((p) => ({ ref: p.ref, ...p.data })) as never }),
    ]);
  } else {
    for (let i = 0; i < prepared.length; i += 10)
      await Promise.all(prepared.slice(i, i + 10).map((p) => prisma.otaLine.upsert({ where: { ref: p.ref }, create: { ref: p.ref, ...p.data } as never, update: p.data as never })));
  }
  upserted = prepared.length;

  if (Object.keys(learned).length) {
    const value = JSON.stringify({ ...R.map, ...learned });
    await prisma.appSetting.upsert({ where: { key: MAP_KEY }, create: { key: MAP_KEY, value }, update: { value } });
  }
  const removed = 0;
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

  const pms = await prisma.booking.findMany({ where: { confirmationCode: { in: [...byCode.keys()] } }, orderBy: [{ updatedAt: "desc" }] });
  const pmsBy = new Map<string, (typeof pms)[number]>();
  for (const b of pms) { const cur = pmsBy.get(b.confirmationCode!); if (!cur || (cur.status === "CANCELLED" && b.status !== "CANCELLED")) pmsBy.set(b.confirmationCode!, b); }
  const noCode = await prisma.booking.findMany({ where: { source: channel, confirmationCode: null, status: { not: "CANCELLED" } } });
  const updates: Promise<unknown>[] = [];
  const creates: Prisma.BookingCreateManyInput[] = [];
  for (const [code, ls] of byCode) {
    const total = Math.round(ls.reduce((s, l) => s + l.amount, 0));
    const res = ls.find((l) => l.kind === "RESERVATION" && l.checkIn && l.checkOut) ?? ls.find((l) => l.checkIn && l.checkOut);
    let b = pmsBy.get(code);
    let viaDates = false;
    if (!b && res?.roomId) { b = noCode.find((x) => x.roomId === res.roomId && +x.checkIn === +res.checkIn! && +x.checkOut === +res.checkOut!); viaDates = !!b; }
    if (b) {
      const data: Record<string, unknown> = {};
      if (b.totalPrice !== total || b.priceSource !== "IMPORT") { data.totalPrice = total; data.priceSource = "IMPORT"; }
      if (!b.confirmationCode) data.confirmationCode = code;
      if ((b.status === "BLOCKED" || viaDates) && res) data.status = "CONFIRMED";
      if (res?.guestName && (!b.guestName || GENERIC_NAME.test(b.guestName))) data.guestName = res.guestName;
      if (Object.keys(data).length) { updates.push(prisma.booking.update({ where: { id: b.id }, data })); updated++; }
    } else if (res?.roomId && res.checkOut! <= today && total > 0) {
      creates.push({
        roomId: res.roomId, guestName: res.guestName ?? `${channel} guest`, checkIn: res.checkIn!, checkOut: res.checkOut!,
        source: channel, status: "CONFIRMED", totalPrice: total, priceSource: "IMPORT", confirmationCode: code,
        notes: "[Sổ OTA] Tạo từ dữ liệu thu nhập của kênh",
      });
    } else if (res && res.checkOut! > today) missingInPms.push(code);
  }
  // Đơn Airbnb ảo phải chuyển trước khi khôi phục/tạo lượt ở thật
  if (channel === "AIRBNB" && snapshot) {
    const r = await prisma.booking.updateMany({
      where: { source: "AIRBNB", status: "CONFIRMED", confirmationCode: null, checkOut: { lte: today } },
      data: { status: "BLOCKED" },
    });
    ghosts = r.count;
  }
  for (let i = 0; i < updates.length; i += 10) await Promise.all(updates.slice(i, i + 10));
  if (creates.length) created = (await prisma.booking.createMany({ data: creates })).count;

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

export type OtaBookingRow = {
  code: string; guest?: string | null; guests?: number | null; bookedAt?: string | null; checkIn: string; checkOut: string;
  nights?: number | null; roomId?: string | null; roomRef?: string | null; status?: string | null;
  gross?: number | null; commission?: number | null; net?: number | null;
};

/** Danh sách đặt phòng của 1 kênh (ảnh chụp toàn bộ → thay hẳn) */
export async function importOtaBookings(channel: LedgerChannel, list: OtaBookingRow[]) {
  const R = await resolver();
  const pms = new Map((await prisma.booking.findMany({ where: { confirmationCode: { in: list.map((b) => b.code) } }, select: { confirmationCode: true, roomId: true } })).map((b) => [b.confirmationCode!, b.roomId]));
  const now = new Date();
  const data = list.filter((b) => b.code && d0(b.checkIn) && d0(b.checkOut)).map((b) => {
    const checkIn = d0(b.checkIn)!, checkOut = d0(b.checkOut)!;
    return {
      channel, code: String(b.code), guestName: b.guest?.slice(0, 120) ?? null, guests: b.guests ?? null, bookedAt: d0(b.bookedAt),
      checkIn, checkOut, nights: b.nights ?? Math.round((checkOut.getTime() - checkIn.getTime()) / DAY),
      roomId: R.room(channel, { amount: 0, roomId: b.roomId, roomRef: b.roomRef }) ?? pms.get(String(b.code)) ?? null, roomRef: b.roomRef ?? null,
      status: b.status ?? null, gross: b.gross ?? null, commission: b.commission ?? null, net: b.net ?? null, seenAt: now,
    };
  });
  if (!data.length) return { bookings: 0 };
  // dedupe theo mã
  const uniq = [...new Map(data.map((d) => [d.code, d])).values()];
  await prisma.$transaction([prisma.otaBooking.deleteMany({ where: { channel } }), prisma.otaBooking.createMany({ data: uniq })]);
  // tên khách đầy đủ + mã cho đơn PMS
  const named = uniq.filter((d) => d.guestName);
  const pmsList = await prisma.booking.findMany({ where: { confirmationCode: { in: named.map((d) => d.code) } }, select: { id: true, confirmationCode: true, guestName: true } });
  const byCode = new Map(named.map((d) => [d.code, d.guestName!]));
  const ups = pmsList.filter((b) => b.guestName !== byCode.get(b.confirmationCode!) && (GENERIC_NAME.test(b.guestName) || byCode.get(b.confirmationCode!)!.startsWith(b.guestName.split(" ")[0])))
    .map((b) => prisma.booking.update({ where: { id: b.id }, data: { guestName: byCode.get(b.confirmationCode!)! } }));
  for (let i = 0; i < ups.length; i += 10) await Promise.all(ups.slice(i, i + 10));
  return { bookings: uniq.length, renamed: ups.length };
}

export type BookingSummaryRow = {
  channel: string; code: string | null; guest: string; guests: number | null; bookedAt: string | null; checkIn: string; checkOut: string; nights: number;
  room: string | null; status: string; gross: number | null; commission: number | null; net: number | null; received: number; upcoming: number; source: "KÊNH" | "PMS";
};

/** Tổng hợp theo TỪNG ĐẶT PHÒNG mọi kênh: kênh (danh sách đặt phòng + Sổ OTA) + đơn trực tiếp/khác trong PMS */
export async function bookingSummary(from: Date, to: Date, by: "checkIn" | "bookedAt" = "checkIn"): Promise<BookingSummaryRow[]> {
  const rooms = new Map((await prisma.room.findMany({ select: { id: true, roomNumber: true, name: true } })).map((r) => [r.id, r.roomNumber ?? r.name]));
  const ota = await prisma.otaBooking.findMany({ where: by === "bookedAt" ? { bookedAt: { gte: from, lt: to } } : { checkIn: { gte: from, lt: to } } });
  const lines = await prisma.otaLine.findMany({ where: { code: { in: ota.map((o) => o.code) } }, select: { code: true, amount: true, status: true } });
  const money = new Map<string, { received: number; upcoming: number }>();
  for (const l of lines) {
    const m = money.get(l.code!) ?? { received: 0, upcoming: 0 };
    if (l.status === "PAID") m.received += l.amount; else m.upcoming += l.amount;
    money.set(l.code!, m);
  }
  const rows: BookingSummaryRow[] = ota.map((o) => {
    const m = money.get(o.code) ?? { received: 0, upcoming: 0 };
    // Agoda/Booking: chưa có dòng tiền riêng → coi net theo kênh là "sắp về"
    const upcoming = m.received || m.upcoming ? m.upcoming : (o.net ?? 0);
    return {
      channel: o.channel, code: o.code, guest: o.guestName ?? "", guests: o.guests, bookedAt: o.bookedAt ? dayKey(o.bookedAt) : null,
      checkIn: dayKey(o.checkIn), checkOut: dayKey(o.checkOut), nights: o.nights ?? 0, room: o.roomId ? rooms.get(o.roomId) ?? null : null,
      status: o.status ?? "", gross: o.gross, commission: o.commission, net: o.net ?? (m.received + m.upcoming || null),
      received: Math.round(m.received), upcoming: Math.round(upcoming), source: "KÊNH",
    };
  });
  const otaChannels = new Set((await prisma.otaBooking.groupBy({ by: ["channel"] })).map((x) => x.channel));
  const pms = await prisma.booking.findMany({
    where: {
      status: { in: ["CONFIRMED", "PENDING"] },
      ...(by === "bookedAt" ? { createdAt: { gte: from, lt: to } } : { checkIn: { gte: from, lt: to } }),
    },
  });
  const known = new Set(ota.map((o) => o.code));
  const paid = await prisma.txn.groupBy({ by: ["bookingId"], where: { kind: "IN", bookingId: { in: pms.map((b) => b.id) } }, _sum: { amount: true } });
  const paidOf = new Map(paid.map((p) => [p.bookingId!, p._sum.amount ?? 0]));
  for (const b of pms) {
    if (otaChannels.has(b.source) && (!b.confirmationCode || known.has(b.confirmationCode))) continue; // kênh đã có danh sách thật
    const received = paidOf.get(b.id) ?? 0;
    rows.push({
      channel: b.source, code: b.confirmationCode, guest: b.guestName, guests: null, bookedAt: dayKey(b.createdAt),
      checkIn: dayKey(b.checkIn), checkOut: dayKey(b.checkOut), nights: Math.round((b.checkOut.getTime() - b.checkIn.getTime()) / DAY),
      room: rooms.get(b.roomId) ?? null, status: b.status === "PENDING" ? "chờ xác nhận" : "đã xác nhận",
      gross: b.totalPrice, commission: null, net: b.totalPrice, received: Math.round(received), upcoming: Math.max(0, Math.round((b.totalPrice ?? 0) - received)), source: "PMS",
    });
  }
  return rows.sort((a, b) => (by === "bookedAt" ? (a.bookedAt ?? "").localeCompare(b.bookedAt ?? "") : a.checkIn.localeCompare(b.checkIn)));
}

/** Ngày nhập sổ gần nhất của từng kênh */
export async function ledgerFreshness() {
  const s = await prisma.appSetting.findMany({ where: { key: { startsWith: "ota_import_at:" } } });
  return Object.fromEntries(s.map((x) => [x.key.split(":")[1], x.value]));
}
