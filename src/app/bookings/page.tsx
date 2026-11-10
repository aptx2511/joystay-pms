"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { format, parseISO } from "date-fns";
import { Plus, Search, X, ArrowUpDown } from "lucide-react";
import Header from "@/components/layout/Header";
import BookingForm from "@/components/bookings/BookingForm";
import { Booking, SOURCE_META, STATUS_META, BookingSource, BookingStatus } from "@/types";
import { nightCount, formatPrice } from "@/lib/utils";

type Row = Booking & { confirmationCode?: string | null; room?: Booking["room"] & { roomNumber?: string | null } };

const PERIODS = [
  { key: "upcoming", label: "Sắp tới & đang ở" },
  { key: "arrive",   label: "Nhận phòng hôm nay" },
  { key: "depart",   label: "Trả phòng hôm nay" },
  { key: "inhouse",  label: "Đang ở" },
  { key: "past",     label: "Đã qua" },
  { key: "all",      label: "Tất cả" },
  { key: "range",    label: "Chọn ngày…" },
] as const;
type Period = (typeof PERIODS)[number]["key"];

const SOURCES: BookingSource[] = ["AIRBNB", "BOOKING", "AGODA", "TRAVELOKA", "DIRECT", "OFFLINE"];
const STATUSES: BookingStatus[] = ["CONFIRMED", "PENDING", "BLOCKED", "CANCELLED"];
const DEFAULT_STATUSES: BookingStatus[] = ["CONFIRMED", "PENDING"];

