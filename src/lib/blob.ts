/**
 * Kho ảnh Vercel Blob ở chế độ RIÊNG TƯ (store "joystay-pms-photos", private).
 * Ảnh không có link công khai — mọi lần xem đều đi qua route của PMS (đã kiểm tra quyền).
 */
import { get, put } from "@vercel/blob";

export const blobReady = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);

const BLOB_URL = /^https:\/\/[a-z0-9.-]+\.blob\.vercel-storage\.com\//i;

export async function putPrivate(path: string, file: File | Blob, contentType: string) {
  const r = await put(path, file, { access: "private", addRandomSuffix: true, contentType });
  return r.url;
}

/** Trả ảnh về trình duyệt (đã kiểm tra quyền ở route gọi hàm này) */
export async function streamBlob(url: string): Promise<Response> {
  if (!BLOB_URL.test(url)) return new Response("Bad url", { status: 400 });
  for (const access of ["private", "public"] as const) {
    try {
      const r = await get(url, { access });
      if (r && r.statusCode === 200 && r.stream) {
        return new Response(r.stream, {
          headers: { "Content-Type": r.blob.contentType ?? "image/jpeg", "Cache-Control": "private, max-age=3600" },
        });
      }
    } catch {
      /* thử chế độ còn lại */
    }
  }
  return new Response("Not found", { status: 404 });
}

/** Đọc ảnh thành Blob (để gửi kèm Telegram) */
export async function readBlob(url: string): Promise<Blob | null> {
  try {
    const r = await get(url, { access: "private" });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    return await new Response(r.stream).blob();
  } catch {
    return null;
  }
}
