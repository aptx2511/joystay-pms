// ─────────────────────────────────────────────────────────────────────────────
// Autopilot Router — Express routes cho n8n gọi vào
// n8n sẽ gọi các endpoint này theo thứ tự để chạy từng agent
// ─────────────────────────────────────────────────────────────────────────────
import { Router, Request, Response, NextFunction } from "express";
import { runTrendHunter } from "./agents/trend-hunter";
import { runMediaCreator } from "./agents/media-creator";
import { runCopywriter } from "./agents/copywriter";
import { runPublisher } from "./agents/publisher";
import { runAnalyst } from "./agents/analyst";
import { runSlideshowCreator } from "./agents/video-creator-slideshow";
import { runAIVideoCreator } from "./agents/video-creator-ai";

const router = Router();

// ── Middleware: API Key auth cho autopilot ─────────────────────────────────
router.use((req: Request, res: Response, next: NextFunction) => {
  const key = req.headers["x-autopilot-key"];
  if (key !== process.env.AUTOPILOT_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
});

// ── Agent 1: Trend Hunter ──────────────────────────────────────────────────
// n8n gọi lúc 6:00 AM
router.post("/trend-hunt", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await runTrendHunter();
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// ── Agent 2: Media Creator ─────────────────────────────────────────────────
// Body: { trend_id, topic, media_type? }
router.post("/create-media", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { trend_id, topic } = req.body;
    if (!trend_id || !topic) {
      res.status(400).json({ error: "trend_id and topic required" });
      return;
    }
    const result = await runMediaCreator(trend_id, topic);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// ── Agent 3: Copywriter ────────────────────────────────────────────────────
// Body: { trend_id, media_id, topic, feedback_context?, platform? }
router.post("/write-copy", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { trend_id, media_id, topic, feedback_context, platform = "both" } = req.body;
    if (!trend_id || !media_id || !topic) {
      res.status(400).json({ error: "trend_id, media_id, topic required" });
      return;
    }
    const result = await runCopywriter(trend_id, media_id, topic, feedback_context, platform);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// ── Agent 4: Publisher ─────────────────────────────────────────────────────
// Body: { calendar_id }
// n8n gọi lúc 11:30 hoặc 20:00
router.post("/publish", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { calendar_id } = req.body;
    if (!calendar_id) {
      res.status(400).json({ error: "calendar_id required" });
      return;
    }
    await runPublisher(calendar_id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Agent 5: Analyst ───────────────────────────────────────────────────────
// n8n gọi sau 24h (06:00 AM ngày hôm sau)
router.post("/analyze", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await runAnalyst();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ── Video Branch A: FFmpeg Slideshow ──────────────────────────────────────
// Body: { media_id, image_urls[] }
router.post("/create-video-slideshow", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { media_id, image_urls } = req.body;
    if (!media_id || !image_urls?.length) {
      res.status(400).json({ error: "media_id and image_urls required" });
      return;
    }
    const result = await runSlideshowCreator(media_id, image_urls);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// ── Video Branch B: AI Video (Replicate) ──────────────────────────────────
// Body: { media_id, image_url, topic }
router.post("/create-video-ai", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { media_id, image_url, topic } = req.body;
    if (!media_id || !image_url || !topic) {
      res.status(400).json({ error: "media_id, image_url, topic required" });
      return;
    }
    const result = await runAIVideoCreator(media_id, image_url, topic);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// ── Status / Health ────────────────────────────────────────────────────────
router.get("/status", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    agents: ["trend-hunt", "create-media", "write-copy", "publish", "analyze", "create-video-slideshow", "create-video-ai"],
    timestamp: new Date().toISOString(),
  });
});

export default router;
