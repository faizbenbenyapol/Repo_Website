import type {
  Claim,
  ComprehensionRun,
  ComprehensionStage,
  ComprehensionStatus,
  FileSummary,
  ModuleSummary,
  RepoDigest,
  SummaryScope,
  SummarySource,
} from '@repolens/shared';
import type { Db } from './client.js';

function asJson(value: unknown): Parameters<Db['json']>[0] {
  return value as Parameters<Db['json']>[0];
}

interface ComprehensionDbRow {
  id: string;
  analysis_id: string;
  status: ComprehensionStatus;
  stage: ComprehensionStage | null;
  percent: number;
  message: string | null;
  files_done: number;
  files_total: number;
  input_tokens: number;
  output_tokens: number;
  commit_sha: string | null;
  error: string | null;
  created_at: Date;
  finished_at: Date | null;
}

function toRun(row: ComprehensionDbRow): ComprehensionRun {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    status: row.status,
    stage: row.stage,
    percent: row.percent,
    message: row.message,
    filesDone: row.files_done,
    filesTotal: row.files_total,
    coverage: row.files_total > 0 ? row.files_done / row.files_total : 0,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    commitSha: row.commit_sha,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
  };
}

const SELECT_RUN = `
  select id, analysis_id, status, stage, percent, message, files_done, files_total,
         input_tokens, output_tokens, commit_sha, error, created_at, finished_at
  from comprehensions
`;

