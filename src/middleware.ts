import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

/**
 * Lớp bảo vệ PMS (Ops 2.0 — Giai đoạn 0).
 *
 * LUÔN BẬT (11/11/2026). Ai có link chỉ xem được Dashboard + Bookings (chỉ đọc, đã ẩn thông tin nhạy cảm);
 * các trang khác + mọi thao tác ghi cần đăng nhập ở /login (cookie ghi nhớ 400 ngày).
 *
 * Cách vào:
 *  - Chủ nhà: /login — mật khẩu PMS_ADMIN_PASSWORD (Vercel) hoặc mật khẩu tự tạo lần đầu (lưu băm trong DB)
 *  - (cũ, vẫn nhận) Basic auth admin / PMS_ADMIN_PASSWORD
 *  - Máy chủ khác (website /api/book, JoyBot): header  x-api-key: PMS_API_KEY
 *  - Cron: header  Authorization: Bearer CRON_SECRET
 *  - Công khai: lịch iCal xuất cho OTA, kiểm tra phòng trống, lịch phòng cho website,
 *    trang việc dọn của lao công (/t/<mã bí mật>), cổng khách (/s, /s/<mã bí mật>) và API của các trang đó.
 */

const PUBLIC_PREFIXES = [
  "/ical/",               // OTA đọc lịch PMS
  "/api/ical/export/",
  "/api/availability",    // website kiểm tra phòng trống
  "/api/quote",          // website/JoyBot lấy giá theo ngày
  "/t/",                  // trang việc dọn cho lao công (khoá bằng token trong link)
  "/api/hk/t/",
  "/s/",                 // cổng khách /s/<mã bí mật>
  "/api/stay/lookup",    // khách tra cứu bằng mã đặt phòng + 4 số ĐT
  "/api/stay/t/",
  "/guide/",             // ảnh hướng dẫn tự nhận phòng
  "/api/payments/sepay", // webhook SePay (tự kiểm tra "Apikey SEPAY_API_KEY")
  "/login",
  "/api/auth/",          // đăng nhập / đăng xuất / tạo mật khẩu lần đầu
  "/api/inbox/email",    // Apps Script Gmail gửi email đặt phòng (tự kiểm tra x-inbox-token)
];
// Trang xem công khai (ai có link): Dashboard + Bookings (chỉ đọc)
const PUBLIC_PAGES = new Set(["/", "/bookings"]);

function isPublic(pathname: string, method: string) {
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  if (pathname === "/s") return true;
  if (PUBLIC_PAGES.has(pathname)) return true;
  // dữ liệu cho 2 trang công khai (chỉ GET; route tự ẩn thông tin nhạy cảm khi chưa đăng nhập)
  if (method === "GET" && (pathname === "/api/bookings" || pathname === "/api/rooms")) return true;
  // website đặt phòng trực tiếp (như trước) — route ép trạng thái PENDING khi chưa đăng nhập
  if (method === "POST" && pathname === "/api/bookings") return true;
  // website: GET /api/rooms/<id>/calendar
  if (method === "GET" && /^\/api\/rooms\/[^/]+\/calendar$/.test(pathname)) return true;
  return false;
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export async function middleware(req: NextRequest) {
  // stay.joystay.vn: chỉ phục vụ cổng khách, mọi đường dẫn khác chuyển về /s
  const host = req.headers.get("host") ?? "";
  if (host.startsWith("stay.")) {
    const p = req.nextUrl.pathname;
    const ok = p === "/s" || p.startsWith("/s/") || p.startsWith("/api/stay/lookup") || p.startsWith("/api/stay/t/") || p.startsWith("/guide/");
    if (!ok) return NextResponse.redirect(new URL("/s", req.url));
    return NextResponse.next();
  }

  const { pathname } = req.nextUrl;
  const authed = await isAuthed(req);
  // header nội bộ cho route biết đã đăng nhập (luôn ghi đè — client không giả được)
  const headers = new Headers(req.headers);
  headers.set("x-pms-auth", authed ? "1" : "0");
  const pass = () => NextResponse.next({ request: { headers } });

  if (authed || req.method === "OPTIONS" || isPublic(pathname, req.method)) return pass();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Cần đăng nhập" }, { status: 401 });
  const url = new URL("/login", req.url);
  url.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

async function isAuthed(req: NextRequest) {
  if (await verifySession(req.cookies.get(SESSION_COOKIE)?.value)) return true;
  const apiKey = process.env.PMS_API_KEY;
  const headerKey = req.headers.get("x-api-key");
  if (apiKey && headerKey && safeEqual(headerKey, apiKey)) return true;
  const auth = req.headers.get("authorization") ?? "";
  const cron = process.env.CRON_SECRET;
  if (cron && safeEqual(auth, `Bearer ${cron}`)) return true;
  const password = process.env.PMS_ADMIN_PASSWORD;
  if (password && auth.startsWith("Basic ")) {
    try {
      const decoded = atob(auth.slice(6));
      const sep = decoded.indexOf(":");
      const user = sep >= 0 ? decoded.slice(0, sep) : decoded;
      const pw = sep >= 0 ? decoded.slice(sep + 1) : "";
      if (safeEqual(user, process.env.PMS_ADMIN_USER || "admin") && safeEqual(pw, password)) return true;
    } catch { /* header hỏng */ }
  }
  return false;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
