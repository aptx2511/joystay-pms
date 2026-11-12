// ─────────────────────────────────────────────────────────────────────────────
// Agent 5 — Data Analyst
// Kéo metrics từ FB + TikTok, phân tích Claude, gửi Telegram report
// ─────────────────────────────────────────────────────────────────────────────
import axios from "axios";
import { askClaude } from "../claude";
import { supabase } from "../supabase";

// ─── Fetch Facebook Insights ─────────────────────────────────────────────────
async function fetchFacebookMetrics(postId: string, platformPostId: string) {
  const token = process.env.FB_PAGE_ACCESS_TOKEN!;
  const metrics = "post_impressions,post_engaged_users,post_clicks,post_reactions_by_type_total";

  const res = await axios.get(
    `https://graph.facebook.com/v18.0/${platformPostId}/insights`,
    { params: { metric: metrics, access_token: token } }
  );

  const map: Record<string, any> = {};
  for (const d of res.data.data ?? []) {
    map[d.name] = d.values?.[0]?.value ?? 0;
  }

  const reactions = map["post_reactions_by_type_total"] ?? {};
  const likes = typeof reactions === "object" ? Object.values(reactions).reduce((a: any, b: any) => a + b, 0) : 0;
  const views = map["post_impressions"] ?? 0;
  const clicks = map["post_clicks"] ?? 0;
  const engaged = map["post_engaged_users"] ?? 0;

  return {
    post_id: postId,
    platform: "facebook",
    views,
    likes,
    comments: 0,
    shares: 0,
    link_clicks: clicks,
    reach: views,
    engagement_rate: views > 0 ? +((engaged / views) * 100).toFixed(2) : 0,
    ctr: views > 0 ? +((clicks / views) * 100).toFixed(2) : 0,
    raw_data: res.data,
  };
}

