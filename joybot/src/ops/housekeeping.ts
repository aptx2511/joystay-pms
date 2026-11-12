/**
 * Ops 2.0 — Module 1: lịch dọn phòng qua Telegram
 *  - Chủ nhật 20:00: lịch dọn tuần tới, mỗi việc có nút giao cho từng lao công
 *  - 07:30 mỗi ngày: việc dọn hôm nay
 *  - 14:30: cảnh báo phòng chưa sẵn sàng (chỉ gửi khi có)
 *  - Nút: hkg:<taskId>:<cleanerId> (giao) · hka:<taskId> (duyệt) · hkr:<taskId> (làm lại) · hkn (nhãn)
 * Dữ liệu nằm ở PMS (/api/housekeeping/...). Bot chỉ hẹn giờ + chuyển nút bấm.
 */
import axios from "axios";
import { config } from "../config";
import { store } from "../store";
import { notifyOwner, answerCallback, editMessage, Button } from "../notify/telegram";

const pms = axios.create({
  baseURL: config.pms.baseUrl,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
    ...(config.pms.apiKey ? { "x-api-key": config.pms.apiKey } : {}),
    ...(config.pms.cronSecret ? { Authorization: `Bearer ${config.pms.cronSecret}` } : {}),
  },
});

type Kind = "weekly" | "daily" | "alert";
interface Digest {
  kind: Kind;
  empty: boolean;
  text: string;
  tasks: { id: string; label: string; assigned: boolean; status: string }[];
  cleaners: { id: string; name: string }[];
}

const SCHEDULE = {
  weeklyDay: Number(process.env.HK_WEEKLY_DAY ?? 0),   // 0 = Chủ nhật
  weeklyTime: process.env.HK_WEEKLY_TIME ?? "20:00",
  dailyTime: process.env.HK_DAILY_TIME ?? "07:30",
  alertTime: process.env.HK_ALERT_TIME ?? "14:30",
};

function vnNow() {
  const vn = new Date(Date.now() + 7 * 3_600_000);
  return { date: vn.toISOString().slice(0, 10), time: vn.toISOString().slice(11, 16), dow: vn.getUTCDay() };
}

export async function sendDigest(kind: Kind, force = false): Promise<boolean> {
  try {
    const { data } = await pms.get<Digest>("/housekeeping/digest", { params: { kind } });
    if (data.empty && kind === "alert" && !force) return true; // không có gì để cảnh báo
    const rows: Button[][] = [];
    if (kind !== "alert" && data.cleaners.length) {
      for (const t of data.tasks.filter((x) => !x.assigned && x.status === "TODO").slice(0, 10)) {
        rows.push([
          { text: `📍 ${t.label}`, data: "hkn" },
          ...data.cleaners.slice(0, 3).map((c) => ({ text: c.name, data: `hkg:${t.id}:${c.id}` })),
        ]);
      }
    }
    await notifyOwner(
      data.text + (rows.length ? "\n\nBấm tên để giao việc (bot sẽ gửi lại tin soạn sẵn để anh dán vào Zalo):" : ""),
      rows.length ? rows : undefined
    );
    return true;
  } catch (e) {
    console.warn(`[Housekeeping] digest ${kind} lỗi:`, (e as Error).message);
    return false;
  }
}

async function runOnce(kind: Kind, date: string) {
  const key = `hk_sent:${kind}:${date}`;
  if (await store.getKv(key).catch(() => null)) return;
  if (await sendDigest(kind)) await store.setKv(key, new Date().toISOString()).catch(() => {});
}

/** Gọi mỗi phút từ index.ts */
export async function housekeepingTick() {
  const { date, time, dow } = vnNow();
  if (dow === SCHEDULE.weeklyDay && time === SCHEDULE.weeklyTime) await runOnce("weekly", date);
  if (time === SCHEDULE.dailyTime) await runOnce("daily", date);
  if (time === SCHEDULE.alertTime) await runOnce("alert", date);
}

/** Xử lý nút bấm hk*. Trả true nếu đã xử lý. */
export async function handleHousekeepingCallback(cq: {
  id: string; data?: string; message?: { chat: { id: number }; message_id: number; text?: string };
}): Promise<boolean> {
  const [action, taskId, cleanerId] = String(cq.data ?? "").split(":");
  if (!action?.startsWith("hk")) return false;
  if (action === "hkn") {
    await answerCallback(cq.id, "Bấm vào tên người để giao việc");
    return true;
  }
  try {
    if (action === "hkg") {
      const { data } = await pms.patch(`/housekeeping/${taskId}`, { cleanerId });
      await answerCallback(cq.id, `Đã giao cho ${data.cleaner?.name ?? "lao công"}`);
      await notifyOwner(`👤 Đã giao: ${data.cleaner?.name}\nDán tin dưới đây vào Zalo cho ${data.cleaner?.name}${data.cleaner?.phone ? ` (${data.cleaner.phone})` : ""}:`);
      await notifyOwner(data.message);
      return true;
    }
    if (action === "hka") {
      await pms.patch(`/housekeeping/${taskId}`, { action: "approve" });
      await answerCallback(cq.id, "Đã duyệt — phòng sẵn sàng");
      if (cq.message) await editMessage(cq.message.chat.id, cq.message.message_id, `${cq.message.text ?? ""}\n\n→ 👍 Đã duyệt, phòng sẵn sàng`);
      return true;
    }
    if (action === "hkr") {
      const { data } = await pms.patch(`/housekeeping/${taskId}`, { action: "reject" });
      await answerCallback(cq.id, "Đã yêu cầu làm lại");
      if (cq.message) await editMessage(cq.message.chat.id, cq.message.message_id, `${cq.message.text ?? ""}\n\n→ ↩️ Yêu cầu làm lại`);
      await notifyOwner(`Dán vào Zalo cho ${data.cleaner?.name ?? "lao công"}:\n\nPhòng cần làm lại: ${data.rejectReason}\n${data.link}`);
      return true;
    }
  } catch (e) {
    const msg = (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? (e as Error).message;
    await answerCallback(cq.id, `Lỗi: ${msg}`.slice(0, 190));
    return true;
  }
  return false;
}
