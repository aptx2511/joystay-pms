/**
 * Nghiệp vụ đặt phòng trực tiếp:
 *   kiểm tra phòng → báo giá → giữ chỗ (PMS PENDING) → QR cọc → xác nhận cọc (PMS CONFIRMED)
 *   → tự hủy giữ chỗ quá hạn (PMS CANCELLED, mở lại lịch)
 */
import { config } from "../config";
import { bookableRooms, findRoom } from "./rooms";
import { quote, vnd, Quote, parseDate } from "./pricing";
import * as pms from "./pms";
import { vietQrUrl, bankText } from "./vietqr";
import { store, DirectBooking } from "../store";
import { channelOf, ChannelName } from "../channels";
import { notifyOwner } from "../notify/telegram";
import { issueDoorCodes, doorCodesText } from "../locks/doors";
import { ROOMS } from "./rooms";

export interface Ctx {
  channel: ChannelName;
  userId: string;
}

const todayVN = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

function validateDates(checkIn: string, checkOut: string) {
  parseDate(checkIn);
  parseDate(checkOut);
  if (checkIn < todayVN()) throw new Error(`Ngày nhận phòng ${checkIn} đã qua (hôm nay ${todayVN()})`);
}

/** Phòng trống + giá cho khoảng ngày. Luôn đồng bộ lịch OTA trước để tránh bán trùng. */
export async function searchRooms(checkIn: string, checkOut: string, guests?: number) {
  validateDates(checkIn, checkOut);
  const rooms = bookableRooms();
  if (!rooms.length)
    return { ok: false, reason: "Chưa có bảng giá phòng được cấu hình — chuyển cho chủ tư vấn trực tiếp." };
  await pms.syncOtaCalendars();
  const free = await pms.getAvailableRoomIds(checkIn, checkOut);
  const eligible = rooms.filter((r) => !guests || r.maxGuests >= guests);
  const daily = new Map<string, number[] | null>();
  await Promise.all(eligible.filter((r) => free.has(r.pmsRoomId)).map(async (r) => {
    daily.set(r.pmsRoomId, (await pms.getNightPrices(r.pmsRoomId, checkIn, checkOut))?.prices ?? null);
  }));
  const results = eligible
    .map((r) => ({
      pmsRoomId: r.pmsRoomId,
      name: r.name,
      concept: r.concept,
      sizeM2: r.sizeM2,
      maxGuests: r.maxGuests,
      hasKitchen: r.hasKitchen,
      description: r.description,
      available: free.has(r.pmsRoomId),
      quote: free.has(r.pmsRoomId) ? quote(r, checkIn, checkOut, daily.get(r.pmsRoomId)) : undefined,
    }));
  return { ok: true, checkIn, checkOut, rooms: results };
}

async function newCode(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = `${config.booking.codePrefix}${Math.floor(1000 + Math.random() * 9000)}`;
    if (!(await store.codeExists(code))) return code;
  }
  return `${config.booking.codePrefix}${Date.now().toString().slice(-6)}`;
}

