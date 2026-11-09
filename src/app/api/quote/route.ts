import { NextResponse } from "next/server";
import { quoteDirect } from "@/lib/rates";

export const dynamic = "force-dynamic";
const CORS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };

// GET /api/quote?roomId=&checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD — giá kênh trực tiếp theo giá ngày (website, JoyBot)
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const roomId = sp.get("roomId"), ci = sp.get("checkIn"), co = sp.get("checkOut");
  if (!roomId || !ci || !co || !/^\d{4}-\d{2}-\d{2}$/.test(ci) || !/^\d{4}-\d{2}-\d{2}$/.test(co) || co <= ci)
    return NextResponse.json({ error: "roomId, checkIn, checkOut (YYYY-MM-DD) bắt buộc" }, { status: 400, headers: CORS });
  const q = await quoteDirect(roomId, ci, co);
  return q ? NextResponse.json(q, { headers: CORS }) : NextResponse.json({ error: "Không có phòng" }, { status: 404, headers: CORS });
}
