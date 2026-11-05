/**
 * Housekeeping — Ops 2.0 Module 1
 * Sinh lịch dọn tự động từ booking, checklist chuẩn, trạng thái phòng, tin nhắn Telegram.
 *
 * Quy ước ngày: mọi ngày (booking.checkIn/checkOut, task.date) là UTC midnight của ngày lịch
 * (iCal VALUE=DATE và form PMS đều lưu như vậy) → so sánh bằng YYYY-MM-DD.
 */
import { randomBytes } from "crypto";
import type { CleaningTask, Room, Cleaner } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readBlob } from "@/lib/blob";

export const DAY = 86_400_000;
export const DEFAULT_WINDOW = { start: "12:00", end: "14:00" }; // khung dọn chủ nhà đặt
export const LOOKAHEAD_DAYS = 14;

export const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Hôm nay theo giờ Việt Nam, dạng UTC midnight */
export function vnToday(now = new Date()): Date {
  const vn = new Date(now.getTime() + 7 * 3_600_000);
  return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()));
}

/** Giờ hiện tại theo VN, dạng "HH:MM" */
export function vnClock(now = new Date()): string {
  const vn = new Date(now.getTime() + 7 * 3_600_000);
  return vn.toISOString().slice(11, 16);
}

export function newToken() {
  return randomBytes(18).toString("base64url");
}

export const publicBaseUrl = () =>
  (process.env.PMS_PUBLIC_URL || "https://joystay-pms.vercel.app").replace(/\/$/, "");

export const taskLink = (t: Pick<CleaningTask, "token">) => `${publicBaseUrl()}/t/${t.token}`;

// ── Checklist chuẩn ────────────────────────────────────────────────────────────
export interface ChecklistItem {
  key: string;
  label: string;
  hint: string;
  done: boolean;
  photos: string[];
}

const BASE_ITEMS: Omit<ChecklistItem, "done" | "photos">[] = [
  { key: "bed",      label: "Giường",              hint: "Thay ga, vỏ gối, vỏ chăn mới. Không tóc, không vết ố. Chụp TOÀN BỘ giường." },
  { key: "bath",     label: "Phòng tắm",           hint: "Bồn cầu, lavabo, vòi sen, gương sạch; sàn khô; không tóc ở lỗ thoát nước. Chụp bồn cầu + vòi sen." },
  { key: "floor",    label: "Sàn & gầm giường",    hint: "Hút/lau sàn, gầm giường, góc tủ. Chụp GẦM GIƯỜNG." },
  { key: "kitchen",  label: "Bếp & tủ lạnh",       hint: "Rửa chén, lau bếp, dọn sạch tủ lạnh (bỏ đồ khách để lại). Chụp bếp + bên trong tủ lạnh." },
  { key: "fridge",   label: "Tủ lạnh mini",        hint: "Dọn sạch, bỏ đồ khách để lại. Chụp bên trong tủ lạnh." },
  { key: "amenity",  label: "Đồ dùng cho khách",   hint: "2 khăn tắm, giấy vệ sinh, dầu gội, sữa tắm, nước uống, móc treo. Chụp khu đồ dùng." },
  { key: "pest",     label: "Kiểm tra côn trùng",  hint: "Soi góc tủ, gầm bồn rửa, bẫy dính. Thấy gián/kiến/muỗi → ghi vào ô Sự cố. Chụp bẫy dính / góc tủ." },
  { key: "final",    label: "Tổng thể & rác",      hint: "Đổ rác, thay túi. Tắt máy lạnh, đèn, TV. Đóng cửa sổ. Chụp TOÀN PHÒNG từ cửa ra vào." },
];

/** Phòng >= 25 m² có bếp; phòng 15 m² chỉ có tủ lạnh mini */
export function buildChecklist(room: Pick<Room, "size">): ChecklistItem[] {
  const hasKitchen = room.size >= 25;
  return BASE_ITEMS
    .filter((i) => (hasKitchen ? i.key !== "fridge" : i.key !== "kitchen"))
    .map((i) => ({ ...i, done: false, photos: [] }));
}

export function readChecklist(t: Pick<CleaningTask, "checklist">): ChecklistItem[] {
  return Array.isArray(t.checklist) ? (t.checklist as unknown as ChecklistItem[]) : [];
}

