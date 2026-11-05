"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Copy, Check, ExternalLink, KeyRound, ShieldCheck, AlertTriangle, Star, Eye } from "lucide-react";
import Header from "@/components/layout/Header";

interface Stay {
  bookingId: string; guestName: string; source: string; confirmationCode: string | null;
  room: string; roomNumber: string | null; checkIn: string; checkOut: string; phase: string;
  link: string | null; phoneLast4: string | null;
  idCount: number; idPhotos: string[]; idSubmittedAt: string | null; idPurged: boolean; registeredAt: string | null;
  doorCodes: { door: string; code: string }[]; codesSource: string | null;
  firstViewAt: string | null; codesViewedAt: string | null; arrivalTime: string | null; guests: number | null;
  issues: { at: string; text: string }[]; feedback: { rating: number; text: string } | null;
}
interface Data { today: string; lookupLink: string; stays: Stay[] }

const DEFAULT_DOORS = ["Main door · Cửa nhà", "Inner gate · Cổng trong", "Phòng"];
const ddmm = (k: string) => `${k.slice(8, 10)}/${k.slice(5, 7)}`;
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }) : "");

function guestMessage(s: Stay) {
  return [
    `Hi${s.guestName && !/guest/i.test(s.guestName) ? " " + s.guestName.split(" ")[0] : ""}! Welcome to Joystay 🌿`,
    `Please open your personal stay page to complete the guest registration (required by Vietnamese law) — your door codes will appear there on your check-in day:`,
    s.link ?? "",
    ``,
    `Xin chào! Vui lòng mở link trên để gửi giấy tờ khai báo lưu trú — mã cửa sẽ hiện tại đó vào ngày nhận phòng.`,
  ].join("\n");
}

