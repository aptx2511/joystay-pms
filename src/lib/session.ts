/**
 * Phiên đăng nhập quản trị PMS — cookie ký HMAC, chạy được cả ở middleware (Edge) lẫn API (Node).
 * Không lưu mật khẩu trong cookie; cookie = "<hạn dùng ms>.<chữ ký>". Ghi nhớ đăng nhập 400 ngày.
 */
export const SESSION_COOKIE = "pms_session";
export const SESSION_MAX_AGE = 400 * 24 * 3600; // giây — giới hạn tối đa trình duyệt cho phép

function secret() {
  return process.env.PMS_SESSION_SECRET || process.env.CRON_SECRET || process.env.PMS_API_KEY || process.env.DATABASE_URL || "joystay-dev";
}
async function hmac(data: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function createSession() {
  const exp = Date.now() + SESSION_MAX_AGE * 1000;
  return `${exp}.${await hmac(`pms-admin:${exp}`)}`;
}
export async function verifySession(token: string | undefined | null) {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !(Number(exp) > Date.now())) return false;
  const good = await hmac(`pms-admin:${exp}`);
  if (good.length !== sig.length) return false;
  let out = 0;
  for (let i = 0; i < good.length; i++) out |= good.charCodeAt(i) ^ sig.charCodeAt(i);
  return out === 0;
}
