"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Filter, Lock, LockOpen, Loader2, Tag } from "lucide-react";
import Header from "@/components/layout/Header";
import { formatPrice } from "@/lib/utils";

interface Status { active: boolean; blocks: number; nights: number; since: string | null }
interface Night {
  date: string; weekday: number; weekend: boolean; lead: number; cat: Cat; orphan: boolean; base: number;
  abNow: number; abNowKnown: boolean; abSuggested: number; abChangePct: number; suggested: number; why: string;
  applied: number | null; airbnbPrice: number | null; airbnbTip: number | null; airbnbTarget: number | null; airbnbDone: boolean;
}
interface Gap {
  roomId: string; roomLabel: string; from: string; to: string; nights: number; lead: number; orphan: boolean;
  nightsAdvice: Night[]; totalAb: number; reasons: string[];
  channels: { name: string; why: string; connected: boolean; listPrice?: number }[];
}
interface Advice {
  month: string; today: string; potentialAb: number; freeNights: number; tipsAt: string | null; floorPct: number;
  airbnbTodo: { roomId: string; roomLabel: string; date: string; current: number | null; target: number }[];
  rooms: { roomId: string; roomLabel: string; occupancy: number; freeAhead: number; ratio: number }[];
  gaps: Gap[];
}
type Cat = "satngay" | "saptoi" | "conxa";

