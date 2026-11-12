/** Messenger + Instagram (qua Page) + WhatsApp Cloud API */
import axios from "axios";
import crypto from "crypto";
import { config } from "../config";
import { InboundMessage, OutboundAdapter } from "./types";

const graph = (path: string) => `https://graph.facebook.com/${config.meta.graphVersion}/${path}`;

export function verifyMetaSignature(rawBody: Buffer | undefined, header: string | undefined): boolean {
  if (!config.meta.appSecret) return true; // chưa cấu hình → bỏ qua (khuyến nghị cấu hình)
  if (!rawBody || !header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", config.meta.appSecret).update(rawBody).digest("hex");
  const got = header.slice(7);
  return expected.length === got.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got));
}

/** Tách tin nhắn văn bản từ payload webhook Meta (object: page | instagram | whatsapp_business_account) */
export function parseMetaWebhook(body: any): InboundMessage[] {
  const out: InboundMessage[] = [];
  if (body?.object === "page" || body?.object === "instagram") {
    const channel = body.object === "page" ? "messenger" : "instagram";
    for (const entry of body.entry ?? []) {
      for (const ev of entry.messaging ?? []) {
        if (ev.message?.is_echo) continue; // tin do chính Page gửi
        const text = ev.message?.text;
        if (text && ev.sender?.id) out.push({ channel, userId: String(ev.sender.id), text });
      }
    }
  } else if (body?.object === "whatsapp_business_account") {
    for (const entry of body.entry ?? []) {
      for (const ch of entry.changes ?? []) {
        const v = ch.value ?? {};
        const names: Record<string, string> = {};
        for (const c of v.contacts ?? []) names[c.wa_id] = c.profile?.name;
        for (const m of v.messages ?? []) {
          if (m.type === "text" && m.text?.body)
            out.push({ channel: "whatsapp", userId: String(m.from), text: m.text.body, userName: names[m.from] });
        }
      }
    }
  }
  return out;
}

const pageSend = async (recipientId: string, message: object) => {
  await axios.post(
    graph("me/messages"),
    { recipient: { id: recipientId }, messaging_type: "RESPONSE", message },
    { params: { access_token: config.meta.pageAccessToken }, timeout: 15000 }
  );
};

export const messengerAdapter: OutboundAdapter = {
  async sendText(userId, text) {
    // Messenger giới hạn 2000 ký tự / tin
    for (const part of chunk(text, 1900)) await pageSend(userId, { text: part });
  },
  async sendImage(userId, url, caption) {
    await pageSend(userId, { attachment: { type: "image", payload: { url, is_reusable: false } } });
    if (caption) await this.sendText(userId, caption);
  },
};

// Instagram Messaging dùng cùng endpoint me/messages với Page token
export const instagramAdapter: OutboundAdapter = {
  async sendText(userId, text) {
    for (const part of chunk(text, 990)) await pageSend(userId, { text: part });
  },
  async sendImage(userId, url, caption) {
    await pageSend(userId, { attachment: { type: "image", payload: { url } } });
    if (caption) await this.sendText(userId, caption);
  },
};

const waSend = async (to: string, payload: object) => {
  await axios.post(
    graph(`${config.meta.whatsappPhoneNumberId}/messages`),
    { messaging_product: "whatsapp", to, ...payload },
    { headers: { Authorization: `Bearer ${config.meta.whatsappToken}` }, timeout: 15000 }
  );
};

export const whatsappAdapter: OutboundAdapter = {
  async sendText(userId, text) {
    for (const part of chunk(text, 4000)) await waSend(userId, { type: "text", text: { body: part } });
  },
  async sendImage(userId, url, caption) {
    await waSend(userId, { type: "image", image: { link: url, ...(caption ? { caption } : {}) } });
  },
};

export function chunk(text: string, size: number): string[] {
  if (text.length <= size) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n", size);
    if (cut < size * 0.5) cut = size;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}
