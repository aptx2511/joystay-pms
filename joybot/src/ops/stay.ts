/**
 * Ops 2.0 — Module 3: cổng khách
 *  - Mỗi 15 phút: khách nhận phòng hôm nay/ngày mai chưa có mã → tự cấp mã TTLock (cửa nhà + cổng + phòng,
 *    hiệu lực 12:00 ngày đến → 12:00 ngày đi) và đẩy về PMS. Khách THẤY mã trên cổng khách từ 10:00 hôm trước; Airbnb tự gửi "Mã cửa đề xuất" (= 4 số cuối ĐT) trong tin ②.
 *  - 07:30 và 20:00 (giờ VN): bản tin khách đến hôm nay (giấy tờ / mã / đã xem mã / đã khai báo).
 * TTLock chưa cấu hình → bỏ qua cấp mã (chủ nhập mã tay ở trang Lưu trú của PMS).
 */
import axios from "axios";
import { config } from "../config";
import { store } from "../store";
import { notifyOwner } from "../notify/telegram";
import { issueDoorCodes, reconcileBookingCodes } from "../locks/doors";
import { listGateways, ttlockConfigured } from "../locks/ttlock";

const pms = axios.create({
  baseURL: config.pms.baseUrl,
  timeout: 30000,
  headers: {
    "Content-Type": "application/json",
    ...(config.pms.apiKey ? { "x-api-key": config.pms.apiKey } : {}),
    ...(config.pms.cronSecret ? { Authorization: `Bearer ${config.pms.cronSecret}` } : {}),
  },
});

const DIGEST_TIMES = (process.env.STAY_DIGEST_TIMES ?? "07:30,20:00").split(",").map((s) => s.trim());

interface Pending {
  bookingId: string; code: string; roomNo: string | null; roomName: string; guestName: string; checkIn: string; checkOut: string;
  phoneLast4?: string | null; source?: string;
}

const FLOOR: Record<string, string> = { "1": "ground floor / tầng trệt", "2": "1st floor / lầu 1", "3": "2nd floor / lầu 2", "4": "3rd floor / lầu 3" };
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
/** Tin gửi khách kênh không tự gửi mã được (Booking.com, Agoda…): chủ copy dán vào chat của kênh */
function guestCodeMessage(p: Pending, code: string) {
  const fl = FLOOR[(p.roomNo ?? "")[0]] ?? "";
  return [
    `Hi! Your door code for Joystay, room ${p.roomNo}${fl ? ` (${fl.split(" / ")[0]}, stairs only)` : ""}: ${code}`,
    `It opens the main door, the inner gate and your room door, valid from 12:00 ${ddmm(p.checkIn)} to 12:00 ${ddmm(p.checkOut)}. Check-in from 15:00.`,
    `Address: 382/23 Nguyễn Thị Minh Khai, Ward 5, District 3, HCMC — https://maps.app.goo.gl/1dreN6KLAHZEqRuc6`,
    `To unlock: touch the keypad to wake it, enter ${code} then press #.`,
    `Payment: cash or bank transfer only (card payment is not available). Hotline/WhatsApp: 0854 777 730.`,
    ``,
    `Mã cửa phòng ${p.roomNo}${fl ? ` (${fl.split(" / ")[1]}, chỉ có thang bộ)` : ""}: ${code} — mở cửa nhà, cổng trong và cửa phòng, hiệu lực 12:00 ${ddmm(p.checkIn)} → 12:00 ${ddmm(p.checkOut)}. Nhận phòng từ 15:00. Thanh toán tiền mặt hoặc chuyển khoản (không quẹt thẻ).`,
  ].join("\n");
}

let running = 0; // thời điểm bắt đầu lượt đang chạy (0 = không chạy)
const ALERT_EVERY_MS = Number(process.env.CODES_ALERT_EVERY_HOURS ?? "3") * 3_600_000;

