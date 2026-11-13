import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import { config } from "./config";
import { chat } from "./joybot";
import autopilotRouter from "./autopilot/routes";
import { channelOf, outbox, InboundMessage } from "./channels";
import { parseMetaWebhook, verifyMetaSignature } from "./channels/meta";
import { parseZaloWebhook, verifyZaloSignature } from "./channels/zalo";
import { telegramWebhook } from "./notify/telegram-webhook";
import { setTelegramWebhook, notifyOwner } from "./notify/telegram";
import { sepayWebhook } from "./payments/sepay";
import { expireHolds } from "./booking/service";
import { syncOtaCalendars } from "./booking/pms";
import { bookableRooms } from "./booking/rooms";
import { housekeepingTick } from "./ops/housekeeping";
import { issuePendingCodes, stayTick } from "./ops/stay";
import { vacancyTick } from "./ops/vacancy";

type RawReq = Request & { rawBody?: Buffer };

const app = express();
app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      (req as RawReq).rawBody = buf;
    },
  })
);

app.get("/", (_req, res) => {
  res.json({ status: "ok", name: "JoyBot", model: config.anthropic.model, rooms: bookableRooms().length });
});

/** Xử lý 1 tin khách: chạy bot rồi gửi trả lời qua đúng kênh (chạy nền) */
async function handleInbound(m: InboundMessage) {
  try {
    console.log(`[In] ${m.channel}:${m.userId} ${m.text.slice(0, 80)}`);
    const r = await chat({ channel: m.channel, userId: m.userId }, m.text);
    if (r.text) await channelOf(m.channel).sendText(m.userId, r.text);
    else if (r.handoff) await notifyOwner(`💬 ${m.channel}:${m.userId}${m.userName ? " (" + m.userName + ")" : ""}: ${m.text}`);
  } catch (e) {
    console.error(`[In] ${m.channel}:${m.userId} lỗi:`, (e as Error).message);
    await notifyOwner(`⚠️ JoyBot không trả lời được ${m.channel}:${m.userId} — "${m.text.slice(0, 200)}"\nLỗi: ${(e as Error).message}`);
  }
}

// ── Meta: Messenger + Instagram + WhatsApp (chung 1 URL webhook) ────────────
app.get("/webhook/meta", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === config.meta.verifyToken) {
    res.status(200).send(String(req.query["hub.challenge"]));
  } else res.sendStatus(403);
});
app.post("/webhook/meta", (req: RawReq, res) => {
  if (!verifyMetaSignature(req.rawBody, req.header("x-hub-signature-256"))) {
    res.sendStatus(401);
    return;
  }
  res.sendStatus(200); // Meta cần phản hồi nhanh
  for (const m of parseMetaWebhook(req.body)) void handleInbound(m);
});

// ── Zalo OA ─────────────────────────────────────────────────────────────────
app.post("/webhook/zalo", (req: RawReq, res) => {
  if (!verifyZaloSignature(req.rawBody, req.header("x-zevent-signature"), req.body?.timestamp)) {
    res.sendStatus(401);
    return;
  }
  res.json({ success: true });
  for (const m of parseZaloWebhook(req.body)) void handleInbound(m);
});

// ── Website widget (trả lời đồng bộ) ─────────────────────────────────────────
app.post("/webhook/website", async (req, res, next) => {
  try {
    const { visitorId, message } = req.body as { visitorId?: string; message?: string };
    if (!visitorId || !message?.trim()) {
      res.status(400).json({ error: "visitorId và message là bắt buộc" });
      return;
    }
    const r = await chat({ channel: "web", userId: visitorId }, message);
    const extra = outbox.splice(0).filter((o) => o.userId === visitorId);
    res.json({ reply: r.text, attachments: extra });
  } catch (e) {
    next(e);
  }
});

// ── Kênh thử nghiệm (cần ADMIN_KEY) ──────────────────────────────────────────
app.post("/chat", async (req, res, next) => {
  try {
    if (!process.env.ADMIN_KEY || req.header("x-admin-key") !== process.env.ADMIN_KEY) {
      res.sendStatus(401);
      return;
    }
    const { userId = "tester", message } = req.body as { userId?: string; message?: string };
    if (!message?.trim()) {
      res.status(400).json({ error: "message is required" });
      return;
    }
    const r = await chat({ channel: "test", userId }, message);
    res.json({ ...r, attachments: outbox.splice(0).filter((o) => o.userId === userId) });
  } catch (e) {
    next(e);
  }
});

// ── Chủ duyệt qua Telegram + tiền về qua SePay ───────────────────────────────
app.post("/webhook/telegram", telegramWebhook);
app.post("/webhook/sepay", sepayWebhook);

// PMS báo vừa có đơn mới / huỷ / đổi (email OTA → đồng bộ ngay) → cấp mã cửa ngay, không chờ lượt 15'
app.post("/hooks/pms-changed", (req, res) => {
  if (!config.pms.cronSecret || req.headers.authorization !== `Bearer ${config.pms.cronSecret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.status(202).json({ ok: true });
  void issuePendingCodes();
});

// ── Autopilot (giữ nguyên) ──────────────────────────────────────────────────
app.use("/autopilot", autopilotRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Error]", err.message);
  res.status(500).json({ error: "Internal server error" });
});

// ── Tác vụ nền ───────────────────────────────────────────────────────────────
setInterval(() => void expireHolds(), 60_000);
setInterval(async () => { if (await syncOtaCalendars()) await issuePendingCodes(); }, config.booking.otaSyncMinutes * 60_000); // đồng bộ xong → cấp mã luôn
setInterval(() => void stayTick(), 60_000); // cổng khách: cấp mã TTLock mỗi 15' · bản tin khách đến 07:30 & 20:00
setInterval(() => void vacancyTick(), 60_000); // bản tin phòng trống + đề xuất 08:00 (giờ VN)
setInterval(() => void housekeepingTick(), 60_000); // lịch dọn: CN 20:00 · 07:30 · 14:30 (giờ VN)

if (require.main === module) {
  app.listen(config.server.port, () => {
    console.log(`JoyBot chạy cổng ${config.server.port} · model ${config.anthropic.model} · ${bookableRooms().length} phòng nhận đặt`);
    void setTelegramWebhook();
    void syncOtaCalendars();
  });
}

export default app;