/** Giữ chỗ: tạo booking PENDING trên PMS (khóa lịch ngay) + gửi QR cọc cho khách */
export async function createHold(
  ctx: Ctx,
  p: { pmsRoomId: string; checkIn: string; checkOut: string; guestName: string; guestPhone?: string; guests?: number }
) {
  validateDates(p.checkIn, p.checkOut);
  const room = findRoom(p.pmsRoomId);
  if (!room) return { ok: false, reason: "Phòng không tồn tại hoặc chưa mở đặt trực tiếp." };
  if (p.guests && p.guests > room.maxGuests)
    return { ok: false, reason: `Phòng ${room.name} tối đa ${room.maxGuests} khách.` };

  await pms.syncOtaCalendars();
  const free = await pms.getAvailableRoomIds(p.checkIn, p.checkOut);
  if (!free.has(room.pmsRoomId)) return { ok: false, reason: "Phòng vừa hết chỗ cho khoảng ngày này." };

  const q: Quote = quote(room, p.checkIn, p.checkOut, (await pms.getNightPrices(room.pmsRoomId, p.checkIn, p.checkOut))?.prices);
  const code = await newCode();
  const holdUntil = new Date(Date.now() + config.booking.holdMinutes * 60_000);

  let pmsBooking;
  try {
    pmsBooking = await pms.createPendingBooking({
      roomId: room.pmsRoomId,
      guestName: p.guestName,
      guestPhone: p.guestPhone,
      checkIn: p.checkIn,
      checkOut: p.checkOut,
      totalPrice: q.total,
      notes: `[JoyBot ${code}] Kênh ${ctx.channel}. Giữ chỗ đến ${holdUntil.toISOString()}. Tổng ${q.total}, cọc ${q.deposit} chưa nhận.`,
    });
  } catch (e) {
    if (e instanceof pms.PmsConflictError) return { ok: false, reason: "Phòng vừa có người đặt trùng ngày." };
    throw e;
  }

  const row: DirectBooking = {
    code,
    pms_booking_id: pmsBooking.id,
    channel: ctx.channel,
    channel_user_id: ctx.userId,
    room_id: room.pmsRoomId,
    room_name: room.name,
    guest_name: p.guestName,
    guest_phone: p.guestPhone ?? null,
    check_in: p.checkIn,
    check_out: p.checkOut,
    nights: q.nights,
    total: q.total,
    deposit: q.deposit,
    balance: q.balance,
    status: "HOLD",
    hold_until: holdUntil.toISOString(),
    paid_amount: 0,
    paid_at: null,
    payment_ref: null,
  };
  await store.insertBooking(row);

  const qr = vietQrUrl(q.deposit, code);
  if (qr) {
    // Gửi ảnh QR ngay cho khách (bot sẽ nhắn kèm hướng dẫn trong câu trả lời)
    await channelOf(ctx.channel).sendImage(ctx.userId, qr).catch((e) => console.error("[Hold] gửi QR lỗi:", e.message));
  }

  await notifyOwner(
    `🟡 GIỮ CHỖ ${code}\n${room.name} · ${p.checkIn} → ${p.checkOut} (${q.nights} đêm)\n` +
      `Khách: ${p.guestName}${p.guestPhone ? " · " + p.guestPhone : ""} · kênh ${ctx.channel}\n` +
      `Tổng ${vnd(q.total)} · Cọc ${vnd(q.deposit)} · hết hạn ${config.booking.holdMinutes} phút\n` +
      `Khi thấy tiền về với nội dung "${code}", bấm ✅.`,
    [[
      { text: `✅ Đã nhận cọc ${code}`, data: `paid:${code}` },
      { text: "❌ Hủy", data: `cancel:${code}` },
    ]]
  );

  return {
    ok: true,
    code,
    room: room.name,
    checkIn: p.checkIn,
    checkOut: p.checkOut,
    quote: q,
    holdMinutes: config.booking.holdMinutes,
    qrSent: !!qr,
    payment: qr ? bankText(q.deposit, code) : "CHƯA cấu hình tài khoản ngân hàng — báo khách chủ sẽ gửi thông tin chuyển khoản.",
  };
}

