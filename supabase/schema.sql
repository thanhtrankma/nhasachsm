-- SạchPro schema. Chạy 1 lần trong Supabase → SQL Editor (chạy lại nhiều lần cũng an toàn).
-- Mọi đọc/ghi đi qua API trên Vercel bằng secret key, nên RLS được bật và KHÔNG có policy công khai:
-- publishable/anon key không đọc hay ghi được bảng nào.

-- Nội dung website + mật khẩu admin (key/value)
create table if not exists site_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Bản sao lưu nội dung (giữ 30 bản mới nhất, API tự dọn)
create table if not exists content_backups (
  id bigint generated always as identity primary key,
  content jsonb not null,
  created_at timestamptz not null default now()
);

-- Đơn đặt lịch
create table if not exists bookings (
  id text primary key,
  created_at timestamptz not null default now(),
  status text not null default 'new'
    check (status in ('new', 'contacted', 'confirmed', 'done', 'cancelled')),
  type text not null check (type in ('survey', 'combo')),
  name text not null,
  phone text not null,
  address text not null,
  date text not null default '',
  slot text not null default '',
  note text not null default '',
  admin_note text not null default '',
  service text,
  items jsonb,
  total bigint,
  original bigint
);
create index if not exists bookings_created_idx on bookings (created_at desc);
create index if not exists bookings_status_idx on bookings (status);

-- Giới hạn số lần đăng nhập sai / gửi đơn theo IP
create table if not exists rate_limits (
  key text primary key,
  count int not null default 0,
  reset_at timestamptz not null
);

create or replace function hit_rate_limit(p_key text, p_window_seconds int)
returns int
language plpgsql
set search_path = public
as $$
declare n int;
begin
  insert into rate_limits as r (key, count, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key) do update set
    count    = case when r.reset_at < now() then 1 else r.count + 1 end,
    reset_at = case when r.reset_at < now() then now() + make_interval(secs => p_window_seconds) else r.reset_at end
  returning count into n;
  return n;
end $$;
revoke execute on function hit_rate_limit(text, int) from public, anon, authenticated;
grant execute on function hit_rate_limit(text, int) to service_role;

alter table site_settings   enable row level security;
alter table content_backups enable row level security;
alter table bookings        enable row level security;
alter table rate_limits     enable row level security;

-- Bucket ảnh công khai (ảnh upload từ trang admin)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
