/**
 * Ghép phòng thật ↔ khoá TTLock và cấp mã cho một booking.
 * Số phòng (roomNo) lấy từ ROOMS_JSON. Lưu ý: listing Black & White và Parisian Chic là CÙNG phòng 302.
 */
import { config } from "../config";
import { changePasscodePeriod, customPasscode, deletePasscode, listPasscodes, periodPasscode, ttlockConfigured, TTLockError } from "./ttlock";

/** Giờ mã cửa bắt đầu mở được (giờ VN, ngày nhận phòng). Mặc định 12:00 — khách vẫn nhận phòng 15:00. */
const CODE_FROM = process.env.DOOR_CODE_FROM || "12:00";

/** lockId theo số phòng — ghi đè bằng env ROOM_LOCKS_JSON, vd {"101":29770292} */
const DEFAULT_ROOM_LOCKS: Record<string, number> = {
  "101": 29770292, // Cozy Indochine Sleep Cave (tên trong app: "101 midnight indochine")
  "201": 29651740, // The Indochine Midnight Hideout
  "202": 18005596, // Pop Art Studio w/ Kitchen
  "301": 35796696, // The Tropical Oasis Room (tên trong app: "301 moi")
  "302": 29770114, // Black & White Room + Parisian Chic Room
  "401": 29770358, // chưa có listing
};

/** Khoá lối vào chung — ghi đè bằng env ENTRANCE_LOCKS_JSON, vd [{"name":"Cửa nhà","lockId":29769774}] */
const DEFAULT_ENTRANCE: { name: string; lockId: number }[] = [
  { name: "Main door · Cửa nhà", lockId: 29769774 },
  { name: "Inner gate · Cổng trong", lockId: 29747718 },
];

function parse<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { console.error("[Doors] JSON env không hợp lệ, dùng mặc định"); return fallback; }
}
export const ROOM_LOCKS = parse(process.env.ROOM_LOCKS_JSON, DEFAULT_ROOM_LOCKS);
export const ENTRANCE_LOCKS = parse(process.env.ENTRANCE_LOCKS_JSON, DEFAULT_ENTRANCE);

