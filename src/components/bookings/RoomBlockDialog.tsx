"use client";

import { useEffect, useState } from "react";
import { Loader2, Lock, X } from "lucide-react";
import { Room } from "@/types";

const REASONS = [
  { key: "video", label: "🎬 Quay video / chụp ảnh marketing" },
  { key: "repair", label: "🔧 Sửa chữa / bảo trì" },
  { key: "owner", label: "🏠 Chủ dùng / người quen ở" },
  { key: "other", label: "🔒 Lý do khác" },
] as const;
const vnToday = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/** Khoá nhanh 1 hoặc nhiều phòng (quay video marketing, sửa chữa…) → tạo "Khoá lịch" (BLOCKED) → Airbnb/Booking/Agoda đóng theo ở lần đồng bộ */
export default function RoomBlockDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [from, setFrom] = useState(vnToday());
  const [to, setTo] = useState(addDays(vnToday(), 1));
  const [reason, setReason] = useState<(typeof REASONS)[number]["key"]>("video");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { if (open) { fetch("/api/rooms").then((r) => r.json()).then(setRooms).catch(() => {}); setMsg(null); } }, [open]);
  if (!open) return null;

  const nights = Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
  const label = REASONS.find((r) => r.key === reason)!.label;

  async function save() {
    if (!sel.length) return setMsg("Chọn ít nhất 1 phòng");
    if (nights < 1) return setMsg("Ngày kết thúc phải sau ngày bắt đầu (khoá theo đêm)");
    setBusy(true); setMsg(null);
    const ok: string[] = [], fail: string[] = [];
    for (const id of sel) {
      const r = rooms.find((x) => x.id === id);
      const res = await fetch("/api/bookings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: id, guestName: label, checkIn: from, checkOut: to, source: "DIRECT", status: "BLOCKED", notes: note || null }),
      });
      (res.ok ? ok : fail).push(r?.roomNumber ?? r?.name ?? id);
    }
    setBusy(false);
    if (ok.length) onSaved();
    setMsg(`${ok.length ? `Đã khoá phòng ${ok.join(", ")}.` : ""}${fail.length ? ` Không khoá được ${fail.join(", ")} — đã có khách/khoá trùng ngày.` : ""}`);
    if (!fail.length) setTimeout(onClose, 1200);
  }

  const chip = (on: boolean) => `text-sm px-3 py-1.5 rounded-full border ${on ? "bg-gray-900 text-white border-gray-900" : "bg-white border-gray-300 text-gray-700"}`;
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-4 space-y-3 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
        <div className="flex items-center justify-between">
          <p className="font-semibold flex items-center gap-2"><Lock size={16} /> Khoá phòng</p>
          <button onClick={onClose} className="p-1 text-gray-400"><X size={18} /></button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {REASONS.map((r) => <button key={r.key} onClick={() => setReason(r.key)} className={chip(reason === r.key)}>{r.label}</button>)}
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Phòng</p>
          <div className="flex flex-wrap gap-1.5">
            {rooms.filter((r) => r.roomNumber).map((r) => (
              <button key={r.id} onClick={() => setSel((s) => (s.includes(r.id) ? s.filter((x) => x !== r.id) : [...s, r.id]))} className={chip(sel.includes(r.id))}>{r.roomNumber}</button>
            ))}
            <button onClick={() => setSel(rooms.filter((r) => r.roomNumber).map((r) => r.id))} className="text-xs text-gray-500 underline">chọn tất cả</button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500 min-w-0">Từ ngày (đêm đầu)<input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value >= to) setTo(addDays(e.target.value, 1)); }} className="block w-full min-w-0 mt-0.5 border border-gray-300 rounded-lg px-2 py-2 text-sm" /></label>
          <label className="text-xs text-gray-500 min-w-0">Mở lại ngày<input type="date" value={to} min={addDays(from, 1)} onChange={(e) => setTo(e.target.value)} className="block w-full min-w-0 mt-0.5 border border-gray-300 rounded-lg px-2 py-2 text-sm" /></label>
        </div>
        <p className="text-xs text-gray-500">{nights > 0 ? `Khoá ${nights} đêm (${from.slice(8)}/${from.slice(5, 7)} → mở lại ${to.slice(8)}/${to.slice(5, 7)})` : ""} · Quay ban ngày 1 hôm: chọn đêm hôm trước hoặc đêm hôm đó tuỳ giờ quay.</p>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú (vd: ekip 3 người, quay 9h–15h)" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
        <button disabled={busy} onClick={save} className="w-full py-3 rounded-xl bg-slate-900 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />} Khoá {sel.length || ""} phòng
        </button>
        {msg && <p className="text-sm text-gray-800">{msg}</p>}
        <p className="text-[11px] text-gray-400">Website/JoyBot dừng bán ngay; Airbnb, Booking.com, Agoda đóng theo ở lần đồng bộ lịch tới (thường vài giờ — nên khoá trước ít nhất 1 ngày). Mở khoá: bấm vào ô khoá trên lịch → Delete.</p>
      </div>
    </div>
  );
}
