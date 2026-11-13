import "dotenv/config";
import { config as loadEnvFile } from "dotenv";

// Mã bí mật TTLock để riêng trong file .env.ttlock (không đưa lên git), ghi đè giá trị trống trong .env.
// Trên Railway không có file này → dùng Variables của Railway như bình thường.
for (const [k, v] of Object.entries(loadEnvFile({ path: ".env.ttlock", processEnv: {} }).parsed ?? {})) {
  if (v) process.env[k] = v;
}

const env = (k: string, d = "") => process.env[k] ?? d;
const num = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);

export const config = {
  anthropic: {
    apiKey: env("ANTHROPIC_API_KEY"),
    // Sonnet: đủ thông minh cho tư vấn + gọi tool, rẻ hơn Opus nhiều
    model: env("ANTHROPIC_MODEL", "claude-sonnet-5-5"),
  },
  pms: {
    baseUrl: env("PMS_BASE_URL", "https://joystay-pms.vercel.app/api"),
    apiKey: env("PMS_API_KEY"),
    cronSecret: env("PMS_CRON_SECRET"), // = CRON_SECRET của PMS, để gọi đồng bộ iCal OTA
  },
  booking: {
    depositPercent: num("DEPOSIT_PERCENT", 50),
    holdMinutes: num("HOLD_MINUTES", 30),
    otaSyncMinutes: num("OTA_SYNC_MINUTES", 10),
    codePrefix: env("BOOKING_CODE_PREFIX", "JOY"),
    // Tự xác nhận khi SePay báo tiền về đủ (true) — nếu false chỉ báo Telegram để chủ bấm
    autoConfirmOnPayment: env("AUTO_CONFIRM_ON_PAYMENT", "true") === "true",
    checkInTime: env("CHECKIN_TIME"),   // vd "14:00" — để trống thì bot không nêu giờ
    checkOutTime: env("CHECKOUT_TIME"), // vd "12:00"
    address: env("PROPERTY_ADDRESS", "382/23 Nguyễn Thị Minh Khai, Quận 3, TP.HCM"),
  },
  bank: {
    // Mã ngân hàng VietQR (vd: VCB, TCB, MB, ACB…) + số tài khoản + tên chủ TK — CHỦ TỰ ĐIỀN trên Railway
    bankId: env("BANK_ID"),
    accountNo: env("BANK_ACCOUNT_NO"),
    accountName: env("BANK_ACCOUNT_NAME"),
  },
  supabase: {
    url: env("SUPABASE_URL"),
    serviceKey: env("SUPABASE_SERVICE_KEY"),
  },
  telegram: {
    // Nên dùng 1 bot Telegram RIÊNG cho JoyBot (khác bot của content-bot) để không tranh webhook/polling
    token: env("JOYBOT_TELEGRAM_TOKEN"),
    ownerChatId: env("JOYBOT_TELEGRAM_CHAT_ID"),
    webhookSecret: env("JOYBOT_TELEGRAM_WEBHOOK_SECRET"),
  },
  meta: {
    verifyToken: env("META_VERIFY_TOKEN"),
    appSecret: env("META_APP_SECRET"),
    pageAccessToken: env("META_PAGE_ACCESS_TOKEN"), // Messenger + Instagram (IG nối với Page)
    whatsappToken: env("WHATSAPP_TOKEN"),
    whatsappPhoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID"),
    graphVersion: env("META_GRAPH_VERSION", "v21.0"),
  },
  zalo: {
    appId: env("ZALO_APP_ID"),
    appSecret: env("ZALO_APP_SECRET"),
    oaSecret: env("ZALO_OA_SECRET"), // OA Secret Key để kiểm chữ ký webhook (tùy chọn)
    accessToken: env("ZALO_OA_ACCESS_TOKEN"),
    refreshToken: env("ZALO_OA_REFRESH_TOKEN"),
  },
  sepay: {
    apiKey: env("SEPAY_API_KEY"), // để trống = chưa bật xác nhận tự động
  },
  ttlock: {
    // CHỦ TỰ ĐIỀN trên Railway/.env — không ghi vào code
    baseUrl: env("TTLOCK_BASE_URL", "https://euapi.ttlock.com"),
    clientId: env("TTLOCK_CLIENT_ID"),
    clientSecret: env("TTLOCK_CLIENT_SECRET"),
    username: env("TTLOCK_USERNAME"),
    password: env("TTLOCK_PASSWORD"),
  },
  server: {
    port: num("PORT", 3001),
    publicUrl: env("PUBLIC_URL", "https://joystay-joybot-production.up.railway.app"),
  },
};
