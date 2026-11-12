"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import Header from "@/components/layout/Header";

type P = { price: number; listPrice: number | null; available: boolean | null } | null;
interface Cell { date: string; base: number | null; direct: number | null; booked: string | null; AIRBNB: P; AIRBNB2: P; BOOKING: P; AGODA: P }
interface Room { roomId: string; roomNo: string; name: string; hasAirbnb2: boolean; cells: Cell[] }
const WD = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
const k = (n: number) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(2).replace(/0$/, "")}tr` : `${Math.round(n / 1000)}k`);
const ROWS: { key: keyof Cell; label: string }[] = [
  { key: "AIRBNB", label: "Airbnb" }, { key: "AIRBNB2", label: "Airbnb (tin 2)" }, { key: "BOOKING", label: "Booking.com" }, { key: "AGODA", label: "Agoda" },
];

export default function ChannelPricesPage() {
  const [days, setDays] = useState(14);
  const [d, setD] = useState<{ dates: string[]; lastScan: string | null; rooms: Room[] } | null>(null);
  const load = useCallback(async () => setD(await fetch(`/api/channel-prices?days=${days}`, { cache: "no-store" }).then((r) => r.json())), [days]);
  useEffect(() => { load(); }, [load]);

  return (
    <>
      <Header title="Giá các kênh" subtitle="Giá khách đang thấy trên Airbnb · Booking.com · Agoda — quét tự động mỗi sáng" />
      <div className="flex-1 overflow-auto p-3 sm:p-5 space-y-4 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {[7, 14, 30].map((n) => <button key={n} onClick={() => setDays(n)} className={`text-sm px-3 py-1.5 rounded-full border ${days === n ? "bg-gray-900 text-white" : "bg-white"}`}>{n} ngày</button>)}
          <span className="text-xs text-gray-500 ml-auto">{d?.lastScan ? `Quét lần cuối: ${new Date(d.lastScan).toLocaleString("vi-VN")}` : "Chưa có dữ liệu quét"}</span>
        </div>
        <p className="text-[11px] text-gray-500">
          Airbnb: giá khách trả sau khuyến mãi (gạch: giá niêm yết). Booking.com: giá "Standard Rate". Agoda: giá phòng "Room Only". <span className="bg-emerald-100 px-1 rounded">xanh</span> = kênh rẻ nhất đêm đó ·
          <span className="bg-amber-100 px-1 rounded ml-1">vàng</span> = rẻ hơn Airbnb &gt;10% (khách dễ chuyển kênh, Airbnb có thể hạ thứ hạng) · ô xám = đã có khách/khoá.
        </p>
        {!d ? <Loader2 className="animate-spin text-gray-400" /> : d.rooms.map((r) => (
          <section key={r.roomId} className="bg-white rounded-xl border p-3 min-w-0">
            <p className="font-semibold text-sm mb-2">{r.roomNo} · {r.name}</p>
            <div className="overflow-x-auto">
              <table className="text-xs tabular-nums border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-white text-left pr-2 font-medium text-gray-500 min-w-[92px]">Kênh</th>
                    {r.cells.map((c) => { const wd = new Date(`${c.date}T00:00:00Z`).getUTCDay(); return <th key={c.date} className={`px-1.5 py-1 font-medium min-w-[54px] ${[5, 6].includes(wd) ? "text-amber-700" : "text-gray-500"}`}>{WD[wd]}<br />{c.date.slice(8)}/{c.date.slice(5, 7)}</th>; })}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.filter((row) => row.key !== "AIRBNB2" || r.hasAirbnb2 || r.cells.some((c) => c.AIRBNB2)).map((row) => (
                    <tr key={row.key}>
                      <td className="sticky left-0 bg-white pr-2 py-1 text-gray-700 font-medium">{row.label}</td>
                      {r.cells.map((c) => {
                        const p = c[row.key] as P;
                        const vals = ROWS.map((x) => (c[x.key] as P)?.price).filter((x): x is number => !!x);
                        const min = vals.length > 1 ? Math.min(...vals) : null;
                        const ab = c.AIRBNB?.price;
                        const under = p && ab && row.key !== "AIRBNB" && row.key !== "AIRBNB2" && p.price < ab * 0.9;
                        return (
                          <td key={c.date} className={`px-1.5 py-1 text-center border-t ${c.booked ? "bg-gray-100 text-gray-400" : under ? "bg-amber-100" : p && min === p.price ? "bg-emerald-50 text-emerald-800" : ""}`}>
                            {p ? <>{k(p.price)}{p.listPrice && p.listPrice !== p.price ? <div className="text-[10px] text-gray-400 line-through">{k(p.listPrice)}</div> : null}</> : <span className="text-gray-300">—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <td className="sticky left-0 bg-white pr-2 py-1 text-gray-500">Trực tiếp (PMS)</td>
                    {r.cells.map((c) => <td key={c.date} className="px-1.5 py-1 text-center border-t text-gray-500">{c.direct ? <b className="text-gray-800">{k(c.direct)}</b> : c.base ? k(c.base) : "—"}</td>)}
                  </tr>
                  <tr>
                    <td className="sticky left-0 bg-white pr-2 py-1 text-gray-400">Tình trạng</td>
                    {r.cells.map((c) => <td key={c.date} className="px-1.5 py-1 text-center border-t text-[10px] text-gray-400">{c.booked ? (c.booked === "BLOCKED" ? "khoá" : "có khách") : "trống"}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
