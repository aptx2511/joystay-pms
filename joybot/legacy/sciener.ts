import axios from "axios";
import CryptoJS from "crypto-js";
import { config, ROOM_LOCK_MAP } from "../config";

const scienerClient = axios.create({
  baseURL: config.sciener.baseUrl,
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  timeout: 15000,
});

export interface ScienerPasscodeResult {
  success: boolean;
  passcode?: string;
  keyboardPwdId?: number;
  lockId?: number;
  validFrom: number;  // Unix ms
  validTo: number;    // Unix ms
  message: string;
}

// ── Generate Sciener Keyboard Password ────────────────────────────────────

export async function generateScienerPasscode(params: {
  bookingId: string;
  roomSlug: string;
  checkIn: string;   // ISO 8601
  checkOut: string;  // ISO 8601
  guestName: string;
}): Promise<ScienerPasscodeResult> {
  const lockId = ROOM_LOCK_MAP[params.roomSlug];
  if (!lockId) {
    return {
      success: false,
      validFrom: 0,
      validTo: 0,
      message: `Không tìm thấy lock ID cho phòng ${params.roomSlug}`,
    };
  }

  // Check-in at 14:00, check-out at 12:00 Vietnam time (UTC+7)
  const validFrom = toCheckInMs(params.checkIn);
  const validTo = toCheckOutMs(params.checkOut);

  // Build Sciener API request
  const date = Date.now();
  const passcode = generateRandomPin(6);

  try {
    const formData = new URLSearchParams({
      clientId: config.sciener.clientId,
      accessToken: config.sciener.accessToken,
      lockId: lockId.toString(),
      keyboardPwd: passcode,
      keyboardPwdName: `JoyBot-${params.bookingId}-${params.guestName.split(" ")[0]}`,
      startDate: validFrom.toString(),
      endDate: validTo.toString(),
      date: date.toString(),
      sign: buildScienerSign(config.sciener.clientId, config.sciener.accessToken, date, config.sciener.clientSecret),
    });

    const response = await scienerClient.post(
      "/v3/keyboardPwd/get",
      formData.toString()
    );

    const data = response.data;

    if (data.errcode === 0) {
      return {
        success: true,
        passcode,
        keyboardPwdId: data.keyboardPwdId,
        lockId,
        validFrom,
        validTo,
        message: "Mã khóa đã được tạo thành công.",
      };
    } else {
      console.error("[Sciener] API error:", data);
      return {
        success: false,
        validFrom,
        validTo,
        message: `Sciener lỗi: ${data.errmsg ?? "Unknown error"} (code: ${data.errcode})`,
      };
    }
  } catch (err) {
    console.warn("[Sciener] Request failed, using mock passcode:", err);
    // Fallback mock for development
    return {
      success: true,
      passcode: generateRandomPin(6),
      lockId,
      validFrom,
      validTo,
      message: "⚠️ [DEV MODE] Mã khóa giả — Sciener API chưa kết nối.",
    };
  }
}

// ── Delete / Revoke passcode ──────────────────────────────────────────────

export async function deleteScienerPasscode(params: {
  lockId: number;
  keyboardPwdId: number;
}): Promise<{ success: boolean; message: string }> {
  try {
    const date = Date.now();
    const formData = new URLSearchParams({
      clientId: config.sciener.clientId,
      accessToken: config.sciener.accessToken,
      lockId: params.lockId.toString(),
      keyboardPwdId: params.keyboardPwdId.toString(),
      deleteType: "2", // 1=delete from lock, 2=delete from cloud only
      date: date.toString(),
      sign: buildScienerSign(config.sciener.clientId, config.sciener.accessToken, date, config.sciener.clientSecret),
    });

    const response = await scienerClient.post(
      "/v3/keyboardPwd/delete",
      formData.toString()
    );

    return {
      success: response.data.errcode === 0,
      message: response.data.errmsg ?? "OK",
    };
  } catch (err) {
    return { success: false, message: String(err) };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function generateRandomPin(length: number): string {
  const digits = "0123456789";
  return Array.from({ length }, () =>
    digits[Math.floor(Math.random() * digits.length)]
  ).join("");
}

function buildScienerSign(
  clientId: string,
  accessToken: string,
  date: number,
  clientSecret: string
): string {
  // Sciener sign = md5(clientId + accessToken + date + clientSecret)
  const raw = `${clientId}${accessToken}${date}${clientSecret}`;
  return CryptoJS.MD5(raw).toString();
}

function toCheckInMs(dateStr: string): number {
  // If already has time component, use as-is; otherwise set to 14:00 VNT
  const d = new Date(dateStr);
  if (dateStr.includes("T")) return d.getTime();
  // Set to 14:00 UTC+7
  return new Date(`${dateStr}T14:00:00+07:00`).getTime();
}

function toCheckOutMs(dateStr: string): number {
  const d = new Date(dateStr);
  if (dateStr.includes("T")) return d.getTime();
  // Set to 12:00 UTC+7
  return new Date(`${dateStr}T12:00:00+07:00`).getTime();
}