export const TYPE_LABEL: Record<string, string> = {
  TURNOVER: "Dọn sau trả phòng",
  MIDSTAY:  "Dọn giữa kỳ",
  DEEP:     "Tổng vệ sinh",
};

export const STATUS_LABEL: Record<string, string> = {
  TODO:        "Chưa giao",
  ASSIGNED:    "Đã giao",
  IN_PROGRESS: "Đang dọn",
  DONE:        "Chờ duyệt",
  APPROVED:    "Sẵn sàng",
  REJECTED:    "Làm lại",
  SKIPPED:     "Bỏ qua",
};

/** Nhóm phòng vật lý: cùng roomNumber (vd 302 có 2 listing) = 1 phòng */
function groupKey(r: Pick<Room, "id" | "roomNumber">) {
  return r.roomNumber?.trim() || r.id;
}

export function roomLabel(r: Pick<Room, "name" | "roomNumber">) {
  return r.roomNumber ? `${r.roomNumber} · ${r.name}` : r.name;
}

// ── Sinh lịch dọn ──────────────────────────────────────────────────────────────
export async function generateCleaningTasks(days = LOOKAHEAD_DAYS) {
  const start = vnToday();
  const end = new Date(start.getTime() + days * DAY);

  const rooms = await prisma.room.findMany({ orderBy: { sortOrder: "asc" } });
  const repOf = new Map<string, Room>(); // groupKey → phòng đại diện
  for (const r of rooms) if (!repOf.has(groupKey(r))) repOf.set(groupKey(r), r);
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  const bookings = await prisma.booking.findMany({
    where: {
      status: "CONFIRMED",
      OR: [
        { checkOut: { gte: start, lt: end } },
        { checkIn: { gte: start, lt: end } },
      ],
    },
    orderBy: { checkIn: "asc" },
  });

  type Slot = { room: Room; date: Date; out?: (typeof bookings)[number]; in?: (typeof bookings)[number] };
  const slots = new Map<string, Slot>();
  const arrivals = new Map<string, (typeof bookings)[number]>();

  for (const b of bookings) {
    const room = roomById.get(b.roomId);
    if (!room) continue;
    const g = groupKey(room);
    if (b.checkIn >= start && b.checkIn < end) arrivals.set(`${g}|${dayKey(b.checkIn)}`, b);
    if (b.checkOut >= start && b.checkOut < end) {
      const k = `${g}|${dayKey(b.checkOut)}`;
      if (!slots.has(k)) slots.set(k, { room: repOf.get(g)!, date: new Date(`${dayKey(b.checkOut)}T00:00:00.000Z`), out: b });
    }
  }
  for (const [k, s] of slots) s.in = arrivals.get(k);

  let created = 0, updated = 0, skipped = 0;
  const wanted = new Set<string>();

  for (const s of slots.values()) {
    wanted.add(`${s.room.id}|${dayKey(s.date)}`);
    const data = {
      priority: s.in ? "URGENT" : "NORMAL",
      bookingOutId: s.out?.id ?? null,
      bookingInId: s.in?.id ?? null,
      guestOut: s.out?.guestName ?? null,
      guestIn: s.in?.guestName ?? null,
    };
    const existing = await prisma.cleaningTask.findUnique({
      where: { roomId_date_type: { roomId: s.room.id, date: s.date, type: "TURNOVER" } },
    });
    if (!existing) {
      await prisma.cleaningTask.create({
        data: {
          ...data,
          roomId: s.room.id,
          date: s.date,
          type: "TURNOVER",
          token: newToken(),
          checklist: buildChecklist(s.room) as unknown as object,
          windowStart: DEFAULT_WINDOW.start,
          windowEnd: DEFAULT_WINDOW.end,
        },
      });
      created++;
    } else if (existing.autoGenerated) {
      const revive = existing.status === "SKIPPED" && existing.note === AUTO_SKIP_NOTE;
      const changed =
        revive ||
        existing.priority !== data.priority ||
        existing.bookingOutId !== data.bookingOutId ||
        existing.bookingInId !== data.bookingInId ||
        existing.guestIn !== data.guestIn ||
        existing.guestOut !== data.guestOut;
      if (changed) {
        await prisma.cleaningTask.update({
          where: { id: existing.id },
          data: {
            ...data,
            ...(revive && { status: existing.cleanerId ? "ASSIGNED" : "TODO", note: null }),
          },
        });
        updated++;
      }
    }
  }

  // Việc tự sinh nhưng booking đã huỷ / đổi ngày → bỏ qua (chỉ khi chưa bắt đầu dọn)
  const orphans = await prisma.cleaningTask.findMany({
    where: { autoGenerated: true, type: "TURNOVER", date: { gte: start, lt: end }, status: { in: ["TODO", "ASSIGNED"] } },
    select: { id: true, roomId: true, date: true },
  });
  const gone = orphans.filter((t) => !wanted.has(`${t.roomId}|${dayKey(t.date)}`)).map((t) => t.id);
  if (gone.length) {
    await prisma.cleaningTask.updateMany({ where: { id: { in: gone } }, data: { status: "SKIPPED", note: AUTO_SKIP_NOTE } });
    skipped = gone.length;
  }

  return { created, updated, skipped };
}