/** Xác nhận cọc — gọi từ nút Telegram của chủ hoặc webhook SePay. Idempotent. */
export async function confirmDeposit(code: string, by: string, amount?: number, ref?: string) {
  const b = await store.getBooking(code);
  if (!b) return { ok: false, message: `Không tìm thấy ${code}` };
  if (b.status === "DEPOSIT_PAID") return { ok: true, message: `${code} đã xác nhận trước đó` };
  if (amount !== undefined && amount < b.deposit) {
    await notifyOwner(`⚠️ ${code}: nhận ${vnd(amount)} < cọc ${vnd(b.deposit)}. Chưa xác nhận — kiểm tra tay.`, [[
      { text: `✅ Vẫn xác nhận ${code}`, data: `paid:${code}` },
    ]]);
    return { ok: false, message: "Số tiền chưa đủ cọc" };
  }

  // Nếu giữ chỗ đã hết hạn và bị hủy trên PMS → thử đặt lại, nếu phòng đã bị người khác lấy thì báo chủ
  if (b.status === "EXPIRED" || b.status === "CANCELLED") {
    const free = await pms.getAvailableRoomIds(b.check_in, b.check_out);
    if (!free.has(b.room_id)) {
      await notifyOwner(`🔴 ${code}: khách đã chuyển tiền nhưng giữ chỗ hết hạn và phòng ĐÃ BỊ ĐẶT. Liên hệ khách hoàn tiền/đổi phòng.`);
      return { ok: false, message: "Phòng đã bị đặt sau khi giữ chỗ hết hạn" };
    }
    const nb = await pms.createPendingBooking({
      roomId: b.room_id, guestName: b.guest_name, guestPhone: b.guest_phone ?? undefined,
      checkIn: b.check_in, checkOut: b.check_out, totalPrice: b.total, notes: `[JoyBot ${code}] đặt lại sau khi hết hạn`,
    });
    b.pms_booking_id = nb.id;
  }

  const paid = amount ?? b.deposit;
  await pms.updateBooking(b.pms_booking_id, {
    status: "CONFIRMED",
    notes: `[JoyBot ${code}] Kênh ${b.channel}. ĐÃ NHẬN CỌC ${paid} (${by}${ref ? ", ref " + ref : ""}). Tổng ${b.total}, còn lại ${Math.max(0, b.total - paid)}.`,
  });
  await store.updateBooking(code, {
    status: "DEPOSIT_PAID",
    pms_booking_id: b.pms_booking_id,
    paid_amount: paid,
    paid_at: new Date().toISOString(),
    payment_ref: ref ?? by,
  });

  const remaining = Math.max(0, b.total - paid);
  if (paid > b.total)
    await notifyOwner(`⚠️ ${code}: khách chuyển ${vnd(paid)}, nhiều hơn tổng ${vnd(b.total)} — kiểm tra hoàn tiền thừa.`);
  const msg =
    `✅ Joystay đã nhận cọc ${vnd(paid)} — đặt phòng ${code} được xác nhận.\n\n` +
    `Phòng: ${b.room_name}\nNhận phòng: ${b.check_in}${config.booking.checkInTime ? " từ " + config.booking.checkInTime : ""}\n` +
    `Trả phòng: ${b.check_out}${config.booking.checkOutTime ? " trước " + config.booking.checkOutTime : ""}\n` +
    `Địa chỉ: ${config.booking.address}\n` +
    (remaining > 0 ? `Còn lại: ${vnd(remaining)} — thanh toán trước ngày nhận phòng.\n` : "") +
    `\nLink trang lưu trú (gửi giấy tờ + xem mã cửa) sẽ được gửi ngay sau tin này. Hẹn gặp bạn ở Joystay!`;
  await channelOf(b.channel).sendText(b.channel_user_id, msg).catch((e) => console.error("[Confirm] nhắn khách lỗi:", e.message));

  // Cấp mã khoá TTLock (cửa chung + cửa phòng) và gửi khách
  let lockNote = "";
  try {
    const roomNo = ROOMS.find((r) => r.pmsRoomId === b.room_id)?.roomNo;
    const r = await issueDoorCodes({
      code, roomNo, roomName: b.room_name, guestName: b.guest_name, checkIn: b.check_in, checkOut: b.check_out,
      preferredCode: (b.guest_phone ?? "").replace(/\D/g, "").slice(-4),
    });
    // Ops 2.0: mã lưu vào cổng khách — khách gửi giấy tờ khai báo rồi xem mã từ 10:00 ngày nhận phòng.
    const link = r.ok
      ? await pms.saveStayCodes(b.pms_booking_id, r.codes.map((c) => ({ door: c.door, code: c.passcode })))
      : await pms.saveStayCodes(b.pms_booking_id, [], "MANUAL");
    if (link) {
      await channelOf(b.channel).sendText(
        b.channel_user_id,
        `🌿 Trang lưu trú của bạn: ${link}\nVui lòng gửi ảnh CCCD/hộ chiếu tại đó để Joystay khai báo lưu trú — mã cửa sẽ hiện tại trang này từ 10:00 ngày nhận phòng.\n\nYour stay page: ${link} — please complete the guest registration there; your door codes will appear on your check-in day.`
      ).catch((e) => console.error("[Confirm] gửi link cổng khách lỗi:", e.message));
      lockNote = r.ok
        ? "\n🔑 Mã đã lưu vào cổng khách: " + r.codes.map((c) => `${c.door} ${c.passcode}`).join(" · ")
        : `\n⚠️ Chưa tạo được mã cửa (${r.reason}) — nhập mã tay ở PMS → Lưu trú. Đã gửi link cổng khách.`;
    } else if (r.ok) {
      // PMS lỗi → gửi mã trực tiếp như cũ
      await channelOf(b.channel).sendText(b.channel_user_id, doorCodesText(r.codes, b.check_in, b.check_out))
        .catch((e) => console.error("[Confirm] gửi mã cửa lỗi:", e.message));
      lockNote = "\n🔑 Đã gửi mã trực tiếp (PMS lỗi): " + r.codes.map((c) => `${c.door} ${c.passcode}`).join(" · ");
    } else {
      lockNote = `\n⚠️ Chưa tạo được mã cửa (${r.reason}) — gửi mã PIN tay cho khách.`;
    }
  } catch (e) {
    console.error("[Confirm] TTLock lỗi:", (e as Error).message);
    lockNote = `\n⚠️ Tạo mã cửa lỗi: ${(e as Error).message} — gửi mã PIN tay cho khách.`;
  }

  await notifyOwner(
    `🟢 ĐÃ CHỐT ${code} (${by})\n${b.room_name} · ${b.check_in} → ${b.check_out}\n${b.guest_name} · cọc ${vnd(paid)} · còn ${vnd(remaining)}\nPMS: CONFIRMED.` + lockNote
  );
  return { ok: true, message: `${code} đã chốt` };
}