// ─── Fetch TikTok Analytics ──────────────────────────────────────────────────
async function fetchTikTokMetrics(postId: string, platformPostId: string) {
  const token = process.env.TIKTOK_ACCESS_TOKEN!;

  const res = await axios.post(
    "https://open.tiktokapis.com/v2/video/query/",
    {
      filters: { video_ids: [platformPostId] },
      fields: ["id", "view_count", "like_count", "comment_count", "share_count"],
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );

  const v = res.data.data?.videos?.[0] ?? {};
  const views = v.view_count ?? 0;
  const likes = v.like_count ?? 0;
  const comments = v.comment_count ?? 0;
  const shares = v.share_count ?? 0;

  return {
    post_id: postId,
    platform: "tiktok",
    views,
    likes,
    comments,
    shares,
    link_clicks: 0,
    reach: views,
    engagement_rate: views > 0 ? +(((likes + comments + shares) / views) * 100).toFixed(2) : 0,
    ctr: 0,
    raw_data: res.data,
  };
}

// ─── Claude Analysis ──────────────────────────────────────────────────────────
async function analyzeMetrics(metrics: any[], yesterdayFeedback: any) {
  return askClaude({
    temperature: 0.3,
    system: "Bạn là AI Analyst chuyên content marketing cho boutique homestay Sài Gòn. Phân tích ngắn gọn, thực tế, actionable.",
    prompt: `Metrics hôm nay:\n${JSON.stringify(metrics, null, 2)}\n
Feedback hôm qua:\n${JSON.stringify(yesterdayFeedback ?? "Chua co", null, 2)}

Tra ve JSON:
{
  "overall_assessment": "2 cau tom tat",
  "best_performing": { "platform": "...", "reason": "...", "hook_pattern": "..." },
  "worst_performing": { "platform": "...", "reason": "...", "what_to_avoid": "..." },
  "top_hashtags": ["..."],
  "recommendations_tomorrow": ["...", "...", "..."],
  "optimal_post_time": "11:30 hoac 20:00 - ly do",
  "content_theme_tomorrow": "..."
}`,
  });
}

// ─── Telegram Report ─────────────────────────────────────────────────────────
async function sendTelegramReport(metrics: any[], insights: any) {
  const token = process.env.TELEGRAM_BOT_TOKEN!;
  const chatId = process.env.TELEGRAM_CHAT_ID!;
  const today = new Date().toLocaleDateString("vi-VN");

  const totalViews = metrics.reduce((s, m) => s + m.views, 0);
  const totalLikes = metrics.reduce((s, m) => s + m.likes, 0);
  const totalShares = metrics.reduce((s, m) => s + (m.shares ?? 0), 0);
  const avgEng = metrics.length
    ? (metrics.reduce((s, m) => s + m.engagement_rate, 0) / metrics.length).toFixed(1)
    : "0";

  const platformBreakdown = metrics
    .map(m => `  • ${m.platform}: ${m.views.toLocaleString()} views, ${m.engagement_rate}% eng`)
    .join("\n");

  const message = `
📊 *JOYSTAY AUTOPILOT — ${today}*

━━━━━━━━━━━━━━
📈 *KẾT QUẢ 24H*
👁 Views: \`${totalViews.toLocaleString()}\`
❤️ Likes: \`${totalLikes.toLocaleString()}\`
🔄 Shares: \`${totalShares.toLocaleString()}\`
⚡️ Avg Eng: \`${avgEng}%\`

${platformBreakdown}

━━━━━━━━━━━━━━
🤖 *AI INSIGHTS*
${insights.overall_assessment}

✅ Tốt nhất: *${insights.best_performing?.platform}* — ${insights.best_performing?.reason}
❌ Cần fix: ${insights.worst_performing?.what_to_avoid}

━━━━━━━━━━━━━━
📌 *GỢI Ý NGÀY MAI*
${(insights.recommendations_tomorrow ?? []).map((r: string) => `• ${r}`).join("\n")}

🎯 Chủ đề: _${insights.content_theme_tomorrow}_
⏰ Giờ đăng: ${insights.optimal_post_time}

━━━━━━━━━━━━━━
_🤖 Joystay Viral Autopilot_
`.trim();

  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text: message,
    parse_mode: "Markdown",
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export async function runAnalyst(): Promise<void> {
  console.log("[Analyst] Starting daily analysis...");

  // Posts từ 26h trước (buffer an toàn)
  const since = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
  const { data: posts } = await supabase
    .from("posts")
    .select("id, platform, platform_post_id")
    .gte("published_at", since)
    .eq("status", "published");

  if (!posts?.length) {
    console.log("[Analyst] No posts to analyze.");
    return;
  }

  // Fetch metrics song song
  const metricPromises = posts.map(p =>
    p.platform === "facebook"
      ? fetchFacebookMetrics(p.id, p.platform_post_id!)
      : fetchTikTokMetrics(p.id, p.platform_post_id!)
  );

  const metricsRaw = await Promise.allSettled(metricPromises);
  const metrics = metricsRaw
    .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
    .map(r => r.value);

  // Lưu metrics
  for (const m of metrics) {
    await supabase.from("performance_metrics").insert({
      post_id: m.post_id,
      views: m.views,
      likes: m.likes,
      comments: m.comments,
      shares: m.shares,
      link_clicks: m.link_clicks,
      reach: m.reach,
      ctr: m.ctr,
      engagement_rate: m.engagement_rate,
      raw_data: m.raw_data,
    });
  }

  // Lấy feedback hôm qua
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const { data: fbData } = await supabase
    .from("feedback_loop")
    .select("*")
    .eq("date", yesterday)
    .limit(1);

  // Phân tích
  const insights = await analyzeMetrics(metrics, fbData?.[0] ?? null);

  // Lưu feedback
  const avgEng = metrics.length
    ? metrics.reduce((s, m) => s + m.engagement_rate, 0) / metrics.length
    : 0;

  await supabase.from("feedback_loop").insert({
    date: new Date().toISOString().split("T")[0],
    best_hook: insights.best_performing?.hook_pattern,
    best_topic: insights.content_theme_tomorrow,
    best_hashtags: insights.top_hashtags ?? [],
    worst_hook: insights.worst_performing?.what_to_avoid,
    avg_engagement: +avgEng.toFixed(2),
    ai_insights: insights.overall_assessment,
    recommendations: insights,
  });

  // Gửi Telegram
  await sendTelegramReport(metrics, insights);

  console.log("[Analyst] Done. Report sent.");
}
