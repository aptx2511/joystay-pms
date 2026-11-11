"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Plus, Upload, Wallet, X } from "lucide-react";
import Header from "@/components/layout/Header";

const OUT_CATS = ["Tiền nhà", "Điện", "Nước", "Internet", "Lương / dọn phòng", "Giặt là", "Vật tư / amenity", "Sửa chữa", "Phí kênh / OTA", "Marketing", "Khác"];
const IN_CATS = ["Tiền phòng", "Phí trả sớm / phụ thu", "Khác"];
const SRC: Record<string, string> = { AIRBNB: "Airbnb", BOOKING: "Booking", AGODA: "Agoda", TRAVELOKA: "Traveloka", DIRECT: "Trực tiếp", OFFLINE: "Offline" };

interface RoomRow { roomId: string; label: string; nights: number; revenue: number; estimated: number; direct: number; shared: number; profit: number; occupancy: number }
interface Txn { id: string; kind: "IN" | "OUT"; date: string; amount: number; category: string; roomId: string | null; bookingId: string | null; channel: string | null; note: string | null; source: string }
interface Fixed { id: string; name: string; amount: number; category: string; roomId: string | null; startMonth: string; endMonth: string | null }
interface Recon { bookingId: string; room: string; roomId: string; guest: string; code: string | null; source: string; checkIn: string; checkOut: string; expected: number; received: number; status: "du" | "lech" | "chua" | "sap" }
interface Report {
  month: string; rooms: RoomRow[]; totals: { revenue: number; estimated: number; cost: number; profit: number; nights: number; occupancy: number };
  cash: { in: number; out: number }; sharedCost: number; txns: Txn[]; fixed: Fixed[]; recon: Recon[]; roomsList: { id: string; no: string; label: string }[];
}

