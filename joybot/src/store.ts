/**
 * Lưu trữ bền: hội thoại + booking trực tiếp (Supabase).
 * Không cấu hình Supabase → dùng bộ nhớ RAM (chỉ để chạy thử local).
 */
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type Anthropic from "@anthropic-ai/sdk";
import { config } from "./config";
import type { ChannelName } from "./channels/types";

export type DirectStatus = "HOLD" | "DEPOSIT_PAID" | "EXPIRED" | "CANCELLED";

export interface DirectBooking {
  code: string;
  pms_booking_id: string;
  channel: ChannelName;
  channel_user_id: string;
  room_id: string;
  room_name: string;
  guest_name: string;
  guest_phone: string | null;
  check_in: string;
  check_out: string;
  nights: number;
  total: number;
  deposit: number;
  balance: number;
  status: DirectStatus;
  hold_until: string;
  paid_amount: number;
  paid_at: string | null;
  payment_ref: string | null;
  created_at?: string;
}

export interface SessionRow {
  id: string;
  channel: ChannelName;
  channel_user_id: string;
  messages: Anthropic.MessageParam[];
  handoff: boolean; // true = chủ đang tự trả lời, bot im lặng
  updated_at?: string;
}

const sb: SupabaseClient | null =
  config.supabase.url && config.supabase.serviceKey && process.env.JOYBOT_STORE !== "memory"
    ? createClient(config.supabase.url, config.supabase.serviceKey, { auth: { persistSession: false } })
    : null;

if (!sb) console.warn("[Store] Chưa cấu hình Supabase — dùng RAM (KHÔNG dùng cho production)");

const memSessions = new Map<string, SessionRow>();
const memBookings = new Map<string, DirectBooking>();
const memKv = new Map<string, string>();

export const store = {
  async getSession(id: string): Promise<SessionRow | null> {
    if (!sb) return memSessions.get(id) ?? null;
    const { data, error } = await sb.from("joybot_sessions").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data as SessionRow | null;
  },

  async saveSession(row: SessionRow): Promise<void> {
    // Giữ 40 tin gần nhất để tiết kiệm token
    const trimmed = { ...row, messages: row.messages.slice(-40), updated_at: new Date().toISOString() };
    // Tin đầu phải là tin khách dạng chữ (không được là tool_result mồ côi)
    while (
      trimmed.messages.length &&
      !(trimmed.messages[0].role === "user" && typeof trimmed.messages[0].content === "string")
    )
      trimmed.messages.shift();
    if (!sb) return void memSessions.set(row.id, trimmed);
    const { error } = await sb.from("joybot_sessions").upsert(trimmed);
    if (error) throw error;
  },

  async insertBooking(b: DirectBooking): Promise<void> {
    if (!sb) return void memBookings.set(b.code, b);
    const { error } = await sb.from("joybot_bookings").insert(b);
    if (error) throw error;
  },

  async getBooking(code: string): Promise<DirectBooking | null> {
    if (!sb) return memBookings.get(code) ?? null;
    const { data, error } = await sb.from("joybot_bookings").select("*").eq("code", code).maybeSingle();
    if (error) throw error;
    return data as DirectBooking | null;
  },

  async updateBooking(code: string, patch: Partial<DirectBooking>): Promise<void> {
    if (!sb) {
      const cur = memBookings.get(code);
      if (cur) memBookings.set(code, { ...cur, ...patch });
      return;
    }
    const { error } = await sb.from("joybot_bookings").update(patch).eq("code", code);
    if (error) throw error;
  },

  async expiredHolds(now = new Date()): Promise<DirectBooking[]> {
    if (!sb)
      return [...memBookings.values()].filter((b) => b.status === "HOLD" && new Date(b.hold_until) < now);
    const { data, error } = await sb
      .from("joybot_bookings")
      .select("*")
      .eq("status", "HOLD")
      .lt("hold_until", now.toISOString());
    if (error) throw error;
    return (data ?? []) as DirectBooking[];
  },

  async getKv(key: string): Promise<string | null> {
    if (!sb) return memKv.get(key) ?? null;
    const { data, error } = await sb.from("joybot_kv").select("value").eq("key", key).maybeSingle();
    if (error) throw error;
    return (data?.value as string) ?? null;
  },

  async setKv(key: string, value: string): Promise<void> {
    if (!sb) return void memKv.set(key, value);
    const { error } = await sb.from("joybot_kv").upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
  },

  async codeExists(code: string): Promise<boolean> {
    return (await this.getBooking(code)) !== null;
  },
};
