/** Nhận nút bấm / lệnh của chủ trên Telegram */
import { Request, Response } from "express";
import { config } from "../config";
import { answerCallback, editMessage, notifyOwner } from "./telegram";
import { confirmDeposit, cancelHold } from "../booking/service";
import { setHandoff } from "../joybot";
import { channelOf, ChannelName } from "../channels";
import { handleHousekeepingCallback, sendDigest } from "../ops/housekeeping";
import { sendArrivalsDigest } from "../ops/stay";

const isOwner = (chatId: unknown) => String(chatId) === String(config.telegram.ownerChatId);

export async function telegramWebhook(req: Request, res: Response) {
  if (config.telegram.webhookSecret && req.header("x-telegram-bot-api-secret-token") !== config.telegram.webhookSecret) {
    res.sendStatus(401);
    return;
  }
  res.sendStatus(200);
  const u = req.body ?? {};
  try {
    if (u.callback_query) {
      const cq = u.callback_query;
      if (!isOwner(cq.message?.chat?.id)) return;
      if (await handleHousekeepingCallback(cq)) return; // nút lịch dọn (hk*)
      const [action, code] = String(cq.data ?? "").split(":");
      const r =
        action === "paid"
          ? await confirmDeposit(code, "chủ xác nhận Telegram")
          : action === "cancel"
          ? await cancelHold(code, "CANCELLED", "chủ")
          : { ok: false, message: "?" };
      await answerCallback(cq.id, r.message);
      if (r.ok && cq.message) await editMessage(cq.message.chat.id, cq.message.message_id, `${cq.message.text}\n\n→ ${r.message}`);
      return;
    }

    const msg = u.message;
    if (!msg?.text || !isOwner(msg.chat?.id)) return;
    const text: string = msg.text.trim();

    // /khach → tình trạng khách nhận phòng hôm nay
    if (/^\/khach$/.test(text)) {
      if (!(await sendArrivalsDigest(true))) await notifyOwner("⚠️ Không lấy được danh sách khách từ PMS");
      return;
    }

    // /don [tuan|nay|canhbao] → xem lịch dọn ngay
    const hk = text.match(/^\/don(?:\s+(tuan|nay|canhbao))?$/);
    if (hk) {
      const kind = hk[1] === "tuan" ? "weekly" : hk[1] === "canhbao" ? "alert" : "daily";
      if (!(await sendDigest(kind, true))) await notifyOwner("⚠️ Không lấy được lịch dọn từ PMS");
      return;
    }

    // /bot <channel>:<userId>  → bật lại bot cho khách
    // /tay <channel>:<userId>  → tắt bot, anh tự trả lời
    // /tl <channel>:<userId> <nội dung> → nhắn khách thay mặt Joystay
    const m = text.match(/^\/(bot|tay|tl)\s+(\w+):(\S+)\s*([\s\S]*)$/);
    if (!m) {
      await notifyOwner("Lệnh: /bot kênh:id (bật bot) · /tay kênh:id (tắt bot) · /tl kênh:id nội dung (nhắn khách) · /don [tuan|nay|canhbao] (lịch dọn) · /khach (khách đến hôm nay)");
      return;
    }
    const [, cmd, channel, userId, body] = m;
    const ctx = { channel: channel as ChannelName, userId };
    if (cmd === "bot") {
      await setHandoff(ctx, false);
      await notifyOwner(`🤖 Đã bật lại bot cho ${channel}:${userId}`);
    } else if (cmd === "tay") {
      await setHandoff(ctx, true);
      await notifyOwner(`✋ Bot im lặng với ${channel}:${userId}`);
    } else if (body) {
      await channelOf(ctx.channel).sendText(userId, body);
      await notifyOwner(`📤 Đã gửi cho ${channel}:${userId}`);
    }
  } catch (e) {
    console.error("[Telegram webhook]", (e as Error).message);
    await notifyOwner(`⚠️ Lỗi xử lý lệnh: ${(e as Error).message}`);
  }
}
