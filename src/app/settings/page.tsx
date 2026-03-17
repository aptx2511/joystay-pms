"use client";

import { useState, useEffect } from "react";
import { Link2, Save, RefreshCw, Copy, Check } from "lucide-react";
import Header from "@/components/layout/Header";
import { Room } from "@/types";

export default function SettingsPage() {
  const [rooms,   setRooms]   = useState<Room[]>([]);
  const [urls,    setUrls]    = useState<Record<string, string>>({});
  const [saving,  setSaving]  = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState(false);
  const [syncLog, setSyncLog] = useState<string | null>(null);
  const [copied,  setCopied]  = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/rooms")
      .then((r) => r.json())
      .then((data: Room[]) => {
        setRooms(data);
        const initial: Record<string, string> = {};
        data.forEach((r) => { initial[r.id] = r.icalUrl ?? ""; });
        setUrls(initial);
      });
  }, []);

  async function saveUrl(roomId: string) {
    setSaving((s) => ({ ...s, [roomId]: true }));
    try {
      await fetch("/api/rooms", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ id: roomId, icalUrl: urls[roomId] }),
      });
      setRooms((prev) =>
        prev.map((r) => r.id === roomId ? { ...r, icalUrl: urls[roomId] } : r)
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
    const url = `${window.location.origin}/api/ical/export/${roomId}`;
    navigator.clipboard.writeText(url);
    setCopied(roomId);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title="iCal Sync Settings"
        subtitle="Paste Airbnb iCal URLs below to import bookings"
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
          <strong>Import:</strong> Paste the Airbnb iCal URL for each room and click Save, then hit
          &ldquo;Sync All Rooms&rdquo; to pull in Airbnb bookings.
          <br />
          <strong>Export:</strong> Copy the export URL and paste it into Airbnb ▸ Calendar ▸ Sync
          (so Airbnb knows about your direct bookings).
        </p>

        {rooms.map((room) => (
          <div key={room.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-semibold text-gray-800">{room.name}</h3>
                <p className="text-xs text-gray-400">{room.size} m²</p>
              </div>
            </div>

            {/* Import URL */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">
                Airbnb iCal Import URL
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="url"
                    value={urls[room.id] ?? ""}
                    onChange={(e) =>
                      setUrls((prev) => ({ ...prev, [room.id]: e.target.value }))
                    }
                    placeholder="https://www.airbnb.com/calendar/ical/…"
                    className="w-full pl-8 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                <button
                  onClick={() => saveUrl(room.id)}
                  disabled={saving[room.id]}
                  className="flex items-center gap-1 text-sm px-3 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
                >
                  <Save size={14} />
                  {saving[room.id] ? "…" : "Save"}
                </button>
              </div>
            </div>

            {/* Export URL */}
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">
                Export URL (paste into Airbnb)
              </label>
              <div className="flex gap-2 items-center">
                <code className="flex-1 text-xs bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-gray-600 truncate">
                  {typeof window !== "undefined"
                    ? `${window.location.origin}/api/ical/export/${room.id}`
                    : `/api/ical/export/${room.id}`}
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
