import { NextResponse } from "next/server";
import { passwordConfigured, setPassword } from "@/lib/admin-password";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";

export const dynamic = "force-dynamic";

// Tạo mật khẩu quản trị lần đầu — chỉ được khi CHƯA có mật khẩu nào
export async function POST(request: Request) {
  if (await passwordConfigured()) return NextResponse.json({ ok: false, error: "Đã có mật khẩu — hãy đăng nhập" }, { status: 409 });
  const { password } = await request.json().catch(() => ({}));
  if (!password || String(password).length < 8) return NextResponse.json({ ok: false, error: "Mật khẩu tối thiểu 8 ký tự" }, { status: 400 });
  await setPassword(String(password));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSession(), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE });
  return res;
}
