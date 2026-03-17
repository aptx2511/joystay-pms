"use client";

import { useState, useEffect, useCallback } from "react";
import { format, parseISO } from "date-fns";
import { Plus, Search } from "lucide-react";
import Header from "@/components/layout/Header";
import BookingForm from "@/components/bookings/BookingForm";
import { Booking, SOURCE_META, STATUS_META, BookingSource, BookingStatus } from "@/types";
import { nightCount, formatPrice } from "@/lib/utils";

export default function BookingsPage() {
  const [bookings,   setBookings]   = useState<Booking[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState("");
  const [formOpen,   setFormOpen]   = useState(false);
  const [editTarget, setEditTarget] = useState<Booking | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchBookings = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/bookings");
      const data = await res.json();
      setBookings(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchBookings(); }, [fetchBookings]);

  const filtered = bookings.filter((b) =>
    b.guestName.toLowerCase().includes(search.toLowerCase()) ||
    b.room?.name.toLowerCase().includes(search.toLowerCase())
  );

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
        title="All Bookings"
        subtitle={`${bookings.length} total bookings`}
        actions={
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium"
          >
            <Plus size={16} /> New Booking
          </button>
        }
      />

      <div className="flex-1 overflow-auto p-5">
        {/* Search */}
        <div className="relative mb-4 max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search guest or room…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
        </div>

        {/* Table */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["Guest", "Room", "Check-in", "Check-out", "Nights", "Source", "Status", "Price"].map((h) => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-gray-400">Loading…</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-gray-400">No bookings found.</td>
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
                      <td className="px-4 py-3 font-medium text-gray-900">{booking.guestName}</td>
                      <td className="px-4 py-3 text-gray-600">{booking.room?.name ?? "—"}</td>
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
