"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

// Trang tra cứu cổng khách: /s?code=HMXXXX → khách nhập 4 số cuối điện thoại
export default function StayLookupPage() {
  const [code, setCode] = useState("");
  const [last4, setLast4] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("code");
    if (c) setCode(c.toUpperCase());
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/stay/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, last4 }) });
      const d = await r.json();
      if (!r.ok) setError(d.error);
      else window.location.href = `/s/${d.token}`;
    } finally { setBusy(false); }
  }

  return (
    <div className="min-h-screen bg-[#F4F8F4] text-[#1A1E1A] flex items-center justify-center p-5">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-3xl shadow-sm border border-[#C8DCC6] p-6">
        <p className="text-[#6B9467] text-xs font-semibold tracking-[0.2em] uppercase">Joystay · The Art of Stay</p>
        <h1 className="text-2xl font-semibold mt-2">Your stay</h1>
        <p className="text-sm text-[#6A7A68] mt-1">Registration, door codes &amp; help — all in one place.<br />Đăng ký lưu trú, mã cửa và hỗ trợ.</p>

        <label className="block text-xs font-medium text-[#6A7A68] mt-5 mb-1 uppercase tracking-wide">Booking code · Mã đặt phòng</label>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="HMXXXXXXXX"
          className="w-full border border-[#C8DCC6] rounded-xl px-3 py-3 text-lg tracking-wider focus:outline-none focus:ring-2 focus:ring-[#6B9467]" autoCapitalize="characters" />

        <label className="block text-xs font-medium text-[#6A7A68] mt-4 mb-1 uppercase tracking-wide">Last 4 digits of your phone · 4 số cuối điện thoại</label>
        <input value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="1234"
          className="w-full border border-[#C8DCC6] rounded-xl px-3 py-3 text-lg tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-[#6B9467]" />

        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

        <button disabled={busy || code.length < 6 || last4.length !== 4}
          className="w-full mt-5 bg-[#1A1E1A] disabled:bg-gray-300 text-white rounded-xl py-3.5 font-semibold flex items-center justify-center gap-2">
          {busy && <Loader2 size={18} className="animate-spin" />} Open · Mở
        </button>
        <p className="text-xs text-[#6A7A68] mt-4 text-center">Need help? WhatsApp <a className="underline" href="https://wa.me/84898888457">+84 898 888 457</a></p>
      </form>
    </div>
  );
}
