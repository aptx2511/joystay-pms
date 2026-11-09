"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Lock, LockOpen, Loader2, Tag } from "lucide-react";
import Header from "@/components/layout/Header";
import { formatPrice } from "@/lib/utils";

interface Status { active: boolean; blocks: number; nights: number; since: string | null }
interface Night { date: string; weekday: number; weekend: boolean; lead: number; base: number; suggested: number; discountPct: number }
interface Gap {
  roomId: string; roomLabel: string; from: string; to: string; nights: number; lead: number;
  kind: "lastminute" | "orphan" | "long" | "normal"; nightsAdvice: Night[]; total: number; reasons: string[];
  channels: { name: string; why: string; connected: boolean; listPrice?: number }[];
}
interface Advice {
  month: string; today: string; potential: number; freeNights: number;
  rooms: { roomId: string; roomLabel: string; occupancy: number; freeAhead: number }[];
  gaps: Gap[];
}

const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const KIND: Record<Gap["kind"], { label: string; cls: string }> = {
  lastminute: { label: "Sát ngày", cls: "bg-rose-100 text-rose-700" },
  orphan: { label: "Trống lẻ", cls: "bg-violet-100 text-violet-700" },
  long: { label: "Trống dài", cls: "bg-sky-100 text-sky-700" },
  normal: { label: "Còn thời gian", cls: "bg-gray-100 text-gray-600" },
};
const ddmm = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const shiftMonth = (m: string, d: number) => {
  const [y, mo] = m.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + d, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
};

