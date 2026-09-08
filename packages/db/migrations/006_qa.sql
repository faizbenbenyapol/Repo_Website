-- ถาม-ตอบกับ repo และเส้นทางอ่านโค้ดสำหรับคนใหม่ ของ v0.6.0
-- ทั้งสองฟีเจอร์ผูกกับผู้ใช้ที่จ่ายค่าเรียกใช้โมเดล เช่นเดียวกับตาราง summaries ใน v0.5.0

create table if not exists qa_messages (
  id             uuid primary key default gen_random_uuid(),
  analysis_id    uuid not null references analyses (id) on delete cascade,
  user_id        uuid not null references users (id) on delete cascade,
  question       text not null,
  -- ข้อความที่ผ่านการตรวจอ้างอิงแล้วเท่านั้น ข้อไหนชี้บรรทัดจริงไม่ได้ถูกตัดไปก่อนถึงตรงนี้
  claims         jsonb not null default '[]'::jsonb,
  model          text,
  input_tokens   int not null default 0,
  output_tokens  int not null default 0,
  created_at     timestamptz not null default now()
);

-- ประวัติคำถามเรียงตามเวลาต่อหนึ่งคู่ analysis+user คือหนึ่งบทสนทนาต่อเนื่อง
create index if not exists qa_messages_thread_idx on qa_messages (analysis_id, user_id, created_at);

create table if not exists reading_paths (
  id             uuid primary key default gen_random_uuid(),
  analysis_id    uuid not null references analyses (id) on delete cascade,
  user_id        uuid not null references users (id) on delete cascade,
  -- รายการขั้นตอนเรียงตามลำดับที่ควรอ่าน แต่ละขั้นมี path, ทำไมต้องอ่าน, สิ่งที่ควรสังเกต, และอ้างอิง
  steps          jsonb not null,
  model          text,
  input_tokens   int not null default 0,
  output_tokens  int not null default 0,
  created_at     timestamptz not null default now(),
  -- สั่งใหม่ได้เสมอ แต่เก็บไว้แค่ชุดล่าสุดต่อผู้ใช้หนึ่งคนต่องานวิเคราะห์หนึ่งงาน
  unique (analysis_id, user_id)
);
