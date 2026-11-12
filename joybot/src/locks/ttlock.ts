/**
 * TTLock Open Platform (EU) — tạo mã khoá có thời hạn cho khách.
 *
 * Đăng nhập bằng tài khoản app TTLock (OAuth password grant) → access_token (~90 ngày),
 * lưu trong store KV, tự đăng nhập lại khi hết hạn / bị từ chối.
 * Thông tin đăng nhập CHỈ lấy từ biến môi trường (chủ tự điền trên Railway/.env):
 *   TTLOCK_CLIENT_ID, TTLOCK_CLIENT_SECRET, TTLOCK_USERNAME, TTLOCK_PASSWORD
 *   TTLOCK_BASE_URL (mặc định https://euapi.ttlock.com — app đăng ký trên euopen.ttlock.com)
 */
import axios from "axios";
import crypto from "crypto";
import { config } from "../config";
import { store } from "../store";

const KV_KEY = "ttlock_token";
const md5 = (s: string) => crypto.createHash("md5").update(s).digest("hex");

interface Token { access_token: string; expires_at: number; uid?: number }
let cached: Token | null = null;

export const ttlockConfigured = () =>
  !!(config.ttlock.clientId && config.ttlock.clientSecret && config.ttlock.username && config.ttlock.password);

export class TTLockError extends Error {
  constructor(public errcode: number, msg: string) { super(`TTLock ${errcode}: ${msg}`); }
}

async function login(): Promise<Token> {
  const c = config.ttlock;
  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    username: c.username,
    password: md5(c.password), // 32 ký tự md5, chữ thường
  });
  const { data } = await axios.post(`${c.baseUrl}/oauth2/token`, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15000,
  });
  if (!data?.access_token) {
    throw new TTLockError(data?.errcode ?? -1, data?.errmsg ?? data?.description ?? "Đăng nhập TTLock thất bại");
  }
  const tok: Token = {
    access_token: data.access_token,
    uid: data.uid,
    // trừ 1 ngày cho chắc
    expires_at: Date.now() + (Number(data.expires_in ?? 7776000) - 86400) * 1000,
  };
  cached = tok;
  await store.setKv(KV_KEY, JSON.stringify(tok)).catch(() => {});
  return tok;
}

async function token(force = false): Promise<string> {
  if (!force) {
    if (!cached) {
      const raw = await store.getKv(KV_KEY).catch(() => null);
      if (raw) try { cached = JSON.parse(raw); } catch { /* bỏ qua */ }
    }
    if (cached && cached.expires_at > Date.now()) return cached.access_token;
  }
  return (await login()).access_token;
}

/** Gọi API v3 (POST form). Tự đăng nhập lại 1 lần nếu token bị từ chối. */
async function call(path: string, params: Record<string, string | number>, retry = true): Promise<any> {
  if (!ttlockConfigured()) throw new Error("Chưa cấu hình TTLOCK_* trong biến môi trường");
  const body = new URLSearchParams({
    clientId: config.ttlock.clientId,
    accessToken: await token(),
    date: String(Date.now()),
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  });
  const { data } = await axios.post(`${config.ttlock.baseUrl}${path}`, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    timeout: 15000,
  });
  if (data && typeof data.errcode === "number" && data.errcode !== 0) {
    // 10003/10004: token sai hoặc hết hạn → đăng nhập lại
    if (retry && [10003, 10004].includes(data.errcode)) {
      await token(true);
      return call(path, params, false);
    }
    throw new TTLockError(data.errcode, data.errmsg ?? data.description ?? "lỗi không rõ");
  }
  return data;
}

export interface LockInfo { lockId: number; lockAlias: string; lockName: string; electricQuantity?: number; hasGateway?: number }

export async function listLocks(): Promise<LockInfo[]> {
  const out: LockInfo[] = [];
  for (let page = 1; page <= 10; page++) {
    const data = await call("/v3/lock/list", { pageNo: page, pageSize: 100 });
    out.push(...(data.list ?? []));
    if (!data.pages || page >= data.pages) break;
  }
  return out;
}

