/** Báo chủ qua Telegram (bot riêng của JoyBot) — có nút bấm duyệt */
import axios from "axios";
import { config } from "../config";

const api = (m: string) => `https://api.telegram.org/bot${config.telegram.token}/${m}`;

export type Button = { text: string; data: string };

export async function notifyOwner(text: string, buttons?: Button[][]): Promise<void> {
  if (!config.telegram.token || !config.telegram.ownerChatId) {
    console.log("[Telegram→owner]", text);
    return;
  }
  try {
    await axios.post(
      api("sendMessage"),
      {
        chat_id: config.telegram.ownerChatId,
        text,
        disable_web_page_preview: true,
        ...(buttons
          ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } }
          : {}),
      },
      { timeout: 15000 }
    );
  } catch (e) {
    console.error("[Telegram] gửi lỗi:", (e as Error).message);
  }
}

export async function answerCallback(id: string, text: string) {
  if (!config.telegram.token) return;
  await axios.post(api("answerCallbackQuery"), { callback_query_id: id, text }).catch(() => {});
}

export async function editMessage(chatId: number | string, messageId: number, text: string) {
  if (!config.telegram.token) return;
  await axios
    .post(api("editMessageText"), { chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true })
    .catch(() => {});
}

export async function setTelegramWebhook(): Promise<void> {
  if (!config.telegram.token) return;
  try {
    await axios.post(api("setWebhook"), {
      url: `${config.server.publicUrl}/webhook/telegram`,
      secret_token: config.telegram.webhookSecret || undefined,
      allowed_updates: ["callback_query", "message"],
    });
    console.log("[Telegram] Webhook đã đặt");
  } catch (e) {
    console.error("[Telegram] setWebhook lỗi:", (e as Error).message);
  }
}
