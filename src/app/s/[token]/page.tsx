"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, KeyRound, Loader2, LifeBuoy, LogOut, MapPin, ShieldCheck, Star, Wifi, Clock, Lock } from "lucide-react";

type Lang = "en" | "vi";
interface View {
  guestName: string; room: string; roomNumber: string | null; checkIn: string; checkOut: string;
  checkInTime: string; checkOutTime: string; phase: "before" | "staying" | "checkout" | "after"; lang: Lang;
  requireId: boolean; idCount: number; idSubmitted: boolean; arrivalTime: string | null; guests: number | null;
  codes: { door: string; code: string }[];
  codesState: "visible" | "need_id" | "too_early" | "preparing" | "expired"; codesOpenAt: string;
  wifi: { name: string; password: string } | null; hotline: string; whatsapp: string; googleReview: string;
  feedbackSent: boolean; issuesCount: number;
  demo?: { step: string; steps: { key: string; label: string }[] };
}

const T = {
  welcome: { en: "Welcome", vi: "Chào mừng" },
  checkin: { en: "Check-in from", vi: "Nhận phòng từ" },
  checkout: { en: "Check-out by", vi: "Trả phòng trước" },
  regTitle: { en: "1 · Guest registration", vi: "1 · Đăng ký lưu trú" },
  regBody: {
    en: "Vietnamese law requires us to register every guest with the local police. Please upload clear photos for EACH guest (all 4 corners visible, no glare). Photos are only used for registration and are deleted 30 days after check-out.",
    vi: "Theo quy định, Joystay phải khai báo lưu trú cho mọi khách với công an phường. Vui lòng tải ảnh rõ nét của TỪNG khách (thấy đủ 4 góc, không loá). Ảnh chỉ dùng để khai báo và được xoá sau 30 ngày kể từ ngày trả phòng.",
  },
  idForeign: { en: "Foreign guests — 2 photos per person", vi: "Khách nước ngoài — 2 ảnh mỗi người" },
  idPassport: { en: "Passport photo page", vi: "Trang thông tin hộ chiếu" },
  idVisa: { en: "Vietnam visa / e-visa / entry stamp page", vi: "Trang thị thực Việt Nam / e-visa / dấu nhập cảnh" },
  idLocal: { en: "Vietnamese guests — ID card (CCCD), both sides", vi: "Khách Việt Nam — CCCD 2 mặt" },
  idFront: { en: "Front", vi: "Mặt trước" },
  idBack: { en: "Back", vi: "Mặt sau" },
  stairs: { en: "stairs only, no elevator", vi: "chỉ có thang bộ" },
  addPhoto: { en: "Add photo", vi: "Thêm ảnh" },
  photos: { en: "photo(s) added", vi: "ảnh đã thêm" },
  submitId: { en: "Submit registration", vi: "Gửi giấy tờ" },
  idDone: { en: "Registration received — thank you!", vi: "Đã nhận giấy tờ — cảm ơn bạn!" },
  arrTitle: { en: "2 · Your arrival", vi: "2 · Giờ đến" },
  arrTime: { en: "Estimated arrival time", vi: "Giờ dự kiến đến" },
  guests: { en: "Number of guests", vi: "Số khách" },
  save: { en: "Save", vi: "Lưu" },
  saved: { en: "Saved", vi: "Đã lưu" },
  codesTitle: { en: "3 · Door codes", vi: "3 · Mã cửa" },
  needId: { en: "Your codes appear here once the registration above is submitted.", vi: "Mã cửa sẽ hiện ở đây sau khi bạn gửi giấy tờ ở bước 1." },
  tooEarly: { en: "Your codes will appear here from", vi: "Mã cửa sẽ hiện ở đây từ" },
  preparing: { en: "We are preparing your codes — refresh in a few minutes, or message us if you are already here.", vi: "Joystay đang chuẩn bị mã — tải lại sau vài phút, hoặc nhắn Joystay nếu bạn đã tới nơi." },
  expired: { en: "Your stay has ended — thank you for staying with us!", vi: "Kỳ lưu trú đã kết thúc — cảm ơn bạn đã ở Joystay!" },
  sameCode: { en: "One code for the main door, inner gate and your room", vi: "Một mã dùng cho cửa nhà, cổng và cửa phòng" },
  pressHash: { en: "Tap the screen to wake the lock → enter the code → press #", vi: "Chạm màn hình cho khoá sáng → nhập mã → nhấn #" },
  firstUse: { en: "Please use your codes for the first time within 24 hours of check-in time. Arriving later? Message us for new codes.", vi: "Hãy dùng mã lần đầu trong vòng 24 giờ kể từ giờ nhận phòng. Đến trễ hơn? Nhắn Joystay để được cấp mã mới." },
  wayTitle: { en: "Getting in", vi: "Cách vào nhà" },
  way: {
    en: [
      "By motorbike: park at the lot at 382/27 Nguyễn Thị Minh Khai (1-minute walk). No indoor parking.",
      "By taxi/car: the alley is car-accessible — ask to be dropped at 382/23 Nguyễn Thị Minh Khai, District 3.",
      "The ground floor of 382/23 is the PORO Trading Card Game shop — Joystay shares this entrance. Walk through to the main gate.",
      "Open the main gate, then your room door, with the codes above.",
      "Arriving before check-in? Luggage lockers are available — message us.",
    ],
    vi: [
      "Đi xe máy: gửi xe tại bãi 382/27 Nguyễn Thị Minh Khai (đi bộ 1 phút). Không có chỗ để xe trong nhà.",
      "Đi taxi/ô tô: hẻm xe hơi vào được — xuống tại 382/23 Nguyễn Thị Minh Khai, Quận 3.",
      "Tầng trệt 382/23 là cửa hàng PORO Trading Card Game — Joystay dùng chung lối vào. Đi thẳng vào tới cổng chính.",
      "Mở cổng chính rồi cửa phòng bằng mã ở trên.",
      "Đến sớm trước giờ nhận phòng? Có tủ gửi hành lý — nhắn Joystay.",
    ],
  },
  fullGuide: { en: "Full guest guide, FAQ & places nearby →", vi: "Cẩm nang đầy đủ, hỏi đáp & quanh đây →" },
  helpTitle: { en: "Need help?", vi: "Cần hỗ trợ?" },
  helpBody: { en: "Something not working (lock, AC, hot water, WiFi…)? Tell us here — we are notified immediately.", vi: "Có gì trục trặc (khoá, máy lạnh, nước nóng, WiFi…)? Nhắn ở đây — Joystay nhận thông báo ngay." },
  helpPh: { en: "Describe the problem…", vi: "Mô tả vấn đề…" },
  send: { en: "Send", vi: "Gửi" },
  helpSent: { en: "Sent — we'll get back to you shortly. Urgent? Call or WhatsApp us.", vi: "Đã gửi — Joystay sẽ phản hồi ngay. Gấp? Gọi hoặc WhatsApp." },
  coTitle: { en: "Check-out", vi: "Trả phòng" },
  coSteps: {
    en: ["Leave by the check-out time — need longer? Message us first.", "Turn off the AC, lights and TV; close the windows.", "Put rubbish in the bin; leave used towels in the bathroom.", "Close the room door and the main gate behind you. No key to return!"],
    vi: ["Trả phòng đúng giờ — cần ở thêm? Nhắn Joystay trước.", "Tắt máy lạnh, đèn, TV; đóng cửa sổ.", "Bỏ rác vào thùng; để khăn đã dùng trong phòng tắm.", "Đóng cửa phòng và cổng chính khi ra. Không cần trả chìa khoá!"],
  },
  fbTitle: { en: "How was your stay?", vi: "Kỳ lưu trú thế nào?" },
  fbPh: { en: "Anything we could do better? (private, only the host sees this)", vi: "Joystay có thể làm tốt hơn điều gì? (riêng tư, chỉ chủ nhà xem)" },
  fbThanks: { en: "Thank you for your feedback!", vi: "Cảm ơn góp ý của bạn!" },
  google: { en: "Enjoyed it? A Google review helps us a lot ★", vi: "Bạn hài lòng? Một đánh giá Google giúp Joystay rất nhiều ★" },
};

