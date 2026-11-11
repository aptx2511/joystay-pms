"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Building2, Loader2, Lock, LogOut } from "lucide-react";
import { logout } from "@/lib/hooks/useAuth";

function LoginInner() {
  const sp = useSearchParams();
  const next = sp.get("next") && sp.get("next")!.startsWith("/") ? sp.get("next")! : "/revenue";
  const [st, setSt] = useState<{ authed: boolean; needsSetup: boolean } | null>(null);
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState(""); const [cur, setCur] = useState("");
  const [msg, setMsg] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/auth/status", { cache: "no-store" }).then((r) => r.json()).then(setSt); }, []);

  async function post(url: string, body: object) {
    setBusy(true); setMsg(null);
    try { return await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()); }
    finally { setBusy(false); }
  }
  async function login(e: React.FormEvent) { e.preventDefault(); const r = await post("/api/auth/login", { password: pw }); if (r.ok) location.href = next; else setMsg(r.error); }
  async function setup(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) return setMsg("Mật khẩu tối thiểu 8 ký tự");
    if (pw !== pw2) return setMsg("Hai lần nhập không khớp");
    const r = await post("/api/auth/setup", { password: pw }); if (r.ok) location.href = next; else setMsg(r.error);
  }
  async function change(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) return setMsg("Hai lần nhập không khớp");
    const r = await post("/api/auth/password", { current: cur, next: pw });
    setMsg(r.ok ? "Đã đổi mật khẩu." : r.error); if (r.ok) { setCur(""); setPw(""); setPw2(""); }
  }
  const input = "w-full border border-gray-300 rounded-xl px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-amber-400";

  return (
    <div className="flex-1 flex items-start sm:items-center justify-center p-4 bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-2xl border shadow-sm p-6 mt-8 sm:mt-0">
        <div className="flex items-center gap-2 mb-4"><Building2 className="text-amber-500" size={22} /><span className="font-bold text-lg">Joystay PMS</span></div>
        {!st ? <Loader2 className="animate-spin text-gray-400" /> : st.authed ? (
          <>
            <p className="text-sm text-gray-700">Bạn đang đăng nhập (máy này được ghi nhớ).</p>
            <div className="flex gap-2 mt-3">
              <a href={next} className="flex-1 text-center py-2.5 rounded-xl bg-amber-500 text-white font-semibold">Vào quản trị</a>
              <button onClick={logout} className="px-3 py-2.5 rounded-xl bg-gray-100 text-gray-700 flex items-center gap-1.5"><LogOut size={16} /> Đăng xuất</button>
            </div>
            <form onSubmit={change} className="mt-6 space-y-2 border-t pt-4">
              <p className="text-sm font-semibold">Đổi mật khẩu</p>
              <input type="password" autoComplete="current-password" placeholder="Mật khẩu hiện tại" value={cur} onChange={(e) => setCur(e.target.value)} className={input} />
              <input type="password" autoComplete="new-password" placeholder="Mật khẩu mới (≥ 8 ký tự)" value={pw} onChange={(e) => setPw(e.target.value)} className={input} />
              <input type="password" autoComplete="new-password" placeholder="Nhập lại mật khẩu mới" value={pw2} onChange={(e) => setPw2(e.target.value)} className={input} />
              <button disabled={busy} className="w-full py-2.5 rounded-xl bg-gray-900 text-white font-semibold disabled:opacity-50">Đổi mật khẩu</button>
            </form>
          </>
        ) : st.needsSetup ? (
          <form onSubmit={setup} className="space-y-3">
            <p className="text-sm text-gray-700"><b>Tạo mật khẩu quản trị</b> (làm 1 lần). Sau đó máy này được ghi nhớ đăng nhập.</p>
            <input type="password" autoComplete="new-password" autoFocus placeholder="Mật khẩu mới (≥ 8 ký tự)" value={pw} onChange={(e) => setPw(e.target.value)} className={input} />
            <input type="password" autoComplete="new-password" placeholder="Nhập lại mật khẩu" value={pw2} onChange={(e) => setPw2(e.target.value)} className={input} />
            <button disabled={busy} className="w-full py-3 rounded-xl bg-amber-500 text-white font-semibold disabled:opacity-50">Tạo mật khẩu & vào</button>
          </form>
        ) : (
          <form onSubmit={login} className="space-y-3">
            <p className="text-sm text-gray-700 flex items-center gap-1.5"><Lock size={15} /> Đăng nhập để xem Doanh thu, Thu chi, Lưu trú…</p>
            <input type="password" autoComplete="current-password" autoFocus placeholder="Mật khẩu quản trị" value={pw} onChange={(e) => setPw(e.target.value)} className={input} />
            <button disabled={busy} className="w-full py-3 rounded-xl bg-amber-500 text-white font-semibold disabled:opacity-50">{busy ? "Đang kiểm tra…" : "Đăng nhập"}</button>
            <p className="text-[11px] text-gray-400">Máy này sẽ được ghi nhớ đăng nhập (tới khi bấm Đăng xuất).</p>
          </form>
        )}
        {msg && <p className="text-sm text-rose-700 mt-3">{msg}</p>}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginInner /></Suspense>;
}
