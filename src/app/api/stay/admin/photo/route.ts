import { streamBlob } from "@/lib/blob";

// GET /api/stay/admin/photo?u=<blob url> — xem ảnh giấy tờ (chỉ chủ, sau lớp đăng nhập middleware)
export async function GET(request: Request) {
  return streamBlob(new URL(request.url).searchParams.get("u") ?? "");
}
