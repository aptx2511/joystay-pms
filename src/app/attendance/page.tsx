"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Clock, DollarSign, CalendarDays, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import Header from "@/components/layout/Header";
import { formatPrice } from "@/lib/utils";
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  getDay, isToday, addMonths, subMonths,
} from "date-fns";
import { vi } from "date-fns/locale";

const RATE      = 75_000; // VND per hour
const MAX_HOURS = 24;
const HOLD_MS   = 600;    // ms to trigger long-press delete
const WEEK_HEADERS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

interface Shift {
  id: string;
  workDate: string; // "YYYY-MM-DD"
  hours: number;
  note: string | null;
}

function toDateStr(d: Date) {
  return format(d, "yyyy-MM-dd");
}

// Color scale based on hours (1–24)
function cellColor(hours: number): string {
  if (hours === 0)  return "bg-gray-50 border-gray-200 text-gray-400";
  if (hours <= 3)   return "bg-amber-50 border-amber-200 text-amber-700";
  if (hours <= 8)   return "bg-amber-100 border-amber-300 text-amber-800";
  if (hours <= 16)  return "bg-amber-200 border-amber-400 text-amber-900";
  return "bg-orange-200 border-orange-400 text-orange-900";
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
        </div>
        <div className={`p-2.5 rounded-lg ${color}`}>
          <Icon size={18} className="text-white" />
        </div>
      </div>
    </div>
  );
}

