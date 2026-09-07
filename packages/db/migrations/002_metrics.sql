-- ตัวชี้วัดของ v0.4.0
-- ข้อมูลรายไฟล์ที่มาจากประวัติ git และจากกราฟ เก็บไว้กับไฟล์เลย เพื่อให้จัดอันดับได้โดยไม่ต้องคำนวณซ้ำ

alter table files add column if not exists churn int not null default 0;
alter table files add column if not exists blast int not null default 0;
alter table files add column if not exists authors jsonb;
alter table files add column if not exists last_commit_at timestamptz;

create index if not exists files_churn_idx on files (analysis_id, churn desc);
create index if not exists files_blast_idx on files (analysis_id, blast desc);

alter table analyses add column if not exists metrics jsonb;

create table if not exists findings (
  id           bigserial primary key,
  analysis_id  uuid not null references analyses (id) on delete cascade,
  path         text not null,
  line         int not null default 0,
  rule         text not null,
  severity     text not null check (severity in ('high', 'medium', 'low')),
  message      text not null,
  snippet      text
);

create index if not exists findings_analysis_idx on findings (analysis_id, severity);
