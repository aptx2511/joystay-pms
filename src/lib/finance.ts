/**
 * Thu chi · Đối soát tiền về · Lãi lỗ theo phòng (bản đơn giản).
 *  - Doanh thu phòng tính theo ĐÊM Ở trong tháng: tiền của booking chia đều cho số đêm.
 *    Tiền booking = tổng tiền THỰC VỀ đã ghi (Txn IN gắn booking) nếu có, nếu chưa có → giá ước tính của PMS (đánh dấu *).
 *  - Chi phí: Txn OUT trong tháng + chi phí cố định hằng tháng. Gắn phòng → chi phí riêng; không gắn → chi phí chung, chia đều cho các phòng.
 */
import { prisma } from "@/lib/prisma";
import { DAY, dayKey, vnToday } from "@/lib/housekeeping";

export const OUT_CATEGORIES = ["Tiền nhà", "Điện", "Nước", "Internet", "Lương / dọn phòng", "Giặt là", "Vật tư / amenity", "Sửa chữa", "Phí kênh / OTA", "Marketing", "Khác"];
export const IN_CATEGORIES = ["Tiền phòng", "Phí trả sớm / phụ thu", "Khác"];

export const monthRange = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
};
const monthOf = (d: Date) => dayKey(d).slice(0, 7);
const label = (r: { roomNumber: string | null; name: string }) => (r.roomNumber ? `${r.roomNumber} · ${r.name}` : r.name);

/** "350k" → 350000 · "1tr2" / "1.2tr" → 1200000 · "350" → 350000 (dưới 10.000 hiểu là nghìn) */
export function parseAmount(input: string | number): number {
  if (typeof input === "number") return input;
  let s = input.toLowerCase().replace(/\s|đ|vnd|₫/g, "");
  const neg = s.startsWith("-"); if (neg) s = s.slice(1);
  let v = NaN;
  let m = s.match(/^(\d+)(?:tr|m|triệu)(\d*)$/);
  if (m) v = Number(m[1]) * 1e6 + (m[2] ? Number(m[2].padEnd(3, "0").slice(0, 3)) * 1e3 : 0);
  else if ((m = s.match(/^(\d+[.,]?\d*)(tr|m|triệu)$/))) v = Number(m[1].replace(",", ".")) * 1e6;
  else if ((m = s.match(/^(\d+[.,]?\d*)(k|n|nghìn|ngàn)$/))) v = Number(m[1].replace(",", ".")) * 1e3;
  else {
    const digits = s.replace(/[.,]/g, "");
    if (/^\d+$/.test(digits)) { v = Number(digits); if (v > 0 && v < 10_000) v *= 1000; }
  }
  return Number.isFinite(v) ? Math.round(neg ? -v : v) : NaN;
}

