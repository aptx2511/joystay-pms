/** Zalo OA — API v3 (tin tư vấn /message/cs) + tự làm mới access token */
import axios from "axios";
import crypto from "crypto";
import { config } from "../config";
import { store } from "../store";
import { InboundMessage, OutboundAdapter } from "./types";

const SEND_URL = "https://openapi.zalo.me/v3.0/oa/message/cs";
const OAUTH_URL = "https://oauth.zaloapp.com/v4/oa/access_token";

let accessToken = config.zalo.accessToken;

async function refreshToken(): Promise<string> {
  const refresh = (await store.getKv("zalo_refresh_token")) ?? config.zalo.refreshToken;
  if (!refresh || !config.zalo.appId || !config.zalo.appSecret) throw new Error("Thiếu ZALO refresh token/app id/secret");
  const { data } = await axios.post(
    OAUTH_URL,
    new URLSearchParams({ refresh_token: refresh, app_id: config.zalo.appId, grant_type: "refresh_token" }),
    { headers: { secret_key: config.zalo.appSecret, "Content-Type": "application/x-www-form-urlencoded" }, timeout: 15000 }
  );
  if (!data?.access_token) throw new Error(`Zalo refresh lỗi: ${JSON.stringify(data)}`);
  accessToken = data.access_token;
  await store.setKv("zalo_access_token", data.access_token);
  if (data.refresh_token) await store.setKv("zalo_refresh_token", data.refresh_token); // token xoay vòng
  console.log("[Zalo] Đã làm mới access token");
  return accessToken;
}

async function send(userId: string, message: object, retried = false): Promise<void> {
  if (!accessToken) accessToken = (await store.getKv("zalo_access_token")) ?? "";
  if (!accessToken) await refreshToken();
  const { data } = await axios.post(
    SEND_URL,
    { recipient: { user_id: userId }, message },
    { headers: { access_token: accessToken }, timeout: 15000 }
  );
  if (data?.error && data.error !== 0) {
    // -216 / -124: token hết hạn hoặc không hợp lệ
    if (!retried && (data.error === -216 || data.error === -124)) {
      await refreshToken();
      return send(userId, message, true);
    }
    throw new Error(`Zalo gửi lỗi ${data.error}: ${data.message}`);
  }
}

export const zaloAdapter: OutboundAdapter = {
  async sendText(userId, text) {
    // Zalo giới hạn ~2000 ký tự
    for (let i = 0; i < text.length; i += 1900) await send(userId, { text: text.slice(i, i + 1900) });
  },
  async sendImage(userId, url, caption) {
    await send(userId, {
      attachment: {
        type: "template",
        payload: { template_type: "media", elements: [{ media_type: "image", url }] },
      },
    });
    if (caption) await this.sendText(userId, caption);
  },
};

/** Kiểm chữ ký X-ZEvent-Signature = "mac=" + sha256(appId + body + timestamp + OASecret) */
export function verifyZaloSignature(rawBody: Buffer | undefined, header: string | undefined, timestamp: string | undefined) {
  if (!config.zalo.oaSecret) return true;
  if (!rawBody || !header) return false;
  const mac = crypto
    .createHash("sha256")
    .update(config.zalo.appId + rawBody.toString("utf8") + (timestamp ?? "") + config.zalo.oaSecret)
    .digest("hex");
  return header.replace(/^mac=/, "") === mac;
}

export function parseZaloWebhook(body: any): InboundMessage[] {
  if (body?.event_name === "user_send_text" && body.sender?.id && body.message?.text) {
    return [{ channel: "zalo", userId: String(body.sender.id), text: body.message.text }];
  }
  return [];
}
