import { ChannelName, OutboundAdapter } from "./types";
import { messengerAdapter, instagramAdapter, whatsappAdapter } from "./meta";
import { zaloAdapter } from "./zalo";

/** Kênh web/test: tin trả lời được trả trực tiếp qua HTTP, tin chủ động lưu vào hộp thư tạm */
export const outbox: Array<{ channel: ChannelName; userId: string; text?: string; imageUrl?: string }> = [];
const httpAdapter = (channel: ChannelName): OutboundAdapter => ({
  async sendText(userId, text) {
    outbox.push({ channel, userId, text });
  },
  async sendImage(userId, imageUrl, caption) {
    outbox.push({ channel, userId, imageUrl, text: caption });
  },
});

const adapters: Record<ChannelName, OutboundAdapter> = {
  zalo: zaloAdapter,
  messenger: messengerAdapter,
  instagram: instagramAdapter,
  whatsapp: whatsappAdapter,
  web: httpAdapter("web"),
  test: httpAdapter("test"),
};

export const channelOf = (c: ChannelName) => adapters[c];

export * from "./types";