export default function VacancyPricingPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"lock" | "unlock" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [data, setData] = useState<Advice | null>(null);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    setStatus(await fetch("/api/emergency-lock", { cache: "no-store" }).then((r) => r.json()));
  }, []);
  const loadAdvice = useCallback(async () => {
    setLoading(true);
    try {
      const d: Advice = await fetch(`/api/pricing${month ? `?month=${month}` : ""}`, { cache: "no-store" }).then((r) => r.json());
      setData(d);
      if (!month) setMonth(d.month);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { loadStatus(); }, [loadStatus]);
  useEffect(() => { loadAdvice(); }, [loadAdvice]);

  async function act(action: "lock" | "unlock") {
    const q = action === "lock"
      ? "KHOÁ KHẨN tất cả các đêm còn trống của mọi phòng (12 tháng tới)?\n\nCác booking đã có giữ nguyên. Airbnb/Booking/Agoda đóng theo ở lần đồng bộ lịch tới (có thể mất vài giờ)."
      : "MỞ khoá khẩn — trả lại các đêm trống để nhận khách?";
    if (!confirm(q)) return;
    setBusy(action); setMsg(null);
    try {
      const r = await fetch("/api/emergency-lock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }).then((x) => x.json());
      setMsg(action === "lock" ? `Đã khoá ${r.nights} đêm trống (${r.created} khoảng).` : `Đã mở khoá (${r.removed} khoảng).`);
      await Promise.all([loadStatus(), loadAdvice()]);
    } catch {
      setMsg("Lỗi — thử lại.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Header title="Giá & phòng trống" subtitle="Khoá khẩn lịch · gợi ý giá và kênh bán cho đêm còn trống" />
      <div className="flex-1 overflow-auto p-3 sm:p-5 space-y-4 sm:space-y-5">
        {/* ── Khoá khẩn ── */}
        <section className={`rounded-xl border p-4 sm:p-5 ${status?.active ? "bg-rose-50 border-rose-300" : "bg-white border-gray-200"}`}>
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg shrink-0 ${status?.active ? "bg-rose-500" : "bg-slate-800"}`}>
              {status?.active ? <Lock size={18} className="text-white" /> : <LockOpen size={18} className="text-white" />}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-gray-900">Khoá khẩn cấp lịch</h2>
              <p className="text-sm text-gray-600 mt-0.5">
                {status == null ? "Đang tải…"
                  : status.active ? `ĐANG KHOÁ ${status.nights} đêm trống (${status.blocks} khoảng) từ ${new Date(status.since!).toLocaleString("vi-VN")}. Không nhận khách mới.`
                  : "Đang mở bình thường. Bấm khoá khi cần dừng nhận khách mới ngay (sự cố, sửa chữa, kiểm tra…)."}
              </p>
              <p className="text-xs text-gray-500 mt-1">Booking đã có giữ nguyên. Website/JoyBot dừng bán ngay; Airbnb, Booking.com, Agoda đóng theo ở lần đồng bộ lịch tới (có thể mất vài giờ).</p>
              <div className="flex flex-wrap gap-2 mt-3">
                <button onClick={() => act("lock")} disabled={busy !== null || status?.active}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-rose-600 text-white text-sm font-semibold disabled:opacity-40">
                  {busy === "lock" ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />} Khoá khẩn tất cả ngày trống
                </button>
                <button onClick={() => act("unlock")} disabled={busy !== null || !status?.active}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40">
                  {busy === "unlock" ? <Loader2 size={16} className="animate-spin" /> : <LockOpen size={16} />} Mở khoá khẩn
                </button>
              </div>
              {msg && <p className="text-sm font-medium text-gray-800 mt-2">{msg}</p>}
            </div>
          </div>
        </section>

        {/* ── Tư vấn giá ── */}
        <section className="bg-white rounded-xl border border-gray-200 p-3 sm:p-5 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2"><Tag size={16} /> Tư vấn giá phòng trống</h2>
            <div className="flex items-center gap-1">
              <button onClick={() => month && setMonth(shiftMonth(month, -1))} className="p-1.5 rounded-lg hover:bg-gray-100"><ChevronLeft size={18} /></button>
              <span className="text-sm font-medium w-16 text-center">{month ? `${month.slice(5)}/${month.slice(0, 4)}` : "…"}</span>
              <button onClick={() => month && setMonth(shiftMonth(month, 1))} className="p-1.5 rounded-lg hover:bg-gray-100"><ChevronRight size={18} /></button>
            </div>
          </div>

          {loading || !data ? (
            <div className="flex justify-center py-10"><Loader2 className="animate-spin text-gray-400" /></div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="rounded-lg bg-gray-50 p-3 min-w-0"><p className="text-[11px] text-gray-500 uppercase">Đêm còn trống (từ hôm nay)</p><p className="text-lg font-bold">{data.freeNights}</p></div>
                <div className="rounded-lg bg-gray-50 p-3 min-w-0"><p className="text-[11px] text-gray-500 uppercase">Nếu bán hết theo giá gợi ý</p><p className="text-lg font-bold break-words">{formatPrice(data.potential)}</p></div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {data.rooms.map((r) => (
                  <span key={r.roomId} className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                    {r.roomLabel.split(" · ")[0]}: lấp {r.occupancy}% · trống {r.freeAhead} đêm
                  </span>
                ))}
              </div>
              {status?.active && (
                <p className="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-center gap-2">
                  <AlertTriangle size={15} className="shrink-0" /> Đang khoá khẩn nên không còn đêm trống để bán. Mở khoá để xem gợi ý.
                </p>
              )}
              {data.gaps.length === 0 && !status?.active && <p className="text-sm text-gray-500 mt-4">Không còn đêm trống trong tháng này 🎉</p>}

              <div className="space-y-3 mt-4">
                {data.gaps.map((g) => (
                  <div key={g.roomId + g.from} className="border border-gray-200 rounded-xl p-3 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm text-gray-900">{g.roomLabel}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${KIND[g.kind].cls}`}>{KIND[g.kind].label}</span>
                    </div>
                    <p className="text-sm text-gray-600 mt-0.5">{ddmm(g.from)} → {ddmm(g.to)} · {g.nights} đêm · tổng gợi ý <b>{formatPrice(g.total)}</b></p>

                    <div className="flex gap-1.5 overflow-x-auto mt-2 pb-1">
                      {g.nightsAdvice.map((n) => (
                        <div key={n.date} className={`shrink-0 rounded-lg border px-2 py-1.5 text-center min-w-[74px] ${n.weekend ? "border-amber-300 bg-amber-50" : "border-gray-200"}`}>
                          <p className="text-[11px] text-gray-500">{WD[n.weekday]} {ddmm(n.date)}</p>
                          <p className="text-sm font-semibold tabular-nums">{Math.round(n.suggested / 1000)}k</p>
                          <p className="text-[10px] text-gray-400 tabular-nums">{n.discountPct > 0 ? `−${n.discountPct}% · ` : ""}gốc {Math.round(n.base / 1000)}k</p>
                        </div>
                      ))}
                    </div>

                    <ul className="mt-2 space-y-0.5">
                      {g.reasons.map((r) => <li key={r} className="text-xs text-gray-600">• {r}</li>)}
                    </ul>
                    <div className="mt-2 space-y-1">
                      {g.channels.map((c) => (
                        <div key={c.name} className="text-xs flex gap-1.5">
                          <span className={`shrink-0 font-semibold ${c.connected ? "text-emerald-700" : "text-gray-400"}`}>{c.connected ? "✓" : "○"} {c.name}{c.listPrice ? ` ~${Math.round(c.listPrice / 1000)}k/đêm` : ""}</span>
                          <span className="text-gray-500 min-w-0">— {c.why}{!c.connected ? " (chưa kết nối lịch)" : ""}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-4 leading-snug">
                Gợi ý theo quy tắc: giá gốc phòng (Settings) · giảm theo số ngày còn lại (≤1 ngày −25%, ≤3 −15%, ≤7 −10%, ≤14 −5%) · trống lẻ kẹp giữa 2 booking −10% · phòng lấp &lt;40% −5% · cuối tuần giảm một nửa · sàn {Math.round(60)}% giá gốc.
                Giá kênh khác đã cộng bù phí để thực nhận ngang Airbnb. PMS chưa tự đổi giá trên OTA — bạn chỉnh trên lịch từng kênh.
              </p>
            </>
          )}
        </section>
      </div>
    </>
  );
}
