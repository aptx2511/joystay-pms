"use client";
import { useEffect, useState } from "react";

/** Trạng thái đăng nhập quản trị (dùng để hiện ổ khoá trên menu) */
export function useAuth() {
  const [s, setS] = useState<{ authed: boolean; needsSetup: boolean } | null>(null);
  useEffect(() => {
    fetch("/api/auth/status", { cache: "no-store" }).then((r) => r.json()).then(setS).catch(() => setS({ authed: false, needsSetup: false }));
  }, []);
  return s;
}
export const PUBLIC_NAV = new Set(["/", "/bookings"]);
export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  location.href = "/";
}
