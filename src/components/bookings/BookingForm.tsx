"use client";

import { useState, useEffect } from "react";
import { X, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Booking, BookingFormData, BookingSource, BookingStatus, Room, SOURCE_META } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  initialData?: Partial<BookingFormData>;
  editBooking?: Booking; // if set, we're editing
}

const EMPTY: BookingFormData = {
  roomId:     "",
  guestName:  "",
  checkIn:    format(new Date(), "yyyy-MM-dd"),
  checkOut:   format(new Date(), "yyyy-MM-dd"),
  source:     "DIRECT",
  status:     "CONFIRMED",
  totalPrice: "",
  notes:      "",
};

export default function BookingForm({ open, onClose, onSaved, initialData, editBooking }: Props) {
  const [rooms,   setRooms]   = useState<Room[]>([]);
  const [form,    setForm]    = useState<BookingFormData>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  // Fetch rooms once
  useEffect(() => {
    fetch("/api/rooms")
      .then((r) => r.json())
      .then(setRooms)
      .catch(console.error);
  }, []);

  // Populate form when opening
  useEffect(() => {
    if (!open) return;
    setError(null);

    if (editBooking) {
      setForm({
        roomId:     editBooking.roomId,
        guestName:  editBooking.guestName,
        checkIn:    format(parseISO(editBooking.checkIn),  "yyyy-MM-dd"),
        checkOut:   format(parseISO(editBooking.checkOut), "yyyy-MM-dd"),
        source:     editBooking.source,
        status:     editBooking.status,
        totalPrice: editBooking.totalPrice != null ? String(editBooking.totalPrice) : "",
        notes:      editBooking.notes ?? "",
      });
    } else {
      setForm({ ...EMPTY, ...initialData });
    }
  }, [open, editBooking, initialData]);

  if (!open) return null;

  const set = (field: keyof BookingFormData) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const url    = editBooking ? `/api/bookings/${editBooking.id}` : "/api/bookings";
      const method = editBooking ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Something went wrong");
        return;
      }

      onSaved();
      onClose();
    } catch (err) {
      setError("Network error. Please try again.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!editBooking) return;
    if (!confirm(`Delete booking for ${editBooking.guestName}? This cannot be undone.`)) return;
    setLoading(true);
    try {
      await fetch(`/api/bookings/${editBooking.id}`, { method: "DELETE" });
      onSaved();
      onClose();
    } catch {
      setError("Failed to delete booking.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {editBooking ? "Edit Booking" : "New Booking"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-4 py-2.5">
              {error}
            </div>
          )}

          {/* Room */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Room *</label>
            <select
              value={form.roomId}
              onChange={set("roomId")}
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            >
              <option value="">Select a room…</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.size} m²)
                </option>
              ))}
            </select>
          </div>

          {/* Guest name */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Guest Name *</label>
            <input
              type="text"
              value={form.guestName}
              onChange={set("guestName")}
              required
              placeholder="e.g. Nguyen Van A"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Check-in *</label>
              <input
                type="date"
                value={form.checkIn}
                onChange={set("checkIn")}
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Check-out *</label>
              <input
                type="date"
                value={form.checkOut}
                onChange={set("checkOut")}
                required
                min={form.checkIn}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>

          {/* Source & Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Source</label>
              <select
                value={form.source}
                onChange={set("source")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                {(["DIRECT", "AIRBNB", "OFFLINE"] as BookingSource[]).map((s) => (
                  <option key={s} value={s}>{SOURCE_META[s].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
              <select
                value={form.status}
                onChange={set("status")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                {(["CONFIRMED", "PENDING", "CANCELLED"] as BookingStatus[]).map((s) => (
                  <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Price */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Total Price (VND)
            </label>
            <input
              type="number"
              value={form.totalPrice}
              onChange={set("totalPrice")}
              placeholder="e.g. 1500000"
              min={0}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={set("notes")}
              rows={2}
              placeholder="Optional notes…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            {editBooking ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={loading}
                className="flex items-center gap-1.5 text-sm text-rose-600 hover:text-rose-700 font-medium disabled:opacity-50"
              >
                <Trash2 size={15} /> Delete
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {loading ? "Saving…" : editBooking ? "Save Changes" : "Create Booking"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
