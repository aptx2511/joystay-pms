"use client";
/**
 * Sổ OTA — trang nhận dữ liệu thu nhập từ trang quản lý của kênh (17/11/2026).
 * Bấm "Mở …" → tab kênh mở ra (giữ liên kết với trang này). Claude chạy đoạn đọc dữ liệu trong tab kênh,
 * đoạn đó gửi về đây bằng window.opener.postMessage({ type: "joy-ota", channel, rows, snapshot }) → trang này nhập vào PMS.
 */
import { useEffect, useState } from "react";
import Header from "@/components/layout/Header";

const ORIGINS = [/^https:\/\/www\.airbnb\.[a-z.]+$/, /^https:\/\/portal\.agoda\.com$/, /^https:\/\/admin\.booking\.com$/];
const LINKS: [string, string][] = [
  ["Airbnb — Thu nhập (sắp tới)", "https://www.airbnb.com.vn/earnings/343161120/upcoming"],
  ["Agoda — Đặt phòng", "https://portal.agoda.com/mldc/en-us/app/postbook/booking/96649093"],
  ["Booking.com — Extranet", "https://admin.booking.com/"],
];
type Log = { at: string; channel: string; text: string; ok: boolean };

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
      <Header title="Sổ OTA" />
      <div className="p-4 space-y-4 max-w-3xl">
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
