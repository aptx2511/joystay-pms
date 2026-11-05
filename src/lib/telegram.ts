/** Gửi tin Telegram cho chủ (dùng chung bot với JoyBot). Không cấu hình → chỉ ghi log. */
export type TgButton = { text: string; callback_data?: string; url?: string };

export async function tgNotify(text: string, buttons?: TgButton[][]) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("[Telegram→owner]", text);
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4000),
        disable_web_page_preview: true,
        ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
      }),
    });
  } catch (e) {
    console.error("[Telegram] lỗi:", e);
  }
}
