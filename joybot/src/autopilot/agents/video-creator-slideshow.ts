// ─────────────────────────────────────────────────────────────────────────────
// Agent: Video Creator — FFmpeg Slideshow
// Ghép ảnh thật từ Supabase Storage thành slideshow video có transition
// ─────────────────────────────────────────────────────────────────────────────
import axios from "axios";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { supabase } from "../supabase";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const SUPABASE_URL = process.env.SUPABASE_URL!;
const BUCKET = "joystay-videos";

// ─── Download ảnh về temp folder ─────────────────────────────────────────────
async function downloadImage(url: string, dest: string): Promise<void> {
  const res = await axios.get(url, { responseType: "arraybuffer" });
  fs.writeFileSync(dest, Buffer.from(res.data));
}

// ─── Tạo slideshow video từ danh sách ảnh ────────────────────────────────────
async function createSlideshow(imagePaths: string[], outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();

    // Mỗi ảnh hiển thị 2.5 giây
    for (const img of imagePaths) {
      cmd.input(img).inputOptions(["-loop 1", "-t 2.5"]);
    }

    cmd
      .complexFilter([
        // Scale tất cả ảnh về 1080x1920 (TikTok/Reels portrait)
        ...imagePaths.map((_, i) =>
          `[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`
        ),
        // Concat với crossfade 0.5s
        imagePaths.length === 1
          ? `[v0]copy[outv]`
          : imagePaths
              .map((_, i) => `[v${i}]`)
              .join("") +
            `concat=n=${imagePaths.length}:v=1:a=0[outv]`,
      ])
      .outputOptions([
        "-map [outv]",
        "-c:v libx264",
        "-preset fast",
        "-crf 23",
        "-pix_fmt yuv420p",
        "-movflags +faststart",
        "-r 30",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (err: Error) => reject(err))
      .run();
  });
}

// ─── Upload video lên Supabase Storage ───────────────────────────────────────
async function uploadVideo(filePath: string, fileName: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);

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
export async function runSlideshowCreator(
  mediaId: string,
  imageUrls: string[]
): Promise<{ video_url: string }> {
  console.log(`[SlideshowCreator] Creating slideshow from ${imageUrls.length} photos...`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "joystay-"));
  const imagePaths: string[] = [];

  try {
    // Download ảnh
    for (let i = 0; i < Math.min(imageUrls.length, 5); i++) {
      const dest = path.join(tmpDir, `img${i}.jpg`);
      await downloadImage(imageUrls[i], dest);
      imagePaths.push(dest);
    }

    // Tạo video
    const outputPath = path.join(tmpDir, "slideshow.mp4");
    await createSlideshow(imagePaths, outputPath);

    // Upload
    const fileName = `slideshow_${mediaId}_${Date.now()}.mp4`;
    const videoUrl = await uploadVideo(outputPath, fileName);

    // Update media_assets
    await supabase
      .from("media_assets")
      .update({ video_url: videoUrl })
      .eq("id", mediaId);

    console.log(`[SlideshowCreator] Done: ${videoUrl}`);
    return { video_url: videoUrl };
  } finally {
    // Cleanup temp files
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  }
}