export default function StaysPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<string, { door: string; code: string }[]>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/stay/admin", { cache: "no-store" });
      const d = await r.json();
      if (r.ok) setData(d); else setMsg(d.error ?? "Lỗi tải dữ liệu");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    const r = await fetch(`/api/stay/admin/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) setMsg((await r.json()).error ?? "Lỗi");
    await load();
  }

  async function copy(key: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2500);
  }

  const groups = useMemo(() => {
    if (!data) return [];
    const inHouse = data.stays.filter((s) => s.checkIn < data.today && s.checkOut > data.today);
    const arrivals = new Map<string, Stay[]>();
    for (const s of data.stays) if (s.checkIn >= data.today) arrivals.set(s.checkIn, [...(arrivals.get(s.checkIn) ?? []), s]);
    return [
      ...[...arrivals.entries()].map(([d, list]) => ({ title: d === data.today ? `Nhận phòng HÔM NAY ${ddmm(d)}` : `Nhận phòng ${ddmm(d)}`, list })),
      { title: "Đang ở", list: inHouse },
    ].filter((g) => g.list.length);
  }, [data]);

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Lưu trú"
        subtitle="Cổng khách · giấy tờ khai báo · mã cửa · sự cố"
        actions={
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium disabled:opacity-60">
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Cập nhật
          </button>
        }
      />
      <div className="flex-1 overflow-auto p-4 md:p-5 space-y-5">
        {msg && <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-xl px-4 py-3">{msg}</div>}
        {data && (
          <p className="text-xs text-gray-500">
            Link tra cứu chung (dán vào tin nhắn hẹn giờ Airbnb): <code className="bg-gray-100 px-1.5 py-0.5 rounded">{data.lookupLink}</code>{" "}
            <button onClick={() => copy("lookup", data.lookupLink)} className="underline">{copied === "lookup" ? "đã copy" : "copy"}</button>
          </p>
        )}
        {!loading && groups.length === 0 && <p className="text-sm text-gray-400">Không có khách đang ở hoặc sắp đến trong 4 ngày tới.</p>}

        {groups.map((g) => (
          <section key={g.title}>
            <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">{g.title} ({g.list.length})</h2>
            <div className="space-y-3">
              {g.list.map((s) => {
                const codes = edit[s.bookingId] ?? (s.doorCodes.length ? s.doorCodes : DEFAULT_DOORS.map((d) => ({ door: d === "Phòng" ? `Room ${s.roomNumber ?? ""} · Phòng ${s.roomNumber ?? ""}` : d, code: "" })));
                return (
                  <div key={s.bookingId} className="bg-white border border-gray-200 rounded-xl p-4">
                    <div className="flex flex-wrap justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-900">{s.guestName} <span className="text-xs font-normal text-gray-500">· {s.source}{s.confirmationCode ? ` · ${s.confirmationCode}` : ""}</span></p>
                        <p className="text-sm text-gray-500">{s.room} · {ddmm(s.checkIn)} → {ddmm(s.checkOut)}{s.guests ? ` · ${s.guests} khách` : ""}{s.arrivalTime ? ` · đến ~${s.arrivalTime}` : ""}</p>
                      </div>
                      <div className="flex gap-2 items-start">
                        {s.link && (
                          <>
                            <button onClick={() => copy(`m-${s.bookingId}`, guestMessage(s))} className="flex items-center gap-1 text-sm px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg">
                              {copied === `m-${s.bookingId}` ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />} Tin gửi khách
                            </button>
                            <a href={s.link} target="_blank" rel="noreferrer" className="p-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg" title="Xem như khách"><ExternalLink size={14} /></a>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5 mt-2 text-[11px]">
                      <Pill ok={Boolean(s.firstViewAt)} label={s.firstViewAt ? `Khách đã mở link ${time(s.firstViewAt)}` : "Khách chưa mở link"} />
                      <Pill ok={Boolean(s.idSubmittedAt)} label={s.idSubmittedAt ? `Giấy tờ ${s.idCount} ảnh` : s.idCount ? `Đang tải ${s.idCount} ảnh` : "Chưa có giấy tờ"} />
                      <Pill ok={s.doorCodes.length > 0} label={s.doorCodes.length ? `Có mã (${s.codesSource === "TTLOCK" ? "TTLock tự cấp" : "nhập tay"})` : "Chưa có mã"} />
                      <Pill ok={Boolean(s.codesViewedAt)} label={s.codesViewedAt ? `Đã xem mã ${time(s.codesViewedAt)}` : "Chưa xem mã"} />
                      <Pill ok={Boolean(s.registeredAt)} label={s.registeredAt ? "Đã khai báo" : "Chưa khai báo"} />
                    </div>

                    {s.issues.length > 0 && (
                      <div className="mt-3 bg-orange-50 border border-orange-200 rounded-lg p-2.5 text-sm text-orange-900 space-y-1">
                        {s.issues.map((i) => <p key={i.at} className="flex gap-1.5"><AlertTriangle size={14} className="shrink-0 mt-0.5" /> {time(i.at)} — {i.text}</p>)}
                      </div>
                    )}
                    {s.feedback && (
                      <p className="mt-2 text-sm text-gray-700 flex gap-1.5"><Star size={14} className="text-amber-500 shrink-0 mt-0.5" /> {s.feedback.rating}/5 {s.feedback.text && `— ${s.feedback.text}`}</p>
                    )}

                    <div className="grid md:grid-cols-2 gap-4 mt-3">
                      {/* Giấy tờ */}
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-1.5 flex items-center gap-1"><ShieldCheck size={13} /> Giấy tờ khai báo</p>
                        {s.idPurged ? <p className="text-xs text-gray-400">Ảnh đã tự xoá (quá 30 ngày sau trả phòng)</p> : (
                          <div className="flex gap-2 flex-wrap">
                            {s.idPhotos.map((u) => (
                              <a key={u} href={u} target="_blank" rel="noreferrer">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={u} alt="Giấy tờ" className="w-24 h-16 object-cover rounded-lg border" />
                              </a>
                            ))}
                            {s.idPhotos.length === 0 && <p className="text-xs text-gray-400">Chưa có — khách gửi qua link.</p>}
                          </div>
                        )}
                        <label className="mt-2 flex items-center gap-2 text-sm">
                          <input type="checkbox" checked={Boolean(s.registeredAt)} onChange={(e) => patch(s.bookingId, { registered: e.target.checked })} />
                          Đã khai báo lưu trú {s.registeredAt && <span className="text-xs text-gray-400">({time(s.registeredAt)})</span>}
                        </label>
                      </div>

                      {/* Mã cửa */}
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-1.5 flex items-center gap-1"><KeyRound size={13} /> Mã cửa (khách thấy sau khi gửi giấy tờ, từ 10:00 ngày nhận phòng)</p>
                        <div className="space-y-1.5">
                          {codes.map((c, i) => (
                            <div key={i} className="flex gap-1.5">
                              <input value={c.door} onChange={(e) => setEdit((p) => ({ ...p, [s.bookingId]: codes.map((x, j) => (j === i ? { ...x, door: e.target.value } : x)) }))}
                                className="w-1/2 text-sm border border-gray-300 rounded-lg px-2 py-1.5" />
                              <input value={c.code} inputMode="numeric" placeholder="mã" onChange={(e) => setEdit((p) => ({ ...p, [s.bookingId]: codes.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)) }))}
                                className="w-1/2 text-sm border border-gray-300 rounded-lg px-2 py-1.5 tracking-widest" />
                            </div>
                          ))}
                        </div>
                        {edit[s.bookingId] && (
                          <button onClick={async () => { await patch(s.bookingId, { doorCodes: edit[s.bookingId], source: "MANUAL" }); setEdit((p) => { const n = { ...p }; delete n[s.bookingId]; return n; }); }}
                            className="mt-2 text-sm px-3 py-1.5 bg-gray-800 text-white rounded-lg">Lưu mã</button>
                        )}
                        {s.doorCodes.length > 0 && !edit[s.bookingId] && (
                          <p className="text-xs text-gray-400 mt-1 flex items-center gap-1"><Eye size={12} /> Muốn đổi mã: sửa trực tiếp rồi bấm Lưu.</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Pill({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`px-2 py-0.5 rounded-full ${ok ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{ok ? "✓ " : ""}{label}</span>;
}
