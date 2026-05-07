"use client";

import { useState, useEffect } from "react";
import { Link2, Save, RefreshCw, Copy, Check, DollarSign } from "lucide-react";
import Header from "@/components/layout/Header";
import { Room } from "@/types";

export default function SettingsPage() {
  const [rooms,            setRooms]            = useState<Room[]>([]);
  const [urls,             setUrls]             = useState<Record<string, string>>({});
  const [bookingUrls,      setBookingUrls]      = useState<Record<string, string>>({});
  const [agodaUrls,        setAgodaUrls]        = useState<Record<string, string>>({});
  const [travelokaUrls,    setTravelokaUrls]    = useState<Record<string, string>>({});
  const [prices,           setPrices]           = useState<Record<string, string>>({});
  const [weekendPrices,    setWeekendPrices]    = useState<Record<string, string>>({});
  const [saving,           setSaving]           = useState<Record<string, boolean>>({});
  const [syncing,  setSyncing]  = useState(false);
  const [syncLog,  setSyncLog]  = useState<string | null>(null);
  const [copied,   setCopied]   = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/rooms")
      .then((r) => r.json())
      .then((data: Room[]) => {
        setRooms(data);
        const initUrls:      Record<string, string> = {};
        const initBooking:   Record<string, string> = {};
        const initAgoda:     Record<string, string> = {};
        const initTraveloka: Record<string, string> = {};
        const initPrices:    Record<string, string> = {};
        const initWeekend:   Record<string, string> = {};
        data.forEach((r) => {
          initUrls[r.id]      = r.icalUrl          ?? "";
          initBooking[r.id]   = r.bookingIcalUrl   ?? "";
          initAgoda[r.id]     = r.agodaIcalUrl     ?? "";
          initTraveloka[r.id] = r.travelokaIcalUrl ?? "";
          initPrices[r.id]    = r.pricePerNight        != null ? String(r.pricePerNight)        : "";
          initWeekend[r.id]   = r.weekendPricePerNight != null ? String(r.weekendPricePerNight) : "";
        });
        setUrls(initUrls);
        setBookingUrls(initBooking);
        setAgodaUrls(initAgoda);
        setTravelokaUrls(initTraveloka);
        setPrices(initPrices);
        setWeekendPrices(initWeekend);
      });
  }, []);

  async function saveRoom(roomId: string) {
    setSaving((s) => ({ ...s, [roomId]: true }));
    try {
      const priceVal   = prices[roomId];
      const weekendVal = weekendPrices[roomId];
      await fetch("/api/rooms", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          id:                   roomId,
          icalUrl:              urls[roomId],
          bookingIcalUrl:       bookingUrls[roomId],
          agodaIcalUrl:         agodaUrls[roomId],
          travelokaIcalUrl:     travelokaUrls[roomId],
          pricePerNight:        priceVal   ? parseFloat(priceVal)   : null,
          weekendPricePerNight: weekendVal ? parseFloat(weekendVal) : null,
        }),
      });
      setRooms((prev) =>
        prev.map((r) => r.id === roomId
          ? {
              ...r,
              icalUrl:              urls[roomId],
              bookingIcalUrl:       bookingUrls[roomId],
              agodaIcalUrl:         agodaUrls[roomId],
              travelokaIcalUrl:     travelokaUrls[roomId],
              pricePerNight:        priceVal   ? parseFloat(priceVal)   : null,
              weekendPricePerNight: weekendVal ? parseFloat(weekendVal) : null,
            }
          : r
        )
      );
    } finally {
      setSaving((s) => ({ ...s, [roomId]: false }));
    }
  }

  async function syncAll() {
    setSyncing(true);
    setSyncLog(null);
    try {
      const res  = await fetch("/api/ical/sync", { method: "POST" });
      const data = await res.json();
      setSyncLog(data.message ?? JSON.stringify(data));
    } catch {
      setSyncLog("Sync failed. Check console for details.");
    } finally {
      setSyncing(false);
    }
  }

  function copyExportUrl(roomId: string) {
    const url = `${window.location.origin}/ical/${roomId}.ics`;
    navigator.clipboard.writeText(url);
    setCopied(roomId);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title="Channel Manager"
        subtitle="Kết nối lịch từ Airbnb, Booking.com, Agoda, Traveloka"
        actions={
          <button
            onClick={syncAll}
            disabled={syncing}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-medium disabled:opacity-60"
          >
            <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing…" : "Sync All Rooms"}
          </button>
        }
      />

      <div className="flex-1 overflow-auto p-5 space-y-4">
        {syncLog && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-xl px-4 py-3">
            {syncLog}
          </div>
        )}

        <p className="text-sm text-gray-500">
          <strong>Import:</strong> Dán iCal URL của từng kênh vào ô tương ứng → Save → bấm &ldquo;Sync All Rooms&rdquo;.
          <br />
          <strong>Export:</strong> Copy URL export và dán vào mục Calendar Sync của từng kênh để kênh đó biết lịch booking trực tiếp.
        </p>

        {rooms.map((room) => (
          <div key={room.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold text-gray-800">{room.name}</h3>
                <p className="text-xs text-gray-400">{room.size} m²</p>
              </div>
            </div>

            {/* Pricing */}
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">
                  Giá ngày thường / đêm (CN–T5)
                </label>
                <div className="relative">
                  <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="number"
                    value={prices[room.id] ?? ""}
                    onChange={(e) => setPrices((prev) => ({ ...prev, [room.id]: e.target.value }))}
                    placeholder="VD: 600000"
                    min={0}
                    className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">
                  Giá cuối tuần / đêm (T6–T7)
                </label>
                <div className="relative">
                  <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="number"
                    value={weekendPrices[room.id] ?? ""}
                    onChange={(e) => setWeekendPrices((prev) => ({ ...prev, [room.id]: e.target.value }))}
                    placeholder="VD: 750000"
                    min={0}
                    className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
              </div>
            </div>

            {/* OTA iCal Import URLs */}
            <div className="mb-3 space-y-2">
              {[
                { label: "Airbnb",       color: "rose",  placeholder: "https://www.airbnb.com/calendar/ical/…",          value: urls[room.id]          ?? "", onChange: (v: string) => setUrls((p)          => ({ ...p, [room.id]: v })) },
                { label: "Booking.com",  color: "blue",  placeholder: "https://ical.booking.com/v1/export?t=…",           value: bookingUrls[room.id]   ?? "", onChange: (v: string) => setBookingUrls((p)   => ({ ...p, [room.id]: v })) },
                { label: "Agoda",        color: "red",   placeholder: "https://ical.agoda.com/…",                         value: agodaUrls[room.id]     ?? "", onChange: (v: string) => setAgodaUrls((p)     => ({ ...p, [room.id]: v })) },
                { label: "Traveloka",    color: "sky",   placeholder: "https://www.traveloka.com/en-vn/hotel/ical/…",     value: travelokaUrls[room.id] ?? "", onChange: (v: string) => setTravelokaUrls((p) => ({ ...p, [room.id]: v })) },
              ].map(({ label, placeholder, value, onChange }) => (
                <div key={label}>
                  <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">
                    {label} — iCal Import URL
                  </label>
                  <div className="relative">
                    <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="url"
                      value={value}
                      onChange={(e) => onChange(e.target.value)}
                      placeholder={placeholder}
                      className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Save button */}
            <div className="mb-3 flex justify-end">
              <button
                onClick={() => saveRoom(room.id)}
                disabled={saving[room.id]}
                className="flex items-center gap-1 text-sm px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                <Save size={14} />
                {saving[room.id] ? "Saving…" : "Save Room"}
              </button>
            </div>

            {/* Export URL */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">
                Export URL (paste into Airbnb)
              </label>
              <div className="flex gap-2 items-center">
                <code className="flex-1 text-xs bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-gray-600 truncate">
                  {typeof window !== "undefined"
                    ? `${window.location.origin}/ical/${room.id}.ics`
                    : `/ical/${room.id}.ics`}
                </code>
                <button
                  onClick={() => copyExportUrl(room.id)}
                  className="flex items-center gap-1 text-sm px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
                >
                  {copied === room.id ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                  {copied === room.id ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
