-- ชั้นความเข้าใจของ v0.5.0
--
-- ผลวิเคราะห์เชิงโครงสร้างใช้ร่วมกันได้ทุกคน แต่คำอธิบายจากโมเดลผูกกับผู้ใช้ที่จ่ายค่าเรียกใช้
-- ทุกแถวจึงมีทั้ง analysis_id และ user_id เสมอ

create table if not exists comprehensions (
  id             uuid primary key default gen_random_uuid(),
  analysis_id    uuid not null references analyses (id) on delete cascade,
  user_id        uuid not null references users (id) on delete cascade,
  status         text not null check (status in ('queued', 'running', 'done', 'failed')),
  stage          text,
  percent        int not null default 0,
  message        text,
  files_done     int not null default 0,
  files_total    int not null default 0,
  input_tokens   int not null default 0,
  output_tokens  int not null default 0,
  commit_sha     text,
  error          text,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz
);

create index if not exists comprehensions_lookup_idx
  on comprehensions (analysis_id, user_id, created_at desc);

create table if not exists summaries (
  id                bigserial primary key,
  comprehension_id  uuid not null references comprehensions (id) on delete cascade,
  analysis_id       uuid not null references analyses (id) on delete cascade,
  user_id           uuid not null references users (id) on delete cascade,
  scope             text not null check (scope in ('file', 'module', 'repo')),
  -- พาธของไฟล์ พาธของโฟลเดอร์ หรือค่าว่างเมื่อเป็นภาพรวมทั้ง repo
  key               text not null,
  headline          text not null,
  -- ข้อความพร้อมบรรทัดอ้างอิงที่ตรวจแล้วว่ามีอยู่จริง
  points            jsonb not null default '[]'::jsonb,
  -- รายละเอียดเพิ่มเติมเฉพาะภาพรวมทั้ง repo (stack, จุดเริ่ม, วิธีรัน, ข้อสังเกต)
  detail            jsonb,
  source            text not null check (source in ('model', 'analyzer')),
  model             text,
  created_at        timestamptz not null default now(),
  unique (comprehension_id, scope, key)
);

create index if not exists summaries_lookup_idx
  on summaries (analysis_id, user_id, scope, key);