/** "2026-11-05" + "14:00" giờ VN → epoch ms */
const vnTime = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm.padStart(5, "0")}:00+07:00`);

export interface DoorCode { door: string; lockId: number; passcode: string; passcodeId: number; custom: boolean; existing?: boolean }

/**
 * Cấp mã cho 1 lượt ở. Chế độ mặc định (DOOR_CODE_MODE=same4, chủ quyết định 05/11):
 *   CÙNG 1 mã 4 số cho cửa nhà + cổng + cửa phòng = 4 số cuối ĐT khách (preferredCode);
 *   không có 4 số cuối → 4 số ngẫu nhiên; bị trùng → (DOOR_CODE_STRICT, mặc định) KHÔNG đổi số, báo chủ. Mã tự chọn đẩy qua bộ phát.
 *   Khoá nào không nhận mã tự chọn (ngoài tầm bộ phát…) → khoá đó dùng mã TỰ SINH (custom=false) và báo chủ.
 * DOOR_CODE_MODE=random → mã tự sinh cho từng khoá như trước.
 */
export async function issueDoorCodes(p: {
  code: string; roomNo?: string; roomName: string; guestName: string; checkIn: string; checkOut: string; preferredCode?: string | null;
}): Promise<{ ok: true; codes: DoorCode[]; validFrom: number; validTo: number; sharedCode: string | null; note: string } | { ok: false; reason: string }> {
  if (!ttlockConfigured()) return { ok: false, reason: "chưa cấu hình TTLock" };
  const roomLock = p.roomNo ? ROOM_LOCKS[p.roomNo] : undefined;
  if (!roomLock) return { ok: false, reason: `chưa có khoá cho phòng ${p.roomNo ?? "(thiếu roomNo trong ROOMS_JSON)"}` };

  const validFrom = vnTime(p.checkIn, CODE_FROM);
  const validTo = vnTime(p.checkOut, config.booking.checkOutTime || "12:00");
  const name = `${p.code} ${p.guestName}`;
  const doors = [...ENTRANCE_LOCKS, { name: `Room ${p.roomNo} · Phòng ${p.roomNo}`, lockId: roomLock }];

  if ((process.env.DOOR_CODE_MODE ?? "same4") === "random") {
    const codes: DoorCode[] = [];
    for (const d of doors) codes.push({ door: d.name, lockId: d.lockId, ...(await periodPasscode(d.lockId, validFrom, validTo, name)), custom: false });
    return { ok: true, codes, validFrom, validTo, sharedCode: null, note: "mã tự sinh cho từng cửa" };
  }

  const random4 = () => String(Math.floor(1000 + Math.random() * 9000));
  const pref = (p.preferredCode ?? "").replace(/\D/g, "");
  const hasPref = /^\d{4}$/.test(pref);
  // Chế độ CHẶT (mặc định, chủ chọn 07/11): Airbnb tự gửi "Mã cửa đề xuất" (= 4 số cuối ĐT) cho khách trong tin ②
  // → mã khoá BẮT BUỘC đúng số đó, không tự đổi sang số khác. Trùng → báo chủ, bot thử lại mỗi 15 phút.
  const strict = (process.env.DOOR_CODE_STRICT ?? "true") !== "false";
  const candidates = hasPref ? (strict ? [pref] : [pref, random4(), random4()]) : [random4(), random4(), random4()];
  const isDup = (e: unknown) => e instanceof TTLockError && /exist|repeat|duplicat|same|already/i.test(e.message);
  // Bộ phát mất mạng (-3002 gateway offline, -2012 khoá không nối bộ phát…): KHÔNG lấy mã tự sinh ngay
  // (mã đó khác 4 số Airbnb đã gửi khách) → báo chủ, thử lại mỗi 15'. Chỉ khi còn < FALLBACK_HOURS tới giờ mở mã
  // mà bộ phát vẫn mất mạng mới dùng mã tự sinh (để khách vẫn vào được) và báo chủ nhắn khách.
  const isGatewayDown = (e: unknown) => e instanceof TTLockError && /-3002|-2012|-3003|-4043|gateway|not connected|offline/i.test(e.message);
  const fallbackHours = Number(process.env.DOOR_CODE_FALLBACK_HOURS ?? "3");
  const allowFallback = Date.now() >= validFrom - fallbackHours * 3_600_000;

  for (const [attempt, code] of candidates.entries()) {
    const codes: DoorCode[] = [];
    let dup = false;
    for (const d of doors) {
      try {
        codes.push({ door: d.name, lockId: d.lockId, ...(await customPasscode(d.lockId, code, validFrom, validTo, name)), custom: true });
      } catch (e) {
        if (isDup(e) && hasPref && code === pref) {
          // chủ đã tự tạo đúng mã này trên khoá (vd khách đã nhận tin Airbnb) và mã còn hiệu lực tới giờ trả phòng → dùng lại
          const mine = await listPasscodes(d.lockId).then((l) => l.find((x) => String(x.keyboardPwd) === code)).catch(() => undefined);
          const covers = mine && (!mine.endDate || mine.endDate === 0 || mine.keyboardPwdType === 2 || mine.endDate >= validTo - 3_600_000);
          if (mine && covers) {
            console.log(`[Doors] ${d.name}: mã ${code} đã có sẵn trên khoá (id ${mine.keyboardPwdId}) → dùng lại`);
            codes.push({ door: d.name, lockId: d.lockId, passcode: code, passcodeId: Number(mine.keyboardPwdId), custom: true, existing: true });
            continue;
          }
        }
        if (isDup(e)) { dup = true; break; }
        if (isGatewayDown(e) && !allowFallback) {
          for (const c of codes.filter((x) => x.custom && !x.existing)) await deletePasscode(c.lockId, c.passcodeId).catch(() => {});
          return { ok: false, reason: `bộ phát TTLock mất mạng (${d.name}: ${(e as Error).message}). Kiểm tra điện/wifi bộ phát; bot tự thử lại mỗi 15 phút với mã ${code}` };
        }
        // khoá không nhận mã tự chọn → dùng mã tự sinh cho riêng khoá này
        console.warn(`[Doors] ${d.name}: mã tự chọn lỗi (${(e as Error).message}) → dùng mã tự sinh`);
        codes.push({ door: d.name, lockId: d.lockId, ...(await periodPasscode(d.lockId, validFrom, validTo, name)), custom: false });
      }
    }
    if (!dup) {
      const fallback = codes.filter((c) => !c.custom).map((c) => c.door);
      const why = attempt === 0 && code === pref ? "4 số cuối ĐT khách (trùng mã Airbnb gửi khách)" : attempt === 0 ? "4 số ngẫu nhiên (không có 4 số cuối ĐT → Airbnb KHÔNG điền được mã, khách phải xem trang lưu trú)" : "4 số ngẫu nhiên (4 số cuối ĐT bị trùng)";
      return {
        ok: true, codes, validFrom, validTo, sharedCode: code,
        note: `mã chung ${code} = ${why}` + (fallback.length ? ` · ⚠️ ${fallback.join(", ")} dùng mã tự sinh khác — mã Airbnb gửi KHÔNG mở được cửa này, nhắn khách ngay!` : ""),
      };
    }
    // trùng mã: gỡ các mã đã thêm ở lượt này rồi thử số khác
    for (const c of codes.filter((x) => x.custom && !x.existing)) await deletePasscode(c.lockId, c.passcodeId).catch(() => {});
  }
  return {
    ok: false,
    reason: hasPref && strict
      ? `mã ${pref} (4 số cuối ĐT khách — Airbnb đã/sẽ gửi số này cho khách) đang TRÙNG với một mã còn hiệu lực ở cửa chung. Xoá mã trùng trong app TTLock (thường là mã cũ chưa xoá) — bot tự thử lại mỗi 15 phút; hoặc tạo mã khác rồi nhắn khách`
      : "trùng mã 3 lần liên tiếp ở cửa chung",
  };
}

export function doorCodesText(codes: DoorCode[], checkIn: string, checkOut: string) {
  const same = codes.length > 0 && codes.every((c) => c.passcode === codes[0].passcode);
  const lines = same ? [`• ${codes[0].passcode} # — dùng cho cửa nhà, cổng và cửa phòng`] : codes.map((c) => `• ${c.door}: ${c.passcode} #`);
  return (
    `🔑 Mã cửa của bạn (hiệu lực ${checkIn} ${CODE_FROM} → ${checkOut} ${config.booking.checkOutTime || "12:00"}):\n` +
    lines.join("\n") +
    `\n\nNhập mã rồi bấm # (hoặc 🔒). Lưu ý: hãy dùng mã lần đầu trong vòng 24 giờ kể từ giờ nhận phòng — nếu đến trễ hơn, nhắn Joystay để được cấp mã mới.`
  );
}

