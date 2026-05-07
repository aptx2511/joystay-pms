"use client";

import { useState, useEffect, useCallback } from "react";
import { TrendingUp, DollarSign, Calendar, BedDouble, AlertCircle, RefreshCw } from "lucide-react";
import Header from "@/components/layout/Header";
import { formatPrice } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────
interface MonthData  { month: string; label: string; revenue: number; bookings: number; nights: number }
interface RoomData   { roomId: string; name: string; revenue: number; bookings: number; nights: number }
interface SourceData { source: string; revenue: number; bookings: number }
interface Summary    {
  totalRevenue: number; pendingRevenue: number; totalBookings: number;
  avgPerBooking: number; totalNights: number; noPriceCount: number;
}
interface RevenueData {
  summary: Summary;
  byMonth: MonthData[];
  byRoom:  RoomData[];
  bySource: SourceData[];
}

const SOURCE_STYLE: Record<string, { label: string; bar: string; badge: string }> = {
  AIRBNB:  { label: "Airbnb",       bar: "bg-rose-500",    badge: "bg-rose-100 text-rose-700"    },
  DIRECT:  { label: "Direct",       bar: "bg-blue-500",    badge: "bg-blue-100 text-blue-700"    },
  OFFLINE: { label: "Offline/Zalo", bar: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-700" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function pct(value: number, max: number) {
  if (!max) return 0;
  return Math.round((value / max) * 100);
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({
  icon: Icon, label, value, sub, color,
}: {
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

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function RevenuePage() {
  const [data,    setData]    = useState<RevenueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [months,  setMonths]  = useState(6);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/revenue?months=${months}`);
      setData(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [months]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const maxMonthRevenue = data ? Math.max(...data.byMonth.map((m) => m.revenue), 1) : 1;
  const maxRoomRevenue  = data ? Math.max(...data.byRoom.map((r) => r.revenue), 1) : 1;

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Báo cáo Doanh thu"
        subtitle="Tổng hợp theo tháng, phòng và kênh đặt"
        actions={
          <div className="flex items-center gap-2">
            <select
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              <option value={3}>3 tháng</option>
              <option value={6}>6 tháng</option>
              <option value={12}>12 tháng</option>
            </select>
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium disabled:opacity-60"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-5 space-y-6">
        {loading && !data ? (
          <div className="flex items-center justify-center h-40 text-gray-400">Đang tải dữ liệu…</div>
        ) : !data ? null : (
          <>
            {/* No-price warning */}
            {data.summary.noPriceCount > 0 && (
              <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-3">
                <AlertCircle size={16} className="shrink-0" />
                <span>
                  <strong>{data.summary.noPriceCount} booking</strong> chưa có giá → vào Settings đặt{" "}
                  <strong>Giá/đêm</strong> cho từng phòng, sau đó Sync lại để tự tính.
                </span>
              </div>
            )}

            {/* ── Stat Cards ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                icon={DollarSign}
                label="Doanh thu (đã xác nhận)"
                value={formatPrice(data.summary.totalRevenue)}
                sub={data.summary.pendingRevenue > 0
                  ? `+ ${formatPrice(data.summary.pendingRevenue)} chờ xác nhận`
                  : undefined}
                color="bg-emerald-500"
              />
              <StatCard
                icon={Calendar}
                label="Số booking"
                value={String(data.summary.totalBookings)}
                sub={`Avg ${formatPrice(data.summary.avgPerBooking)} / booking`}
                color="bg-blue-500"
              />
              <StatCard
                icon={BedDouble}
                label="Tổng số đêm"
                value={String(data.summary.totalNights)}
                sub={`${months} tháng gần nhất`}
                color="bg-violet-500"
              />
              <StatCard
                icon={TrendingUp}
                label="Avg revenue / tháng"
                value={formatPrice(Math.round(data.summary.totalRevenue / months))}
                sub={`Dựa trên ${months} tháng`}
                color="bg-amber-500"
              />
            </div>

            {/* ── Monthly Revenue Chart ── */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h3 className="text-sm font-semibold text-gray-800 mb-5">Doanh thu theo tháng</h3>
              <div className="space-y-3">
                {data.byMonth.map((m) => (
                  <div key={m.month} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-20 shrink-0 text-right">{m.label}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-7 overflow-hidden relative">
                      <div
                        className="h-full bg-amber-400 rounded-full transition-all duration-500 flex items-center"
                        style={{ width: `${pct(m.revenue, maxMonthRevenue)}%`, minWidth: m.revenue > 0 ? "2px" : 0 }}
                      />
                    </div>
                    <div className="text-right w-36 shrink-0">
                      <span className="text-sm font-semibold text-gray-800">
                        {m.revenue > 0 ? formatPrice(m.revenue) : <span className="text-gray-300">—</span>}
                      </span>
                      <span className="text-xs text-gray-400 ml-2">({m.bookings} booking)</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* ── Revenue by Room ── */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <h3 className="text-sm font-semibold text-gray-800 mb-5">Doanh thu theo phòng</h3>
                {data.byRoom.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">Chưa có dữ liệu</p>
                ) : (
                  <div className="space-y-4">
                    {data.byRoom.map((r, i) => (
                      <div key={r.roomId}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-sm font-medium text-gray-700 flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">
                              {i + 1}
                            </span>
                            {r.name}
                          </span>
                          <div className="text-right">
                            <span className="text-sm font-semibold text-gray-800">
                              {r.revenue > 0 ? formatPrice(r.revenue) : "—"}
                            </span>
                          </div>
                        </div>
                        <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
                          <div
                            className="h-full bg-amber-400 rounded-full transition-all duration-500"
                            style={{ width: `${pct(r.revenue, maxRoomRevenue)}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-400 mt-1">
                          {r.bookings} booking · {r.nights} đêm
                          {r.bookings > 0 && r.revenue > 0 && (
                            <> · avg {formatPrice(Math.round(r.revenue / r.bookings))}</>
                          )}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Revenue by Source ── */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <h3 className="text-sm font-semibold text-gray-800 mb-5">Doanh thu theo kênh</h3>
                {data.bySource.every((s) => s.revenue === 0) ? (
                  <p className="text-sm text-gray-400 text-center py-4">Chưa có dữ liệu</p>
                ) : (
                  <div className="space-y-5">
                    {data.bySource.map((s) => {
                      const style = SOURCE_STYLE[s.source] ?? {
                        label: s.source, bar: "bg-gray-400", badge: "bg-gray-100 text-gray-700",
                      };
                      const total = data.bySource.reduce((acc, x) => acc + x.revenue, 0);
                      const share = total > 0 ? Math.round((s.revenue / total) * 100) : 0;
                      return (
                        <div key={s.source}>
                          <div className="flex items-center justify-between mb-2">
                            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${style.badge}`}>
                              {style.label}
                            </span>
                            <span className="text-sm font-bold text-gray-800">
                              {s.revenue > 0 ? formatPrice(s.revenue) : "—"}
                              {s.revenue > 0 && (
                                <span className="text-xs font-normal text-gray-400 ml-2">{share}%</span>
                              )}
                            </span>
                          </div>
                          <div className="bg-gray-100 rounded-full h-3 overflow-hidden">
                            <div
                              className={`h-full ${style.bar} rounded-full transition-all duration-500`}
                              style={{ width: `${share}%` }}
                            />
                          </div>
                          <p className="text-xs text-gray-400 mt-1">{s.bookings} booking</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