const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const CAT: Record<Cat, { label: string; rule: string; chip: string; dot: string }> = {
  satngay: { label: "Sát ngày", rule: "đêm còn ≤ 3 ngày nữa → giảm 10–15% để bán nốt", chip: "border-rose-300 bg-rose-50", dot: "bg-rose-500" },
  saptoi: { label: "Sắp tới", rule: "còn 4–14 ngày → giảm nhẹ 3–7% hoặc theo Airbnb gợi ý", chip: "border-amber-300 bg-amber-50", dot: "bg-amber-500" },
  conxa: { label: "Còn xa", rule: "còn > 14 ngày → giữ giá (chỉ chỉnh nếu Airbnb gợi ý lệch ≥ 10%)", chip: "border-gray-200 bg-white", dot: "bg-gray-400" },
};
const k = (n: number) => `${Math.round(n / 1000)}k`;
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

  const [saving, setSaving] = useState<string | null>(null);

  // ── Bộ lọc & áp giá hàng loạt ──
  const [fRooms, setFRooms] = useState<string[]>([]);           // rỗng = tất cả phòng
  const [fCats, setFCats] = useState<Cat[]>([]);               // rỗng = mọi nhóm
  const [fOrphan, setFOrphan] = useState(false);                // chỉ đêm lẻ
  const [showHelp, setShowHelp] = useState(false);
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [fDays, setFDays] = useState<"all" | "weekday" | "weekend">("all");
  const [showApplied, setShowApplied] = useState(false);       // mặc định ẩn đêm đã áp dụng
  const [method, setMethod] = useState<"rule" | "tip" | "pct">("rule"); // rule = cột Đề xuất
  const [pct, setPct] = useState(-10);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const visible = useMemo(() => {
    if (!data) return [];
    return data.gaps
      .filter((g) => (!fRooms.length || fRooms.includes(g.roomId)) && (!fOrphan || g.orphan))
      .map((g) => ({
        ...g,
        nightsAdvice: g.nightsAdvice.filter((n) =>
          (showApplied || n.applied == null) && (!fCats.length || fCats.includes(n.cat)) &&
          (!fFrom || n.date >= fFrom) && (!fTo || n.date <= fTo) &&
          (fDays === "all" || (fDays === "weekend" ? n.weekend : !n.weekend))),
      }))
      .filter((g) => g.nightsAdvice.length > 0);
  }, [data, fRooms, fCats, fOrphan, fFrom, fTo, fDays, showApplied]);
  const appliedCount = useMemo(() => (data ? data.gaps.reduce((s, g) => s + g.nightsAdvice.filter((n) => n.applied != null).length, 0) : 0), [data]);
  const targets = visible.flatMap((g) => g.nightsAdvice.filter((n) => n.applied == null).map((n) => ({ g, n })));
  const appliedInView = visible.flatMap((g) => g.nightsAdvice.filter((n) => n.applied != null).map((n) => ({ g, n })));
  const r10k = (x: number) => Math.round(x / 10_000) * 10_000;

  async function bulk(kind: "apply" | "clear") {
    let items: object[] = [];
    if (kind === "clear") items = appliedInView.map(({ g, n }) => ({ roomId: g.roomId, date: n.date }));
    else if (method === "rule") items = targets.map(({ g, n }) => ({ roomId: g.roomId, date: n.date, airbnbTarget: n.abSuggested, source: "RULE" }));
    else if (method === "tip") items = targets.filter(({ n }) => n.airbnbTip != null).map(({ g, n }) => ({ roomId: g.roomId, date: n.date, useTip: true }));
    else items = targets.map(({ g, n }) => ({ roomId: g.roomId, date: n.date, airbnbTarget: r10k(n.abNow * (1 + pct / 100)), source: "MANUAL" }));
    if (!items.length) { setBulkMsg(method === "tip" && kind === "apply" ? "Không có đêm nào trong bộ lọc có gợi ý giá Airbnb." : "Không có đêm nào để xử lý."); return; }
    const label = kind === "clear" ? `Đưa ${items.length} đêm về giá gốc?` :
      `Áp dụng ${method === "rule" ? "giá Đề xuất" : method === "tip" ? "giá Airbnb gợi ý" : `giá Airbnb đang ${pct > 0 ? "+" : ""}${pct}%`} cho ${items.length} đêm đang lọc?\n\nCác đêm này sẽ vào danh sách “Cần chỉnh trên Airbnb”; JoyBot/website dùng giá trực tiếp tương ứng ngay.`;
    if (!confirm(label)) return;
    setSaving("bulk"); setBulkMsg(null);
    try {
      for (let i = 0; i < items.length; i += 40) {
        await fetch("/api/rates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: kind, items: items.slice(i, i + 40) }) });
      }
      setBulkMsg(kind === "clear" ? `Đã bỏ giá áp dụng ${items.length} đêm.` : `Đã áp dụng ${items.length} đêm — các đêm này đã được ẩn khỏi danh sách.`);
      await loadAdvice();
    } finally {
      setSaving(null);
    }
  }
  async function rates(action: "apply" | "clear" | "airbnb-done", items: object[], key: string) {
    setSaving(key);
    try {
      await fetch("/api/rates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, items }) });
      await loadAdvice();
    } finally {
      setSaving(null);
    }
  }
  function editNight(g: Gap, n: Night) {
    const cur = n.airbnbTarget ?? n.abSuggested;
    const v = prompt(`Giá AIRBNB đêm ${WD[n.weekday]} ${ddmm(n.date)} — ${g.roomLabel}\nĐang ${n.abNow.toLocaleString("vi-VN")}đ · Đề xuất ${n.abSuggested.toLocaleString("vi-VN")}đ${n.airbnbTip ? ` · Airbnb gợi ý ${n.airbnbTip.toLocaleString("vi-VN")}đ` : ""}\nNhập giá Airbnb muốn đặt (để trống = bỏ áp dụng):`, String(cur));
    if (v === null) return;
    const num = Number(v.replace(/[^\d]/g, ""));
    if (!v.trim() || !num) rates("clear", [{ roomId: g.roomId, date: n.date }], g.roomId + n.date);
    else rates("apply", [{ roomId: g.roomId, date: n.date, airbnbTarget: num, source: "MANUAL" }], g.roomId + n.date);
  }

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
                <div className="rounded-lg bg-gray-50 p-3 min-w-0"><p className="text-[11px] text-gray-500 uppercase">Bán hết theo giá Đề xuất (Airbnb)</p><p className="text-lg font-bold break-words">{formatPrice(data.potentialAb)}</p></div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {data.rooms.map((r) => (
                  <span key={r.roomId} className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                    {r.roomLabel.split(" · ")[0]}: lấp {r.occupancy}% · trống {r.freeAhead} đêm
                  </span>
                ))}
              </div>

              {/* ── Cách đọc ── */}
              <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50/60 p-3">
                <button onClick={() => setShowHelp(!showHelp)} className="text-sm font-semibold text-sky-900 w-full text-left">
                  {showHelp ? "▾" : "▸"} Cách đọc gợi ý (bấm để {showHelp ? "ẩn" : "xem"})
                </button>
                {showHelp && (
                  <div className="text-xs text-gray-700 mt-2 space-y-1.5 leading-relaxed">
                    <p>Tất cả giá ở đây là <b>giá trên Airbnb</b> (kênh ~90% khách): <b>Đang</b> = giá đang niêm yết trên Airbnb, <b>Đề xuất</b> = giá nên đặt.</p>
                    <p>Mỗi <b>đêm</b> được xếp nhóm theo số ngày còn lại tới đêm đó (không phải theo cả khoảng trống):</p>
                    {(Object.keys(CAT) as Cat[]).map((c) => (
                      <p key={c} className="flex gap-1.5"><span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${CAT[c].dot}`} /><span><b>{CAT[c].label}</b>: {CAT[c].rule}.</span></p>
                    ))}
                    <p><b>Đêm lẻ</b>: khoảng trống ≤ 2 đêm kẹp giữa 2 booking (khó bán) → giảm thêm 5%.</p>
                    <p>Nếu có <b>Airbnb gợi ý</b>, đề xuất bám theo đó; không bao giờ thấp hơn {data.floorPct}% giá đang. Cuối tuần (T6, T7) giảm một nửa. Phòng lấp &lt; 40% tháng giảm thêm 3%.</p>
                    <p>Bấm <b>Áp dụng</b> → đêm đó vào danh sách “Cần chỉnh trên Airbnb” (bạn chỉnh tay trên Airbnb rồi bấm “Đã chỉnh xong”), và JoyBot/website báo giá trực tiếp tương ứng ngay.</p>
                  </div>
                )}
              </div>
              {status?.active && (
                <p className="mt-3 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-center gap-2">
                  <AlertTriangle size={15} className="shrink-0" /> Đang khoá khẩn nên không còn đêm trống để bán. Mở khoá để xem gợi ý.
                </p>
              )}
              {data.gaps.length === 0 && !status?.active && <p className="text-sm text-gray-500 mt-4">Không còn đêm trống trong tháng này 🎉</p>}

              {data.airbnbTodo.length > 0 && (
                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-rose-800">Cần chỉnh trên Airbnb ({data.airbnbTodo.length} đêm)</p>
                    <a href="https://www.airbnb.com.vn/multicalendar" target="_blank" rel="noreferrer" className="text-xs px-2.5 py-1.5 rounded-lg bg-white border border-rose-300 text-rose-700 font-semibold shrink-0">Mở lịch Airbnb</a>
                  </div>
                  <div className="mt-2 space-y-2">
                    {[...new Set(data.airbnbTodo.map((t) => t.roomId))].map((rid) => {
                      const list = data.airbnbTodo.filter((t) => t.roomId === rid);
                      return (
                        <div key={rid} className="bg-white rounded-lg p-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-gray-800">{list[0].roomLabel}</p>
                            <button disabled={saving !== null} onClick={() => rates("airbnb-done", list.map((t) => ({ roomId: t.roomId, date: t.date })), "done" + rid)}
                              className="text-[11px] px-2 py-1 rounded-md bg-emerald-600 text-white font-semibold shrink-0 disabled:opacity-50">Đã chỉnh xong</button>
                          </div>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {list.map((t) => (
                              <span key={t.date} className="text-[11px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 tabular-nums">
                                {ddmm(t.date)}: {t.current != null ? `${k(t.current)} → ` : ""}<b>{k(t.target)}</b>
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-rose-700 mt-2">Giá Airbnb đã quy đổi theo mức chênh hiện tại giữa giá Airbnb và giá gốc của phòng. JoyBot báo giá theo giá đã áp dụng ngay; website sẽ nối sau.</p>
                </div>
              )}

              <p className="text-[11px] text-gray-400 mt-3">{data.tipsAt ? `Gợi ý giá Airbnb cập nhật lúc ${new Date(data.tipsAt).toLocaleString("vi-VN")}.` : "Chưa có gợi ý giá Airbnb — nhắn Claude \"cập nhật gợi ý giá Airbnb\"."}</p>

              {/* ── Bộ lọc & áp giá hàng loạt ── */}
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-2.5">
                <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5"><Filter size={15} /> Lọc & áp giá hàng loạt</p>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => setFRooms([])} className={`text-xs px-2.5 py-1 rounded-full border ${fRooms.length === 0 ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-300"}`}>Tất cả phòng</button>
                  {data.rooms.filter((r) => r.freeAhead > 0).map((r) => (
                    <button key={r.roomId} onClick={() => setFRooms(toggle(fRooms, r.roomId))}
                      className={`text-xs px-2.5 py-1 rounded-full border ${fRooms.includes(r.roomId) ? "bg-amber-500 text-white border-amber-500" : "bg-white border-gray-300"}`}>{r.roomLabel.split(" · ")[0]}</button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(CAT) as Cat[]).map((c) => (
                    <button key={c} onClick={() => setFCats(toggle(fCats, c))}
                      className={`text-xs px-2.5 py-1 rounded-full border flex items-center gap-1 ${fCats.includes(c) ? "bg-amber-500 text-white border-amber-500" : "bg-white border-gray-300"}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${CAT[c].dot}`} />{CAT[c].label}
                    </button>
                  ))}
                  <button onClick={() => setFOrphan(!fOrphan)} className={`text-xs px-2.5 py-1 rounded-full border ${fOrphan ? "bg-violet-600 text-white border-violet-600" : "bg-white border-gray-300"}`}>Chỉ đêm lẻ</button>
                  <span className="w-px bg-gray-300 mx-0.5" />
                  {([["all", "Mọi đêm"], ["weekday", "Ngày thường"], ["weekend", "T6–T7"]] as const).map(([v, l]) => (
                    <button key={v} onClick={() => setFDays(v)} className={`text-xs px-2.5 py-1 rounded-full border ${fDays === v ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-300"}`}>{l}</button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] text-gray-500 min-w-0">Từ ngày<input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} className="block w-full min-w-0 mt-0.5 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white" /></label>
                  <label className="text-[11px] text-gray-500 min-w-0">Đến ngày<input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} className="block w-full min-w-0 mt-0.5 border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white" /></label>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-gray-600">Đặt giá Airbnb theo:</span>
                  {([["rule", "Đề xuất"], ["tip", "Airbnb gợi ý"], ["pct", "% so với giá đang"]] as const).map(([v, l]) => (
                    <button key={v} onClick={() => setMethod(v)} className={`text-xs px-2.5 py-1 rounded-full border ${method === v ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-300"}`}>{l}</button>
                  ))}
                  {method === "pct" && (
                    <span className="flex items-center gap-1 text-xs">
                      <input type="number" value={pct} onChange={(e) => setPct(Number(e.target.value))} className="w-16 border border-gray-300 rounded-lg px-2 py-1 text-sm bg-white" />%
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button disabled={saving !== null || targets.length === 0} onClick={() => bulk("apply")}
                    className="text-sm px-3 py-2 rounded-lg bg-amber-500 text-white font-semibold disabled:opacity-40">
                    {saving === "bulk" ? "Đang áp dụng…" : `Áp dụng cho ${method === "tip" ? targets.filter((t) => t.n.airbnbTip != null).length : targets.length} đêm đang lọc`}
                  </button>
                  {showApplied && appliedInView.length > 0 && (
                    <button disabled={saving !== null} onClick={() => bulk("clear")} className="text-sm px-3 py-2 rounded-lg bg-gray-100 text-gray-700 font-semibold disabled:opacity-40">
                      Bỏ áp dụng {appliedInView.length} đêm
                    </button>
                  )}
                  {(fRooms.length || fCats.length || fOrphan || fFrom || fTo || fDays !== "all") ? (
                    <button onClick={() => { setFRooms([]); setFCats([]); setFOrphan(false); setFFrom(""); setFTo(""); setFDays("all"); }} className="text-xs text-gray-500 underline">Bỏ lọc</button>
                  ) : null}
                </div>
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={showApplied} onChange={(e) => setShowApplied(e.target.checked)} />
                  Hiện cả đêm đã áp dụng ({appliedCount} đêm đang ẩn{showApplied ? " — đang hiện" : ""})
                </label>
                {bulkMsg && <p className="text-sm font-medium text-gray-800">{bulkMsg}</p>}
              </div>

              <div className="space-y-3 mt-3">
                {visible.length === 0 && data.gaps.length > 0 && <p className="text-sm text-gray-500">Không còn đêm nào khớp bộ lọc{!showApplied && appliedCount ? " (các đêm đã áp dụng đang được ẩn)" : ""}.</p>}
                {visible.map((g) => {
                  const cats = [...new Set(g.nightsAdvice.map((n) => n.cat))];
                  return (
                  <div key={g.roomId + g.from} className="border border-gray-200 rounded-xl p-3 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-sm text-gray-900">{g.roomLabel}</span>
                      {cats.map((c) => <span key={c} className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700 flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${CAT[c].dot}`} />{CAT[c].label}</span>)}
                      {g.orphan && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700">Đêm lẻ</span>}
                    </div>
                    <p className="text-sm text-gray-600 mt-0.5">Trống {ddmm(g.from)} → {ddmm(g.to)} · {g.nights} đêm{g.nightsAdvice.length !== g.nights ? ` (đang hiện ${g.nightsAdvice.length})` : ""}</p>

                    <div className="flex gap-1.5 overflow-x-auto mt-2 pb-1">
                      {g.nightsAdvice.map((n) => {
                        const done = n.applied != null;
                        const set = n.airbnbTarget;
                        const same = n.abSuggested === n.abNow;
                        return (
                        <button key={n.date} onClick={() => editNight(g, n)} title={n.why}
                          className={`shrink-0 rounded-lg border px-2 py-1.5 text-left min-w-[92px] ${done ? "border-emerald-400 bg-emerald-50" : CAT[n.cat].chip}`}>
                          <p className="text-[11px] text-gray-500 flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${CAT[n.cat].dot}`} />{WD[n.weekday]} {ddmm(n.date)}</p>
                          <p className="text-[10px] text-gray-400 tabular-nums">đang {k(n.abNow)}{n.abNowKnown ? "" : "*"}</p>
                          {done ? (
                            <p className="text-sm font-semibold tabular-nums text-emerald-700">{set != null ? k(set) : "—"} ✓</p>
                          ) : (
                            <p className="text-sm font-semibold tabular-nums">{same ? <span className="text-gray-500">giữ</span> : k(n.abSuggested)}
                              {!same && <span className={`text-[10px] ml-1 ${n.abChangePct < 0 ? "text-rose-600" : "text-emerald-600"}`}>{n.abChangePct > 0 ? "+" : ""}{n.abChangePct}%</span>}</p>
                          )}
                          {n.airbnbTip != null && <p className="text-[10px] text-rose-500 tabular-nums">AB gợi ý {k(n.airbnbTip)}</p>}
                        </button>
                        );
                      })}
                    </div>

                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <button disabled={saving !== null} onClick={() => rates("apply", g.nightsAdvice.filter((n) => n.applied == null).map((n) => ({ roomId: g.roomId, date: n.date, airbnbTarget: n.abSuggested, source: "RULE" })), g.roomId + g.from)}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-amber-500 text-white font-semibold disabled:opacity-50">
                        {saving === g.roomId + g.from ? "Đang lưu…" : "Áp dụng Đề xuất"}
                      </button>
                      {g.nightsAdvice.some((n) => n.airbnbTip != null && n.applied == null) && (
                        <button disabled={saving !== null} onClick={() => rates("apply", g.nightsAdvice.filter((n) => n.airbnbTip != null && n.applied == null).map((n) => ({ roomId: g.roomId, date: n.date, useTip: true })), g.roomId + g.from + "tip")}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-rose-500 text-white font-semibold disabled:opacity-50">Theo Airbnb gợi ý</button>
                      )}
                      {g.nightsAdvice.some((n) => n.applied != null) && (
                        <button disabled={saving !== null} onClick={() => rates("clear", g.nightsAdvice.filter((n) => n.applied != null).map((n) => ({ roomId: g.roomId, date: n.date })), g.roomId + g.from + "clr")}
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-700 font-semibold disabled:opacity-50">Bỏ áp dụng</button>
                      )}
                      <span className="text-[11px] text-gray-400 self-center">Chạm 1 đêm để nhập giá Airbnb tay</span>
                    </div>

                    <ul className="mt-2 space-y-0.5">
                      {g.reasons.map((r) => <li key={r} className="text-xs text-gray-600">• {r}</li>)}
                    </ul>
                    <details className="mt-1.5">
                      <summary className="text-xs text-gray-500 cursor-pointer">Kênh bán & giá niêm yết tương ứng</summary>
                      <div className="mt-1 space-y-1">
                        {g.channels.map((c) => (
                          <div key={c.name} className="text-xs flex gap-1.5">
                            <span className={`shrink-0 font-semibold ${c.connected ? "text-emerald-700" : "text-gray-400"}`}>{c.connected ? "✓" : "○"} {c.name}{c.listPrice ? ` ~${Math.round(c.listPrice / 1000)}k/đêm` : ""}</span>
                            <span className="text-gray-500 min-w-0">— {c.why}{!c.connected ? " (chưa kết nối lịch)" : ""}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-400 mt-4 leading-snug">
                * = chưa đọc được giá Airbnb của đêm đó, đang ước tính theo giá gốc × tỉ lệ Airbnb của phòng. Di chuột/giữ vào 1 đêm để xem lý do đề xuất.
              </p>
            </>
          )}
        </section>
      </div>
    </>
  );
}
