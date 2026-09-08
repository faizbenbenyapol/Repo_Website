-- วิเคราะห์ซ้ำแบบ incremental ของ v0.7.0
--
-- เก็บแพ็กเกจภายนอกที่แต่ละไฟล์เรียกใช้แยกจากสรุปรวมใน analyses.external
-- เพราะตอนวิเคราะห์ซ้ำ ไฟล์ที่เนื้อหาไม่เปลี่ยนจะไม่ถูกพาร์สใหม่ (ข้าม tree-sitter ทั้งไฟล์)
-- ถ้าไม่มีตารางนี้ สรุปรวมของรอบใหม่จะขาดการนับจากไฟล์ที่ถูกข้ามไปทั้งหมด

create table if not exists file_externals (
  id           bigserial primary key,
  analysis_id  uuid not null references analyses (id) on delete cascade,
  path         text not null,
  specifier    text not null,
  count        int not null default 1
);

create index if not exists file_externals_analysis_idx on file_externals (analysis_id, path);