export async function issuePendingCodes() {
  if (!ttlockConfigured()) return;
  // chống kẹt: lượt trước treo > 10 phút thì bỏ qua cờ
  if (running && Date.now() - running < 10 * 60_000) return;
  running = Date.now();
  try {
    const { data } = await pms.get<{ items: Pending[] }>("/stay/bot", { params: { kind: "pending-codes" } });
    if (data.items.length) console.log(`[Stay] cần cấp mã: ${data.items.map((p) => `${p.roomNo} ${p.code} ${p.checkIn} (4 số ${p.phoneLast4 ?? "—"})`).join(" · ")}`);
    for (const p of data.items) {
      const failKey = `codes_fail:${p.bookingId}`;
      const r = await issueDoorCodes({
        code: p.code, roomNo: p.roomNo ?? undefined, roomName: p.roomName,
        guestName: p.guestName, checkIn: p.checkIn, checkOut: p.checkOut, preferredCode: p.phoneLast4,
      }).catch((e: Error) => ({ ok: false as const, reason: e.message }));

      console.log(`[Stay] ${p.roomNo} ${p.code}: ${r.ok ? `OK ${r.codes.map((c) => c.passcode).join("/")}` : `LỖI ${r.reason}`}`);
      if (r.ok) {
        await store.setKv(failKey, "").catch(() => {});
        await pms.patch(`/stay/admin/${p.bookingId}`, {
          doorCodes: r.codes.map((c) => ({ door: c.door, code: c.passcode })),
          source: "TTLOCK",
        });
        await notifyOwner(`🔑 Đã tự cấp mã TTLock cho ${p.guestName} · phòng ${p.roomNo} · ${p.checkIn}→${p.checkOut}\n${r.note}\n${r.codes.map((c) => `• ${c.door}: ${c.passcode}${c.custom ? "" : " (tự sinh)"}`).join("\n")}\n${p.source === "AIRBNB" || p.phoneLast4
          ? "Airbnb gửi mã cho khách lúc 10:00 hôm trước (tin ②); trang lưu trú cũng hiện mã từ 10:00 hôm trước."
          : `⚠️ Kênh ${p.source ?? ""} KHÔNG tự gửi mã — copy tin dưới đây dán vào chat ${p.source === "BOOKING" ? "Booking.com" : p.source === "AGODA" ? "Agoda" : "với khách"}:\n\n${guestCodeMessage(p, r.sharedCode ?? r.codes[0]?.passcode ?? "")}`}`);
      } else {
        // nhắc lại mỗi CODES_ALERT_EVERY_HOURS (mặc định 3h) cho tới khi cấp được — khách đã/sẽ nhận mã từ Airbnb
        const last = await store.getKv(failKey).catch(() => null);
        if (!last || Date.now() - Date.parse(last) >= ALERT_EVERY_MS) {
          await store.setKv(failKey, new Date().toISOString()).catch(() => {});
          const pin = p.phoneLast4 ? `Airbnb gửi khách mã ${p.phoneLast4} (4 số cuối ĐT) — mã này CHƯA có trên khoá!` : "Khách chưa có mã.";
          await notifyOwner(`🚨 CHƯA CẤP ĐƯỢC MÃ CỬA · phòng ${p.roomNo} · ${p.code} · nhận ${p.checkIn}\n${pin}\nLý do: ${r.reason}\n→ Cách xử lý nhanh: mở app TTLock tại nhà (Bluetooth), tạo mã ${p.phoneLast4 ?? "4 số"} cho Cửa nhà, Cổng trong, Phòng ${p.roomNo} (từ 12:00 ${p.checkIn} → 12:00 ${p.checkOut}); rồi nhập mã ở PMS → Lưu trú. Bot nhắc lại mỗi ${ALERT_EVERY_MS / 3_600_000}h tới khi xong.`);
        }
      }
    }
  } catch (e) {
    console.warn("[Stay] cấp mã lỗi:", (e as Error).message);
  } finally {
    running = 0;
  }
}

/** Kiểm tra bộ phát (gateway) TTLock mỗi giờ: mất mạng → bot KHÔNG cài được mã từ xa → báo chủ (tối đa 6h/lần) */
export async function checkGateways() {
  if (!ttlockConfigured()) return;
  try {
    const gws = await listGateways();
    const off = gws.filter((g) => g.isOnline === 0);
    const key = "gateway_offline_alert";
    if (!off.length) {
      if (await store.getKv(key).catch(() => null)) {
        await store.setKv(key, "").catch(() => {});
        await notifyOwner(`✅ Bộ phát TTLock đã online lại — bot cài mã cửa từ xa bình thường.`);
      }
      return;
    }
    console.warn(`[Stay] bộ phát offline: ${off.map((g) => g.gatewayName).join(", ")}`);
    const last = await store.getKv(key).catch(() => null);
    if (!last || Date.now() - Date.parse(last) >= 6 * 3_600_000) {
      await store.setKv(key, new Date().toISOString()).catch(() => {});
      await notifyOwner(`📡 Bộ phát TTLock MẤT MẠNG: ${off.map((g) => g.gatewayName).join(", ")}\nTrong lúc này bot KHÔNG cài được mã cửa cho khách mới (mã Airbnb gửi khách sẽ không mở được cửa).\n→ Kiểm tra nguồn điện & wifi bộ phát (rút điện 10 giây rồi cắm lại).`);
    }
  } catch (e) {
    console.warn("[Stay] kiểm tra bộ phát lỗi:", (e as Error).message);
  }
}

