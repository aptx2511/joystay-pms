import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEMO_TOKEN, demoView, findByToken, guestView, stayLine } from "@/lib/stay";
import { tgNotify } from "@/lib/telegram";
import { publicBaseUrl } from "@/lib/housekeeping";
import { paymentView } from "@/lib/payment";

const withPay = async (b: Parameters<typeof guestView>[0]) => ({ ...guestView(b), payment: await paymentView(b).catch(() => null) });

type Params = { params: Promise<{ token: string }> };
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: Params) {
  const { token } = await params;
  if (token === DEMO_TOKEN) return NextResponse.json(demoView(new URL(req.url).searchParams.get("at")));
  const b = await findByToken(token);
  if (!b) return NextResponse.json({ error: "Link không đúng hoặc đặt phòng đã huỷ / Invalid link" }, { status: 404 });
  const v = guestView(b);
  const now = new Date();
  await prisma.stayPortal.update({
    where: { id: b.portal!.id },
    data: {
      ...(!b.portal!.firstViewAt && { firstViewAt: now }),
      ...(v.codes.length && !b.portal!.codesViewedAt && { codesViewedAt: now }),
    },
  });
  return NextResponse.json({ ...v, payment: await paymentView(b).catch(() => null) });
}

/**
 * POST { action: "lang", lang }
 *      { action: "arrival", time, guests }
 *      { action: "issue", text }          → Telegram báo chủ ngay
 *      { action: "feedback", rating, text }
 */
export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  if (token === DEMO_TOKEN) return NextResponse.json(demoView(new URL(request.url).searchParams.get("at")));
  const b = await findByToken(token);
  if (!b) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  const p = b.portal!;
  const body = (await request.json().catch(() => ({}))) as {
    action?: string; lang?: string; time?: string; guests?: number; text?: string; rating?: number;
  };

  switch (body.action) {
    case "lang":
      await prisma.stayPortal.update({ where: { id: p.id }, data: { lang: body.lang === "vi" ? "vi" : "en" } });
      break;
    case "arrival": {
      const time = /^\d{2}:\d{2}$/.test(body.time ?? "") ? body.time! : null;
      const guests = Number(body.guests) >= 1 && Number(body.guests) <= 4 ? Number(body.guests) : null;
      await prisma.stayPortal.update({ where: { id: p.id }, data: { arrivalTime: time, guests } });
      break;
    }
    case "issue": {
      const text = (body.text ?? "").trim().slice(0, 1000);
      if (!text) return NextResponse.json({ error: "Empty" }, { status: 400 });
      const issues = [...(Array.isArray(p.issues) ? (p.issues as object[]) : []), { at: new Date().toISOString(), text }].slice(-20);
      await prisma.stayPortal.update({ where: { id: p.id }, data: { issues } });
      await tgNotify(`🆘 KHÁCH CẦN HỖ TRỢ\n${stayLine(b)}\n\n“${text}”\n\nTrả lời khách qua kênh đã đặt (Airbnb/Zalo/WhatsApp).\n${publicBaseUrl()}/luu-tru`);
      break;
    }
    case "feedback": {
      const rating = Math.max(1, Math.min(5, Math.round(Number(body.rating) || 0)));
      const text = (body.text ?? "").trim().slice(0, 2000);
      await prisma.stayPortal.update({ where: { id: p.id }, data: { feedback: { rating, text, at: new Date().toISOString() } } });
      await tgNotify(`${rating >= 4 ? "⭐" : "⚠️"} Góp ý khách: ${"★".repeat(rating)}${"☆".repeat(5 - rating)}\n${stayLine(b)}${text ? `\n“${text}”` : ""}`);
      break;
    }
    default:
      return NextResponse.json({ error: "action không hợp lệ" }, { status: 400 });
  }
  const fresh = await findByToken(token);
  return NextResponse.json(await withPay(fresh!));
}