export const AUTO_SKIP_NOTE = "Tự bỏ: booking đã huỷ hoặc đổi ngày";

// ── Trạng thái phòng hôm nay ──────────────────────────────────────────────────
export type RoomState = "OCCUPIED" | "DIRTY" | "CLEANING" | "CHECK" | "READY" | "VACANT";
export const ROOM_STATE_LABEL: Record<RoomState, string> = {
  OCCUPIED: "Có khách",
  DIRTY:    "Chưa dọn",
  CLEANING: "Đang dọn",
  CHECK:    "Chờ duyệt",
  READY:    "Sẵn sàng",
  VACANT:   "Trống",
};

export async function roomBoard() {
  const today = vnToday();
  const tomorrow = new Date(today.getTime() + DAY);
  const rooms = await prisma.room.findMany({ orderBy: { sortOrder: "asc" } });
  const reps = new Map<string, Room>();
  for (const r of rooms) if (!reps.has(groupKey(r))) reps.set(groupKey(r), r);

  const [staying, tasks] = await Promise.all([
    prisma.booking.findMany({
      where: { status: "CONFIRMED", checkIn: { lte: today }, checkOut: { gt: today } },
      select: { roomId: true, guestName: true, checkOut: true },
    }),
    prisma.cleaningTask.findMany({ where: { date: { gte: today, lt: tomorrow }, status: { not: "SKIPPED" } } }),
  ]);
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  return [...reps.values()].map((room) => {
    const g = groupKey(room);
    const stay = staying.find((b) => groupKey(roomById.get(b.roomId)!) === g);
    const task = tasks.find((t) => groupKey(roomById.get(t.roomId)!) === g);
    let state: RoomState = "VACANT";
    if (task) {
      state =
        task.status === "APPROVED" ? "READY"
        : task.status === "DONE" ? "CHECK"
        : task.status === "IN_PROGRESS" ? "CLEANING"
        : "DIRTY";
    } else if (stay) state = "OCCUPIED";
    return { roomId: room.id, label: roomLabel(room), state, guest: stay?.guestName ?? null, taskId: task?.id ?? null };
  });
}

// ── Tin nhắn ──────────────────────────────────────────────────────────────────
type TaskFull = CleaningTask & { room: Room; cleaner: Cleaner | null };

const ddmm = (d: Date) => `${d.toISOString().slice(8, 10)}/${d.toISOString().slice(5, 7)}`;
const WEEKDAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

export function taskLine(t: TaskFull) {
  const urgent = t.priority === "URGENT" ? "🔴 GẤP (có khách vào 15:00)" : "";
  return `${WEEKDAY[t.date.getUTCDay()]} ${ddmm(t.date)} · ${roomLabel(t.room)} · ${TYPE_LABEL[t.type] ?? t.type} ${t.windowStart}–${t.windowEnd} ${urgent}`.trim();
}

/** Tin nhắn soạn sẵn để chủ dán vào Zalo gửi lao công */
export function cleanerMessage(t: TaskFull) {
  const who = t.cleaner?.name ? `Chào ${t.cleaner.name}, ` : "";
  return [
    `${who}Joystay nhờ dọn phòng:`,
    `• ${taskLine(t)}`,
    `• Địa chỉ: 382/23 Nguyễn Thị Minh Khai, Q3 (lối vào chung với cửa hàng PORO)`,
    `• Mở link, làm theo từng mục và CHỤP ẢNH từng mục trước khi bấm Hoàn thành:`,
    taskLink(t),
  ].join("\n");
}

