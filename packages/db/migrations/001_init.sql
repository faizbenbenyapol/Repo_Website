-- โครงตารางเริ่มต้นของ RepoLens
-- ผลวิเคราะห์หนึ่งครั้งผูกกับคอมมิตหนึ่งค่าเสมอ จึงแคชและเทียบย้อนหลังได้

create table if not exists repos (
  id          bigserial primary key,
  host        text not null,
  owner       text not null,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (host, owner, name)
);

create table if not exists analyses (
  id               uuid primary key default gen_random_uuid(),
  repo_id          bigint not null references repos (id) on delete cascade,
  requested_input  text not null,
  status           text not null check (status in ('queued', 'running', 'done', 'failed')),
  stage            text,
  percent          int not null default 0,
  message          text,
  commit_sha       text,
  branch           text,
  totals           jsonb,
  engines          jsonb,
  external         jsonb,
  warnings         jsonb,
  error            text,
  analyzer_schema  int not null,
  app_version      text,
  duration_ms      int,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz
);

create index if not exists analyses_repo_idx on analyses (repo_id, created_at desc);
create index if not exists analyses_status_idx on analyses (status);

create table if not exists files (
  id           bigserial primary key,
  analysis_id  uuid not null references analyses (id) on delete cascade,
  path         text not null,
  language     text,
  bytes        bigint not null default 0,
  loc          int not null default 0,
  hash         text,
  parsed       boolean not null default false,
  skip_reason  text,
  dependents   int not null default 0,
  unique (analysis_id, path)
);

create index if not exists files_analysis_idx on files (analysis_id, dependents desc);

create table if not exists edges (
  id           bigserial primary key,
  analysis_id  uuid not null references analyses (id) on delete cascade,
  src          text not null,
  dst          text not null,
  kind         text not null,
  line         int not null default 0,
  confidence   real not null default 1
);

create index if not exists edges_analysis_src_idx on edges (analysis_id, src);
create index if not exists edges_analysis_dst_idx on edges (analysis_id, dst);

create table if not exists symbols (
  id           bigserial primary key,
  analysis_id  uuid not null references analyses (id) on delete cascade,
  path         text not null,
  name         text not null,
  kind         text not null,
  line         int not null default 0
);

create index if not exists symbols_analysis_path_idx on symbols (analysis_id, path);