export async function sendArrivalsDigest(force = false) {
  try {
    const { data } = await pms.get<{ empty: boolean; text: string }>("/stay/bot", { params: { kind: "arrivals" } });
    if (data.empty && !force) return true;
    await notifyOwner(data.text);
    return true;
  } catch (e) {
    console.warn("[Stay] bản tin khách đến lỗi:", (e as Error).message);
    return false;
  }
}

interface AuditItem {
  bookingId: string; code: string; altCode: string; roomNo: string | null; guestName: string; status: string; active: boolean;
  checkIn: string; checkOut: string; codes: { door: string; code: string }[]; sharedWithActive: boolean;
}

/** Mỗi giờ: booking HUỶ → xoá mã trên khoá; booking ĐỔI NGÀY → sửa hạn mã cho khớp. Báo chủ qua Telegram. */
export async function auditCodes() {
  if (!ttlockConfigured()) return;
  try {
    const { data } = await pms.get<{ items: AuditItem[] }>("/stay/bot", { params: { kind: "codes-audit" } });
    for (const it of data.items) {
      const codes = [...new Set(it.codes.map((c) => c.code))];
      const names = [it.code, it.altCode];
      if (!it.active) {
        // huỷ: mã trùng với booking khác còn hiệu lực ở cùng phòng → chỉ gỡ khỏi PMS, không xoá trên khoá
        const r = it.sharedWithActive ? { removed: [], changed: [], errors: [] as string[] }
          : await reconcileBookingCodes({ codes, names, roomNo: it.roomNo, checkIn: it.checkIn, checkOut: it.checkOut, remove: true });
        if (!r.errors.length) await pms.patch(`/stay/admin/${it.bookingId}`, { doorCodes: [], source: "MANUAL" }).catch(() => {});
        console.log(`[Codes] huỷ ${it.roomNo} ${it.code}: xoá ${r.removed.length}${r.errors.length ? ` · lỗi ${r.errors.join("; ")}` : ""}`);
        if (r.removed.length) await notifyOwner(`🗑 Booking ${it.code} (${it.guestName}, phòng ${it.roomNo}, ${it.checkIn}→${it.checkOut}) đã huỷ → bot đã XOÁ mã ${codes.join("/")} trên: ${r.removed.join(", ")}`);
        if (r.errors.length) await notifyOwner(`⚠️ Không xoá được mã ${codes.join("/")} của booking huỷ ${it.code} (phòng ${it.roomNo}): ${r.errors.join("; ")}\n→ Xoá tay trong app TTLock; bot thử lại mỗi giờ.`);
      } else {
        const r = await reconcileBookingCodes({ codes, names, roomNo: it.roomNo, checkIn: it.checkIn, checkOut: it.checkOut, remove: false });
        if (r.changed.length) {
          console.log(`[Codes] đổi hạn ${it.roomNo} ${it.code}: ${r.changed.join(", ")}`);
          await notifyOwner(`🔁 Booking ${it.code} (${it.guestName}, phòng ${it.roomNo}) đổi ngày → bot đã sửa hạn mã ${codes.join("/")} thành 12:00 ${it.checkIn} → 12:00 ${it.checkOut} trên: ${r.changed.join(", ")}`);
        }
        if (r.errors.length) console.warn(`[Codes] ${it.code}: ${r.errors.join("; ")}`);
      }
    }
  } catch (e) {
    console.warn("[Codes] đối chiếu mã lỗi:", (e as Error).message);
  }
}

let lastCodesRun = 0;
let lastAudit = 0;
let lastGatewayCheck = 0;

/** Gọi mỗi phút từ index.ts */
export async function stayTick() {
  const vn = new Date(Date.now() + 7 * 3_600_000);
  const date = vn.toISOString().slice(0, 10);
  const time = vn.toISOString().slice(11, 16);

  if (Date.now() - lastCodesRun >= 15 * 60_000) {
    lastCodesRun = Date.now();
    await issuePendingCodes();
  }
  if (Date.now() - lastAudit >= 60 * 60_000) {
    lastAudit = Date.now();
    await auditCodes();
  }
  if (Date.now() - lastGatewayCheck >= 60 * 60_000) {
    lastGatewayCheck = Date.now();
    await checkGateways();
  }
  if (DIGEST_TIMES.includes(time)) {
    const key = `stay_digest:${date}:${time}`;
    if (!(await store.getKv(key).catch(() => null)) && (await sendArrivalsDigest())) {
      await store.setKv(key, new Date().toISOString()).catch(() => {});
    }
  }
}
