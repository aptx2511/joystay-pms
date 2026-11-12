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

/** Gọi mỗi phút từ index.ts */
export async function vacancyTick() {
  const vn = new Date(Date.now() + 7 * 3_600_000).toISOString();
  const date = vn.slice(0, 10), time = vn.slice(11, 16);
  if (time !== TIME) return;
  const key = `vacancy_sent:${date}`;
  if (await store.getKv(key).catch(() => null)) return;
  if (await sendVacancyReport()) await store.setKv(key, new Date().toISOString()).catch(() => {});
}
