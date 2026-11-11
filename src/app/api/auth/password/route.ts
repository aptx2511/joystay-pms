import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { checkPassword, setPassword } from "@/lib/admin-password";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

// Đổi mật khẩu (đang đăng nhập + nhập đúng mật khẩu cũ)
export async function POST(request: Request) {
  const jar = await cookies();
  if (!(await verifySession(jar.get(SESSION_COOKIE)?.value))) return NextResponse.json({ ok: false, error: "Cần đăng nhập" }, { status: 401 });
  if (process.env.PMS_ADMIN_PASSWORD) return NextResponse.json({ ok: false, error: "Mật khẩu đang đặt bằng biến môi trường Vercel — đổi ở đó" }, { status: 409 });
  const { current, next } = await request.json().catch(() => ({}));
  if (!(await checkPassword(String(current ?? "")))) return NextResponse.json({ ok: false, error: "Mật khẩu cũ không đúng" }, { status: 401 });
  if (!next || String(next).length < 8) return NextResponse.json({ ok: false, error: "Mật khẩu mới tối thiểu 8 ký tự" }, { status: 400 });
  await setPassword(String(next));
  return NextResponse.json({ ok: true });
}
