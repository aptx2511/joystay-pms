"use client";

import { useState } from "react";
import Header from "@/components/layout/Header";
import GanttCalendar from "@/components/calendar/GanttCalendar";
import BookingForm from "@/components/bookings/BookingForm";
import RoomBlockDialog from "@/components/bookings/RoomBlockDialog";
import { Lock } from "lucide-react";
import { Booking, BookingFormData } from "@/types";
import { format } from "date-fns";
import { useAuth } from "@/lib/hooks/useAuth";

export default function DashboardPage() {
  const [formOpen,  setFormOpen]  = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editBooking,  setEditBooking]  = useState<Booking | undefined>(undefined);
  const [prefillData, setPrefillData] = useState<Partial<BookingFormData> | undefined>(undefined);
  const auth = useAuth();
  const needLogin = () => { if (auth && !auth.authed) { if (confirm("Cần đăng nhập quản trị để thêm/sửa booking. Đăng nhập ngay?")) location.href = "/login?next=/"; return true; } return false; };

  function openNewBooking(date?: string, roomId?: string) {
    if (needLogin()) return;
    setEditBooking(undefined);
    setPrefillData({
      checkIn:  date ?? format(new Date(), "yyyy-MM-dd"),
      checkOut: date ?? format(new Date(), "yyyy-MM-dd"),
      roomId:   roomId ?? "",
    });
    setFormOpen(true);
  }

  function openEditBooking(booking: Booking) {
    if (needLogin()) return;
    setEditBooking(booking);
    setPrefillData(undefined);
    setFormOpen(true);
  }

  function handleSaved() {
    setRefreshKey((k) => k + 1);
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Availability Calendar"
        subtitle="Click any cell to add a booking · Click a block to edit"
        actions={
          <button onClick={() => { if (!needLogin()) setBlockOpen(true); }}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-slate-900 hover:bg-slate-700 text-white rounded-lg font-medium">
            <Lock size={15} /> <span>Khoá phòng</span>
          </button>
        }
      />
      <div className="flex-1 overflow-auto p-5">
        <GanttCalendar
          onAddBooking={openNewBooking}
          onEditBooking={openEditBooking}
          refreshKey={refreshKey}
        />
      </div>

      <RoomBlockDialog open={blockOpen} onClose={() => setBlockOpen(false)} onSaved={handleSaved} />
      <BookingForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={handleSaved}
        initialData={prefillData}
        editBooking={editBooking}
      />
    </div>
  );
}
