import { searchRooms, createHold, bookingStatus, Ctx } from "../booking/service";
import { notifyOwner } from "../notify/telegram";
import { setHandoff } from "../joybot";

export async function executeTool(name: string, input: Record<string, any>, ctx: Ctx): Promise<string> {
  console.log(`[Tool] ${name}`, JSON.stringify(input));
  try {
    switch (name) {
      case "search_rooms":
        return JSON.stringify(await searchRooms(input.checkIn, input.checkOut, input.guests));
      case "create_hold":
        return JSON.stringify(await createHold(ctx, input as any));
      case "booking_status":
        return JSON.stringify(await bookingStatus(ctx, String(input.code)));
      case "handoff_to_owner":
        await setHandoff(ctx, true);
        await notifyOwner(
          `🙋 CẦN ANH TRẢ LỜI (${ctx.channel})\nLý do: ${input.reason}\n${input.summary}\n` +
            `Bot đã dừng tự trả lời khách này. Gửi /bot ${ctx.channel}:${ctx.userId} để bật lại.`
        );
        return JSON.stringify({ ok: true, note: "Đã chuyển chủ. Báo khách chủ sẽ nhắn sớm." });
      default:
        return JSON.stringify({ error: `Unknown tool ${name}` });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[Tool] ${name} lỗi:`, msg);
    await notifyOwner(`⚠️ JoyBot lỗi khi chạy ${name} (${ctx.channel}:${ctx.userId}): ${msg}`);
    return JSON.stringify({
      ok: false,
      error: "Hệ thống tạm lỗi. KHÔNG được báo khách là đã đặt/giữ chỗ. Xin lỗi khách và gọi handoff_to_owner.",
    });
  }
}
