-- Chạy 1 lần trong Supabase → SQL Editor (project đang dùng cho Autopilot)
create table if not exists joybot_sessions (
  id               text primary key,          -- "<channel>:<userId>"
  channel          text not null,
  channel_user_id  text not null,
  messages         jsonb not null default '[]',
  handoff          boolean not null default false,
  updated_at       timestamptz not null default now()
);

create table if not exists joybot_bookings (
  code             text primary key,          -- vd JOY4821 — cũng là nội dung chuyển khoản
  pms_booking_id   text not null,
  channel          text not null,
  channel_user_id  text not null,
  room_id          text not null,
  room_name        text not null,
  guest_name       text not null,
  guest_phone      text,
  check_in         date not null,
  check_out        date not null,
  nights           int not null,
  total            bigint not null,
  deposit          bigint not null,
  balance          bigint not null,
  status           text not null default 'HOLD', -- HOLD | DEPOSIT_PAID | EXPIRED | CANCELLED
  hold_until       timestamptz not null,
  paid_amount      bigint not null default 0,
  paid_at          timestamptz,
  payment_ref      text,
  created_at       timestamptz not null default now()
);

create index if not exists joybot_bookings_status_idx on joybot_bookings (status, hold_until);

-- Chỉ backend (service key) được đọc/ghi
alter table joybot_sessions enable row level security;
alter table joybot_bookings enable row level security;

-- Lưu token có xoay vòng (Zalo refresh_token đổi mỗi lần làm mới)
create table if not exists joybot_kv (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table joybot_kv enable row level security;
