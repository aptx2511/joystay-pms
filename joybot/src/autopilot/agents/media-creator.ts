// ─────────────────────────────────────────────────────────────────────────────
// Agent 2 — Media Creator
// Chọn ảnh thật từ Supabase Storage theo topic, không cần generate AI
// ─────────────────────────────────────────────────────────────────────────────
import { supabase } from "../supabase";

const SUPABASE_URL = process.env.SUPABASE_URL!;

// Map keyword trong topic → thư mục ảnh trong Supabase
const ROOM_MAP: Record<string, string> = {
  "pop art":    "Popart Studio",
  "popart":     "Popart Studio",
  "b&w":        "B&W Studio Large",
  "bw":         "B&W Studio Large",
  "monochrome": "B&W Studio Large",
  "indochine":  "Indochine Room",
  "indochine 1":"Indochine Room",
  "indochine 2":"Indochine 2",
  "midcentury": "Midcentury Room",
  "mid century":"Midcentury Room",
  "ngoai canh": "Ngoai canh",
  "exterior":   "Ngoai canh",
};

// Lấy danh sách ảnh trong 1 folder từ Supabase Storage
async function listPhotos(folder: string): Promise<string[]> {
  const { data, error } = await supabase.storage
    .from("joystay-photos")
    .list(folder, { limit: 50 });

  if (error || !data?.length) return [];

  return data
    .filter(f => f.name.endsWith(".jpg"))
    .map(f => `${SUPABASE_URL}/storage/v1/object/public/joystay-photos/${encodeURIComponent(folder)}/${f.name}`);
}

// Chọn folder phù hợp nhất dựa trên topic title
function pickFolder(topicTitle: string): string {
  const lower = topicTitle.toLowerCase();
  for (const [keyword, folder] of Object.entries(ROOM_MAP)) {
    if (lower.includes(keyword)) return folder;
  }
  // Default: random trong tất cả các phòng
  const allFolders = [...new Set(Object.values(ROOM_MAP))];
  return allFolders[Math.floor(Math.random() * allFolders.length)];
}

// Chọn ngẫu nhiên N ảnh từ mảng
function pickRandom<T>(arr: T[], n = 3): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export async function runMediaCreator(
  trendId: string,
  topic: { title: string; angle: string; visual_style: string }
): Promise<{ media_id: string; image_urls: string[] }> {
  console.log(`[MediaCreator] Selecting photos for: ${topic.title}`);

  const folder = pickFolder(topic.title);
  console.log(`[MediaCreator] Using folder: ${folder}`);

  let photos = await listPhotos(folder);

  // Fallback: nếu folder rỗng thì lấy từ Popart Studio
  if (!photos.length) {
    photos = await listPhotos("Popart Studio");
  }

  const selectedUrls = pickRandom(photos, 3);

  const { data, error } = await supabase
    .from("media_assets")
    .insert({
      trend_id:  trendId,
      image_url: selectedUrls[0] ?? null,
      video_url: null,
      style:     `${folder} — real photo`,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Supabase insert failed: ${error.message}`);

  console.log(`[MediaCreator] Selected ${selectedUrls.length} photos from "${folder}"`);
  return {
    media_id:   data.id,
    image_urls: selectedUrls,
  };
}
