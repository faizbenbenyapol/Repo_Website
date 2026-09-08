-- บัญชีผู้ใช้และ session ของ v0.5.0
--
-- ตารางเหล่านี้ไม่มีคอลัมน์สำหรับ API key ของผู้ใช้ และตั้งใจให้ไม่มีตลอดไป
-- กุญแจของสมาชิกอยู่ในที่เก็บชั่วคราวที่มีวันหมดอายุเท่านั้น (ดู ADR 0002)
-- ฐานข้อมูลนี้ถูกสำรองลงดิสก์เป็นประจำ สิ่งที่ไม่ควรอยู่ในสำเนาสำรองจึงต้องไม่ถูกเขียนลงมาแต่แรก

create table if not exists users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  password_hash  text not null,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz
);

-- เทียบอีเมลแบบไม่สนตัวพิมพ์ เพราะคนเดียวกันพิมพ์อีเมลตัวเองไม่เหมือนกันทุกครั้ง
create unique index if not exists users_email_idx on users (lower(email));

create table if not exists sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  -- เก็บเฉพาะค่าที่ย่อแล้ว ถ้าฐานข้อมูลหลุด โทเค็นที่ยังไม่หมดอายุก็เอาไปสวมรอยไม่ได้
  token_hash    text not null unique,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null
);

create index if not exists sessions_user_idx on sessions (user_id, last_seen_at desc);
create index if not exists sessions_expiry_idx on sessions (expires_at);
