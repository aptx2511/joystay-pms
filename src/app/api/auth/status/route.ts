import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { passwordConfigured } from "@/lib/admin-password";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const jar = await cookies();
  const authed = await verifySession(jar.get(SESSION_COOKIE)?.value);
  return NextResponse.json({ authed, needsSetup: !(await passwordConfigured()) });
}