/** Giờ hiệu lực phải tròn giờ (phút, giây = 0) theo yêu cầu TTLock */
const roundHour = (ms: number) => Math.floor(ms / 3_600_000) * 3_600_000;

/**
 * Mã có thời hạn (keyboardPwdType 3), sinh bằng thuật toán của khoá → không cần gateway.
 * ⚠️ TTLock: mã phải được dùng ít nhất 1 lần trong 24 giờ kể từ giờ bắt đầu, nếu không sẽ mất hiệu lực.
 */
export async function periodPasscode(lockId: number, startMs: number, endMs: number, name: string) {
  const data = await call("/v3/keyboardPwd/get", {
    lockId,
    keyboardPwdVersion: 4,
    keyboardPwdType: 3,
    keyboardPwdName: name.slice(0, 50),
    startDate: roundHour(startMs),
    endDate: roundHour(endMs),
  });
  return { passcode: String(data.keyboardPwd), passcodeId: Number(data.keyboardPwdId) };
}

// ── Bộ phát (gateway) ──────────────────────────────────────────────────────────
export interface GatewayInfo { gatewayId: number; gatewayName: string; lockNum?: number; isOnline?: number }

export async function listGateways(): Promise<GatewayInfo[]> {
  const data = await call("/v3/gateway/list", { pageNo: 1, pageSize: 50 });
  return data.list ?? [];
}

/** Các khoá mà 1 bộ phát đang phủ sóng */
export async function locksOfGateway(gatewayId: number): Promise<{ lockId: number; lockAlias?: string; lockName?: string; rssi?: number }[]> {
  const data = await call("/v3/gateway/listLock", { gatewayId });
  return data.list ?? [];
}

/**
 * Mã TỰ CHỌN (vd 4 số cuối ĐT khách) có thời hạn — đẩy xuống khoá QUA BỘ PHÁT (addType 2).
 * Khoá phải nằm trong tầm 1 bộ phát đang online. Không bị giới hạn "dùng lần đầu trong 24h".
 */
export async function customPasscode(lockId: number, code: string, startMs: number, endMs: number, name: string) {
  if (!/^\d{4,9}$/.test(code)) throw new Error("Mã tự chọn phải gồm 4–9 chữ số");
  const data = await call("/v3/keyboardPwd/add", {
    lockId,
    keyboardPwd: code,
    keyboardPwdName: name.slice(0, 50),
    keyboardPwdType: 3,
    startDate: roundHour(startMs),
    endDate: roundHour(endMs),
    addType: 2,
  });
  return { passcode: code, passcodeId: Number(data.keyboardPwdId) };
}

/** Xoá 1 mã khỏi khoá qua bộ phát (deleteType 2) */
export async function deletePasscode(lockId: number, keyboardPwdId: number) {
  await call("/v3/keyboardPwd/delete", { lockId, keyboardPwdId, deleteType: 2 });
}

export interface PasscodeInfo { keyboardPwdId: number; keyboardPwd: string; keyboardPwdName?: string; keyboardPwdType?: number; startDate?: number; endDate?: number }
/** Danh sách mã đang có trên khoá (dùng để nhận lại mã chủ đã tự tạo tay trùng số) */
export async function listPasscodes(lockId: number): Promise<PasscodeInfo[]> {
  const out: PasscodeInfo[] = [];
  for (let page = 1; page <= 5; page++) {
    const data = await call("/v3/lock/listKeyboardPwd", { lockId, pageNo: page, pageSize: 100 });
    const list: PasscodeInfo[] = data?.list ?? [];
    out.push(...list);
    if (list.length < 100) break;
  }
  return out;
}

/** Đổi hạn dùng của 1 mã qua bộ phát (changeType 2) — dùng khi khách đổi ngày */
export async function changePasscodePeriod(lockId: number, keyboardPwdId: number, startMs: number, endMs: number) {
  await call("/v3/keyboardPwd/change", { lockId, keyboardPwdId, startDate: roundHour(startMs), endDate: roundHour(endMs), changeType: 2 });
}