export async function cancelHold(code: string, reason: "EXPIRED" | "CANCELLED", by = "system") {
  const b = await store.getBooking(code);
  if (!b || b.status !== "HOLD") return { ok: false, message: `${code} không ở trạng thái giữ chỗ` };
  await pms.updateBooking(b.pms_booking_id, {
    status: "CANCELLED",
    notes: `[JoyBot ${code}] ${reason === "EXPIRED" ? "Hết hạn giữ chỗ, chưa nhận cọc" : "Hủy bởi " + by}.`,
  });
  await store.updateBooking(code, { status: reason });
  const text =
    reason === "EXPIRED"
      ? `Giữ chỗ ${code} đã hết hạn vì Joystay chưa nhận được cọc. Nếu bạn đã chuyển khoản, cứ nhắn lại — mình kiểm tra ngay.`
      : `Giữ chỗ ${code} đã được hủy.`;
  await channelOf(b.channel).sendText(b.channel_user_id, text).catch(() => {});
  await notifyOwner(`⚪ ${code} ${reason === "EXPIRED" ? "hết hạn" : "đã hủy"} — đã mở lại lịch ${b.room_name} ${b.check_in}→${b.check_out}.`);
  return { ok: true, message: `${code} ${reason}` };
}

export async function expireHolds() {
  for (const b of await store.expiredHolds()) {
    try {
      await cancelHold(b.code, "EXPIRED");
    } catch (e) {
      console.error(`[Expire] ${b.code}:`, (e as Error).message);
    }
  }
}

export async function bookingStatus(ctx: Ctx, code: string) {
  const b = await store.getBooking(code.toUpperCase());
  if (!b || b.channel_user_id !== ctx.userId) return { ok: false, reason: "Không tìm thấy mã đặt phòng của bạn." };
  return {
    ok: true,
    code: b.code,
    status: b.status,
    room: b.room_name,
    checkIn: b.check_in,
    checkOut: b.check_out,
    total: b.total,
    deposit: b.deposit,
    paid: b.paid_amount,
    holdUntil: b.hold_until,
  };
}
