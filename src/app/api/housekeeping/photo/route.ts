import { streamBlob } from "@/lib/blob";

// GET /api/housekeeping/photo?u=<blob url> — chủ xem ảnh dọn phòng (sau lớp đăng nhập middleware)
export async function GET(request: Request) {
  return streamBlob(new URL(request.url).searchParams.get("u") ?? "");
}
