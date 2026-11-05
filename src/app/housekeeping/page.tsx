"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Copy, Check, ExternalLink, Plus, UserPlus, ThumbsUp, Undo2, AlertTriangle, Ban, RotateCcw } from "lucide-react";
import Header from "@/components/layout/Header";

interface Item { key: string; label: string; done: boolean; photos: string[] }
interface Cleaner { id: string; name: string; phone: string | null; type: string; active: boolean }
interface Task {
  id: string; date: string; type: string; status: string; priority: string;
  windowStart: string; windowEnd: string; guestOut: string | null; guestIn: string | null;
  cleanerId: string | null; note: string | null; rejectReason: string | null;
  checklist: Item[] | null; issueNote: string | null; issuePhotos: string[] | null; hasIssue: boolean;
  doneAt: string | null; link: string;
  room: { id: string; name: string; roomNumber: string | null };
  cleaner: Cleaner | null;
}
interface BoardRow { roomId: string; label: string; state: string; guest: string | null }
interface Data { today: string; tasks: Task[]; board: BoardRow[]; cleaners: Cleaner[]; rooms: { id: string; name: string; roomNumber: string | null }[] }

const STATUS: Record<string, { label: string; cls: string }> = {
  TODO:        { label: "Chưa giao",  cls: "bg-gray-100 text-gray-600" },
  ASSIGNED:    { label: "Đã giao",    cls: "bg-blue-100 text-blue-700" },
  IN_PROGRESS: { label: "Đang dọn",   cls: "bg-amber-100 text-amber-800" },
  DONE:        { label: "Chờ duyệt",  cls: "bg-purple-100 text-purple-700" },
  APPROVED:    { label: "Sẵn sàng",   cls: "bg-emerald-100 text-emerald-700" },
  REJECTED:    { label: "Làm lại",    cls: "bg-red-100 text-red-700" },
  SKIPPED:     { label: "Bỏ qua",     cls: "bg-gray-100 text-gray-400 line-through" },
};
const BOARD: Record<string, { label: string; cls: string }> = {
  OCCUPIED: { label: "Có khách",  cls: "bg-blue-50 border-blue-200 text-blue-800" },
  DIRTY:    { label: "Chưa dọn",  cls: "bg-red-50 border-red-200 text-red-800" },
  CLEANING: { label: "Đang dọn",  cls: "bg-amber-50 border-amber-200 text-amber-800" },
  CHECK:    { label: "Chờ duyệt", cls: "bg-purple-50 border-purple-200 text-purple-800" },
  READY:    { label: "Sẵn sàng",  cls: "bg-emerald-50 border-emerald-200 text-emerald-800" },
  VACANT:   { label: "Trống",     cls: "bg-gray-50 border-gray-200 text-gray-500" },
};
const TYPE: Record<string, string> = { TURNOVER: "Sau trả phòng", MIDSTAY: "Giữa kỳ", DEEP: "Tổng vệ sinh" };
const WEEKDAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const dlabel = (iso: string, today: string) => {
  const d = new Date(iso);
  const k = iso.slice(0, 10);
  const rel = k === today ? " · Hôm nay" : "";
  return `${WEEKDAY[d.getUTCDay()]} ${k.slice(8, 10)}/${k.slice(5, 7)}${rel}`;
};
const img = (u: string) => `/api/housekeeping/photo?u=${encodeURIComponent(u)}`;
const roomName = (r: Task["room"]) => (r.roomNumber ? `${r.roomNumber} · ${r.name}` : r.name);