const fmtDate = (iso: string, lang: Lang) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(lang === "vi" ? "vi-VN" : "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

async function compress(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("x"))), "image/jpeg", 0.85));
  } catch { return file; }
}

export default function StayPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [v, setV] = useState<View | null>(null);
  const [lang, setLang] = useState<Lang>("en");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [arr, setArr] = useState({ time: "", guests: "" });
  const [issue, setIssue] = useState("");
  const [sentIssue, setSentIssue] = useState(false);
  const [savedArr, setSavedArr] = useState(false);
  const [rating, setRating] = useState(0);
  const [fb, setFb] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [at, setAt] = useState<string>("");
  const qs = token === "demo" && at ? `?at=${at}` : "";
  const t = (k: keyof typeof T) => (T[k] as Record<Lang, string>)[lang];

  useEffect(() => {
    if (token === "demo") setAt(new URLSearchParams(window.location.search).get("at") ?? "chieu-ngay-den");
  }, [token]);

  const load = useCallback(async () => {
    if (token === "demo" && !at) return;
    const r = await fetch(`/api/stay/t/${token}${qs}`, { cache: "no-store" });
    const d = await r.json();
    if (!r.ok) { setError(d.error); return; }
    setV(d);
    setLang((l) => (d.lang === "vi" || d.lang === "en" ? d.lang : l));
    setArr({ time: d.arrivalTime ?? "", guests: d.guests ? String(d.guests) : "" });
  }, [token, at, qs]);
  useEffect(() => { load(); }, [load]);

  async function post(body: Record<string, unknown>, key: string, url = `/api/stay/t/${token}${qs}`) {
    setBusy(key); setError(null);
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setError(d.error); return false; }
      setV(d); return true;
    } finally { setBusy(null); }
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy("upload"); setError(null);
    try {
      for (const f of Array.from(files).slice(0, 4)) {
        const fd = new FormData();
        fd.append("file", new File([await compress(f)], "id.jpg", { type: "image/jpeg" }));
        const r = await fetch(`/api/stay/t/${token}/id${qs}`, { method: "POST", body: fd });
        const d = await r.json();
        if (!r.ok) { setError(d.error); break; }
        setV(d);
      }
    } finally { setBusy(null); if (fileRef.current) fileRef.current.value = ""; }
  }

  function switchLang(l: Lang) { setLang(l); post({ action: "lang", lang: l }, "lang"); }

  if (error && !v) return <Shell><p className="text-center text-red-600 py-24">{error}</p></Shell>;
  if (!v) return <Shell><div className="flex justify-center py-24"><Loader2 className="animate-spin text-[#6B9467]" /></div></Shell>;

  const openAt = new Date(v.codesOpenAt).toLocaleString(lang === "vi" ? "vi-VN" : "en-GB", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short", timeZone: "Asia/Ho_Chi_Minh" });

  return (
    <Shell>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />

      {v.demo && (
        <div className="bg-amber-100 border border-amber-300 rounded-2xl p-3 text-sm">
          <p className="font-semibold text-amber-900">DEMO — dữ liệu giả, không gửi gì cho ai. Chọn thời điểm để xem khách thấy gì:</p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {v.demo.steps.map((s) => (
              <button key={s.key} onClick={() => { setAt(s.key); window.history.replaceState(null, "", `?at=${s.key}`); }}
                className={`px-2.5 py-1 rounded-full text-xs ${v.demo!.step === s.key ? "bg-amber-600 text-white" : "bg-white text-amber-900 border border-amber-300"}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <header className="bg-[#1A1E1A] text-white rounded-3xl p-5">
        <div className="flex justify-between items-start">
          <p className="text-[#A8C8A4] text-[11px] font-semibold tracking-[0.2em] uppercase">Joystay · The Art of Stay</p>
          <div className="flex text-xs rounded-full bg-white/10 p-0.5">
            {(["en", "vi"] as Lang[]).map((l) => (
              <button key={l} onClick={() => switchLang(l)} className={`px-2.5 py-1 rounded-full ${lang === l ? "bg-white text-[#1A1E1A]" : "text-white/70"}`}>{l.toUpperCase()}</button>
            ))}
          </div>
        </div>
        <h1 className="text-2xl font-semibold mt-3">{t("welcome")}{v.guestName ? `, ${v.guestName}` : ""}</h1>
        <p className="text-white/80 mt-1">{v.room}</p>
        {floorLabel(v.roomNumber, lang) && (
          <p className="text-[#A8C8A4] text-sm mt-0.5">{floorLabel(v.roomNumber, lang)} · {t("stairs")}</p>
        )}
        <div className="grid grid-cols-2 gap-2 mt-4 text-sm">
          <div className="bg-white/10 rounded-xl p-3"><p className="text-white/60 text-xs">{t("checkin")}</p><p className="font-semibold">{v.checkInTime} · {fmtDate(v.checkIn, lang)}</p></div>
          <div className="bg-white/10 rounded-xl p-3"><p className="text-white/60 text-xs">{t("checkout")}</p><p className="font-semibold">{v.checkOutTime} · {fmtDate(v.checkOut, lang)}</p></div>
        </div>
      </header>

      {error && <p className="text-sm text-red-600 mt-3 px-1">{error}</p>}

      {/* 1. Giấy tờ */}
      {v.phase !== "after" && (
        <Card icon={<ShieldCheck size={18} />} title={t("regTitle")} done={v.idSubmitted}>
          {v.idSubmitted ? (
            <p className="text-sm text-[#6B9467] font-medium flex items-center gap-1.5"><Check size={16} /> {t("idDone")} ({v.idCount} {t("photos")})</p>
          ) : (
            <>
              <p className="text-sm text-[#6A7A68]">{t("regBody")}</p>
              <IdExamples t={t} />
              <div className="flex items-center gap-3 mt-3">
                <button onClick={() => fileRef.current?.click()} disabled={busy !== null}
                  className="flex items-center gap-2 border-2 border-dashed border-[#6B9467] text-[#6B9467] rounded-xl px-4 py-3 text-sm font-medium">
                  {busy === "upload" ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />} {t("addPhoto")}
                </button>
                <span className="text-sm text-[#6A7A68]">{v.idCount} {t("photos")}</span>
              </div>
              <button onClick={() => post({ action: "submit" }, "submit", `/api/stay/t/${token}/id${qs}`)} disabled={v.idCount === 0 || busy !== null}
                className="w-full mt-3 bg-[#6B9467] disabled:bg-gray-300 text-white rounded-xl py-3 font-semibold">
                {busy === "submit" ? <Loader2 size={18} className="animate-spin mx-auto" /> : t("submitId")}
              </button>
            </>
          )}
        </Card>
      )}

      {/* 2. Giờ đến */}
      {v.phase === "before" || (v.phase === "staying" && v.codesState !== "visible") ? (
        <Card icon={<Clock size={18} />} title={t("arrTitle")} done={Boolean(v.arrivalTime)}>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-[#6A7A68]">{t("arrTime")}
              <input type="time" value={arr.time} onChange={(e) => { setArr((p) => ({ ...p, time: e.target.value })); setSavedArr(false); }}
                className="w-full mt-1 border border-[#C8DCC6] rounded-xl px-3 py-2.5 text-base text-[#1A1E1A]" />
            </label>
            <label className="text-xs text-[#6A7A68]">{t("guests")}
              <select value={arr.guests} onChange={(e) => { setArr((p) => ({ ...p, guests: e.target.value })); setSavedArr(false); }}
                className="w-full mt-1 border border-[#C8DCC6] rounded-xl px-3 py-2.5 text-base text-[#1A1E1A] bg-white">
                <option value="">—</option><option value="1">1</option><option value="2">2</option>
              </select>
            </label>
          </div>
          <button onClick={async () => setSavedArr(await post({ action: "arrival", time: arr.time, guests: Number(arr.guests) }, "arr"))}
            className="mt-3 text-sm px-4 py-2 rounded-xl bg-[#E8F2E8] text-[#1A1E1A] font-medium">
            {busy === "arr" ? <Loader2 size={16} className="animate-spin" /> : savedArr ? `✓ ${t("saved")}` : t("save")}
          </button>
        </Card>
      ) : null}

      {/* 3. Mã cửa */}
      <Card icon={<KeyRound size={18} />} title={t("codesTitle")} done={v.codesState === "visible"}>
        {v.codesState === "visible" ? (
          <>
            {v.codes.length > 1 && v.codes.every((c) => c.code === v.codes[0].code) ? (
              <div className="bg-[#F4F8F4] rounded-2xl px-4 py-5 text-center">
                <p className="text-4xl font-bold tracking-[0.3em] tabular-nums">{v.codes[0].code}<span className="text-[#6B9467]"> #</span></p>
                <p className="text-sm text-[#6A7A68] mt-2">{t("sameCode")}</p>
              </div>
            ) : (
            <div className="space-y-2">
              {v.codes.map((c) => (
                <div key={c.door} className="flex justify-between items-center bg-[#F4F8F4] rounded-xl px-4 py-3">
                  <span className="text-sm text-[#6A7A68]">{c.door}</span>
                  <span className="text-2xl font-bold tracking-[0.15em] tabular-nums">{c.code}<span className="text-[#6B9467]"> #</span></span>
                </div>
              ))}
            </div>
            )}
            <p className="text-sm text-[#6A7A68] mt-3">{t("pressHash")}</p>
            <p className="text-xs text-[#6A7A68] mt-1">{t("firstUse")}</p>
            {v.wifi && (
              <div className="mt-3 flex items-center gap-3 bg-[#F4F8F4] rounded-xl px-4 py-3 text-sm">
                <Wifi size={18} className="text-[#6B9467]" />
                <span><b>{v.wifi.name}</b> · {v.wifi.password}</span>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-[#6A7A68] flex gap-2">
            <Lock size={16} className="shrink-0 mt-0.5" />
            {v.codesState === "need_id" ? t("needId")
              : v.codesState === "too_early" ? `${t("tooEarly")} ${openAt}.`
              : v.codesState === "preparing" ? t("preparing")
              : t("expired")}
          </p>
        )}
      </Card>

      {/* Cách vào nhà */}
      {v.phase !== "after" && (
        <Card icon={<MapPin size={18} />} title={t("wayTitle")}>
          <ol className="space-y-2 text-sm text-[#1A1E1A] list-decimal pl-5">
            {T.way[lang].map((s) => <li key={s}>{s}</li>)}
          </ol>
          <div className="grid gap-3 mt-4">
            <a href="/guide/parking.jpg" target="_blank" rel="noreferrer">
              <img src="/guide/parking.jpg" alt={lang === "vi" ? "Hướng dẫn gửi xe & đường đi" : "Parking & directions"} className="w-full rounded-2xl border border-[#C8DCC6]" loading="lazy" />
            </a>
            <a href="/guide/unlock.jpg" target="_blank" rel="noreferrer">
              <img src="/guide/unlock.jpg" alt={lang === "vi" ? "Hướng dẫn mở khoá" : "How to unlock"} className="w-full rounded-2xl border border-[#C8DCC6]" loading="lazy" />
            </a>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <a href="https://maps.app.goo.gl/1dreN6KLAHZEqRuc6" target="_blank" rel="noreferrer"
              className="text-sm px-3 py-2 rounded-xl bg-[#E8F2E8]">Google Maps</a>
            <a href="https://joystay.vn/guide" target="_blank" rel="noreferrer" className="text-sm px-3 py-2 rounded-xl bg-[#E8F2E8]">{t("fullGuide")}</a>
          </div>
        </Card>
      )}

      {/* Trả phòng */}
      {(v.phase === "staying" || v.phase === "checkout") && (
        <Card icon={<LogOut size={18} />} title={`${t("coTitle")} · ${v.checkOutTime} ${fmtDate(v.checkOut, lang)}`}>
          <ul className="space-y-1.5 text-sm list-disc pl-5">{T.coSteps[lang].map((s) => <li key={s}>{s}</li>)}</ul>
        </Card>
      )}

      {/* Góp ý */}
      {(v.phase === "checkout" || v.phase === "after") && (
        <Card icon={<Star size={18} />} title={t("fbTitle")} done={v.feedbackSent}>
          {v.feedbackSent ? (
            <p className="text-sm text-[#6B9467] font-medium">{t("fbThanks")}</p>
          ) : (
            <>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} onClick={() => setRating(n)} aria-label={`${n}`}>
                    <Star size={32} className={n <= rating ? "fill-[#E0B04A] text-[#E0B04A]" : "text-gray-300"} />
                  </button>
                ))}
              </div>
              <textarea value={fb} onChange={(e) => setFb(e.target.value)} rows={3} placeholder={t("fbPh")}
                className="w-full mt-3 border border-[#C8DCC6] rounded-xl p-3 text-sm" />
              <button onClick={() => post({ action: "feedback", rating, text: fb }, "fb")} disabled={!rating || busy !== null}
                className="mt-2 text-sm px-4 py-2 rounded-xl bg-[#1A1E1A] disabled:bg-gray-300 text-white font-medium">{t("send")}</button>
            </>
          )}
          <a href={v.googleReview} target="_blank" rel="noreferrer" className="block mt-3 text-sm text-[#6B9467] underline">{t("google")}</a>
        </Card>
      )}

      {/* Hỗ trợ */}
      <Card icon={<LifeBuoy size={18} />} title={t("helpTitle")}>
        {sentIssue ? <p className="text-sm text-[#6B9467] font-medium">{t("helpSent")}</p> : (
          <>
            <p className="text-sm text-[#6A7A68]">{t("helpBody")}</p>
            <textarea value={issue} onChange={(e) => setIssue(e.target.value)} rows={3} placeholder={t("helpPh")}
              className="w-full mt-2 border border-[#C8DCC6] rounded-xl p-3 text-sm" />
            <button onClick={async () => { if (await post({ action: "issue", text: issue }, "issue")) { setSentIssue(true); setIssue(""); } }}
              disabled={!issue.trim() || busy !== null} className="mt-2 text-sm px-4 py-2 rounded-xl bg-[#1A1E1A] disabled:bg-gray-300 text-white font-medium">
              {busy === "issue" ? <Loader2 size={16} className="animate-spin" /> : t("send")}
            </button>
          </>
        )}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <a href={v.whatsapp} className="text-center text-sm py-2.5 rounded-xl bg-[#25D366] text-white font-medium">WhatsApp</a>
          <a href={`tel:${v.hotline.replace(/\s/g, "")}`} className="text-center text-sm py-2.5 rounded-xl bg-[#E8F2E8] font-medium">{v.hotline}</a>
        </div>
      </Card>

      <p className="text-center text-xs text-[#6A7A68] py-6">382/23 Nguyễn Thị Minh Khai, Bàn Cờ, District 3 · joystay.vn</p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#F4F8F4] text-[#1A1E1A]"><div className="max-w-md mx-auto p-4 space-y-3">{children}</div></div>;
}

function Card({ icon, title, done, children }: { icon: React.ReactNode; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-3xl border border-[#C8DCC6] p-5">
      <h2 className="font-semibold flex items-center gap-2 mb-3">
        <span className={done ? "text-[#6B9467]" : "text-[#1A1E1A]"}>{icon}</span>{title}
        {done && <Check size={16} className="text-[#6B9467] ml-auto" />}
      </h2>
      {children}
    </section>
  );
}

// ── Tầng: 1xx = tầng trệt, 2xx = lầu 1, 3xx = lầu 2, 4xx = lầu 3 (chỉ có thang bộ) ──
function floorLabel(roomNumber: string | null, lang: Lang): string | null {
  const n = Number(String(roomNumber ?? "").trim().charAt(0));
  if (!n) return null;
  const f = n - 1;
  if (lang === "vi") return f === 0 ? "Tầng trệt" : `Lầu ${f}`;
  if (f === 0) return "Ground floor";
  const ord = f === 1 ? "1st" : f === 2 ? "2nd" : f === 3 ? "3rd" : `${f}th`;
  return `${ord} floor (${f} flight${f > 1 ? "s" : ""} of stairs up)`;
}

// ── Ảnh minh hoạ giấy tờ cần chụp (hình vẽ mẫu, không phải giấy tờ thật) ──
function IdExamples({ t }: { t: (k: "idForeign" | "idPassport" | "idVisa" | "idLocal" | "idFront" | "idBack") => string }) {
  return (
    <div className="mt-3 space-y-3">
      <div>
        <p className="text-xs font-semibold text-[#1A1E1A] mb-1.5">🌍 {t("idForeign")}</p>
        <div className="grid grid-cols-2 gap-2">
          <Example n={1} label={t("idPassport")}><PassportSvg /></Example>
          <Example n={2} label={t("idVisa")}><VisaSvg /></Example>
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-[#1A1E1A] mb-1.5">🇻🇳 {t("idLocal")}</p>
        <div className="grid grid-cols-2 gap-2">
          <Example n={1} label={t("idFront")}><CardSvg front /></Example>
          <Example n={2} label={t("idBack")}><CardSvg /></Example>
        </div>
      </div>
    </div>
  );
}

function Example({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <figure className="bg-[#F4F8F3] rounded-xl p-2 border border-[#C8DCC6]">
      <div className="relative">
        {children}
        <span className="absolute -top-1 -left-1 w-5 h-5 rounded-full bg-[#6B9467] text-white text-[11px] font-bold flex items-center justify-center">{n}</span>
      </div>
      <figcaption className="text-[11px] leading-tight text-[#1A1E1A] mt-1.5 text-center">{label}</figcaption>
    </figure>
  );
}

const ink = "#6A7A68", soft = "#C8DCC6", hi = "#6B9467";

function PassportSvg() {
  return (
    <svg viewBox="0 0 160 110" className="w-full h-auto" aria-hidden>
      <rect x="2" y="2" width="156" height="106" rx="6" fill="#fff" stroke={hi} strokeWidth="2.5" />
      <text x="10" y="16" fontSize="8" fontWeight="700" fill={ink}>PASSPORT</text>
      <rect x="10" y="22" width="34" height="44" rx="3" fill={soft} />
      <circle cx="27" cy="38" r="8" fill="#fff" /><rect x="15" y="50" width="24" height="12" rx="6" fill="#fff" />
      {[24, 34, 44, 54, 64].map((y) => <rect key={y} x="52" y={y} width={y % 20 === 4 ? 70 : 92} height="5" rx="2" fill={soft} />)}
      <rect x="8" y="78" width="144" height="24" rx="3" fill="#F4F8F3" />
      <text x="12" y="88" fontSize="7" fontFamily="monospace" fill={ink}>P&lt;VNMXXXXXX&lt;&lt;XXXXX&lt;&lt;&lt;&lt;&lt;</text>
      <text x="12" y="98" fontSize="7" fontFamily="monospace" fill={ink}>X000000&lt;0XXX0000000&lt;&lt;&lt;&lt;</text>
    </svg>
  );
}

function VisaSvg() {
  return (
    <svg viewBox="0 0 160 110" className="w-full h-auto" aria-hidden>
      <rect x="2" y="2" width="156" height="106" rx="6" fill="#fff" stroke={hi} strokeWidth="2.5" />
      <rect x="10" y="10" width="140" height="62" rx="4" fill="#FDF6E7" stroke="#E7C98B" />
      <text x="16" y="22" fontSize="7.5" fontWeight="700" fill="#9A6B12">VIET NAM · VISA / THỊ THỰC</text>
      <rect x="16" y="28" width="24" height="32" rx="2" fill="#F1E2BF" />
      {[30, 38, 46, 54].map((y) => <rect key={y} x="46" y={y} width={y === 54 ? 50 : 96} height="4" rx="2" fill="#F1E2BF" />)}
      <circle cx="122" cy="90" r="14" fill="none" stroke="#B4473C" strokeWidth="2" strokeDasharray="3 2" />
      <text x="110" y="93" fontSize="6.5" fontWeight="700" fill="#B4473C">ENTRY</text>
      <text x="12" y="88" fontSize="6.5" fill={ink}>or e-visa printout</text>
      <text x="12" y="98" fontSize="6.5" fill={ink}>/ entry stamp</text>
    </svg>
  );
}

function CardSvg({ front = false }: { front?: boolean }) {
  return (
    <svg viewBox="0 0 160 100" className="w-full h-auto" aria-hidden>
      <rect x="2" y="2" width="156" height="96" rx="8" fill="#fff" stroke={hi} strokeWidth="2.5" />
      {front ? (
        <>
          <text x="10" y="16" fontSize="7" fontWeight="700" fill={ink}>CĂN CƯỚC CÔNG DÂN</text>
          <rect x="10" y="24" width="30" height="40" rx="3" fill={soft} />
          <circle cx="25" cy="38" r="7" fill="#fff" /><rect x="15" y="49" width="20" height="11" rx="5" fill="#fff" />
          {[26, 36, 46, 56].map((y) => <rect key={y} x="48" y={y} width={y === 56 ? 60 : 98} height="5" rx="2" fill={soft} />)}
          <rect x="10" y="74" width="40" height="16" rx="2" fill="#F4F8F3" />
        </>
      ) : (
        <>
          <rect x="10" y="12" width="22" height="18" rx="2" fill="#E7C98B" />
          {[16, 24].map((y) => <rect key={y} x="40" y={y} width="100" height="4" rx="2" fill={soft} />)}
          <rect x="8" y="58" width="144" height="32" rx="3" fill="#F4F8F3" />
          <text x="12" y="70" fontSize="7" fontFamily="monospace" fill={ink}>IDVNM0000000000&lt;&lt;&lt;&lt;&lt;</text>
          <text x="12" y="82" fontSize="7" fontFamily="monospace" fill={ink}>XXXXX&lt;&lt;XXXX&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;</text>
        </>
      )}
    </svg>
  );
}
