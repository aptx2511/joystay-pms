"use client";

import { useState } from "react";
import Header from "@/components/layout/Header";
import GanttCalendar from "@/components/calendar/GanttCalendar";
import BookingForm from "@/components/bookings/BookingForm";
import { Booking, BookingFormData } from "@/types";
import { format } from "date-fns";

export default function DashboardPage() {
  const [formOpen,  setFormOpen]  = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editBooking,  setEditBooking]  = useState<Booking | undefined>(undefined);
  const [prefillData, setPrefillData] = useState<Partial<BookingFormData> | undefined>(undefined);

  function openNewBooking(date?: string, roomId?: string) {
    setEditBooking(undefined);
    setPrefillData({
      checkIn:  date ?? format(new Date(), "yyyy-MM-dd"),
      checkOut: date ?? format(new Date(), "yyyy-MM-dd"),
      roomId:   roomId ?? "",
    });
    setFormOpen(true);
  }

  function openEditBooking(booking: Booking) {
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
      />
      <div className="flex-1 overflow-auto p-5">
        <GanttCalendar
          onAddBooking={openNewBooking}
          onEditBooking={openEditBooking}
          refreshKey={refreshKey}
        />
      </div>

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
