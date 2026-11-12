// ─────────────────────────────────────────────────────────────────────────────
// Agent 3 — Copywriter & Hook Master
// Viết caption + hook + hashtag cho TikTok và Facebook
// ─────────────────────────────────────────────────────────────────────────────
import { askClaude } from "../claude";
import { supabase } from "../supabase";

const SYSTEM_PROMPT = `
Mày là AI: "Thổ Địa Sài Gòn" — linh hồn viết content cho Joystay Vietnam.

## NHÂN CÁCH
Mày lớn lên ở Sài Gòn. Mày hiểu cái hẻm nhỏ có linh hồn hơn khách sạn 5 sao.
Viết như kể chuyện cho bạn thân — không phải chạy quảng cáo.

## JOYSTAY
Boutique homestay nghệ thuật tại TP.HCM. 5 phòng:
Pop Art Studio / Indochine 1 / Indochine 2 / Midcentury Room / B&W Studio Large.
Tự check-in 24/7. Link đặt phòng: https://joystay.vn

## NGUYÊN TẮC HOOK (3 giây đầu)
Hook PHẢI làm 1 trong 3:
1. Gây sốc nhẹ (sự thật counter-intuitive)
2. Đặt câu hỏi gây tò mò
3. Bắt đầu bằng kể chuyện ngay lập tức

Hook KHÔNG được bắt đầu bằng tên thương hiệu, "Đặt phòng", hay liệt kê tính năng.

## ĐIỀU TUYỆT ĐỐI KHÔNG DÙNG
"sang trọng", "đẳng cấp", "trải nghiệm tuyệt vời", "không gian ấm cúng"

## OUTPUT FORMAT
Trả về JSON thuần, không có markdown wrapper:
{
  "hook": "...",
  "caption_tiktok": "...",
  "caption_facebook": "...",
  "hashtags": ["...", "..."],
  "cta": "...",
  "content_angle": "..."
}
`.trim();

// ─── Main ─────────────────────────────────────────────────────────────────────
export async function runCopywriter(
  trendId: string,
  mediaId: string,
  topic: { title: string; angle: string; visual_style: string },
  feedbackContext?: string,
  platform: "tiktok" | "facebook" | "both" = "both"
): Promise<{ calendar_id: string }> {
  console.log(`[Copywriter] Writing copy for: ${topic.title}`);

  const userPrompt = `
Chủ đề hôm nay: "${topic.title}"
Góc khai thác: ${topic.angle}
Visual style: ${topic.visual_style}
${feedbackContext ? `\nBài học từ hôm qua:\n${feedbackContext}` : ""}

Viết caption cho ${platform === "both" ? "cả TikTok và Facebook" : platform}.
Nhớ: hook phải đủ mạnh để người dừng lại trong 3 giây đầu.
  `.trim();

  const copy = await askClaude({ temperature: 0.8, system: SYSTEM_PROMPT, prompt: userPrompt });

  // Schedule cho 2 khung giờ vàng hôm nay
  const today = new Date();
  const scheduledAt = getNextGoldenHour(today);

  const { data, error } = await supabase
    .from("content_calendar")
    .insert({
      trend_id: trendId,
      media_id: mediaId,
      platform,
      hook: copy.hook,
      caption: platform === "tiktok"
        ? copy.caption_tiktok
        : copy.caption_facebook,
      hashtags: copy.hashtags,
      cta: copy.cta,
      scheduled_at: scheduledAt.toISOString(),
      status: "scheduled",
    })
    .select("id")
    .single();

  if (error) throw new Error(`Supabase insert failed: ${error.message}`);

  console.log(`[Copywriter] Scheduled at ${scheduledAt.toISOString()}`);
  console.log(`[Copywriter] Hook: "${copy.hook}"`);

  return { calendar_id: data.id };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getNextGoldenHour(from: Date): Date {
  const result = new Date(from);
  const hour = from.getHours();

  // Khung vàng: 11:30 và 20:00 (giờ Việt Nam = UTC+7)
  if (hour < 11 || (hour === 11 && from.getMinutes() < 30)) {
    result.setHours(11, 30, 0, 0);
  } else if (hour < 20) {
    result.setHours(20, 0, 0, 0);
  } else {
    // Sáng hôm sau
    result.setDate(result.getDate() + 1);
    result.setHours(11, 30, 0, 0);
  }

  return result;
}
