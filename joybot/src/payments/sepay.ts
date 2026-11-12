/**
 * Webhook SePay: báo biến động số dư → khớp mã đặt phòng trong nội dung CK → xác nhận cọc.
 * Cấu hình trên SePay: URL = <PUBLIC_URL>/webhook/sepay, xác thực "API Key" = SEPAY_API_KEY.
 */
import { Request, Response } from "express";
import { config } from "../config";
import { confirmDeposit } from "../booking/service";
import { notifyOwner } from "../notify/telegram";

export async function sepayWebhook(req: Request, res: Response) {
  if (!config.sepay.apiKey || req.header("authorization") !== `Apikey ${config.sepay.apiKey}`) {
    res.status(401).json({ success: false });
    return;
  }
  res.json({ success: true });

  const t = req.body ?? {};
  if (t.transferType !== "in") return;
  const amount = Number(t.transferAmount ?? 0);
  const text = `${t.code ?? ""} ${t.content ?? ""} ${t.description ?? ""}`.toUpperCase().replace(/\s+/g, " ");
  const re = new RegExp(`${config.booking.codePrefix}\\s?(\\d{4,6})`);
  const m = text.match(re);
  if (!m) return; // tiền về không phải từ JoyBot → bỏ qua
  const code = `${config.booking.codePrefix}${m[1]}`;

  try {
    if (config.booking.autoConfirmOnPayment) {
      await confirmDeposit(code, "SePay tự động", amount, String(t.id ?? t.referenceCode ?? ""));
    } else {
      await notifyOwner(`💰 Tiền về ${amount.toLocaleString("vi-VN")}đ cho ${code}`, [
        [{ text: `✅ Chốt ${code}`, data: `paid:${code}` }],
      ]);
    }
  } catch (e) {
    await notifyOwner(`⚠️ SePay ${code}: ${(e as Error).message}`);
  }
}
