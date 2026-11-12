/**
 * Đọc email đặt phòng (Airbnb / Booking.com) do Apps Script trong Gmail chuyển sang.
 * Mục tiêu: PMS biết ngay TÊN KHÁCH, MÃ ĐẶT PHÒNG, SỐ KHÁCH, TIỀN THỰC NHẬN, email trả lời (Booking) — không chờ iCal/CSV.
 * Email chưa khớp được booking (iCal chưa về) → lưu UNMATCHED, thử khớp lại ở mỗi lần đồng bộ iCal.
 */
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { newToken } from "@/lib/housekeeping";

const TOKEN_KEY = "inbound_email_token";
export async function inboxToken() {
  const row = await prisma.appSetting.findUnique({ where: { key: TOKEN_KEY } });
  if (row) return row.value;
  const v = randomBytes(24).toString("hex");
  await prisma.appSetting.create({ data: { key: TOKEN_KEY, value: v } });
  return v;
}

const PLACEHOLDER = /^(airbnb|booking\.com|agoda|traveloka)( guest)?( \(|$)|^reserved|not available|closed/i;
const clean = (s: string) => s.replace(/ /g, " ").replace(/[ \t]+/g, " ");

/** "₫1.234.567" · "1.234.567 ₫" · "VND 2.250.000" · "₫1,234,567.00" → số */
function money(s: string): number | null {
  const m = s.match(/(?:₫|VND|đ)\s?([\d.,]+)|([\d.,]+)\s?(?:₫|VND|đ)/i);
  if (!m) return null;
  let v = (m[1] ?? m[2]).replace(/[.,](\d{2})$/, "");
  v = v.replace(/[.,]/g, "");
  const n = Number(v);
  return Number.isFinite(n) && n >= 10_000 ? n : null;
}
function after(text: string, labels: RegExp, max = 120) {
  const m = text.match(labels);
  if (!m || m.index == null) return null;
  return text.slice(m.index + m[0].length, m.index + m[0].length + max);
}

export interface Parsed {
  channel: "AIRBNB" | "BOOKING" | "AGODA" | "OTHER"; kind: "NEW" | "CANCEL" | "CHANGE" | "PAYOUT" | "MESSAGE" | "OTHER";
  code?: string | null; guestName?: string | null; guests?: number | null; payout?: number | null; total?: number | null;
  checkIn?: string | null; roomHint?: string | null;
}

const VN_MONTH = (s: string) => {
  // "11 tháng 11 2026" | "11 thg 11, 2026" | "Nov 11, 2026"
  let m = s.match(/(\d{1,2})\s*(?:tháng|thg)\s*(\d{1,2}),?\s*(\d{4})/i);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  m = s.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i);
  if (m) return `${m[3]}-${String(months.indexOf(m[1].toLowerCase()) + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
};

export function parseEmail(from: string, subject: string, body: string): Parsed {
  const f = from.toLowerCase(), s = clean(subject), b = clean(body);
  if (f.includes("airbnb")) {
    const kind: Parsed["kind"] = /hủy|huỷ|cancel/i.test(s) ? "CANCEL" : /thay đổi|altered|changed|cập nhật đặt phòng/i.test(s) ? "CHANGE"
      : /xác nhận|confirmed|đặt phòng mới|new booking|reservation/i.test(s) ? "NEW" : /thanh toán|payout|đã gửi.*tiền/i.test(s) ? "PAYOUT" : /tin nhắn|message/i.test(s) ? "MESSAGE" : "OTHER";
    const code = (s + " " + b).match(/\bHM[A-Z0-9]{8}\b/)?.[0] ?? null;
    const name = s.match(/(?:xác nhận|confirmed|hủy|huỷ|canceled|cancelled)\s*[-–:]\s*(.+?)\s+(?:sẽ đến|đến vào|đến|arrives|arriving|nhận phòng)\b/i)?.[1]?.trim()
      ?? s.match(/(?:từ|from)\s+(.+?)\s+(?:đã|has)\b/i)?.[1]?.trim() ?? null;
    const guests = Number((b.match(/(\d{1,2})\s*(?:khách|guests?)\b/i) ?? [])[1]) || null;
    const payoutTxt = after(b, /(bạn kiếm được|bạn sẽ nhận được|you earn|your payout|tiền chi trả cho bạn|tổng thu nhập)/i);
    const payout = payoutTxt ? money(payoutTxt) : null;
    const checkIn = VN_MONTH(after(b, /(nhận phòng|check-in|checkin)/i, 60) ?? "") ?? null;
    return { channel: "AIRBNB", kind, code, guestName: name, guests, payout, checkIn };
  }
  if (f.includes("agoda")) {
    const kind: Parsed["kind"] = /hủy|huỷ|cancel/i.test(s) ? "CANCEL" : /thay đổi|amend|modif|changed/i.test(s) ? "CHANGE"
      : /xác nhận|confirm|đặt phòng mới|new booking|booking id/i.test(s) ? "NEW" : /tin nhắn|message/i.test(s) ? "MESSAGE" : "OTHER";
    const code = (s.match(/\b(\d{8,11})\b/) ?? b.match(/(?:booking id|mã đặt phòng|số đặt phòng|booking no)\D{0,20}(\d{8,11})/i) ?? [])[1] ?? null;
    const nameTxt = after(b, /(tên khách|guest name|customer name|tên khách hàng)\s*:?\s*/i, 60);
    const guestName = nameTxt ? nameTxt.split(/\n|\s{2,}|\|/)[0].trim() || null : null;
    const guests = Number((b.match(/(\d{1,2})\s*(?:người lớn|khách|adults?|guests?)\b/i) ?? [])[1]) || null;
    const netTxt = after(b, /(net rate|số tiền thực nhận|giá thực nhận|amount to (?:be )?(?:paid|receive))\s*:?\s*/i, 60);
    const totalTxt = after(b, /(tổng giá|tổng tiền|total)\s*:?\s*/i, 60);
    const net = netTxt ? money(netTxt) : null;
    const total = totalTxt ? money(totalTxt) : null;
    const checkIn = VN_MONTH(after(b, /(nhận phòng|check-in|ngày đến|arrival)/i, 60) ?? "") ?? VN_MONTH(s);
    const roomHint = (b.match(/(cozy|midnight|pop art|tropical|black ?& ?white|parisian|matcha)[^\n]{0,40}/i) ?? [])[0] ?? null;
    return { channel: "AGODA", kind, code, guestName, guests, payout: net, total, checkIn, roomHint };
  }
  if (f.includes("booking.com")) {
    const kind: Parsed["kind"] = /hủy|huỷ|cancel/i.test(s) ? "CANCEL" : /thay đổi|modif|changed/i.test(s) ? "CHANGE"
      : /đặt phòng mới|new booking|new reservation|xác nhận đặt phòng|booking confirmation/i.test(s) ? "NEW" : /tin nhắn|message|đã gửi cho bạn/i.test(s) ? "MESSAGE" : "OTHER";
    const code = (s.match(/\b(\d{9,11})\b/) ?? b.match(/(?:số đặt phòng|mã đặt phòng|booking number|reservation number|confirmation number)\D{0,20}(\d{9,11})/i) ?? [])[1] ?? null;
    const nameTxt = after(b, /(tên khách|tên của khách|guest name|tên người đặt|booker name)\s*:?\s*/i, 60);
    const guestName = nameTxt ? nameTxt.split(/\n|\s{2,}|\|/)[0].trim() || null : null;
    const guests = Number((b.match(/(\d{1,2})\s*(?:người lớn|khách|adults?|guests?)\b/i) ?? [])[1]) || null;
    const totalTxt = after(b, /(tổng giá|tổng tiền|total price|price|giá phòng)\s*:?\s*/i, 60);
    const total = totalTxt ? money(totalTxt) : money(b);
    const checkIn = VN_MONTH(s) ?? VN_MONTH(after(b, /(nhận phòng|check-in|ngày đến|arrival)/i, 60) ?? "");
    const roomHint = (b.match(/\(([^()]{4,60})\)/g) ?? []).map((x) => x.slice(1, -1)).find((x) => /cozy|midnight|pop art|tropical|black|white|parisian|matcha/i.test(x)) ?? null;
    return { channel: "BOOKING", kind, code, guestName, guests, total, checkIn, roomHint };
  }
  return { channel: "OTHER", kind: "OTHER" };
}

/** Áp email vào booking (nếu khớp). Trả bookingId hoặc null. */
async function apply(p: Parsed, replyTo: string | null): Promise<string | null> {
  if (p.channel === "OTHER") return null;
  let booking = p.code ? await prisma.booking.findFirst({ where: { confirmationCode: p.code, status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" } }) : null;
  if (!booking && (p.channel === "BOOKING" || p.channel === "AGODA") && p.checkIn) {
    const day = new Date(`${p.checkIn}T00:00:00.000Z`);
    const cands = await prisma.booking.findMany({ where: { source: p.channel, checkIn: day, status: { in: ["CONFIRMED", "PENDING"] } }, include: { room: true } });
    const hint = (p.roomHint ?? "").toLowerCase();
    booking = cands.find((c) => hint && hint.includes(c.room.name.toLowerCase().split(" ").slice(0, 2).join(" "))) ?? (cands.length === 1 ? cands[0] : null);
  }
  if (!booking) return null;
  const data: Record<string, unknown> = {};
  if (p.guestName && (PLACEHOLDER.test(booking.guestName) || booking.guestName === p.guestName)) data.guestName = p.guestName.slice(0, 80);
  if (p.code && !booking.confirmationCode) data.confirmationCode = p.code;
  const net = p.payout ?? (p.total && p.channel === "BOOKING" ? Math.round(p.total * 0.85) : p.total && p.channel === "AGODA" ? Math.round(p.total * 0.82) : null); // trừ hoa hồng ~15% / ~18%
  // Airbnb: tiền thật do script "Joystay - Email Airbnb to PMS" (11/11) + /api/finance/airbnb-payout lo (có chốt chặn số đêm) → ở đây KHÔNG ghi tiền Airbnb
  if (net && p.channel !== "AIRBNB" && booking.priceSource !== "MANUAL" && booking.priceSource !== "IMPORT") { data.totalPrice = net; data.priceSource = "EMAIL"; }
  if (Object.keys(data).length) await prisma.booking.update({ where: { id: booking.id }, data });
  if (p.guests || replyTo) {
    await prisma.stayPortal.upsert({
      where: { bookingId: booking.id },
      update: { ...(p.guests ? { guests: p.guests } : {}) },
      create: { bookingId: booking.id, token: newToken(), ...(p.guests ? { guests: p.guests } : {}) },
    });
  }
  return booking.id;
}

export async function ingestEmail(e: { messageId: string; from: string; replyTo?: string | null; subject: string; date?: string; text: string }) {
  const exists = await prisma.inboundEmail.findUnique({ where: { messageId: e.messageId } });
  if (exists) return { ok: true, duplicate: true, status: exists.status };
  const p = parseEmail(e.from, e.subject, e.text);
  const ignore = p.channel === "OTHER" || p.kind === "OTHER" || p.kind === "MESSAGE";
  const bookingId = ignore ? null : await apply(p, e.replyTo ?? null).catch(() => null);
  const row = await prisma.inboundEmail.create({
    data: {
      messageId: e.messageId, channel: p.channel, kind: p.kind, fromAddr: e.from.slice(0, 200), replyTo: e.replyTo?.slice(0, 200) ?? null,
      subject: e.subject.slice(0, 300), receivedAt: e.date ? new Date(e.date) : new Date(), body: e.text.slice(0, 20000),
      parsed: p as object, bookingId, status: ignore ? "IGNORED" : bookingId ? "MATCHED" : "UNMATCHED",
    },
  });
  return { ok: true, status: row.status, parsed: p, bookingId };
}

/** Thử khớp lại email chưa khớp (gọi sau mỗi lần đồng bộ iCal) */
export async function rematchEmails() {
  const list = await prisma.inboundEmail.findMany({ where: { status: "UNMATCHED", createdAt: { gte: new Date(Date.now() - 21 * 86_400_000) } }, take: 50 });
  let n = 0;
  for (const r of list) {
    const id = await apply(r.parsed as unknown as Parsed, r.replyTo).catch(() => null);
    if (id) { await prisma.inboundEmail.update({ where: { id: r.id }, data: { bookingId: id, status: "MATCHED" } }); n++; }
  }
  return n;
}

export function appsScript(token: string, base: string) {
  return `/**
 * Joystay PMS — chuyển email đặt phòng Airbnb / Booking.com / Agoda sang PMS (chạy trong Gmail của bạn).
 * Có nhiều hộp Gmail (vd 1 hộp nhận Airbnb, 1 hộp nhận Booking/Agoda) → cài CÙNG đoạn mã này vào MỖI tài khoản.
 * LUÔN tạo DỰ ÁN MỚI — KHÔNG dán đè vào dự án "Joystay - Email Airbnb to PMS" có sẵn (hàm setup xoá hết trigger của dự án đang dán).
 * Cách cài: dán toàn bộ đoạn này vào script.google.com → Lưu → chọn hàm "setup" → Chạy → Cho phép.
 */
const PMS_URL = '${base}/api/inbox/email';
const TOKEN = '${token}';
const QUERY = '(from:airbnb.com OR from:booking.com OR from:agoda.com OR from:agoda-messaging.com) newer_than:7d';

function sync() {
  const props = PropertiesService.getScriptProperties();
  const seen = JSON.parse(props.getProperty('seen') || '[]');
  const threads = GmailApp.search(QUERY, 0, 60);
  threads.forEach(function (t) {
    t.getMessages().forEach(function (m) {
      const id = m.getId();
      if (seen.indexOf(id) >= 0) return;
      const payload = {
        messageId: id, from: m.getFrom(), replyTo: m.getReplyTo(), subject: m.getSubject(),
        date: m.getDate().toISOString(), text: m.getPlainBody().slice(0, 20000)
      };
      const res = UrlFetchApp.fetch(PMS_URL, {
        method: 'post', contentType: 'application/json', payload: JSON.stringify(payload),
        headers: { 'x-inbox-token': TOKEN }, muteHttpExceptions: true
      });
      if (res.getResponseCode() < 300) seen.push(id);
    });
  });
  props.setProperty('seen', JSON.stringify(seen.slice(-800)));
}

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sync').timeBased().everyMinutes(10).create();
  sync();
}
`;
}

/** Đọc lại email đã lưu bằng bộ đọc mới nhất (vd sau khi thêm Agoda / chỉnh mẫu) — mọi email chưa MATCHED trong 45 ngày */
export async function reparseEmails() {
  const list = await prisma.inboundEmail.findMany({ where: { status: { not: "MATCHED" }, createdAt: { gte: new Date(Date.now() - 45 * 86_400_000) } }, take: 200 });
  let matched = 0;
  for (const r of list) {
    const p = parseEmail(r.fromAddr, r.subject, r.body);
    const ignore = p.channel === "OTHER" || p.kind === "OTHER" || p.kind === "MESSAGE";
    const bookingId = ignore ? null : await apply(p, r.replyTo).catch(() => null);
    if (bookingId) matched++;
    await prisma.inboundEmail.update({ where: { id: r.id }, data: { channel: p.channel, kind: p.kind, parsed: p as object, bookingId, status: ignore ? "IGNORED" : bookingId ? "MATCHED" : "UNMATCHED" } });
  }
  return { checked: list.length, matched };
}