/**
 * Đối chiếu mã của 1 booking trên các khoá (cửa nhà, cổng trong, phòng):
 *  - remove=true  → xoá mã (booking huỷ)
 *  - remove=false → sửa hạn mã cho khớp ngày nhận/trả mới (booking đổi ngày)
 * Chỉ đụng tới mã có cùng số VÀ tên mã bắt đầu bằng mã booking (mã do bot tạo), không động vào mã khác.
 */
export async function reconcileBookingCodes(p: {
  codes: string[]; names: string[]; roomNo?: string | null; checkIn: string; checkOut: string; remove: boolean;
}): Promise<{ changed: string[]; removed: string[]; errors: string[] }> {
  const out = { changed: [] as string[], removed: [] as string[], errors: [] as string[] };
  const roomLock = p.roomNo ? ROOM_LOCKS[p.roomNo] : undefined;
  const doors = [...ENTRANCE_LOCKS, ...(roomLock ? [{ name: `Room ${p.roomNo} · Phòng ${p.roomNo}`, lockId: roomLock }] : [])];
  const from = vnTime(p.checkIn, CODE_FROM);
  const to = vnTime(p.checkOut, config.booking.checkOutTime || "12:00");
  const hour = (ms: number) => Math.floor(ms / 3_600_000) * 3_600_000;
  for (const d of doors) {
    let list;
    try { list = await listPasscodes(d.lockId); } catch (e) { out.errors.push(`${d.name}: ${(e as Error).message}`); continue; }
    const mine = list.filter((x) => p.codes.includes(String(x.keyboardPwd)) && p.names.some((n) => (x.keyboardPwdName ?? "").startsWith(n)));
    for (const x of mine) {
      try {
        if (p.remove) { await deletePasscode(d.lockId, Number(x.keyboardPwdId)); out.removed.push(`${d.name} ${x.keyboardPwd}`); }
        else if (x.endDate && (Math.abs(Number(x.endDate) - hour(to)) > 3_600_000 || Math.abs(Number(x.startDate ?? 0) - hour(from)) > 3_600_000)) {
          await changePasscodePeriod(d.lockId, Number(x.keyboardPwdId), from, to);
          out.changed.push(`${d.name} ${x.keyboardPwd}`);
        }
      } catch (e) { out.errors.push(`${d.name} ${x.keyboardPwd}: ${(e as Error).message}`); }
    }
  }
  return out;
}
