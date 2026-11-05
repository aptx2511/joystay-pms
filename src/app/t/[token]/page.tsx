"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Circle, AlertTriangle, Loader2, Send } from "lucide-react";

interface Item { key: string; label: string; hint: string; done: boolean; photos: string[] }
interface TaskView {
  room: string; date: string; type: string; window: string; urgent: boolean; status: string;
  cleaner: string | null; note: string | null; rejectReason: string | null;
  checklist: Item[]; issueNote: string; issuePhotos: string[]; photosRequired: boolean; locked: boolean;
}

const WEEKDAY = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
function prettyDate(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAY[d.getUTCDay()]}, ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** Nén ảnh điện thoại về ~1600px JPEG để tải nhanh */
async function compress(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("nén lỗi"))), "image/jpeg", 0.78));
  } catch {
    return file;
  }
}

export default function CleanerTaskPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [task, setTask] = useState<TaskView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [issue, setIssue] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingKey = useRef<string>("");

  const load = useCallback(async () => {
    const r = await fetch(`/api/hk/t/${token}`, { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) setError(d.error ?? "Không mở được việc");
    else { setTask(d); setIssue(d.issueNote ?? ""); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  async function act(body: Record<string, unknown>, label: string) {
    setBusy(label); setError(null);
    try {
      const r = await fetch(`/api/hk/t/${token}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) setError(d.error ?? "Có lỗi, thử lại");
      else setTask(d);
    } finally { setBusy(null); }
  }

  function pickPhoto(key: string) {
    pendingKey.current = key;
    fileRef.current?.click();
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const key = pendingKey.current;
    setBusy(`photo-${key}`); setError(null);
    try {
      for (const f of Array.from(files).slice(0, 4)) {           // tải lần lượt từng ảnh
        const blob = await compress(f);
        const fd = new FormData();
        fd.append("key", key);
        fd.append("file", new File([blob], "photo.jpg", { type: "image/jpeg" }));
        const r = await fetch(`/api/hk/t/${token}/photo`, { method: "POST", body: fd });
        if (!r.ok) { setError((await r.json()).error ?? "Tải ảnh lỗi"); break; }
      }
      await load();
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  if (error && !task) return <Shell><p className="text-red-600 text-center py-20">{error}</p></Shell>;
  if (!task) return <Shell><div className="flex justify-center py-20"><Loader2 className="animate-spin text-amber-500" /></div></Shell>;

  const doneCount = task.checklist.filter((i) => i.done).length;
  const allDone = doneCount === task.checklist.length;
  const submitted = task.status === "DONE" || task.status === "APPROVED";

  return (
    <Shell>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => onFiles(e.target.files)} />

      <header className="bg-slate-900 text-white rounded-2xl p-4 mb-4">
        <p className="text-amber-400 text-xs font-semibold tracking-wider uppercase">Joystay · Việc dọn phòng</p>
        <h1 className="text-2xl font-bold mt-1">{task.room}</h1>
        <p className="text-slate-300 text-sm mt-1">{prettyDate(task.date)} · {task.type} · {task.window}</p>
        {task.urgent && <p className="mt-2 inline-block bg-red-500 text-white text-xs font-bold px-2 py-1 rounded">GẤP — có khách nhận phòng 15:00</p>}
        {task.note && <p className="mt-2 text-sm text-amber-200">Ghi chú: {task.note}</p>}
      </header>

      {task.status === "REJECTED" && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-3 mb-4 text-sm">
          <b>Cần làm lại:</b> {task.rejectReason}
        </div>
      )}
      {submitted && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3 mb-4 text-sm">
          {task.status === "APPROVED" ? "✅ Chủ nhà đã duyệt. Cảm ơn bạn!" : "✅ Đã gửi. Chủ nhà đang xem ảnh."}
        </div>
      )}

      <p className="text-sm text-gray-500 mb-2">
        Làm từng mục, <b>chụp ảnh</b> rồi bấm vào ô tròn để đánh dấu xong. ({doneCount}/{task.checklist.length})
      </p>

      <ul className="space-y-3">
        {task.checklist.map((item, idx) => (
          <li key={item.key} className={`bg-white rounded-xl border p-3 ${item.done ? "border-emerald-300" : "border-gray-200"}`}>
            <div className="flex items-start gap-3">
              <button
                disabled={task.locked || submitted || busy !== null}
                onClick={() => act({ action: "check", key: item.key, done: !item.done }, item.key)}
                className="mt-0.5 shrink-0"
                aria-label={item.done ? "Bỏ đánh dấu" : "Đánh dấu xong"}
              >
                {busy === item.key ? <Loader2 size={28} className="animate-spin text-amber-500" />
                  : item.done ? <CheckCircle2 size={28} className="text-emerald-500" />
                  : <Circle size={28} className="text-gray-300" />}
              </button>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900">{idx + 1}. {item.label}</p>
                <p className="text-sm text-gray-500 mt-0.5">{item.hint}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  {item.photos.map((p) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={p} src={`/api/hk/t/${token}/photo?u=${encodeURIComponent(p)}`} alt="" className="w-16 h-16 object-cover rounded-lg border" />
                  ))}
                  {!task.locked && !submitted && (
                    <button
                      onClick={() => pickPhoto(item.key)}
                      disabled={busy !== null}
                      className="w-16 h-16 rounded-lg border-2 border-dashed border-amber-400 text-amber-600 flex flex-col items-center justify-center text-[10px]"
                    >
                      {busy === `photo-${item.key}` ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
                      Chụp
                    </button>
                  )}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <section className="bg-white rounded-xl border border-orange-200 p-3 mt-4">
        <p className="font-semibold text-gray-900 flex items-center gap-1.5"><AlertTriangle size={16} className="text-orange-500" /> Sự cố / hư hỏng / đồ khách để quên</p>
        <p className="text-sm text-gray-500">Không có thì bỏ trống. Có thì ghi rõ + chụp ảnh (vết bẩn, đồ hỏng, côn trùng…).</p>
        <textarea
          value={issue}
          onChange={(e) => setIssue(e.target.value)}
          onBlur={() => issue !== task.issueNote && act({ action: "issue", note: issue }, "issue")}
          disabled={task.locked || submitted}
          rows={3}
          className="w-full mt-2 border border-gray-300 rounded-lg p-2 text-sm"
          placeholder="VD: ga có vết ố không giặt được, khách để quên sạc điện thoại…"
        />
        <div className="flex flex-wrap gap-2 mt-2">
          {task.issuePhotos.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={p} src={`/api/hk/t/${token}/photo?u=${encodeURIComponent(p)}`} alt="" className="w-16 h-16 object-cover rounded-lg border" />
          ))}
          {!task.locked && !submitted && (
            <button onClick={() => pickPhoto("issue")} disabled={busy !== null}
              className="w-16 h-16 rounded-lg border-2 border-dashed border-orange-300 text-orange-500 flex flex-col items-center justify-center text-[10px]">
              {busy === "photo-issue" ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
              Chụp
            </button>
          )}
        </div>
      </section>

      {error && <p className="text-red-600 text-sm mt-3">{error}</p>}

      {!task.locked && !submitted && (
        <button
          disabled={!allDone || busy !== null}
          onClick={() => act({ action: "submit" }, "submit")}
          className="w-full mt-5 mb-10 bg-emerald-600 disabled:bg-gray-300 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 text-lg"
        >
          {busy === "submit" ? <Loader2 className="animate-spin" /> : <Send size={20} />}
          {allDone ? "Hoàn thành — gửi chủ nhà" : `Còn ${task.checklist.length - doneCount} mục`}
        </button>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-gray-50 p-4 max-w-lg mx-auto w-full">{children}</div>;
}
