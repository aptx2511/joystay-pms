"use client";
/**
 * Sổ OTA — trang nhận dữ liệu thu nhập từ trang quản lý của kênh (17/11/2026).
 * Bấm "Mở …" → tab kênh mở ra (giữ liên kết với trang này). Claude chạy đoạn đọc dữ liệu trong tab kênh,
 * đoạn đó gửi về đây bằng window.opener.postMessage({ type: "joy-ota", channel, rows, snapshot }) → trang này nhập vào PMS.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "@/components/layout/Header";

const ORIGINS = [/^https:\/\/www\.airbnb\.[a-z.]+$/, /^https:\/\/portal\.agoda\.com$/, /^https:\/\/admin\.booking\.com$/];
const LINKS: [string, string][] = [
  ["Airbnb — Thu nhập (sắp tới)", "https://www.airbnb.com.vn/earnings/343161120/upcoming"],
  ["Agoda — Đặt phòng", "https://portal.agoda.com/mldc/en-us/app/postbook/booking/96649093"],
  ["Booking.com — Extranet", "https://admin.booking.com/"],
];
type Log = { at: string; channel: string; text: string; ok: boolean };
type Row = {
  channel: string; code: string | null; guest: string; guests: number | null; bookedAt: string | null; checkIn: string; checkOut: string; nights: number;
  room: string | null; status: string; gross: number | null; commission: number | null; net: number | null; received: number; upcoming: number; source: string;
};
const CH: Record<string, string> = { AIRBNB: "Airbnb", BOOKING: "Booking.com", AGODA: "Agoda", DIRECT: "Trực tiếp", OFFLINE: "Khác", TRAVELOKA: "Traveloka" };
const ST: Record<string, string> = { upcoming: "sắp tới", completed: "đã ở", complete: "đã ở", current: "đang ở", canceled: "đã huỷ", cancelled: "đã huỷ",
  canceled_by_guest: "khách huỷ", canceled_by_host: "chủ huỷ", CONFIRMED: "đã xác nhận", CANCELLED: "đã huỷ", AGODA_COLLECT: "Agoda thu hộ", HOTEL_COLLECT: "thu tại chỗ" };
const vnd = (n: number | null | undefined) => (n == null ? "" : Math.round(n).toLocaleString("vi-VN"));
const ym = (d = new Date()) => d.toISOString().slice(0, 7);

function BookingTable() {
  const [month, setMonth] = useState(ym(new Date(Date.now() + 7 * 3_600_000)));
  const [by, setBy] = useState<"checkIn" | "bookedAt">("checkIn");
  const [ch, setCh] = useState("ALL");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    const [y, m] = month.split("-").map(Number);
    const to = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const j = await fetch(`/api/finance/bookings?from=${month}-01&to=${to}&by=${by}`).then((r) => r.json());
    setRows(j.rows ?? []); setLoading(false);
  }, [month, by]);
  useEffect(() => { void load(); }, [load]);
  const list = useMemo(() => rows.filter((r) => ch === "ALL" || r.channel === ch), [rows, ch]);
  const sum = (k: "gross" | "commission" | "net" | "received" | "upcoming") => list.reduce((s, r) => s + (r[k] ?? 0), 0);
  const csv = () => {
    const head = ["Kênh", "Mã đặt phòng", "Khách", "Số khách", "Ngày đặt", "Nhận phòng", "Trả phòng", "Đêm", "Phòng", "Trạng thái", "Khách trả", "Hoa hồng", "Thực nhận", "Đã về", "Sắp về"];
    const body = list.map((r) => [CH[r.channel] ?? r.channel, r.code ?? "", r.guest, r.guests ?? "", r.bookedAt ?? "", r.checkIn, r.checkOut, r.nights, r.room ?? "", ST[r.status] ?? r.status, r.gross ?? "", r.commission ?? "", r.net ?? "", r.received, r.upcoming]);
    const text = [head, ...body].map((a) => a.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" }));
    a.download = `joystay-dat-phong-${month}-${by === "bookedAt" ? "theo-ngay-dat" : "theo-ngay-o"}.csv`; a.click();
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <b className="mr-2">Tổng hợp từng đặt phòng</b>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border rounded px-2 py-1" />
        <select value={by} onChange={(e) => setBy(e.target.value as "checkIn" | "bookedAt")} className="border rounded px-2 py-1">
          <option value="checkIn">theo ngày nhận phòng</option><option value="bookedAt">theo ngày đặt</option>
        </select>
        <select value={ch} onChange={(e) => setCh(e.target.value)} className="border rounded px-2 py-1">
          <option value="ALL">mọi kênh</option>{Object.entries(CH).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={csv} className="px-3 py-1 rounded bg-gray-900 text-white">Tải CSV</button>
        {loading && <span className="text-gray-400">đang tải…</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 text-gray-600"><tr>
            {["Kênh", "Mã", "Khách", "Ngày đặt", "Nhận", "Trả", "Đêm", "Phòng", "Trạng thái", "Khách trả", "Hoa hồng", "Thực nhận", "Đã về", "Sắp về"].map((h) => <th key={h} className="px-2 py-1 text-left whitespace-nowrap">{h}</th>)}
          </tr></thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={i} className={`border-t ${/cancel/i.test(r.status) ? "text-gray-400 line-through" : ""}`}>
                <td className="px-2 py-1 whitespace-nowrap">{CH[r.channel] ?? r.channel}{r.source === "PMS" && r.channel !== "DIRECT" ? " *" : ""}</td>
                <td className="px-2 py-1 font-mono">{r.code ?? ""}</td>
                <td className="px-2 py-1 whitespace-nowrap">{r.guest}{r.guests ? ` (${r.guests})` : ""}</td>
                <td className="px-2 py-1 whitespace-nowrap">{r.bookedAt ?? ""}</td>
                <td className="px-2 py-1 whitespace-nowrap">{r.checkIn}</td>
                <td className="px-2 py-1 whitespace-nowrap">{r.checkOut}</td>
                <td className="px-2 py-1 text-right">{r.nights}</td>
                <td className="px-2 py-1">{r.room ?? ""}</td>
                <td className="px-2 py-1 whitespace-nowrap">{ST[r.status] ?? r.status}</td>
                <td className="px-2 py-1 text-right tabular-nums">{vnd(r.gross)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{vnd(r.commission)}</td>
                <td className="px-2 py-1 text-right tabular-nums font-medium">{vnd(r.net)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{vnd(r.received)}</td>
                <td className="px-2 py-1 text-right tabular-nums">{vnd(r.upcoming)}</td>
              </tr>
            ))}
            <tr className="border-t-2 font-semibold">
              <td className="px-2 py-1" colSpan={6}>{list.length} đặt phòng</td>
              <td className="px-2 py-1 text-right">{list.reduce((s, r) => s + r.nights, 0)}</td>
              <td colSpan={2} />
              <td className="px-2 py-1 text-right">{vnd(sum("gross"))}</td>
              <td className="px-2 py-1 text-right">{vnd(sum("commission"))}</td>
              <td className="px-2 py-1 text-right">{vnd(sum("net"))}</td>
              <td className="px-2 py-1 text-right">{vnd(sum("received"))}</td>
              <td className="px-2 py-1 text-right">{vnd(sum("upcoming"))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-500">Airbnb/Agoda/Booking lấy từ trang quản lý của kênh (cập nhật thứ Hai). * = đơn kênh chỉ có trong PMS, chưa có trong danh sách của kênh. Airbnb: "Khách trả"/"Hoa hồng" để trống vì Airbnb chỉ trả số thực nhận.</p>
    </div>
  );
}

export default function SoOtaPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  useEffect(() => {
    const onMsg = async (e: MessageEvent) => {
      if (!ORIGINS.some((r) => r.test(e.origin))) return;
      const d = e.data as { type?: string; channel?: string; rows?: unknown[]; snapshot?: boolean };
      if (d?.type !== "joy-ota" || !Array.isArray(d.rows)) return;
      const at = new Date().toLocaleTimeString("vi-VN");
      try {
        const r = await fetch("/api/finance/import-ota", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: d.channel, rows: d.rows, snapshot: !!d.snapshot, notify: true }) });
        const j = await r.json();
        (window as unknown as { __joyLast: unknown }).__joyLast = j;
        e.source?.postMessage({ type: "joy-ota-result", result: j }, { targetOrigin: e.origin });
        setLogs((l) => [{ at, channel: String(d.channel), ok: !!j.ok, text: JSON.stringify(j) }, ...l]);
      } catch (err) {
        setLogs((l) => [{ at, channel: String(d.channel), ok: false, text: String(err) }, ...l]);
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  return (
    <div className="flex flex-col h-full">
      <Header title="Sổ đặt phòng & Sổ OTA" />
      <div className="p-4 space-y-4 overflow-auto">
        <BookingTable />
        <p className="text-sm text-gray-600">Mở trang kênh từ đây (giữ trang này mở). Dữ liệu thu nhập đọc từ kênh sẽ tự nhập vào PMS và báo Telegram nếu có lệch.</p>
        <div className="flex flex-wrap gap-2">
          {LINKS.map(([label, url]) => (
            <button key={url} id={`open-${label.split(" ")[0].toLowerCase().replace(".", "")}`} onClick={() => window.open(url, `joy-${label.split(" ")[0]}`)}
              className="px-3 py-2 rounded-lg bg-gray-900 text-white text-sm">{label}</button>
          ))}
        </div>
        <div className="space-y-2">
          {logs.map((l, i) => (
            <div key={i} className={`text-xs rounded-lg p-2 border ${l.ok ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"}`}>
              <b>{l.at} · {l.channel}</b>
              <pre className="whitespace-pre-wrap break-all">{l.text}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
