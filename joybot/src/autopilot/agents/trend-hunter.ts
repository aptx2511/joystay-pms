// ─────────────────────────────────────────────────────────────────────────────
// Agent 1 — Trend Hunter
// Quét TikTok trending qua Apify, chọn 3 chủ đề hot nhất bằng Claude
// ─────────────────────────────────────────────────────────────────────────────
import axios from "axios";
import { askClaude } from "../claude";
import { supabase } from "../supabase";

const HASHTAGS_TO_SCAN = [
  "saigon", "staycation", "dulichsaigon", "homestaysaigon",
  "hochiminh", "vietnamtravel", "chualanh", "weekendvibes",
];

// ─── 1. Chạy Apify TikTok Scraper ────────────────────────────────────────────
async function scrapeApify(): Promise<any[]> {
  const token = process.env.APIFY_API_TOKEN!;

  // Trigger run
  const runRes = await axios.post(
    `https://api.apify.com/v2/acts/clockworks~tiktok-scraper/runs?token=${token}`,
    {
      hashtags: HASHTAGS_TO_SCAN,
      maxItems: 30,
      resultsType: "posts",
      proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
    }
  );

  const runId = runRes.data.data.id;
  console.log(`[TrendHunter] Apify run started: ${runId}`);

  // Poll until done (max 3 phút)
  for (let i = 0; i < 18; i++) {
    await sleep(10_000);
    const statusRes = await axios.get(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${token}`
    );
    if (statusRes.data.data.status === "SUCCEEDED") break;
    if (statusRes.data.data.status === "FAILED") {
      throw new Error("Apify run failed");
    }
  }

  // Lấy kết quả
  const datasetId = runRes.data.data.defaultDatasetId;
  const itemsRes = await axios.get(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&limit=30`
  );

  return itemsRes.data;
}

// ─── 2. Claude chọn 3 chủ đề hot nhất ───────────────────────────────────────
async function selectTopTopics(posts: any[]): Promise<any[]> {
  const summary = posts.slice(0, 20).map(p => ({
    text: p.text?.slice(0, 150),
    plays: p.playCount,
    likes: p.diggCount,
    hashtags: p.hashtags?.map((h: any) => h.name),
    music: p.musicMeta?.musicName,
  }));

  const result = await askClaude<{ topics: any[] }>({
    temperature: 0.4,
    system: `Bạn là chuyên gia phân tích xu hướng TikTok cho homestay nghệ thuật tại Sài Gòn.
Phân tích các bài đăng trending, tìm ra pattern content phù hợp với:
- Boutique homestay có style Pop Art / Indochine / Minimalist
- Khách du lịch trong nước và quốc tế tại TP.HCM
- Trending music và visual style hiện tại`,
    prompt: `Dựa trên ${summary.length} bài TikTok trending này:\n${JSON.stringify(summary, null, 2)}\n
Trả về JSON:
{
  "topics": [
    {
      "title": "Tên chủ đề ngắn",
      "angle": "Góc khai thác cụ thể cho Joystay",
      "suggested_music": "Tên nhạc trending phù hợp",
      "visual_style": "Mô tả style video/ảnh",
      "trending_score": 8.5,
      "reason": "Lý do chọn"
    }
  ]
}
Chỉ chọn 3 chủ đề tốt nhất.`,
  });

  return result.topics ?? [];
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export async function runTrendHunter(): Promise<{ topics: any[]; trend_ids: string[] }> {
  console.log("[TrendHunter] Scanning trending topics...");

  const posts = await scrapeApify();
  const topics = await selectTopTopics(posts);

  // Lưu vào Supabase
  const insertData = topics.map(t => ({
    date: new Date().toISOString().split("T")[0],
    topic: t.title,
    platform: "tiktok",
    trend_score: t.trending_score,
    keywords: [t.angle, t.visual_style].filter(Boolean),
    raw_data: t,
    selected: true,
  }));

  const { data, error } = await supabase
    .from("trend_insights")
    .insert(insertData)
    .select("id, topic");

  if (error) throw new Error(`Supabase insert failed: ${error.message}`);

  console.log(`[TrendHunter] Saved ${data?.length} topics`);
  return {
    topics,
    trend_ids: data?.map(d => d.id) ?? [],
  };
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