export async function monthReport(month: string) {
  const { start, end } = monthRange(month);
  const daysInMonth = Math.round((end.getTime() - start.getTime()) / DAY);
  const rooms = (await prisma.room.findMany({ orderBy: { roomNumber: "asc" } })).filter((r) => r.roomNumber);
  const bookings = await prisma.booking.findMany({
    where: { status: "CONFIRMED", checkIn: { lt: end }, checkOut: { gt: start } },
    include: { room: true },
  });
  const paid = await prisma.txn.groupBy({ by: ["bookingId"], where: { kind: "IN", bookingId: { in: bookings.map((b) => b.id) } }, _sum: { amount: true } });
  const paidOf = new Map(paid.map((p) => [p.bookingId!, p._sum.amount ?? 0]));
  const txns = await prisma.txn.findMany({ where: { date: { gte: start, lt: end } }, orderBy: { date: "desc" } });
  const fixed = (await prisma.fixedCost.findMany()).filter((f) => f.startMonth <= month && (!f.endMonth || f.endMonth >= month));

  const per = new Map(rooms.map((r) => [r.id, { roomId: r.id, label: label(r), nights: 0, revenue: 0, estimated: 0, direct: 0, shared: 0, profit: 0, occupancy: 0 }]));
  for (const b of bookings) {
    const row = per.get(b.roomId); if (!row) continue;
    const total = Math.max(1, Math.round((b.checkOut.getTime() - b.checkIn.getTime()) / DAY));
    const from = Math.max(b.checkIn.getTime(), start.getTime()), to = Math.min(b.checkOut.getTime(), end.getTime());
    const n = Math.max(0, Math.round((to - from) / DAY));
    const received = paidOf.get(b.id) ?? 0;
    const money = received > 0 ? received : b.totalPrice ?? 0;
    const part = (money * n) / total;
    row.nights += n; row.revenue += part; if (!(received > 0)) row.estimated += part;
  }
  let sharedOut = 0, sharedIn = 0;
  for (const t of txns) {
    const sign = t.kind === "IN" ? 1 : -1;
    if (t.kind === "IN" && t.bookingId) continue; // đã tính theo đêm ở trên
    const row = t.roomId ? per.get(t.roomId) : undefined;
    if (row) { if (sign > 0) row.revenue += t.amount; else row.direct += t.amount; }
    else if (sign > 0) sharedIn += t.amount; else sharedOut += t.amount;
  }
  for (const f of fixed) { const row = f.roomId ? per.get(f.roomId) : undefined; if (row) row.direct += f.amount; else sharedOut += f.amount; }
  const share = rooms.length ? (sharedOut - sharedIn) / rooms.length : 0;
  const list = [...per.values()].map((r) => ({
    ...r, revenue: Math.round(r.revenue), estimated: Math.round(r.estimated), direct: Math.round(r.direct), shared: Math.round(share),
    profit: Math.round(r.revenue - r.direct - share), occupancy: Math.round((r.nights / daysInMonth) * 100),
  }));
  const cashIn = txns.filter((t) => t.kind === "IN").reduce((s, t) => s + t.amount, 0);
  const cashOut = txns.filter((t) => t.kind === "OUT").reduce((s, t) => s + t.amount, 0) + fixed.reduce((s, f) => s + f.amount, 0);

  // Đối soát: booking nhận phòng trong tháng
  const today = dayKey(vnToday());
  const recon = bookings
    .filter((b) => b.checkIn >= start && b.checkIn < end)
    .sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime())
    .map((b) => {
      const received = paidOf.get(b.id) ?? 0;
      const expected = b.totalPrice ?? 0;
      const status = received > 0 ? (expected && Math.abs(received - expected) / expected > 0.05 ? "lech" : "du") : dayKey(b.checkIn) <= today ? "chua" : "sap";
      return { bookingId: b.id, room: b.room.roomNumber ?? b.room.name, roomId: b.roomId, guest: b.guestName, code: b.confirmationCode, source: b.source,
        checkIn: dayKey(b.checkIn), checkOut: dayKey(b.checkOut), expected: Math.round(expected), received: Math.round(received), status };
    });

  const totals = list.reduce((s, r) => ({ revenue: s.revenue + r.revenue, estimated: s.estimated + r.estimated, cost: s.cost + r.direct + r.shared, profit: s.profit + r.profit, nights: s.nights + r.nights }),
    { revenue: 0, estimated: 0, cost: 0, profit: 0, nights: 0 });
  return {
    month, daysInMonth, rooms: list, totals: { ...totals, occupancy: rooms.length ? Math.round((totals.nights / (daysInMonth * rooms.length)) * 100) : 0 },
    cash: { in: Math.round(cashIn), out: Math.round(cashOut) }, sharedCost: Math.round(sharedOut),
    txns: txns.map((t) => ({ id: t.id, kind: t.kind, date: dayKey(t.date), amount: t.amount, category: t.category, roomId: t.roomId, bookingId: t.bookingId, channel: t.channel, note: t.note, source: t.source })),
    fixed, recon,
    roomsList: rooms.map((r) => ({ id: r.id, no: r.roomNumber!, label: label(r) })),
    months: monthOf(start),
  };
}

