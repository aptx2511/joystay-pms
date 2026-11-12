"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Loader2, Mail, RefreshCw } from "lucide-react";
import Header from "@/components/layout/Header";

interface Row { id: string; channel: string; kind: string; subject: string; receivedAt: string; status: string; bookingId: string | null; parsed: { code?: string; guestName?: string; guests?: number; payout?: number; total?: number } | null }
const ST: Record<string, string> = { MATCHED: "bg-emerald-100 text-emerald-700", UNMATCHED: "bg-amber-100 text-amber-800", IGNORED: "bg-gray-100 text-gray-500" };
const STT: Record<string, string> = { MATCHED: "Đã khớp", UNMATCHED: "Chờ khớp", IGNORED: "Bỏ qua" };
const KIND: Record<string, string> = { NEW: "Đặt mới", CANCEL: "Huỷ", CHANGE: "Đổi", PAYOUT: "Tiền về", MESSAGE: "Tin nhắn", OTHER: "Khác" };

export default function EmailPage() {
  const [d, setD] = useState<{ script: string; list: Row[]; counts: { status: string; _count: number }[] } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setD(await fetch("/api/inbox", { cache: "no-store" }).then((r) => r.json())), []);
  useEffect(() => { load(); }, [load]);
  const total = d?.counts.reduce((s, c) => s + c._count, 0) ?? 0;

  return (
    <>
      <Header title="Email đặt phòng" subtitle="Gmail → PMS: tên khách, mã đặt phòng, số khách, tiền thực nhận" />
      <div className="flex-1 overflow-auto p-3 sm:p-5 space-y-4">
        {!d ? <Loader2 className="animate-spin text-gray-400" /> : (
          <>
            <section className={`rounded-xl border p-4 ${total ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
              <p className="font-semibold flex items-center gap-2"><Mail size={16} /> {total ? `Đang chạy — đã nhận ${total} email` : "Chưa kết nối Gmail"}</p>
              {!total && (
                <ol className="text-sm text-gray-700 mt-2 space-y-1 list-decimal pl-5">
                  <li>Mở <a className="underline text-sky-700" href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer">script.google.com → Dự án mới</a> bằng tài khoản Gmail nhận email Airbnb/Booking.</li>
                  <li>Bấm <b>Sao chép đoạn mã</b> bên dưới → xoá hết nội dung có sẵn → dán vào → bấm 💾 Lưu.</li>
                  <li>Chọn hàm <b>setup</b> ở thanh trên → bấm <b>▶ Chạy</b> → <b>Cho phép</b> (Google hỏi quyền đọc Gmail &amp; gửi dữ liệu ra ngoài — chỉ gửi email từ Airbnb/Booking sang PMS của bạn).</li>
                  <li>Xong. Cứ 10 phút script tự chuyển email mới; quay lại trang này sẽ thấy danh sách.</li>
                </ol>
              )}
              <div className="flex gap-2 mt-3">
                <button onClick={async () => { await navigator.clipboard.writeText(d.script); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                  className="text-sm px-3 py-2 rounded-lg bg-gray-900 text-white font-semibold flex items-center gap-1.5">{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Đã sao chép" : "Sao chép đoạn mã"}</button>
                <button disabled={busy} onClick={async () => { setBusy(true); await fetch("/api/inbox", { method: "POST" }); await load(); setBusy(false); }}
                  className="text-sm px-3 py-2 rounded-lg bg-white border flex items-center gap-1.5 disabled:opacity-50"><RefreshCw size={15} className={busy ? "animate-spin" : ""} /> Khớp lại</button>
              </div>
              <p className="text-[11px] text-gray-500 mt-2">Đoạn mã có chứa khoá riêng của PMS — chỉ dán vào Google Apps Script của bạn, không gửi cho người khác.</p>
            </section>

            <section className="bg-white rounded-xl border p-3 sm:p-4">
              <p className="text-sm font-semibold mb-2">Email gần đây</p>
              {d.list.length === 0 && <p className="text-sm text-gray-500">Chưa có email nào.</p>}
              <div className="divide-y">
                {d.list.map((r) => (
                  <div key={r.id} className="py-2 text-sm flex items-start gap-2">
                    <span className="text-[11px] text-gray-400 w-14 shrink-0">{new Date(r.receivedAt).toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" })}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate">{r.channel === "AIRBNB" ? "Airbnb" : r.channel === "BOOKING" ? "Booking" : r.channel} · {KIND[r.kind] ?? r.kind} · {r.subject}</p>
                      {r.parsed && (r.parsed.code || r.parsed.guestName) && (
                        <p className="text-xs text-gray-500">{[r.parsed.code, r.parsed.guestName, r.parsed.guests ? `${r.parsed.guests} khách` : null, r.parsed.payout ? `nhận ${Math.round(r.parsed.payout / 1000)}k` : r.parsed.total ? `tổng ${Math.round(r.parsed.total / 1000)}k` : null].filter(Boolean).join(" · ")}</p>
                      )}
                    </div>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${ST[r.status] ?? ""}`}>{STT[r.status] ?? r.status}</span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </>
  );
}
