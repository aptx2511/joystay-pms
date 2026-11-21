/** Bản tin phòng trống + phương án đề xuất — gửi Telegram mỗi ngày (mặc định 08:00 giờ VN) */
import axios from "axios";
import { config } from "../config";
import { store } from "../store";
import { notifyOwner } from "../notify/telegram";

const pms = axios.create({
  baseURL: config.pms.baseUrl,
  timeout: 60000,
  headers: {
    ...(config.pms.apiKey ? { "x-api-key": config.pms.apiKey } : {}),
    ...(config.pms.cronSecret ? { Authorization: `Bearer ${config.pms.cronSecret}` } : {}),
  },
});
const TIME = process.env.VACANCY_REPORT_TIME ?? "08:00";
const EVENING_TIME = process.env.VACANCY_EVENING_TIME ?? "18:00"; // nhắc đêm trống 48 giờ tới

export async function sendVacancyReport(): Promise<boolean> {
  try {
    const { data } = await pms.get<{ text: string }>("/vacancy/digest");
    await notifyOwner(data.text);
    return true;
  } catch (e) {
    console.warn("[Vacancy] lỗi:", (e as Error).message);
    return false;
  }
}

export async function sendEveningReminder(): Promise<boolean> {
  try {
    const { data } = await pms.get<{ text: string }>("/vacancy/digest", { params: { mode: "evening" } });
    if (data.text) await notifyOwner(data.text);
    return true;
  } catch (e) {
    console.warn("[Vacancy] nhắc tối lỗi:", (e as Error).message);
    return false;
  }
}

/** Gọi mỗi phút từ index.ts */
export async function vacancyTick() {
  const vn = new Date(Date.now() + 7 * 3_600_000).toISOString();
  const date = vn.slice(0, 10), time = vn.slice(11, 16);
  if (time === EVENING_TIME) {
    const ek = `vacancy_evening:${date}`;
    if (!(await store.getKv(ek).catch(() => null)) && (await sendEveningReminder())) await store.setKv(ek, new Date().toISOString()).catch(() => {});
    return;
  }
  if (time !== TIME) return;
  const key = `vacancy_sent:${date}`;
  if (await store.getKv(key).catch(() => null)) return;
  if (await sendVacancyReport()) await store.setKv(key, new Date().toISOString()).catch(() => {});
}

/** Báo cáo doanh thu tuần (Sổ OTA + trực tiếp) — thứ Hai, mặc định 09:30 giờ VN (sau phiên nhập Sổ OTA buổi sáng) */
const FINANCE_WEEKLY_TIME = process.env.FINANCE_WEEKLY_TIME ?? "09:30";
export async function financeWeeklyTick() {
  const vnNow = new Date(Date.now() + 7 * 3_600_000);
  if (vnNow.getUTCDay() !== 1 || vnNow.toISOString().slice(11, 16) !== FINANCE_WEEKLY_TIME) return;
  const key = `finance_weekly:${vnNow.toISOString().slice(0, 10)}`;
  if (await store.getKv(key).catch(() => null)) return;
  try {
    const { data } = await pms.get<{ text: string }>("/finance/weekly");
    if (data.text) await notifyOwner(data.text);
    await store.setKv(key, new Date().toISOString()).catch(() => {});
  } catch (e) {
    console.warn("[Finance] báo cáo tuần lỗi:", (e as Error).message);
  }
}

/** Cảnh báo khi cầu lịch PMS → Google → Agoda (Apps Script) ngừng chạy quá 3 tiếng. Gọi mỗi giờ trong cửa sổ PMS. */
export async function gcalBridgeTick() {
  try {
    const { data } = await pms.get<{ seenAt: string | null; stale: boolean }>("/settings/agoda-gcal");
    if (!data.seenAt || !data.stale) return;
    const key = `gcal_bridge_alert:${data.seenAt}`;
    if (await store.getKv(key).catch(() => null)) return;
    await notifyOwner(
      `⚠️ Lịch PMS → Agoda (Apps Script Google) chưa chạy từ ${new Date(data.seenAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}.\n` +
        "Agoda có thể không biết booking trực tiếp / Booking.com mới → nguy cơ trùng phòng. Mở script.google.com → \"Joystay – Lịch PMS cho Agoda\" → Executions để xem lỗi.",
    );
    await store.setKv(key, new Date().toISOString()).catch(() => {});
  } catch (e) {
    console.warn("[GcalBridge] kiểm tra lỗi:", (e as Error).message);
  }
}
