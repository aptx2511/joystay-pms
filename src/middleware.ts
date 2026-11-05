import { NextRequest, NextResponse } from "next/server";

/**
 * Lớp bảo vệ PMS (Ops 2.0 — Giai đoạn 0).
 *
 * BẬT khi đặt biến môi trường PMS_ADMIN_PASSWORD trên Vercel. Chưa đặt → không chặn gì
 * (để triển khai từng bước, không làm gãy website/JoyBot đang gọi PMS).
 *
 * Cách vào:
 *  - Chủ nhà: trình duyệt hỏi tài khoản → user "admin" (hoặc PMS_ADMIN_USER), mật khẩu PMS_ADMIN_PASSWORD
 *  - Máy chủ khác (website /api/book, JoyBot): header  x-api-key: PMS_API_KEY
 *  - Cron: header  Authorization: Bearer CRON_SECRET
 *  - Công khai: lịch iCal xuất cho OTA, kiểm tra phòng trống, lịch phòng cho website,
 *    trang việc dọn của lao công (/t/<mã bí mật>), cổng khách (/s, /s/<mã bí mật>) và API của các trang đó.
 */

const PUBLIC_PREFIXES = [
  "/ical/",               // OTA đọc lịch PMS
  "/api/ical/export/",
  "/api/availability",    // website kiểm tra phòng trống
  "/t/",                  // trang việc dọn cho lao công (khoá bằng token trong link)
  "/api/hk/t/",
  "/s/",                 // cổng khách /s/<mã bí mật>
  "/api/stay/lookup",    // khách tra cứu bằng mã đặt phòng + 4 số ĐT
  "/api/stay/t/",
];

function isPublic(pathname: string, method: string) {
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  if (pathname === "/s") return true;
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

export function middleware(req: NextRequest) {
  // stay.joystay.vn: chỉ phục vụ cổng khách, mọi đường dẫn khác chuyển về /s
  const host = req.headers.get("host") ?? "";
  if (host.startsWith("stay.")) {
    const p = req.nextUrl.pathname;
    const ok = p === "/s" || p.startsWith("/s/") || p.startsWith("/api/stay/lookup") || p.startsWith("/api/stay/t/");
    if (!ok) return NextResponse.redirect(new URL("/s", req.url));
    return NextResponse.next();
  }

  const password = process.env.PMS_ADMIN_PASSWORD;
  if (!password) return NextResponse.next(); // chưa bật bảo vệ

  const { pathname } = req.nextUrl;
  if (req.method === "OPTIONS" || isPublic(pathname, req.method)) return NextResponse.next();

  const apiKey = process.env.PMS_API_KEY;
  const headerKey = req.headers.get("x-api-key");
  if (apiKey && headerKey && safeEqual(headerKey, apiKey)) return NextResponse.next();

  const auth = req.headers.get("authorization") ?? "";
  const cron = process.env.CRON_SECRET;
  if (cron && safeEqual(auth, `Bearer ${cron}`)) return NextResponse.next();

  if (auth.startsWith("Basic ")) {
    try {
      const decoded = atob(auth.slice(6));
      const sep = decoded.indexOf(":");
      const user = sep >= 0 ? decoded.slice(0, sep) : decoded;
      const pass = sep >= 0 ? decoded.slice(sep + 1) : "";
      const expectedUser = process.env.PMS_ADMIN_USER || "admin";
      if (safeEqual(user, expectedUser) && safeEqual(pass, password)) return NextResponse.next();
    } catch {
      /* header hỏng → từ chối */
    }
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return new NextResponse("Cần đăng nhập Joystay PMS", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Joystay PMS", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