/** Hôm nay theo giờ VN, dạng YYYY-MM-DD */
const vnTodayKey = () => new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
const key = (iso: string) => iso.slice(0, 10);
/** tên mặc định từ iCal (Airbnb chỉ gửi "Reserved") → coi như chưa có tên khách thật */
const isPlaceholderName = (n: string) => /^(airbnb|booking\.com|agoda|traveloka)( guest)?( \(|$)|^reserved|not available|closed/i.test(n.trim());
const roomLabel = (b: Row) => (b.room ? (b.room.roomNumber ? `${b.room.roomNumber} · ${b.room.name}` : b.room.name) : "—");

export default function BookingsPage() {
  const [bookings,   setBookings]   = useState<Row[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [formOpen,   setFormOpen]   = useState(false);
  const [editTarget, setEditTarget] = useState<Booking | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);

  // ── Bộ lọc ────────────────────────────────────────────────────────────────
  const [search,   setSearch]   = useState("");
  const [qName,    setQName]    = useState("");
  const [qCode,    setQCode]    = useState("");
  const [noName,   setNoName]   = useState(false);
  const [period,   setPeriod]   = useState<Period>("upcoming");
  const [from,     setFrom]     = useState("");
  const [to,       setTo]       = useState("");
  const [roomId,   setRoomId]   = useState("");
  const [sources,  setSources]  = useState<BookingSource[]>([]);          // trống = tất cả kênh
  const [statuses, setStatuses] = useState<BookingStatus[]>(DEFAULT_STATUSES);
  const [sortAsc,  setSortAsc]  = useState(true);

  const fetchBookings = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/bookings");
      const data = await res.json();
      setBookings(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  const rooms = useMemo(() => {
    const m = new Map<string, Row>();
    for (const b of bookings) if (b.room && !m.has(b.roomId)) m.set(b.roomId, b);
    return [...m.entries()]
      .map(([id, b]) => ({ id, label: roomLabel(b) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [bookings]);

  const filtered = useMemo(() => {
    const today = vnTodayKey();
    const q = search.trim().toLowerCase();
    return bookings
      .filter((b) => {
        const ci = key(b.checkIn), co = key(b.checkOut);
        switch (period) {
          case "upcoming": if (co < today) return false; break;
          case "arrive":   if (ci !== today) return false; break;
          case "depart":   if (co !== today) return false; break;
          case "inhouse":  if (!(ci <= today && co > today)) return false; break;
          case "past":     if (co >= today) return false; break;
          case "range":
            // lượt ở có giao với khoảng ngày đã chọn
            if (from && co <= from) return false;
            if (to && ci > to) return false;
            break;
        }
        if (roomId && b.roomId !== roomId) return false;
        if (sources.length && !sources.includes(b.source as BookingSource)) return false;
        if (statuses.length && !statuses.includes(b.status as BookingStatus)) return false;
        if (qName && !b.guestName.toLowerCase().includes(qName.trim().toLowerCase())) return false;
        if (qCode && !(b.confirmationCode ?? "").toLowerCase().includes(qCode.trim().toLowerCase())) return false;
        if (noName && !isPlaceholderName(b.guestName)) return false;
        if (q) {
          const hay = `${b.guestName} ${roomLabel(b)} ${b.confirmationCode ?? ""} ${b.notes ?? ""}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (sortAsc ? 1 : -1) * a.checkIn.localeCompare(b.checkIn));
  }, [bookings, search, qName, qCode, noName, period, from, to, roomId, sources, statuses, sortAsc]);

  const summary = useMemo(() => {
    const confirmed = filtered.filter((b) => b.status === "CONFIRMED");
    return {
      count: filtered.length,
      nights: confirmed.reduce((s, b) => s + nightCount(b.checkIn, b.checkOut), 0),
      revenue: confirmed.reduce((s, b) => s + (b.totalPrice ?? 0), 0),
    };
  }, [filtered]);

  const isDefault =
    !search && !qName && !qCode && !noName && period === "upcoming" && !roomId && sources.length === 0 &&
    statuses.length === DEFAULT_STATUSES.length && DEFAULT_STATUSES.every((s) => statuses.includes(s));

  function resetFilters() {
    setSearch(""); setQName(""); setQCode(""); setNoName(false); setPeriod("upcoming"); setFrom(""); setTo(""); setRoomId("");
    setSources([]); setStatuses(DEFAULT_STATUSES); setSortAsc(true);
  }

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  function openEdit(booking: Booking) {
    setEditTarget(booking);
    setFormOpen(true);
  }

  function openNew() {
    setEditTarget(undefined);
    setFormOpen(true);
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Bookings"
        subtitle={`${summary.count} / ${bookings.length} booking · ${summary.nights} đêm · ${formatPrice(summary.revenue)} (đã xác nhận)`}
        actions={
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium"
          >
            <Plus size={16} />
            <span className="hidden sm:inline">New Booking</span>
          </button>
        }
      />

      <div className="flex-1 overflow-auto p-4 md:p-5">
        {/* ── Bộ lọc ── */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-3 md:p-4 mb-4 space-y-3">
          {/* Thời gian */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`shrink-0 text-xs md:text-sm px-3 py-1.5 rounded-full border transition-colors ${
                  period === p.key ? "bg-slate-900 text-white border-slate-900" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {period === "range" && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="text-gray-500">Từ</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5" />
              <label className="text-gray-500">đến</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-gray-300 rounded-lg px-2 py-1.5" />
              <span className="text-xs text-gray-400">(lượt ở có ít nhất 1 đêm trong khoảng này)</span>
            </div>
          )}

          {/* Tìm + phòng + sắp xếp */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_220px_auto] gap-2">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Tìm tên khách, phòng, mã đặt phòng (HM…), ghi chú…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="text-sm border border-gray-300 rounded-lg px-2 py-2 bg-white">
              <option value="">Tất cả phòng</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            <button onClick={() => setSortAsc((v) => !v)} className="flex items-center justify-center gap-1.5 text-sm px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
              <ArrowUpDown size={14} /> Nhận phòng {sortAsc ? "sớm → muộn" : "muộn → sớm"}
            </button>
          </div>

          {/* Tên khách + Booking ID */}
          <div className="grid grid-cols-2 md:grid-cols-[1fr_1fr_auto] gap-2">
            <input type="text" placeholder="Tên khách…" value={qName} onChange={(e) => setQName(e.target.value)}
              className="min-w-0 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400" />
            <input type="text" placeholder="Booking ID (HM…)" value={qCode} onChange={(e) => setQCode(e.target.value)}
              className="min-w-0 px-3 py-2 text-sm font-mono uppercase border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400" />
            <label className="col-span-2 md:col-span-1 flex items-center gap-2 text-xs text-gray-600 px-1">
              <input type="checkbox" checked={noName} onChange={(e) => setNoName(e.target.checked)} />
              Chỉ booking chưa có tên khách thật
            </label>
          </div>

          {/* Kênh + trạng thái */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-gray-400 uppercase tracking-wide mr-1">Kênh</span>
              {SOURCES.map((s) => {
                const on = sources.includes(s);
                return (
                  <button key={s} onClick={() => setSources((l) => toggle(l, s))}
                    className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${on ? "bg-amber-50 border-amber-400 text-amber-900" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${SOURCE_META[s].bgClass}`} />{SOURCE_META[s].label}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-gray-400 uppercase tracking-wide mr-1">Trạng thái</span>
              {STATUSES.map((s) => {
                const on = statuses.includes(s);
                return (
                  <button key={s} onClick={() => setStatuses((l) => toggle(l, s))}
                    className={`text-xs px-2.5 py-1 rounded-full border ${on ? `${STATUS_META[s].bgClass} ${STATUS_META[s].textClass} border-transparent` : "border-gray-200 text-gray-400 hover:bg-gray-50"}`}>
                    {STATUS_META[s].label}
                  </button>
                );
              })}
            </div>
            {!isDefault && (
              <button onClick={resetFilters} className="ml-auto inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800">
                <X size={13} /> Xoá lọc
              </button>
            )}
          </div>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden space-y-3">
          {loading ? (
            <div className="text-center py-10 text-gray-400">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10 text-gray-400">Không có booking khớp bộ lọc.</div>
          ) : (
            filtered.map((booking) => {
              const src    = SOURCE_META[booking.source as BookingSource];
              const status = STATUS_META[booking.status as BookingStatus];
              return (
                <div
                  key={booking.id}
                  onClick={() => openEdit(booking)}
                  className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 cursor-pointer active:bg-amber-50 transition-colors"
                >
                  <div className="flex items-start justify-between mb-1.5">
                    <span className={`font-semibold ${isPlaceholderName(booking.guestName) ? "text-gray-400 italic" : "text-gray-900"}`}>{booking.guestName}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${status.bgClass} ${status.textClass}`}>
                      {status.label}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mb-2">{roomLabel(booking)}</p>
                  <p className="text-xs text-gray-500 mb-2">Booking ID: <span className="font-mono text-gray-800">{booking.confirmationCode ?? "—"}</span></p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">
                      {format(parseISO(booking.checkIn), "dd/MM")} → {format(parseISO(booking.checkOut), "dd/MM/yy")}
                      {" · "}{nightCount(booking.checkIn, booking.checkOut)} đêm
                    </span>
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${src.textClass}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${src.bgClass}`} />
                      {src.label}
                    </span>
                  </div>
                  {booking.totalPrice != null && (
                    <p className="text-sm font-bold text-gray-800 mt-2 font-mono">
                      {formatPrice(booking.totalPrice)}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["Khách", "Booking ID", "Phòng", "Nhận phòng", "Trả phòng", "Đêm", "Kênh", "Trạng thái", "Giá"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-gray-400">Loading…</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-gray-400">Không có booking khớp bộ lọc.</td>
                </tr>
              ) : (
                filtered.map((booking) => {
                  const src    = SOURCE_META[booking.source as BookingSource];
                  const status = STATUS_META[booking.status as BookingStatus];
                  return (
                    <tr
                      key={booking.id}
                      onClick={() => openEdit(booking)}
                      className="hover:bg-amber-50/40 cursor-pointer transition-colors"
                    >
                      <td className={`px-4 py-3 font-medium ${isPlaceholderName(booking.guestName) ? "text-gray-400 italic" : "text-gray-900"}`}>{booking.guestName}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">{booking.confirmationCode ?? "—"}</td>
                      <td className="px-4 py-3 text-gray-600">{roomLabel(booking)}</td>
                      <td className="px-4 py-3 text-gray-600">{format(parseISO(booking.checkIn),  "dd MMM yyyy")}</td>
                      <td className="px-4 py-3 text-gray-600">{format(parseISO(booking.checkOut), "dd MMM yyyy")}</td>
                      <td className="px-4 py-3 text-gray-600">{nightCount(booking.checkIn, booking.checkOut)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${src.textClass} bg-opacity-10`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${src.bgClass}`} />
                          {src.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${status.bgClass} ${status.textClass}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 font-mono text-xs">
                        {formatPrice(booking.totalPrice)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <BookingForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => setRefreshKey((k) => k + 1)}
        editBooking={editTarget}
      />
    </div>
  );
}
