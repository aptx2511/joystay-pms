"use client";

import { useState, useEffect } from "react";
import { Link2, Save, RefreshCw, Copy, Check, DollarSign, Plus } from "lucide-react";
import Header from "@/components/layout/Header";
import { Room } from "@/types";

export default function SettingsPage() {
  const [rooms,            setRooms]            = useState<Room[]>([]);
  const [urls,             setUrls]             = useState<Record<string, string>>({});
  const [bookingUrls,      setBookingUrls]      = useState<Record<string, string>>({});
  const [agodaUrls,        setAgodaUrls]        = useState<Record<string, string>>({});
  const [travelokaUrls,    setTravelokaUrls]    = useState<Record<string, string>>({});
  const [airbnb2Urls,      setAirbnb2Urls]      = useState<Record<string, string>>({});
  const [names,            setNames]            = useState<Record<string, string>>({});
  const [roomNumbers,      setRoomNumbers]      = useState<Record<string, string>>({});
  const [prices,           setPrices]           = useState<Record<string, string>>({});
  const [weekendPrices,    setWeekendPrices]    = useState<Record<string, string>>({});
  const [saving,           setSaving]           = useState<Record<string, boolean>>({});
  const [syncing,  setSyncing]  = useState(false);
  const [syncLog,  setSyncLog]  = useState<string | null>(null);
  const [copied,   setCopied]   = useState<string | null>(null);
  const [newRoom,  setNewRoom]  = useState({ name: "The Matcha Bath Loft", size: "50", price: "1490000", weekend: "1590000" });
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/rooms")
      .then((r) => r.json())
      .then((data: Room[]) => {
        setRooms(data);
        const initUrls:      Record<string, string> = {};
        const initBooking:   Record<string, string> = {};
        const initAgoda:     Record<string, string> = {};
        const initTraveloka: Record<string, string> = {};
        const initAirbnb2:   Record<string, string> = {};
        const initNames:     Record<string, string> = {};
        const initNumbers:   Record<string, string> = {};
        const initPrices:    Record<string, string> = {};
        const initWeekend:   Record<string, string> = {};
        data.forEach((r) => {
          initUrls[r.id]      = r.icalUrl          ?? "";
          initBooking[r.id]   = r.bookingIcalUrl   ?? "";
          initAgoda[r.id]     = r.agodaIcalUrl     ?? "";
          initTraveloka[r.id] = r.travelokaIcalUrl ?? "";
          initAirbnb2[r.id]   = r.airbnbIcalUrl2   ?? "";
          initNames[r.id]     = r.name;
          initNumbers[r.id]   = r.roomNumber       ?? "";
          initPrices[r.id]    = r.pricePerNight        != null ? String(r.pricePerNight)        : "";
          initWeekend[r.id]   = r.weekendPricePerNight != null ? String(r.weekendPricePerNight) : "";
        });
        setUrls(initUrls);
        setBookingUrls(initBooking);
        setAgodaUrls(initAgoda);
        setTravelokaUrls(initTraveloka);
        setAirbnb2Urls(initAirbnb2);
        setNames(initNames);
        setRoomNumbers(initNumbers);
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
          airbnbIcalUrl2:       airbnb2Urls[roomId],
          name:                 names[roomId],
          roomNumber:           roomNumbers[roomId],
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
              airbnbIcalUrl2:       airbnb2Urls[roomId],
              name:                 names[roomId] || r.name,
              roomNumber:           roomNumbers[roomId],
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

  async function createRoom() {
    setCreating(true);
    setCreateMsg(null);
    try {
      const res = await fetch("/api/rooms", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          name:                 newRoom.name,
          size:                 parseInt(newRoom.size, 10),
          pricePerNight:        newRoom.price   ? parseFloat(newRoom.price)   : null,
          weekendPricePerNight: newRoom.weekend ? parseFloat(newRoom.weekend) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateMsg(data.error ?? "Không tạo được phòng");
        return;
      }
      const room = data as Room;
      setRooms((prev) => [...prev, room]);
      setUrls((p) => ({ ...p, [room.id]: "" }));
      setBookingUrls((p) => ({ ...p, [room.id]: "" }));
      setAgodaUrls((p) => ({ ...p, [room.id]: "" }));
      setTravelokaUrls((p) => ({ ...p, [room.id]: "" }));
      setPrices((p) => ({ ...p, [room.id]: room.pricePerNight != null ? String(room.pricePerNight) : "" }));
      setWeekendPrices((p) => ({ ...p, [room.id]: room.weekendPricePerNight != null ? String(room.weekendPricePerNight) : "" }));
      setCreateMsg(`Đã tạo phòng ${room.name}. Dán iCal URL bên dưới rồi bấm Save Room.`);
    } catch {
      setCreateMsg("Không tạo được phòng. Kiểm tra console.");
    } finally {
      setCreating(false);
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

        {/* Add new room */}
        <div className="bg-white rounded-xl border border-dashed border-amber-300 shadow-sm p-5">
          <h3 className="font-semibold text-gray-800 mb-3">Thêm phòng mới</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { key: "name",    label: "Tên phòng",          type: "text"   },
              { key: "size",    label: "Diện tích (m²)",     type: "number" },
              { key: "price",   label: "Giá ngày thường",    type: "number" },
              { key: "weekend", label: "Giá cuối tuần",      type: "number" },
            ].map(({ key, label, type }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">{label}</label>
                <input
                  type={type}
                  value={newRoom[key as keyof typeof newRoom]}
                  onChange={(e) => setNewRoom((p) => ({ ...p, [key]: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-gray-500">{createMsg}</p>
            <button
              onClick={createRoom}
              disabled={creating || !newRoom.name.trim() || !newRoom.size}
              className="flex items-center gap-1 text-sm px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50"
            >
              <Plus size={14} />
              {creating ? "Đang tạo…" : "Tạo phòng"}
            </button>
          </div>
        </div>

        {rooms.map((room) => (
          <div key={room.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex-1 grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">Tên phòng</label>
                  <input
                    value={names[room.id] ?? room.name}
                    onChange={(e) => setNames((p) => ({ ...p, [room.id]: e.target.value }))}
                    className="w-full px-3 py-2 text-sm font-semibold border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                  <p className="text-xs text-gray-400 mt-0.5">{room.size} m²</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wide">Số phòng</label>
                  <input
                    value={roomNumbers[room.id] ?? ""}
                    onChange={(e) => setRoomNumbers((p) => ({ ...p, [room.id]: e.target.value }))}
                    placeholder="VD: 302"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                  <p className="text-xs text-gray-400 mt-0.5">Cùng số = cùng 1 phòng thật</p>
                </div>
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
                { label: "Airbnb (listing thứ 2 cùng phòng)", color: "rose", placeholder: "VD: 302 Parisian Chic + Black & White", value: airbnb2Urls[room.id] ?? "", onChange: (v: string) => setAirbnb2Urls((p) => ({ ...p, [room.id]: v })) },
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
