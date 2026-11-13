"use client";

import { useState, useEffect } from "react";
import { X, Trash2, Calculator } from "lucide-react";
import { format, parseISO, differenceInDays } from "date-fns";
import { Booking, BookingFormData, BookingSource, BookingStatus, Room, SOURCE_META, calcAutoPrice } from "@/types";

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

export const BLOCK_REASONS = [
  "🔧 Sửa chữa phòng",
  "🎬 Quay video / chụp ảnh marketing",
  "🏠 Chủ dùng / người quen ở",
  "🔒 Lý do khác",
];

const STATUS_LABEL: Record<BookingStatus, string> = {
  CONFIRMED: "Confirmed",
  PENDING: "Pending",
  CANCELLED: "Cancelled",
  BLOCKED: "🔒 Khoá lịch",
};

export default function BookingForm({ open, onClose, onSaved, initialData, editBooking }: Props) {
  const [rooms,      setRooms]      = useState<Room[]>([]);
  const [form,       setForm]       = useState<BookingFormData>(EMPTY);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [autoPrice,  setAutoPrice]  = useState<number | null>(null);

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
        confirmationCode: (editBooking as Booking & { confirmationCode?: string | null }).confirmationCode ?? "",
      });
    } else {
      setForm({ ...EMPTY, ...initialData });
    }
  }, [open, editBooking, initialData]);

  // Auto-calculate price when room, dates or source change
  // Weekend (Fri/Sat) uses weekendPricePerNight if set; OTA: trừ phí kênh theo CHANNEL_FEE (Airbnb 15,5%)
  useEffect(() => {
    const room = rooms.find((r) => r.id === form.roomId);
    // Khoá lịch / huỷ: không tính tiền (tránh khoá lịch bị cộng vào doanh thu)
    if (form.status === "BLOCKED" || form.status === "CANCELLED" || !room?.pricePerNight || !form.checkIn || !form.checkOut) {
      setAutoPrice(null);
      return;
    }
    const nights = differenceInDays(parseISO(form.checkOut), parseISO(form.checkIn));
    if (nights <= 0) { setAutoPrice(null); return; }
    const calculated = calcAutoPrice(
      parseISO(form.checkIn), parseISO(form.checkOut),
      room.pricePerNight, room.weekendPricePerNight ?? null,
      form.source as BookingSource
    );
    setAutoPrice(calculated);
    // Auto-fill only when price is empty or matches previous auto value
    setForm((prev) => ({
      ...prev,
      totalPrice: prev.totalPrice === "" || prev.totalPrice === String(autoPrice)
        ? String(calculated)
        : prev.totalPrice,
    }));
  }, [form.roomId, form.checkIn, form.checkOut, form.source, form.status, rooms]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal — bottom sheet on mobile, centered dialog on sm+ */}
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg sm:mx-4 max-h-[92dvh] flex flex-col overflow-hidden">
        {/* Drag handle (mobile only) */}
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 md:px-6 py-3 md:py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {editBooking ? "Edit Booking" : "New Booking"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form id="booking-form" onSubmit={handleSubmit} className="px-4 md:px-6 py-4 md:py-5 space-y-4 overflow-y-auto flex-1 min-h-0">
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

          {/* Guest name + Booking ID */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-3">
          <div className="min-w-0">
            <label className="block text-xs font-medium text-gray-600 mb-1">Tên khách *</label>
            <input
              type="text"
              value={form.guestName}
              onChange={set("guestName")}
              required
              placeholder="e.g. Nguyen Van A"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <div className="min-w-0">
            <label className="block text-xs font-medium text-gray-600 mb-1">Booking ID (mã đặt phòng)</label>
            <input
              type="text"
              value={form.confirmationCode ?? ""}
              onChange={set("confirmationCode")}
              placeholder="HM…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="block text-xs font-medium text-gray-600 mb-1">Check-in *</label>
              <input
                type="date"
                value={form.checkIn}
                onChange={set("checkIn")}
                required
                className="block w-full min-w-0 max-w-full appearance-none bg-white text-left border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <div className="min-w-0">
              <label className="block text-xs font-medium text-gray-600 mb-1">Check-out *</label>
              <input
                type="date"
                value={form.checkOut}
                onChange={set("checkOut")}
                required
                min={form.checkIn}
                className="block w-full min-w-0 max-w-full appearance-none bg-white text-left border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
          </div>

          {/* Source & Status */}
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <label className="block text-xs font-medium text-gray-600 mb-1">Source</label>
              <select
                value={form.source}
                onChange={set("source")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                {(["DIRECT", "AIRBNB", "BOOKING", "AGODA", "TRAVELOKA", "OFFLINE"] as BookingSource[]).map((s) => (
                  <option key={s} value={s}>{SOURCE_META[s].label}</option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
              <select
                value={form.status}
                onChange={set("status")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                {(["CONFIRMED", "PENDING", "CANCELLED", "BLOCKED"] as BookingStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Lý do khoá — chỉ hiện khi Khoá lịch. Khoá trong PMS (nguồn Trực tiếp) được xuất sang mọi kênh. */}
          {form.status === "BLOCKED" && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Lý do khoá phòng</label>
              <div className="flex flex-wrap gap-1.5">
                {BLOCK_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, guestName: r, source: "DIRECT" }))}
                    className={`px-2.5 py-1 rounded-full text-xs border ${form.guestName === r ? "bg-amber-500 text-white border-amber-500" : "bg-white text-gray-700 border-gray-300"}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                Khoá ở đây (nguồn Trực tiếp) sẽ tự đóng ngày trên Airbnb, Booking, Agoda ở lần các kênh quét lịch PMS kế tiếp.
                {form.source !== "DIRECT" && <span className="text-red-600"> Nguồn đang không phải Trực tiếp → khoá này KHÔNG được gửi sang các kênh.</span>}
              </p>
            </div>
          )}

          {/* Price */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-gray-600">Tổng tiền (VND)</label>
              {autoPrice !== null && (
                <span className="flex items-center gap-1 text-xs font-medium text-amber-600">
                  <Calculator size={11} />
                  {form.source === "AIRBNB" ? "Airbnb (−15,5% phí):" : "Tự tính:"}
                  {" "}{autoPrice.toLocaleString("vi-VN")} đ
                  <button
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, totalPrice: String(autoPrice) }))}
                    className="ml-1 px-1.5 py-0.5 bg-amber-100 rounded hover:bg-amber-200 text-amber-700"
                  >
                    Dùng giá này
                  </button>
                </span>
              )}
            </div>
            <div className="relative">
              <input
                type="number"
                value={form.totalPrice}
                onChange={set("totalPrice")}
                placeholder={autoPrice ? String(autoPrice) : "Nhập tổng tiền…"}
                min={0}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 pr-16"
              />
              {form.totalPrice && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">
                  {Number(form.totalPrice).toLocaleString("vi-VN")} đ
                </span>
              )}
            </div>
            {autoPrice !== null && form.totalPrice && Number(form.totalPrice) !== autoPrice && (
              <p className="text-xs text-violet-500 mt-1 flex items-center gap-1">
                ✏️ Đã chỉnh tay — giá tự tính: {autoPrice.toLocaleString("vi-VN")} đ
              </p>
            )}
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

        </form>
        {/* Actions — luôn hiện ở đáy (không bị thanh menu điện thoại che) */}
        <div className="shrink-0 border-t border-gray-100 bg-white px-4 md:px-6 py-3 flex items-center justify-between gap-2" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
            {editBooking ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={loading}
                className="flex items-center gap-1.5 px-2 py-2 text-sm text-rose-600 hover:text-rose-700 font-medium disabled:opacity-50"
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
                form="booking-form"
                disabled={loading}
                className="px-4 py-2.5 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {loading ? "Saving…" : editBooking ? "Save Changes" : "Create Booking"}
              </button>
            </div>
          </div>
      </div>
    </div>
  );
}