export default function HousekeepingPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [newTask, setNewTask] = useState({ roomId: "", date: "", type: "MIDSTAY", note: "" });
  const [newCleaner, setNewCleaner] = useState({ name: "", phone: "", type: "INTERNAL" });
  const [focusId, setFocusId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/housekeeping", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) setMsg(d.error ?? "Lỗi tải dữ liệu");
      else setData(d);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    setFocusId(new URLSearchParams(window.location.search).get("task"));
    load();
  }, [load]);

  useEffect(() => {
    if (focusId && data) document.getElementById(`task-${focusId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusId, data]);

  async function patch(id: string, body: Record<string, unknown>) {
    const r = await fetch(`/api/housekeeping/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) { setMsg(d.error ?? "Lỗi"); return null; }
    await load();
    return d as Task & { message: string };
  }

  async function copyMessage(id: string) {
    const r = await fetch(`/api/housekeeping/${id}`);
    const d = await r.json();
    await navigator.clipboard.writeText(d.message);
    setCopied(id);
    setTimeout(() => setCopied(null), 2500);
  }

  async function reject(t: Task) {
    const reason = window.prompt("Lý do làm lại (lao công sẽ thấy):", "Ảnh chưa rõ / còn tóc trên ga — dọn lại và chụp lại");
    if (reason === null) return;
    const d = await patch(t.id, { action: "reject", reason });
    if (d) {
      await navigator.clipboard.writeText(`${d.cleaner?.name ? d.cleaner.name + " ơi, " : ""}phòng ${roomName(t.room)} cần làm lại: ${reason}\n${t.link}`).catch(() => {});
      setMsg("Đã chuyển sang 'Làm lại' — tin nhắn cho lao công đã được copy, dán vào Zalo.");
    }
  }

  async function addTask() {
    const r = await fetch("/api/housekeeping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newTask) });
    const d = await r.json();
    setMsg(r.ok ? "Đã thêm việc dọn." : d.error);
    if (r.ok) { setNewTask({ roomId: "", date: "", type: "MIDSTAY", note: "" }); load(); }
  }

  async function addCleaner() {
    const r = await fetch("/api/housekeeping/cleaners", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newCleaner) });
    const d = await r.json();
    setMsg(r.ok ? `Đã thêm ${d.name}.` : d.error);
    if (r.ok) { setNewCleaner({ name: "", phone: "", type: "INTERNAL" }); load(); }
  }

  async function toggleCleaner(c: Cleaner) {
    await fetch("/api/housekeeping/cleaners", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, active: !c.active }) });
    load();
  }

  const pending = useMemo(() => data?.tasks.filter((t) => t.status === "DONE") ?? [], [data]);
  const byDate = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of data?.tasks ?? []) {
      const k = t.date.slice(0, 10);
      if (data && k < data.today && ["APPROVED", "SKIPPED"].includes(t.status)) continue; // ẩn việc cũ đã xong
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()];
  }, [data]);
  const activeCleaners = data?.cleaners.filter((c) => c.active) ?? [];

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Dọn phòng"
        subtitle="Lịch tự sinh từ booking mọi kênh · giao việc · duyệt ảnh"
        actions={
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium disabled:opacity-60">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Cập nhật
          </button>
        }
      />

      <div className="flex-1 overflow-auto p-4 md:p-5 space-y-5">
        {msg && (
          <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3 flex justify-between gap-3">
            <span>{msg}</span><button onClick={() => setMsg(null)} className="text-amber-700">✕</button>
          </div>
        )}

        {/* Trạng thái phòng hôm nay */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Phòng hôm nay</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            {data?.board.map((b) => (
              <div key={b.roomId} className={`border rounded-xl px-3 py-2 ${BOARD[b.state]?.cls ?? ""}`}>
                <p className="text-sm font-semibold truncate">{b.label}</p>
                <p className="text-xs">{BOARD[b.state]?.label ?? b.state}{b.guest && b.state === "OCCUPIED" ? ` · ${b.guest}` : ""}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Chờ duyệt */}
        {pending.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-purple-700 uppercase tracking-wide mb-2">Chờ duyệt ảnh ({pending.length})</h2>
            <div className="space-y-3">
              {pending.map((t) => (
                <div key={t.id} id={`task-${t.id}`} className={`bg-white border rounded-xl p-4 ${focusId === t.id ? "ring-2 ring-purple-400" : "border-purple-200"}`}>
                  <div className="flex flex-wrap justify-between gap-2">
                    <p className="font-semibold">{roomName(t.room)} · {dlabel(t.date, data!.today)}</p>
                    <p className="text-sm text-gray-500">{t.cleaner?.name ?? "—"}</p>
                  </div>
                  {t.hasIssue && (
                    <p className="mt-2 text-sm bg-orange-50 border border-orange-200 text-orange-800 rounded-lg px-3 py-2 flex gap-1.5">
                      <AlertTriangle size={16} className="shrink-0 mt-0.5" /> Sự cố: {t.issueNote ?? "(xem ảnh)"}
                    </p>
                  )}
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(t.checklist ?? []).map((i) => (
                      <div key={i.key}>
                        <p className="text-xs text-gray-500 mb-1">{i.label}</p>
                        <div className="flex gap-1 overflow-x-auto">
                          {i.photos.map((p) => (
                            <a key={p} href={img(p)} target="_blank" rel="noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={img(p)} alt={i.label} className="w-24 h-24 object-cover rounded-lg border" />
                            </a>
                          ))}
                          {i.photos.length === 0 && <span className="text-xs text-gray-400">không ảnh</span>}
                        </div>
                      </div>
                    ))}
                    {(t.issuePhotos ?? []).map((p) => (
                      <a key={p} href={img(p)} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img(p)} alt="Sự cố" className="w-24 h-24 object-cover rounded-lg border-2 border-orange-300" />
                      </a>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => patch(t.id, { action: "approve" })} className="flex items-center gap-1 text-sm px-4 py-2 bg-emerald-600 text-white rounded-lg">
                      <ThumbsUp size={15} /> Duyệt — sẵn sàng
                    </button>
                    <button onClick={() => reject(t)} className="flex items-center gap-1 text-sm px-4 py-2 bg-white border border-red-300 text-red-700 rounded-lg">
                      <Undo2 size={15} /> Làm lại
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Lịch dọn */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Lịch dọn 14 ngày tới</h2>
          {byDate.length === 0 && !loading && <p className="text-sm text-gray-400">Chưa có việc dọn nào. Bấm “Cập nhật” sau khi đồng bộ lịch OTA.</p>}
          <div className="space-y-4">
            {byDate.map(([day, tasks]) => (
              <div key={day}>
                <p className="text-sm font-semibold text-gray-700 mb-1.5">{dlabel(`${day}T00:00:00.000Z`, data!.today)}</p>
                <div className="space-y-2">
                  {tasks.map((t) => (
                    <div key={t.id} id={`task-${t.id}`}
                      className={`bg-white border rounded-xl p-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-4 ${focusId === t.id ? "ring-2 ring-amber-400" : "border-gray-200"}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-gray-900">{roomName(t.room)}</span>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS[t.status]?.cls}`}>{STATUS[t.status]?.label ?? t.status}</span>
                          {t.priority === "URGENT" && t.status !== "SKIPPED" && <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500 text-white font-semibold">GẤP</span>}
                          {t.hasIssue && <AlertTriangle size={14} className="text-orange-500" />}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {TYPE[t.type] ?? t.type} · {t.windowStart}–{t.windowEnd}
                          {t.guestOut && ` · Ra: ${t.guestOut}`}{t.guestIn && ` · Vào: ${t.guestIn}`}
                          {t.note && ` · ${t.note}`}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={t.cleanerId ?? ""}
                          disabled={["APPROVED", "SKIPPED"].includes(t.status)}
                          onChange={(e) => patch(t.id, { cleanerId: e.target.value || null })}
                          className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white"
                        >
                          <option value="">— Giao cho —</option>
                          {activeCleaners.map((c) => <option key={c.id} value={c.id}>{c.name}{c.type === "APP" ? " (app)" : ""}</option>)}
                        </select>
                        <button onClick={() => copyMessage(t.id)} title="Copy tin nhắn gửi Zalo"
                          className="flex items-center gap-1 text-sm px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg">
                          {copied === t.id ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                          {copied === t.id ? "Đã copy" : "Tin Zalo"}
                        </button>
                        <a href={t.link} target="_blank" rel="noreferrer" title="Mở trang lao công"
                          className="p-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg"><ExternalLink size={14} /></a>
                        {t.status === "SKIPPED"
                          ? <button onClick={() => patch(t.id, { action: "reopen" })} title="Mở lại" className="p-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg"><RotateCcw size={14} /></button>
                          : !["APPROVED", "DONE"].includes(t.status) &&
                            <button onClick={() => patch(t.id, { action: "skip" })} title="Bỏ qua việc này" className="p-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg"><Ban size={14} /></button>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Thêm việc */}
        <section className="bg-white rounded-xl border border-dashed border-amber-300 p-4">
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-1.5"><Plus size={16} /> Thêm việc dọn (giữa kỳ / tổng vệ sinh)</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <select value={newTask.roomId} onChange={(e) => setNewTask((p) => ({ ...p, roomId: e.target.value }))} className="text-sm border border-gray-300 rounded-lg px-2 py-2">
              <option value="">Phòng…</option>
              {data?.rooms.map((r) => <option key={r.id} value={r.id}>{r.roomNumber ? `${r.roomNumber} · ` : ""}{r.name}</option>)}
            </select>
            <input type="date" value={newTask.date} onChange={(e) => setNewTask((p) => ({ ...p, date: e.target.value }))} className="text-sm border border-gray-300 rounded-lg px-2 py-2" />
            <select value={newTask.type} onChange={(e) => setNewTask((p) => ({ ...p, type: e.target.value }))} className="text-sm border border-gray-300 rounded-lg px-2 py-2">
              <option value="MIDSTAY">Dọn giữa kỳ</option>
              <option value="DEEP">Tổng vệ sinh / côn trùng</option>
              <option value="TURNOVER">Dọn sau trả phòng</option>
            </select>
            <input placeholder="Ghi chú" value={newTask.note} onChange={(e) => setNewTask((p) => ({ ...p, note: e.target.value }))} className="text-sm border border-gray-300 rounded-lg px-2 py-2" />
            <button onClick={addTask} disabled={!newTask.roomId || !newTask.date} className="text-sm px-4 py-2 bg-amber-500 text-white rounded-lg disabled:opacity-50">Thêm</button>
          </div>
        </section>

        {/* Lao công */}
        <section className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-1.5"><UserPlus size={16} /> Lao công</h3>
          <div className="flex flex-wrap gap-2 mb-3">
            {data?.cleaners.map((c) => (
              <button key={c.id} onClick={() => toggleCleaner(c)} title={c.active ? "Bấm để tạm ngưng" : "Bấm để kích hoạt lại"}
                className={`text-sm px-3 py-1.5 rounded-full border ${c.active ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-gray-50 border-gray-200 text-gray-400 line-through"}`}>
                {c.name}{c.phone ? ` · ${c.phone}` : ""}{c.type === "APP" ? " · app" : ""}
              </button>
            ))}
            {data && data.cleaners.length === 0 && <p className="text-sm text-gray-400">Chưa có ai — thêm 2 lao công quen + 1 dòng “Jupviec/bTaskee”.</p>}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <input placeholder="Tên (vd: Chị Lan)" value={newCleaner.name} onChange={(e) => setNewCleaner((p) => ({ ...p, name: e.target.value }))} className="text-sm border border-gray-300 rounded-lg px-2 py-2" />
            <input placeholder="SĐT Zalo" value={newCleaner.phone} onChange={(e) => setNewCleaner((p) => ({ ...p, phone: e.target.value }))} className="text-sm border border-gray-300 rounded-lg px-2 py-2" />
            <select value={newCleaner.type} onChange={(e) => setNewCleaner((p) => ({ ...p, type: e.target.value }))} className="text-sm border border-gray-300 rounded-lg px-2 py-2">
              <option value="INTERNAL">Lao công quen</option>
              <option value="APP">Qua app (Jupviec/bTaskee)</option>
            </select>
            <button onClick={addCleaner} disabled={!newCleaner.name.trim()} className="text-sm px-4 py-2 bg-gray-800 text-white rounded-lg disabled:opacity-50">Thêm người</button>
          </div>
        </section>
      </div>
    </div>
  );
}
