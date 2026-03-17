"use client";

import { useState, useEffect, useCallback } from "react";
import {
  format,
  addDays,
  startOfMonth,
  eachDayOfInterval,
  isToday,
  isSunday,
  isSaturday,
  differenceInDays,
  parseISO,
  addMonths,
  subMonths,
} from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Booking, Room, SOURCE_META, BookingSource } from "@/types";

const CELL_W   = 44;  // px per day column
const ROW_H    = 52;  // px per room row
const DAYS_SHOWN = 30;

interface Props {
  onAddBooking?: (prefillDate?: string, prefillRoomId?: string) => void;
  onEditBooking?: (booking: Booking) => void;
  refreshKey?: number; // increment to force re-fetch
}

export default function GanttCalendar({ onAddBooking, onEditBooking, refreshKey }: Props) {
  const [windowStart, setWindowStart] = useState<Date>(() => startOfMonth(new Date()));
  const [rooms,    setRooms]    = useState<Room[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [tooltip,  setTooltip]  = useState<{ booking: Booking; x: number; y: number } | null>(null);

  const days = eachDayOfInterval({
    start: windowStart,
    end:   addDays(windowStart, DAYS_SHOWN - 1),
  });

  // ── Data fetching ────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const start = format(windowStart,               "yyyy-MM-dd");
      const end   = format(addDays(windowStart, DAYS_SHOWN), "yyyy-MM-dd");

      const [roomsRes, bookingsRes] = await Promise.all([
        fetch("/api/rooms"),
        fetch(`/api/bookings?start=${start}&end=${end}`),
      ]);

      setRooms(await roomsRes.json());
      setBookings(await bookingsRes.json());
    } catch (err) {
      console.error("GanttCalendar fetch error:", err);
    } finally {
      setLoading(false);
    }
  }, [windowStart, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(); }, [fetchData]);

  // ── Navigation ───────────────────────────────────────────────────────────────
  const prevPeriod = () => setWindowStart((d) => subMonths(d, 1));
  const nextPeriod = () => setWindowStart((d) => addMonths(d, 1));
  const goToday    = () => setWindowStart(startOfMonth(new Date()));

  // ── Booking positioning ──────────────────────────────────────────────────────
  function getBookingLayout(booking: Booking) {
    const ci = parseISO(booking.checkIn);
    const co = parseISO(booking.checkOut);
    const rawStart = differenceInDays(ci, windowStart);
    const rawEnd   = differenceInDays(co, windowStart);
    const visStart = Math.max(0, rawStart);
    const visEnd   = Math.min(DAYS_SHOWN, rawEnd);
    if (visStart >= DAYS_SHOWN || visEnd <= 0) return null; // not visible
    return {
      left:  visStart * CELL_W + 2,
      width: (visEnd - visStart) * CELL_W - 4,
    };
  }

  function bookingsForRoom(roomId: string) {
    return bookings.filter(
      (b) => b.roomId === roomId && b.status !== "CANCELLED"
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2">
          <button
            onClick={prevPeriod}
            className="p-1.5 rounded hover:bg-gray-200 transition-colors"
            title="Previous month"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="font-semibold text-gray-800 w-40 text-center">
            {format(windowStart, "MMMM yyyy")}
          </span>
          <button
            onClick={nextPeriod}
            className="p-1.5 rounded hover:bg-gray-200 transition-colors"
            title="Next month"
          >
            <ChevronRight size={18} />
          </button>
          <button
            onClick={goToday}
            className="ml-2 text-xs px-2.5 py-1 rounded bg-amber-100 text-amber-800 hover:bg-amber-200 font-medium transition-colors"
          >
            Today
          </button>
        </div>

        {onAddBooking && (
          <button
            onClick={() => onAddBooking()}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium transition-colors"
          >
            <Plus size={16} /> New Booking
          </button>
        )}
      </div>

      {/* ── Scrollable Gantt ── */}
      <div className="overflow-x-auto gantt-scroll">
        <div style={{ minWidth: CELL_W * DAYS_SHOWN + 180 }}>

          {/* ── Header row ── */}
          <div className="flex border-b border-gray-200 bg-gray-50 sticky top-0 z-20">
            {/* Room label column */}
            <div className="gantt-row-label text-xs font-medium text-gray-500 uppercase tracking-wide flex items-end px-3 pb-2">
              Room
            </div>
            {/* Day headers */}
            {days.map((day) => {
              const today    = isToday(day);
              const weekend  = isSaturday(day) || isSunday(day);
              return (
                <div
                  key={day.toISOString()}
                  className={`gantt-header-cell flex flex-col items-center justify-end pb-1 text-xs
                    ${today   ? "bg-amber-100 text-amber-800 font-bold" : ""}
                    ${weekend && !today ? "bg-gray-100 text-gray-500"   : "text-gray-600"}
                  `}
                >
                  <span className="leading-none">{format(day, "d")}</span>
                  <span className="text-gray-400 text-[10px]">{format(day, "EEE")}</span>
                </div>
              );
            })}
          </div>

          {/* ── Room rows ── */}
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400 text-sm">
              Loading calendar…
            </div>
          ) : (
            rooms.map((room, idx) => (
              <div
                key={room.id}
                className={`flex relative ${idx % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}
                style={{ height: ROW_H }}
              >
                {/* Room label */}
                <div className="gantt-row-label flex flex-col justify-center px-3">
                  <span className="text-sm font-medium text-gray-800 truncate">{room.name}</span>
                  <span className="text-xs text-gray-400">{room.size} m²</span>
                </div>

                {/* Day grid lines */}
                <div className="flex flex-1 relative">
                  {days.map((day) => {
                    const today   = isToday(day);
                    const weekend = isSaturday(day) || isSunday(day);
                    return (
                      <div
                        key={day.toISOString()}
                        onClick={() => onAddBooking?.(format(day, "yyyy-MM-dd"), room.id)}
                        className={`gantt-cell cursor-pointer transition-colors
                          ${today   ? "bg-amber-50"         : ""}
                          ${weekend && !today ? "bg-gray-100/60" : "hover:bg-blue-50/40"}
                        `}
                        title={`Add booking: ${room.name} on ${format(day, "dd MMM yyyy")}`}
                      />
                    );
                  })}

                  {/* Booking blocks */}
                  {bookingsForRoom(room.id).map((booking) => {
                    const layout = getBookingLayout(booking);
                    if (!layout) return null;
                    const meta = SOURCE_META[booking.source as BookingSource];
                    const isCancelled = booking.status === "CANCELLED";
                    const isPending   = booking.status === "PENDING";

                    return (
                      <div
                        key={booking.id}
                        className={`absolute top-[6px] rounded-md text-white text-xs font-medium
                          flex items-center px-2 overflow-hidden whitespace-nowrap cursor-pointer
                          shadow-sm transition-opacity hover:opacity-90
                          ${meta.bgClass}
                          ${isCancelled ? "opacity-40 line-through" : ""}
                          ${isPending   ? "opacity-70 border-2 border-dashed border-white/60" : ""}
                        `}
                        style={{
                          left:   layout.left,
                          width:  layout.width,
                          height: ROW_H - 12,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditBooking?.(booking);
                        }}
                        onMouseEnter={(e) => {
                          setTooltip({ booking, x: e.clientX, y: e.clientY });
                        }}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        <span className="truncate">{booking.guestName}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Tooltip ── */}
      {tooltip && (
        <div
          className="fixed z-50 bg-slate-900 text-white text-xs rounded-lg px-3 py-2.5 shadow-xl pointer-events-none"
          style={{ top: tooltip.y + 14, left: tooltip.x + 10, maxWidth: 220 }}
        >
          <p className="font-semibold">{tooltip.booking.guestName}</p>
          <p className="text-slate-300 mt-0.5">
            {format(parseISO(tooltip.booking.checkIn),  "dd MMM")} →{" "}
            {format(parseISO(tooltip.booking.checkOut), "dd MMM yyyy")}
          </p>
          <p className="text-slate-400 mt-0.5 flex items-center gap-1">
            <span
              className={`inline-block w-2 h-2 rounded-full ${SOURCE_META[tooltip.booking.source as BookingSource].bgClass}`}
            />
            {SOURCE_META[tooltip.booking.source as BookingSource].label}
            {" · "}
            {tooltip.booking.status}
          </p>
          {tooltip.booking.totalPrice != null && (
            <p className="text-amber-300 mt-0.5 font-medium">
              {new Intl.NumberFormat("vi-VN").format(tooltip.booking.totalPrice)} VND
            </p>
          )}
        </div>
      )}
    </div>
  );
}
