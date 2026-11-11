import { NextResponse } from "next/server";
import { auditAirbnb, checkBookingIntegrity } from "@/lib/sync-guard";

/** Kiểm tra chéo lịch hằng ngày (Vercel cron) — cần Authorization: Bearer CRON_SECRET */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }
  const integrity = await checkBookingIntegrity();
  const airbnb = await auditAirbnb();
  return NextResponse.json({ integrity, airbnb, message: `Kiểm tra xong: ${integrity.length + airbnb.length} cảnh báo mới` });
}

/** Chạy tay từ trang Cài đặt (đã qua đăng nhập ở middleware) */
export async function POST() {
  const integrity = await checkBookingIntegrity();
  const airbnb = await auditAirbnb();
  return NextResponse.json({ integrity, airbnb, message: `Kiểm tra xong: ${integrity.length + airbnb.length} cảnh báo mới` });
}
