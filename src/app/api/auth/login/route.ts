import { NextResponse } from "next/server";
import { checkPassword } from "@/lib/admin-password";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";

export const dynamic = "force-dynamic";
const tries = new Map<string, { n: number; at: number }>();

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  const t = tries.get(ip);
  if (t && t.n >= 8 && Date.now() - t.at < 15 * 60_000) return NextResponse.json({ ok: false, error: "Sai quá nhiều lần — thử lại sau 15 phút" }, { status: 429 });
  const { password } = await request.json().catch(() => ({}));
  if (!password || !(await checkPassword(String(password)))) {
    tries.set(ip, { n: (t && Date.now() - t.at < 15 * 60_000 ? t.n : 0) + 1, at: Date.now() });
    return NextResponse.json({ ok: false, error: "Sai mật khẩu" }, { status: 401 });
  }
  tries.delete(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSession(), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE });
  return res;
}
