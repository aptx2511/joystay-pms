// ─────────────────────────────────────────────────────────────────────────────
// Agent: Video Creator — AI (Replicate)
// Dùng Replicate API để tạo video từ ảnh phòng + prompt
// Model: minimax/video-01-live (image-to-video)
// ─────────────────────────────────────────────────────────────────────────────
import Replicate from "replicate";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { supabase } from "../supabase";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN! });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const BUCKET = "joystay-videos";

// ─── Upload video lên Supabase Storage ───────────────────────────────────────
async function uploadVideoFromUrl(videoUrl: string, fileName: string): Promise<string> {
  const res = await axios.get(videoUrl, { responseType: "arraybuffer" });
  const buffer = Buffer.from(res.data);

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(fileName, buffer, {
      contentType: "video/mp4",
      upsert: true,
    });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${fileName}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export async function runAIVideoCreator(
  mediaId: string,
  imageUrl: string,
  topic: { title: string; angle: string; visual_style: string }
): Promise<{ video_url: string }> {
  console.log(`[AIVideoCreator] Generating video for: ${topic.title}`);

  const prompt = `Cinematic video of a boutique homestay room in Saigon Vietnam. ${topic.visual_style}. Slow pan camera movement, golden hour lighting, luxury aesthetic. No people. High quality, 4K.`;

  // Dùng minimax/video-01-live: image-to-video
  // Dùng predictions.create để tự dùng latest version
  let prediction = await replicate.predictions.create({
    model: "minimax/video-01",
    input: {
      prompt,
      first_frame_image: imageUrl,
    },
  });

  // Chờ đến khi xong (polling)
  prediction = await replicate.wait(prediction);

  const output = prediction.output;
  const replicateVideoUrl = Array.isArray(output) ? output[0] : output;
  if (!replicateVideoUrl) throw new Error("Replicate returned no video URL");

  console.log(`[AIVideoCreator] Replicate done, uploading...`);

  const fileName = `ai_video_${mediaId}_${Date.now()}.mp4`;
  const videoUrl = await uploadVideoFromUrl(replicateVideoUrl, fileName);

  // Update media_assets
  await supabase
    .from("media_assets")
    .update({ video_url: videoUrl })
    .eq("id", mediaId);

  console.log(`[AIVideoCreator] Done: ${videoUrl}`);
  return { video_url: videoUrl };
}