export async function createComprehension(
  sql: Db,
  input: { analysisId: string; userId: string; filesTotal: number },
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into comprehensions ${sql({
      analysis_id: input.analysisId,
      user_id: input.userId,
      status: 'queued',
      percent: 0,
      message: 'เข้าคิวรอสรุป',
      files_total: input.filesTotal,
    })}
    returning id
  `;

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('สร้างงานสรุปไม่สำเร็จ');
  return id;
}

export async function getComprehension(sql: Db, id: string): Promise<ComprehensionRun | null> {
  const rows = await sql.unsafe<ComprehensionDbRow[]>(`${SELECT_RUN} where id = $1`, [id]);
  const row = rows[0];
  return row ? toRun(row) : null;
}

/** เจ้าของงานสรุป — ใช้ตรวจว่าคนที่ขอดูผลคือคนเดียวกับที่จ่ายค่าเรียกใช้โมเดล */
export async function getComprehensionOwner(sql: Db, id: string): Promise<string | null> {
  const rows = await sql<{ user_id: string }[]>`
    select user_id from comprehensions where id = ${id} limit 1
  `;
  return rows[0]?.user_id ?? null;
}

/** งานสรุปล่าสุดของผู้ใช้คนนี้กับงานวิเคราะห์นี้ */
export async function findLatestComprehension(
  sql: Db,
  analysisId: string,
  userId: string,
): Promise<ComprehensionRun | null> {
  const rows = await sql.unsafe<ComprehensionDbRow[]>(
    `${SELECT_RUN} where analysis_id = $1 and user_id = $2 order by created_at desc limit 1`,
    [analysisId, userId],
  );
  const row = rows[0];
  return row ? toRun(row) : null;
}

export async function updateComprehensionProgress(
  sql: Db,
  id: string,
  progress: {
    stage: ComprehensionStage;
    percent: number;
    message: string;
    filesDone?: number;
    commitSha?: string | null;
  },
): Promise<void> {
  await sql`
    update comprehensions
    set status = 'running',
        stage = ${progress.stage},
        percent = ${progress.percent},
        message = ${progress.message},
        files_done = coalesce(${progress.filesDone ?? null}, files_done),
        commit_sha = coalesce(${progress.commitSha ?? null}, commit_sha),
        started_at = coalesce(started_at, now())
    where id = ${id}
  `;
}

export async function markComprehensionFailed(sql: Db, id: string, message: string): Promise<void> {
  await sql`
    update comprehensions
    set status = 'failed', error = ${message}, message = ${message}, finished_at = now()
    where id = ${id}
  `;
}

export async function finishComprehension(
  sql: Db,
  id: string,
  totals: { inputTokens: number; outputTokens: number; filesDone: number },
): Promise<void> {
  await sql`
    update comprehensions
    set status = 'done',
        stage = 'publish',
        percent = 100,
        message = 'สรุปเสร็จแล้ว',
        files_done = ${totals.filesDone},
        input_tokens = ${totals.inputTokens},
        output_tokens = ${totals.outputTokens},
        error = null,
        finished_at = now()
    where id = ${id}
  `;
}

export interface SummaryInput {
  scope: SummaryScope;
  key: string;
  headline: string;
  points: Claim[];
  detail?: unknown;
  source: SummarySource;
  model: string | null;
}

/**
 * เขียนคำอธิบายเป็นชุด
 * เขียนทับของเดิมในงานสรุปเดียวกันได้ เพราะการลองใหม่บางไฟล์ไม่ควรทำให้ผลทั้งชุดเสีย
 */
export async function saveSummaries(
  sql: Db,
  owner: { comprehensionId: string; analysisId: string; userId: string },
  summaries: SummaryInput[],
): Promise<void> {
  if (summaries.length === 0) return;

  const rows = summaries.map((summary) => ({
    comprehension_id: owner.comprehensionId,
    analysis_id: owner.analysisId,
    user_id: owner.userId,
    scope: summary.scope,
    key: summary.key,
    headline: summary.headline,
    points: sql.json(asJson(summary.points)),
    detail: summary.detail === undefined ? null : sql.json(asJson(summary.detail)),
    source: summary.source,
    model: summary.model,
  }));

  for (let i = 0; i < rows.length; i += 200) {
    await sql`
      insert into summaries ${sql(rows.slice(i, i + 200))}
      on conflict (comprehension_id, scope, key) do update
      set headline = excluded.headline,
          points = excluded.points,
          detail = excluded.detail,
          source = excluded.source,
          model = excluded.model,
          created_at = now()
    `;
  }
}

interface SummaryDbRow {
  key: string;
  headline: string;
  points: Claim[] | null;
  source: SummarySource;
  model: string | null;
}

/** คำอธิบายของไฟล์เดียว จากงานสรุปล่าสุดของผู้ใช้คนนี้ */
export async function getFileSummary(
  sql: Db,
  analysisId: string,
  userId: string,
  path: string,
): Promise<FileSummary | null> {
  const rows = await sql<SummaryDbRow[]>`
    select s.key, s.headline, s.points, s.source, s.model
    from summaries s
    join comprehensions c on c.id = s.comprehension_id
    where s.analysis_id = ${analysisId} and s.user_id = ${userId}
      and s.scope = 'file' and s.key = ${path}
    order by c.created_at desc
    limit 1
  `;

  const row = rows[0];
  if (!row) return null;
  return {
    path: row.key,
    headline: row.headline,
    points: row.points ?? [],
    source: row.source,
    model: row.model,
  };
}

/** คำอธิบายรายโมดูลของงานสรุปที่เสร็จล่าสุด เรียงตามพาธเพื่อให้ไล่อ่านจากรากลงไปได้ */
export async function getModuleSummaries(
  sql: Db,
  analysisId: string,
  userId: string,
): Promise<ModuleSummary[]> {
  const rows = await sql<(SummaryDbRow & { detail: { fileCount?: number } | null })[]>`
    select s.key, s.headline, s.points, s.detail, s.source, s.model
    from summaries s
    where s.analysis_id = ${analysisId} and s.user_id = ${userId} and s.scope = 'module'
      and s.comprehension_id = (
        select s2.comprehension_id
        from summaries s2
        join comprehensions c on c.id = s2.comprehension_id
        where s2.analysis_id = ${analysisId} and s2.user_id = ${userId} and s2.scope = 'module'
        order by c.created_at desc
        limit 1
      )
    order by s.key asc
  `;

  return rows.map((row) => ({
    path: row.key,
    headline: row.headline,
    points: row.points ?? [],
    fileCount: row.detail?.fileCount ?? 0,
    source: row.source,
    model: row.model,
  }));
}

type DigestDetail = Pick<RepoDigest, 'purpose' | 'stack' | 'entrypoints' | 'howToRun' | 'notes'>;

export async function getRepoDigest(
  sql: Db,
  analysisId: string,
  userId: string,
): Promise<RepoDigest | null> {
  const rows = await sql<(SummaryDbRow & { detail: Partial<DigestDetail> | null })[]>`
    select s.key, s.headline, s.points, s.detail, s.source, s.model
    from summaries s
    join comprehensions c on c.id = s.comprehension_id
    where s.analysis_id = ${analysisId} and s.user_id = ${userId} and s.scope = 'repo'
    order by c.created_at desc
    limit 1
  `;

  const row = rows[0];
  if (!row) return null;
  const detail = row.detail ?? {};
  return {
    headline: row.headline,
    purpose: detail.purpose ?? row.points ?? [],
    stack: detail.stack ?? [],
    entrypoints: detail.entrypoints ?? [],
    howToRun: detail.howToRun ?? [],
    notes: detail.notes ?? [],
    model: row.model,
  };
}

/** จำนวนไฟล์ที่มีคำอธิบายแล้วในงานสรุปหนึ่งครั้ง — ใช้ตอบว่าครอบคลุมไฟล์ได้กี่เปอร์เซ็นต์ */
export async function countFileSummaries(sql: Db, comprehensionId: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count from summaries
    where comprehension_id = ${comprehensionId} and scope = 'file'
  `;
  return Number(rows[0]?.count ?? 0);
}

/** ไฟล์ทั้งหมดของงานวิเคราะห์ พร้อมสิ่งที่ต้องใช้ตัดสินใจว่าจะให้โมเดลอ่านไฟล์ไหนก่อน */
export interface FileForSummary {
  path: string;
  language: string | null;
  loc: number;
  bytes: number;
  parsed: boolean;
  skipReason: string | null;
  dependents: number;
}

export async function listFilesForSummary(sql: Db, analysisId: string): Promise<FileForSummary[]> {
  const rows = await sql<
    {
      path: string;
      language: string | null;
      loc: number;
      bytes: string;
      parsed: boolean;
      skip_reason: string | null;
      dependents: number;
    }[]
  >`
    select path, language, loc, bytes, parsed, skip_reason, dependents
    from files where analysis_id = ${analysisId}
    order by dependents desc, path asc
  `;

  return rows.map((row) => ({
    path: row.path,
    language: row.language,
    loc: row.loc,
    bytes: Number(row.bytes),
    parsed: row.parsed,
    skipReason: row.skip_reason,
    dependents: row.dependents,
  }));
}