export async function loadTasks(from: Date, to: Date) {
  return prisma.cleaningTask.findMany({
    where: { date: { gte: from, lt: to } },
    include: { room: true, cleaner: true },
    orderBy: [{ date: "asc" }, { priority: "desc" }],
  });
}

/** Nội dung cho JoyBot gửi Telegram: weekly | daily | alert */
export async function buildDigest(kind: "weekly" | "daily" | "alert") {
  await generateCleaningTasks();
  const today = vnToday();
  const from = kind === "weekly" ? new Date(today.getTime() + DAY) : today;
  const to = new Date(from.getTime() + (kind === "weekly" ? 7 : 1) * DAY);
  const all = (await loadTasks(from, to)).filter((t) => t.status !== "SKIPPED");
  const tasks = kind === "alert" ? all.filter((t) => !["DONE", "APPROVED"].includes(t.status)) : all;
  const cleaners = await prisma.cleaner.findMany({ where: { active: true }, orderBy: { createdAt: "asc" } });

  const title =
    kind === "weekly" ? `🧹 Lịch dọn tuần tới (${ddmm(from)}–${ddmm(new Date(to.getTime() - DAY))}): ${tasks.length} việc`
    : kind === "daily" ? `🧹 Hôm nay ${ddmm(today)}: ${tasks.length} việc dọn${tasks.some((t) => t.priority === "URGENT") ? " — có việc GẤP" : ""}`
    : `⚠️ ${vnClock()} — ${tasks.length} phòng CHƯA sẵn sàng cho hôm nay`;

  const lines = tasks.map((t) => {
    const who = t.cleaner ? `👤 ${t.cleaner.name}` : "👤 chưa giao";
    return `• ${taskLine(t)}\n   ${STATUS_LABEL[t.status] ?? t.status} · ${who}`;
  });

  return {
    kind,
    empty: tasks.length === 0,
    text: [title, ...lines, "", `Xem & giao việc: ${publicBaseUrl()}/housekeeping`].join("\n"),
    tasks: tasks.map((t) => ({
      id: t.id,
      label: `${ddmm(t.date)} ${t.room.roomNumber ?? t.room.name}`,
      assigned: Boolean(t.cleanerId),
      status: t.status,
    })),
    cleaners: cleaners.map((c) => ({ id: c.id, name: c.name })),
  };
}

// ── Telegram (tuỳ chọn): báo chủ khi lao công nộp việc ─────────────────────────
// Dùng CHUNG bot với JoyBot (TELEGRAM_BOT_TOKEN = JOYBOT_TELEGRAM_TOKEN). Nút bấm
// "hka:<id>" (duyệt) / "hkr:<id>" (làm lại) do JoyBot xử lý.
export async function notifyOwnerTaskDone(t: TaskFull) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  const api = (m: string) => `https://api.telegram.org/bot${token}/${m}`;
  const photos = readChecklist(t).flatMap((i) => i.photos.slice(0, 1)).slice(0, 10);
  try {
    if (photos.length >= 2) {
      const fd = new FormData();
      fd.append("chat_id", String(chatId));
      const media: { type: "photo"; media: string }[] = [];
      for (const [i, url] of photos.entries()) {
        const b = await readBlob(url);
        if (!b) continue;
        fd.append(`p${i}`, b, `p${i}.jpg`);
        media.push({ type: "photo", media: `attach://p${i}` });
      }
      if (media.length >= 2) {
        fd.append("media", JSON.stringify(media));
        await fetch(api("sendMediaGroup"), { method: "POST", body: fd });
      }
    }
    const issue = t.hasIssue ? `\n⚠️ SỰ CỐ: ${t.issueNote ?? "(xem ảnh)"}` : "";
    await fetch(api("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: `✅ ${t.cleaner?.name ?? "Lao công"} đã dọn xong\n${taskLine(t)}${issue}\n\nXem đủ ảnh: ${publicBaseUrl()}/housekeeping?task=${t.id}`,
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[
            { text: "👍 Duyệt — phòng sẵn sàng", callback_data: `hka:${t.id}` },
            { text: "↩️ Làm lại", callback_data: `hkr:${t.id}` },
          ]],
        },
      }),
    });
  } catch (e) {
    console.error("[housekeeping] Telegram lỗi:", e);
  }
}
