// ─────────────────────────────────────────────────────────────────────────────
// Agent 4 — Publisher
// Đăng video/ảnh lên TikTok + Facebook tự động
// ─────────────────────────────────────────────────────────────────────────────
import axios from "axios";
import { supabase } from "../supabase";

// ─── TikTok Publisher ────────────────────────────────────────────────────────
async function publishTikTok(
  caption: string,
  mediaUrl: string
): Promise<{ success: boolean; post_id?: string; error?: string }> {
  const token = process.env.TIKTOK_ACCESS_TOKEN!;

  try {
    const initRes = await axios.post(
      "https://open.tiktokapis.com/v2/post/publish/video/init/",
      {
        post_info: {
          title: caption.slice(0, 2200),
          privacy_level: "PUBLIC_TO_EVERYONE",
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
          video_cover_timestamp_ms: 1000,
        },
        source_info: {
          source: "PULL_FROM_URL",
          video_url: mediaUrl,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
      }
    );

    const { publish_id } = initRes.data.data;

    // Poll publish status
    for (let i = 0; i < 24; i++) {
      await sleep(5000);
      const statusRes = await axios.post(
        "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
        { publish_id },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const { status, publicaly_available_post_id } = statusRes.data.data;

      if (status === "PUBLISH_COMPLETE") {
        const postId = publicaly_available_post_id?.[0] ?? publish_id;
        return { success: true, post_id: postId };
      }
      if (status === "FAILED") {
        return { success: false, error: JSON.stringify(statusRes.data) };
      }
    }

    return { success: false, error: "Publish timeout" };
  } catch (err: any) {
    return { success: false, error: err.response?.data?.error?.message ?? err.message };
  }
}

// ─── Facebook Publisher ──────────────────────────────────────────────────────
async function publishFacebook(
  caption: string,
  mediaUrl: string,
  mediaType: "image" | "video"
): Promise<{ success: boolean; post_id?: string; error?: string }> {
  const pageId = process.env.FB_PAGE_ID!;
  const token = process.env.FB_PAGE_ACCESS_TOKEN!;
  const v = "v18.0";

  try {
    if (mediaType === "video") {
      // Init Reels upload
      const initRes = await axios.post(
        `https://graph.facebook.com/${v}/${pageId}/video_reels`,
        { upload_phase: "start", access_token: token }
      );
      const { video_id, upload_url } = initRes.data;

      // Upload video
      const videoBuffer = await downloadBuffer(mediaUrl);
      await axios.post(upload_url, videoBuffer, {
        headers: {
          Authorization: `OAuth ${token}`,
          "Content-Type": "application/octet-stream",
          offset: "0",
          file_size: videoBuffer.length.toString(),
        },
      });

      // Publish
      const pubRes = await axios.post(
        `https://graph.facebook.com/${v}/${pageId}/video_reels`,
        {
          video_id,
          upload_phase: "finish",
          video_state: "PUBLISHED",
          description: caption,
          title: caption.slice(0, 100),
          access_token: token,
        }
      );

      return { success: true, post_id: pubRes.data.id ?? video_id };
    } else {
      // Image post
      const photoRes = await axios.post(
        `https://graph.facebook.com/${v}/${pageId}/photos`,
        {
          url: mediaUrl,
          caption,
          access_token: token,
        }
      );
      return { success: true, post_id: photoRes.data.id };
    }
  } catch (err: any) {
    return {
      success: false,
      error: err.response?.data?.error?.message ?? err.message,
    };
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export async function runPublisher(calendarId: string): Promise<void> {
  // Lấy content
  const { data: item, error } = await supabase
    .from("content_calendar")
    .select("id, platform, hook, caption, hashtags, cta, media_id, status")
    .eq("id", calendarId)
    .single();

  if (error || !item) throw new Error(`Content not found: ${calendarId}`);

  // Lấy media riêng
  const { data: mediaRow } = await supabase
    .from("media_assets")
    .select("image_url, video_url")
    .eq("id", item.media_id)
    .single();

  const fileUrl = mediaRow?.video_url ?? mediaRow?.image_url ?? null;
  const mediaType: "image" | "video" = mediaRow?.video_url ? "video" : "image";

  const hashtagStr = (item.hashtags as string[])
    .map(h => `#${h}`)
    .join(" ");
  const fullCaption = `${item.hook}\n\n${item.caption}\n\n${hashtagStr}`;

  console.log(`[Publisher] Posting to ${item.platform}: "${item.hook}"`);

  const results = [];

  if (item.platform === "tiktok" || item.platform === "both") {
    const r = await publishTikTok(fullCaption, fileUrl);
    results.push({ platform: "tiktok", ...r });
  }

  if (item.platform === "facebook" || item.platform === "both") {
    const r = await publishFacebook(fullCaption, fileUrl, mediaType);
    results.push({ platform: "facebook", ...r });
  }

  // Lưu posts
  for (const r of results) {
    await supabase.from("posts").insert({
      calendar_id: calendarId,
      platform: r.platform,
      platform_post_id: r.post_id,
      post_url: r.post_id
        ? r.platform === "tiktok"
          ? `https://www.tiktok.com/@joystay.vn/video/${r.post_id}`
          : `https://www.facebook.com/permalink.php?id=${r.post_id}`
        : null,
      published_at: new Date().toISOString(),
      status: r.success ? "published" : "failed",
      error_message: r.error,
    });
  }

  await supabase
    .from("content_calendar")
    .update({ status: results.every(r => r.success) ? "published" : "partial" })
    .eq("id", calendarId);

  console.log(`[Publisher] Results:`, results.map(r => `${r.platform}:${r.success}`));
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await axios.get(url, { responseType: "arraybuffer" });
  return Buffer.from(res.data);
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