// ── Import CSV thu nhập Airbnb (Thu nhập → Báo cáo / Lịch sử giao dịch → Tải CSV) ──
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
function num(s: string): number {
  let v = (s ?? "").replace(/[^\d.,-]/g, "");
  if (!v) return NaN;
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(v)) v = v.replace(/,/g, "");
  else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(v)) v = v.replace(/\./g, "").replace(",", ".");
  else v = v.replace(",", ".");
  return Number(v);
}
function date(s: string, dayFirst: boolean): Date | null {
  const t = (s ?? "").trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) { const [a, b] = [+m[1], +m[2]]; const [d, mo] = dayFirst || a > 12 ? [a, b] : [b, a]; return new Date(Date.UTC(+m[3], mo - 1, d)); }
  return null;
}

export async function importAirbnbCsv(text: string) {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (rows.length < 2) return { ok: false, error: "File trống" };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...keys: string[]) => head.findIndex((h) => keys.some((k) => h === k || h.includes(k)));
  const cDate = col("date", "ngày");
  const cType = col("type", "loại");
  const cCode = col("confirmation code", "mã xác nhận");
  const cAmount = head.findIndex((h) => h === "amount" || h === "số tiền");
  const cGuest = col("guest", "khách");
  const cListing = col("listing", "chỗ ở", "nhà/phòng");
  if (cDate < 0 || cAmount < 0) return { ok: false, error: "Không nhận ra cột Ngày / Số tiền — hãy tải bản CSV 'Lịch sử giao dịch' của Airbnb" };
  const english = head.includes("date") || head.includes("amount");
  const codes = [...new Set(rows.slice(1).map((r) => (cCode >= 0 ? r[cCode]?.trim() : "")).filter(Boolean))];
  const bookings = await prisma.booking.findMany({ where: { confirmationCode: { in: codes } }, select: { id: true, roomId: true, confirmationCode: true, status: true } });
  const byCode = new Map<string, { id: string; roomId: string }>();
  for (const b of bookings) if (!byCode.has(b.confirmationCode!) || b.status === "CONFIRMED") byCode.set(b.confirmationCode!, b);
  let added = 0, dup = 0, matched = 0, skipped = 0;
  const unmatched: string[] = [];
  for (const r of rows.slice(1)) {
    const type = (cType >= 0 ? r[cType] : "").trim();
    if (/payout|thanh toán cho|chi trả/i.test(type) && !/reservation|đặt phòng/i.test(type)) { skipped++; continue; } // dòng chuyển khoản tổng → bỏ
    const amount = num(r[cAmount]);
    const d = date(r[cDate], !english);
    if (!Number.isFinite(amount) || !amount || !d) { skipped++; continue; }
    const code = cCode >= 0 ? (r[cCode] ?? "").trim() : "";
    const b = code ? byCode.get(code) : undefined;
    if (b) matched++; else if (code) unmatched.push(code);
    const ref = `airbnb|${code}|${dayKey(d)}|${type}|${amount}`;
    const note = [type, cGuest >= 0 ? r[cGuest] : "", cListing >= 0 ? r[cListing] : ""].filter(Boolean).join(" · ").slice(0, 200);
    try {
      await prisma.txn.create({ data: {
        kind: amount >= 0 ? "IN" : "OUT", date: d, amount: Math.abs(amount), category: amount >= 0 ? "Tiền phòng" : "Phí kênh / OTA",
        roomId: b?.roomId ?? null, bookingId: amount >= 0 ? b?.id ?? null : null, channel: "AIRBNB", note, source: "CSV", ref,
      } });
      added++;
    } catch { dup++; }
  }
  return { ok: true, added, dup, matched, skipped, unmatched: [...new Set(unmatched)].slice(0, 30) };
}