const vnd = (n: number) => `${Math.round(n).toLocaleString("vi-VN")}đ`;
const short = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1).replace(".0", "")}tr` : `${Math.round(n / 1000)}k`);
const ddmm = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const thisMonth = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 7);
const today = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const shift = (m: string, d: number) => { const [y, mo] = m.split("-").map(Number); const t = new Date(Date.UTC(y, mo - 1 + d, 1)); return t.toISOString().slice(0, 7); };
/** giống parseAmount phía server — để xem trước */
function parseAmount(input: string): number {
  let s = input.toLowerCase().replace(/\s|đ|vnd|₫/g, "");
  let m = s.match(/^(\d+)(?:tr|m|triệu)(\d*)$/);
  if (m) return Number(m[1]) * 1e6 + (m[2] ? Number(m[2].padEnd(3, "0").slice(0, 3)) * 1e3 : 0);
  if ((m = s.match(/^(\d+[.,]?\d*)(tr|m|triệu)$/))) return Number(m[1].replace(",", ".")) * 1e6;
  if ((m = s.match(/^(\d+[.,]?\d*)(k|n|nghìn|ngàn)$/))) return Number(m[1].replace(",", ".")) * 1e3;
  s = s.replace(/[.,]/g, "");
  if (!/^\d+$/.test(s)) return NaN;
  const v = Number(s); return v > 0 && v < 10_000 ? v * 1000 : v;
}
const STATUS: Record<Recon["status"], { t: string; c: string }> = {
  du: { t: "Đã về", c: "bg-emerald-100 text-emerald-700" }, lech: { t: "Đã về · lệch", c: "bg-amber-100 text-amber-800" },
  chua: { t: "Chưa về", c: "bg-rose-100 text-rose-700" }, sap: { t: "Sắp tới", c: "bg-gray-100 text-gray-600" },
};

export default function FinancePage() {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"nhap" | "laiLo" | "doiSoat" | "coDinh">("nhap");
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(await fetch(`/api/finance/report?month=${month}`, { cache: "no-store" }).then((r) => r.json())); } finally { setLoading(false); }
  }, [month]);
  useEffect(() => { load(); }, [load]);

  // ── Nhập nhanh ──
  const [kind, setKind] = useState<"OUT" | "IN">("OUT");
  const [amount, setAmount] = useState("");
  const [cat, setCat] = useState(OUT_CATS[0]);
  const [room, setRoom] = useState<string>("");
  const [date, setDate] = useState(today());
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const preview = parseAmount(amount);
  const amountRef = useRef<HTMLInputElement>(null);
  async function save() {
    if (!Number.isFinite(preview) || preview <= 0) { setMsg("Số tiền chưa đúng — vd 350k, 1tr2, 2.5tr"); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/finance/txns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, amount, category: cat, roomId: room || null, date, note }) }).then((x) => x.json());
      if (r.ok) { setMsg(`Đã lưu ${kind === "OUT" ? "chi" : "thu"} ${vnd(r.amount)} · ${cat}`); setAmount(""); setNote(""); amountRef.current?.focus(); await load(); }
      else setMsg(r.error ?? "Lỗi");
    } finally { setBusy(false); }
  }
  async function delTxn(id: string) { if (!confirm("Xoá dòng này?")) return; await fetch(`/api/finance/txns?id=${id}`, { method: "DELETE" }); load(); }

  // ── Đối soát ──
  const fileRef = useRef<HTMLInputElement>(null);
  const [imp, setImp] = useState<string | null>(null);
  async function importCsv(f: File) {
    setImp("Đang nhập…");
    const r = await fetch("/api/finance/import-airbnb", { method: "POST", headers: { "Content-Type": "text/csv" }, body: await f.text() }).then((x) => x.json());
    setImp(r.ok ? `Đã nhập ${r.added} dòng (${r.matched} khớp booking${r.dup ? `, ${r.dup} dòng đã có — bỏ qua` : ""}${r.unmatched?.length ? `; chưa khớp: ${r.unmatched.join(", ")}` : ""})` : r.error);
    load();
  }
  async function markPaid(x: Recon) {
    const v = prompt(`Đã thu bao nhiêu từ ${x.guest} (phòng ${x.room}, ${SRC[x.source] ?? x.source})?\nVd 2250k hoặc 2tr25`, x.expected ? String(Math.round(x.expected / 1000)) + "k" : "");
    if (v == null) return;
    const ch = prompt("Thu bằng gì? Gõ 1 = tiền mặt, 2 = chuyển khoản, 3 = qua kênh (OTA trả về)", x.source === "AIRBNB" ? "3" : "1");
    const channel = ch === "2" ? "TRANSFER" : ch === "3" ? x.source : "CASH";
    await fetch("/api/finance/txns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "IN", amount: v, category: "Tiền phòng", bookingId: x.bookingId, roomId: x.roomId, channel, note: `${x.guest} ${x.code ?? ""}`.trim() }) });
    load();
  }

  // ── Cố định ──
  const [fName, setFName] = useState(""); const [fAmount, setFAmount] = useState(""); const [fCat, setFCat] = useState("Tiền nhà"); const [fRoom, setFRoom] = useState("");
  async function addFixed() {
    const r = await fetch("/api/finance/fixed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: fName || fCat, amount: fAmount, category: fCat, roomId: fRoom || null, startMonth: month }) }).then((x) => x.json());
    if (r.ok) { setFName(""); setFAmount(""); load(); } else alert(r.error);
  }
  async function stopFixed(f: Fixed) {
    if (!confirm(`Dừng "${f.name}" từ tháng ${month}? (các tháng trước vẫn giữ)`)) return;
    await fetch("/api/finance/fixed", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: f.id, endMonth: shift(month, -1) }) });
    load();
  }

  const roomNo = useMemo(() => new Map((data?.roomsList ?? []).map((r) => [r.id, r.no])), [data]);
  const chip = (on: boolean) => `text-xs px-2.5 py-1.5 rounded-full border ${on ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-300 text-gray-700"}`;

  return (
    <>
      <Header title="Thu chi" subtitle="Nhập thu chi · đối soát tiền về · lãi lỗ theo phòng" />
      <div className="flex-1 overflow-auto p-3 sm:p-5 space-y-4 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button onClick={() => setMonth(shift(month, -1))} className="p-1.5 rounded-lg hover:bg-gray-100"><ChevronLeft size={18} /></button>
            <span className="text-sm font-semibold w-20 text-center">Tháng {month.slice(5)}/{month.slice(0, 4)}</span>
            <button onClick={() => setMonth(shift(month, 1))} className="p-1.5 rounded-lg hover:bg-gray-100"><ChevronRight size={18} /></button>
          </div>
          {loading && <Loader2 size={16} className="animate-spin text-gray-400" />}
        </div>

        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-xl bg-white border p-3 min-w-0"><p className="text-[11px] text-gray-500 uppercase">Doanh thu</p><p className="text-lg font-bold">{short(data.totals.revenue)}</p>{data.totals.estimated > 0 && <p className="text-[10px] text-amber-700">{short(data.totals.estimated)} ước tính*</p>}</div>
            <div className="rounded-xl bg-white border p-3 min-w-0"><p className="text-[11px] text-gray-500 uppercase">Chi phí</p><p className="text-lg font-bold">{short(data.totals.cost)}</p></div>
            <div className="rounded-xl bg-white border p-3 min-w-0"><p className="text-[11px] text-gray-500 uppercase">Lãi / lỗ</p><p className={`text-lg font-bold ${data.totals.profit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{short(data.totals.profit)}</p></div>
            <div className="rounded-xl bg-white border p-3 min-w-0"><p className="text-[11px] text-gray-500 uppercase">Công suất</p><p className="text-lg font-bold">{data.totals.occupancy}%</p><p className="text-[10px] text-gray-500">{data.totals.nights} đêm</p></div>
          </div>
        )}

        <div className="flex gap-1.5 overflow-x-auto">
          {([["nhap", "➕ Nhập thu chi"], ["laiLo", "📊 Lãi lỗ phòng"], ["doiSoat", "🔎 Đối soát tiền về"], ["coDinh", "📌 Chi cố định"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`shrink-0 text-sm px-3 py-2 rounded-lg ${tab === k ? "bg-amber-500 text-white font-semibold" : "bg-white border text-gray-700"}`}>{l}</button>
          ))}
        </div>

        {data && tab === "nhap" && (
          <section className="bg-white rounded-xl border p-3 sm:p-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setKind("OUT"); setCat(OUT_CATS[0]); }} className={`py-2.5 rounded-lg font-semibold ${kind === "OUT" ? "bg-rose-600 text-white" : "bg-gray-100 text-gray-600"}`}>− Chi ra</button>
              <button onClick={() => { setKind("IN"); setCat(IN_CATS[0]); }} className={`py-2.5 rounded-lg font-semibold ${kind === "IN" ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-600"}`}>+ Tiền vào</button>
            </div>
            <div>
              <input ref={amountRef} value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} inputMode="text" autoFocus
                placeholder="Số tiền: 350k · 1tr2 · 2.5tr" className="w-full text-2xl font-bold border border-gray-300 rounded-xl px-3 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400" />
              <p className="text-xs text-gray-500 mt-1 h-4">{amount ? (Number.isFinite(preview) && preview > 0 ? `= ${vnd(preview)}` : "Chưa hiểu số tiền") : "Gõ tắt: k = nghìn, tr = triệu. Gõ 350 cũng hiểu là 350.000đ"}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">{(kind === "OUT" ? OUT_CATS : IN_CATS).map((c) => <button key={c} onClick={() => setCat(c)} className={chip(cat === c)}>{c}</button>)}</div>
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs text-gray-500">Phòng:</span>
              <button onClick={() => setRoom("")} className={chip(room === "")}>Chung</button>
              {data.roomsList.map((r) => <button key={r.id} onClick={() => setRoom(r.id)} className={chip(room === r.id)}>{r.no}</button>)}
            </div>
            <div className="grid grid-cols-[140px_1fr] gap-2">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="min-w-0 border border-gray-300 rounded-lg px-2 py-2 text-sm" />
              <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="Ghi chú (không bắt buộc)" className="min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <button disabled={busy} onClick={save} className={`w-full py-3 rounded-xl text-white font-semibold flex items-center justify-center gap-2 ${kind === "OUT" ? "bg-rose-600" : "bg-emerald-600"} disabled:opacity-50`}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Lưu {kind === "OUT" ? "khoản chi" : "khoản thu"}
            </button>
            {msg && <p className="text-sm text-gray-800">{msg}</p>}

            <div className="pt-2 border-t">
              <p className="text-sm font-semibold mb-1.5">Các dòng tháng này ({data.txns.length})</p>
              {data.txns.length === 0 && <p className="text-sm text-gray-500">Chưa có dòng nào.</p>}
              <div className="divide-y">
                {data.txns.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 py-1.5 text-sm">
                    <span className="text-xs text-gray-500 w-11 shrink-0">{ddmm(t.date)}</span>
                    <span className="min-w-0 flex-1 truncate">{t.category}{t.roomId ? ` · ${roomNo.get(t.roomId) ?? ""}` : " · chung"}{t.note ? <span className="text-gray-400"> · {t.note}</span> : null}</span>
                    <span className={`font-semibold tabular-nums shrink-0 ${t.kind === "IN" ? "text-emerald-700" : "text-rose-700"}`}>{t.kind === "IN" ? "+" : "−"}{short(t.amount)}</span>
                    <button onClick={() => delTxn(t.id)} className="text-gray-400 hover:text-rose-600 shrink-0"><X size={14} /></button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {data && tab === "laiLo" && (
          <section className="bg-white rounded-xl border p-3 sm:p-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead><tr className="text-xs text-gray-500 text-left border-b">
                  <th className="py-2">Phòng</th><th className="text-right">Đêm</th><th className="text-right">Doanh thu</th><th className="text-right">Chi riêng</th><th className="text-right">Chi chung</th><th className="text-right">Lãi / lỗ</th>
                </tr></thead>
                <tbody>
                  {data.rooms.map((r) => (
                    <tr key={r.roomId} className="border-b last:border-0">
                      <td className="py-2 font-medium">{r.label.split(" · ")[0]} <span className="text-xs text-gray-400">{r.occupancy}%</span></td>
                      <td className="text-right tabular-nums">{r.nights}</td>
                      <td className="text-right tabular-nums">{short(r.revenue)}{r.estimated > 0 && <span className="text-amber-600">*</span>}</td>
                      <td className="text-right tabular-nums text-gray-600">{short(r.direct)}</td>
                      <td className="text-right tabular-nums text-gray-600">{short(r.shared)}</td>
                      <td className={`text-right tabular-nums font-semibold ${r.profit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{short(r.profit)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold bg-gray-50"><td className="py-2">Tổng</td><td className="text-right">{data.totals.nights}</td><td className="text-right">{short(data.totals.revenue)}</td><td colSpan={2} className="text-right">{short(data.totals.cost)}</td><td className={`text-right ${data.totals.profit >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{short(data.totals.profit)}</td></tr>
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-gray-500 mt-2 leading-snug">
              Doanh thu tính theo đêm ở trong tháng. Booking đã đối soát dùng số tiền thực về; chưa đối soát dùng giá ước tính của PMS (dấu <span className="text-amber-600">*</span>).
              Chi phí không gắn phòng (chung + cố định = {short(data.sharedCost)}) chia đều cho {data.rooms.length} phòng. Tiền thực vào/ra trong tháng: +{short(data.cash.in)} / −{short(data.cash.out)}.
            </p>
          </section>
        )}

        {data && tab === "doiSoat" && (
          <section className="bg-white rounded-xl border p-3 sm:p-4 space-y-3">
            <div className="rounded-lg bg-sky-50 border border-sky-200 p-3 text-sm">
              <p className="font-semibold text-sky-900">Airbnb: nhập 1 file là xong</p>
              <p className="text-xs text-gray-700 mt-1">Airbnb → Thu nhập → Lịch sử giao dịch → Tải xuống CSV (chọn khoảng ngày) → chọn file ở đây. Nhập lại file cũ không bị trùng.</p>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
              <button onClick={() => fileRef.current?.click()} className="mt-2 text-sm px-3 py-2 rounded-lg bg-sky-600 text-white font-semibold flex items-center gap-1.5"><Upload size={15} /> Chọn file CSV Airbnb</button>
              {imp && <p className="text-xs text-gray-800 mt-2">{imp}</p>}
            </div>
            <p className="text-xs text-gray-500">Booking.com / Agoda / trực tiếp: khách trả tiền mặt hoặc chuyển khoản → bấm <b>Đã thu</b>.</p>
            <div className="divide-y">
              {data.recon.length === 0 && <p className="text-sm text-gray-500">Không có booking nhận phòng trong tháng này.</p>}
              {data.recon.map((x) => (
                <div key={x.bookingId} className="py-2 flex items-center gap-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate"><b>{x.room}</b> · {x.guest} <span className="text-xs text-gray-400">{SRC[x.source] ?? x.source}{x.code ? ` · ${x.code}` : ""}</span></p>
                    <p className="text-xs text-gray-500">{ddmm(x.checkIn)}→{ddmm(x.checkOut)} · ước tính {short(x.expected)}{x.received ? ` · đã về ${short(x.received)}${x.expected ? ` (${x.received >= x.expected ? "+" : ""}${short(x.received - x.expected)})` : ""}` : ""}</p>
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${STATUS[x.status].c}`}>{STATUS[x.status].t}</span>
                  <button onClick={() => markPaid(x)} className="text-xs px-2 py-1 rounded-md bg-emerald-600 text-white shrink-0">Đã thu</button>
                </div>
              ))}
            </div>
          </section>
        )}

        {data && tab === "coDinh" && (
          <section className="bg-white rounded-xl border p-3 sm:p-4 space-y-3">
            <p className="text-xs text-gray-500">Khoản chi lặp lại mỗi tháng (tiền nhà, internet, lương cố định…) — nhập 1 lần, tự tính vào mọi tháng từ tháng đang chọn.</p>
            <div className="grid grid-cols-2 sm:grid-cols-[1fr_120px_160px_100px_auto] gap-2">
              <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Tên (vd Tiền thuê nhà)" className="col-span-2 sm:col-span-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <input value={fAmount} onChange={(e) => setFAmount(e.target.value)} placeholder="25tr" className="min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              <select value={fCat} onChange={(e) => setFCat(e.target.value)} className="min-w-0 border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white">{OUT_CATS.map((c) => <option key={c}>{c}</option>)}</select>
              <select value={fRoom} onChange={(e) => setFRoom(e.target.value)} className="min-w-0 border border-gray-300 rounded-lg px-2 py-2 text-sm bg-white"><option value="">Chung</option>{data.roomsList.map((r) => <option key={r.id} value={r.id}>{r.no}</option>)}</select>
              <button onClick={addFixed} className="col-span-2 sm:col-span-1 px-3 py-2 rounded-lg bg-gray-900 text-white text-sm font-semibold">Thêm</button>
            </div>
            <div className="divide-y">
              {data.fixed.length === 0 && <p className="text-sm text-gray-500">Chưa có khoản cố định nào áp dụng cho tháng này.</p>}
              {data.fixed.map((f) => (
                <div key={f.id} className="flex items-center gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{f.name} <span className="text-xs text-gray-400">· {f.category} · {f.roomId ? roomNo.get(f.roomId) : "chung"} · từ {f.startMonth.slice(5)}/{f.startMonth.slice(0, 4)}</span></span>
                  <span className="font-semibold tabular-nums">{short(f.amount)}</span>
                  <button onClick={() => stopFixed(f)} className="text-xs px-2 py-1 rounded-md bg-gray-100 text-gray-700">Dừng</button>
                </div>
              ))}
            </div>
          </section>
        )}
        <p className="text-[11px] text-gray-400 flex items-center gap-1"><Wallet size={12} /> Tiền thực về từ Airbnb sẽ thay giá ước tính trong Lãi lỗ ngay sau khi nhập CSV.</p>
      </div>
    </>
  );
}
