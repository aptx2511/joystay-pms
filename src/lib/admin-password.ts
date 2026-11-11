import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

const KEY = "admin_password_hash";

/** Mật khẩu lấy từ biến môi trường PMS_ADMIN_PASSWORD (nếu có), nếu không thì mật khẩu chủ tự tạo lưu dạng băm trong DB */
export async function passwordConfigured() {
  if (process.env.PMS_ADMIN_PASSWORD) return true;
  return Boolean(await prisma.appSetting.findUnique({ where: { key: KEY } }));
}
export async function checkPassword(input: string) {
  const env = process.env.PMS_ADMIN_PASSWORD;
  if (env) {
    const a = Buffer.from(input), b = Buffer.from(env);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  if (!row) return false;
  const [salt, hash] = row.value.split(":");
  const got = scryptSync(input, salt, 64);
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}
export async function setPassword(pw: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pw, salt, 64).toString("hex");
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: `${salt}:${hash}` }, update: { value: `${salt}:${hash}` } });
}