export default function AttendancePage() {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [shifts, setShifts]             = useState<Shift[]>([]);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState<string | null>(null);
  const [pressing, setPressing]         = useState<string | null>(null); // dateStr being held

  // Long-press refs (not state — avoid re-renders during hold)
  const holdTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress  = useRef(false);

  const monthStr = format(currentMonth, "yyyy-MM");

  const fetchShifts = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/shifts?month=${monthStr}`);
      setShifts(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [monthStr]);

  useEffect(() => { fetchShifts(); }, [fetchShifts]);

  const shiftMap = new Map<string, Shift>(shifts.map((s) => [s.workDate, s]));

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end:   endOfMonth(currentMonth),
  });
  const firstDow     = getDay(days[0]);
  const leadingEmpty = firstDow === 0 ? 6 : firstDow - 1;

  const totalDays  = shifts.length;
  const totalHours = shifts.reduce((s, sh) => s + sh.hours, 0);
  const totalPay   = totalHours * RATE;

  // ── API helpers ──────────────────────────────────────────────────────────────
  async function apiIncrement(date: Date) {
    const dateStr     = toDateStr(date);
    const existing    = shiftMap.get(dateStr);
    const nextHours   = Math.min(MAX_HOURS, (existing?.hours ?? 0) + 1);

    setSaving(dateStr);
    try {
      const res     = await fetch("/api/shifts", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ workDate: dateStr, hours: nextHours }),
      });
      const updated = await res.json() as Shift;
      setShifts((prev) => [
        ...prev.filter((s) => s.workDate !== dateStr),
        updated,
      ]);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(null);
    }
  }

  async function apiDelete(date: Date) {
    const dateStr = toDateStr(date);
    setSaving(dateStr);
    try {
      await fetch(`/api/shifts?date=${dateStr}`, { method: "DELETE" });
      setShifts((prev) => prev.filter((s) => s.workDate !== dateStr));
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(null);
    }
  }

  // ── Press handlers ───────────────────────────────────────────────────────────
  function startPress(date: Date) {
    const dateStr = toDateStr(date);
    if (!shiftMap.get(dateStr)) return; // no shift → skip long-press, only allow click to add

    didLongPress.current = false;
    setPressing(dateStr);

    holdTimer.current = setTimeout(() => {
      didLongPress.current = true;
      setPressing(null);
      apiDelete(date);
    }, HOLD_MS);
  }

  function endPress(date: Date) {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setPressing(null);

    if (!didLongPress.current) {
      // Short click → increment
      apiIncrement(date);
    }
    didLongPress.current = false;
  }

  function cancelPress() {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setPressing(null);
    didLongPress.current = false;
  }

  // ── Cleanup on unmount ───────────────────────────────────────────────────────
  useEffect(() => () => { if (holdTimer.current) clearTimeout(holdTimer.current); }, []);

  const sortedShifts = [...shifts].sort((a, b) => a.workDate.localeCompare(b.workDate));

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Chấm công"
        subtitle="Cô giúp việc · 75,000đ / tiếng · tối đa 24 tiếng / ngày"
      />

      <div className="flex-1 overflow-auto p-5 space-y-5">
        {/* ── Stats ── */}
        <div className="grid grid-cols-3 gap-4">
          <StatCard
            icon={CalendarDays}
            label="Ngày làm"
            value={`${totalDays} ngày`}
            sub={format(currentMonth, "MMMM yyyy", { locale: vi })}
            color="bg-blue-500"
          />
          <StatCard
            icon={Clock}
            label="Tổng giờ"
            value={`${totalHours} tiếng`}
            sub={`avg ${totalDays > 0 ? (totalHours / totalDays).toFixed(1) : 0}h / ngày`}
            color="bg-amber-500"
          />
          <StatCard
            icon={DollarSign}
            label="Lương tháng"
            value={formatPrice(totalPay)}
            sub={`${totalHours} tiếng × 75,000đ`}
            color="bg-emerald-500"
          />
        </div>

        {/* ── Calendar ── */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-5">
            <button
              onClick={() => setCurrentMonth((m) => subMonths(m, 1))}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ChevronLeft size={18} className="text-gray-600" />
            </button>
            <h3 className="text-sm font-semibold text-gray-800 capitalize">
              {format(currentMonth, "MMMM yyyy", { locale: vi })}
            </h3>
            <button
              onClick={() => setCurrentMonth((m) => addMonths(m, 1))}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ChevronRight size={18} className="text-gray-600" />
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-2">
            {WEEK_HEADERS.map((d) => (
              <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
            ))}
          </div>

          {/* Day cells */}
          {loading ? (
            <div className="flex items-center justify-center h-36 text-gray-400 text-sm">Đang tải…</div>
          ) : (
            <div className="grid grid-cols-7 gap-1.5">
              {Array.from({ length: leadingEmpty }).map((_, i) => <div key={`e${i}`} />)}

              {days.map((day) => {
                const dateStr      = toDateStr(day);
                const shift        = shiftMap.get(dateStr);
                const hours        = shift?.hours ?? 0;
                const isCurrentDay = isToday(day);
                const isSavingThis = saving === dateStr;
                const isHolding    = pressing === dateStr;

                const title = hours === 0
                  ? "Click để thêm 1 tiếng"
                  : hours < MAX_HOURS
                  ? `${hours}h — click +1h · giữ để xoá`
                  : `${hours}h (tối đa) — giữ để xoá`;

                return (
                  <button
                    key={dateStr}
                    disabled={isSavingThis}
                    title={title}
                    onMouseDown={() => startPress(day)}
                    onMouseUp={() => endPress(day)}
                    onMouseLeave={cancelPress}
                    onTouchStart={(e) => { e.preventDefault(); startPress(day); }}
                    onTouchEnd={() => endPress(day)}
                    onTouchCancel={cancelPress}
                    onContextMenu={(e) => e.preventDefault()}
                    className={[
                      "border rounded-lg flex flex-col items-center justify-center gap-0.5",
                      "aspect-square transition-all duration-150 select-none cursor-pointer",
                      isHolding
                        ? "bg-red-100 border-red-400 text-red-700 scale-90"
                        : cellColor(hours),
                      isCurrentDay && !isHolding ? "ring-2 ring-offset-1 ring-amber-400" : "",
                      isSavingThis ? "opacity-50 cursor-wait" : "",
                    ].join(" ")}
                  >
                    <span className="text-sm font-semibold leading-none">{format(day, "d")}</span>
                    {hours > 0 && !isHolding && (
                      <span className="text-[10px] font-bold leading-none opacity-90">{hours}h</span>
                    )}
                    {isHolding && (
                      <Trash2 size={10} className="opacity-80" />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t border-gray-100 text-xs text-gray-500">
            <span className="font-medium">Thao tác:</span>
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded border border-gray-200 bg-gray-50 inline-block shrink-0" />
              Chưa làm
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded border border-amber-200 bg-amber-50 inline-block shrink-0" />
              Click → +1 tiếng (tối đa 24h)
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3.5 h-3.5 rounded border border-red-400 bg-red-100 inline-block shrink-0" />
              Giữ chuột → xoá ngày
            </div>
          </div>
        </div>

        {/* ── Detail list ── */}
        {sortedShifts.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">
              Chi tiết — {format(currentMonth, "MMMM yyyy", { locale: vi })}
            </h3>
            <div className="space-y-0">
              {sortedShifts.map((s) => {
                const d = new Date(s.workDate + "T00:00:00.000Z");
                return (
                  <div key={s.id} className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-700 capitalize">
                        {format(d, "EEEE, dd/MM", { locale: vi })}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
                        {s.hours} tiếng
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-gray-800">
                      {formatPrice(s.hours * RATE)}
                    </span>
                  </div>
                );
              })}
              <div className="flex items-center justify-between pt-3 mt-1">
                <span className="text-sm font-semibold text-gray-700">
                  Tổng · {totalDays} ngày · {totalHours} tiếng
                </span>
                <span className="text-base font-bold text-emerald-700">
                  {formatPrice(totalPay)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
