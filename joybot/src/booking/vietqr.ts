import { config } from "../config";

/** Ảnh QR chuyển khoản VietQR có sẵn số tiền + nội dung (mã booking) */
export function vietQrUrl(amount: number, content: string): string | null {
  const { bankId, accountNo, accountName } = config.bank;
  if (!bankId || !accountNo) return null;
  const q = new URLSearchParams({
    amount: String(Math.round(amount)),
    addInfo: content,
    ...(accountName ? { accountName } : {}),
  });
  return `https://img.vietqr.io/image/${encodeURIComponent(bankId)}-${encodeURIComponent(accountNo)}-compact2.png?${q}`;
}

export function bankText(amount: number, content: string): string {
  const { bankId, accountNo, accountName } = config.bank;
  return [
    `Ngân hàng: ${bankId}`,
    `Số TK: ${accountNo}`,
    accountName ? `Chủ TK: ${accountName}` : "",
    `Số tiền: ${amount.toLocaleString("vi-VN")}đ`,
    `Nội dung: ${content}`,
  ]
    .filter(Boolean)
    .join("\n");
}
