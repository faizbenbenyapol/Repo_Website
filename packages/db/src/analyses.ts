import type { AnalysisResult, RepoRef, Stage } from '@repolens/analyzer';
import { countDependents } from '@repolens/analyzer';
import type { Db } from './client.js';

/**
 * postgres.js นิยาม JSONValue ให้รับเฉพาะรูปทรงที่มี index signature
 * โครงสร้างของเราเป็น interface ที่ระบุฟิลด์ชัดเจน จึงต้องแปลงชนิดตรงนี้ที่เดียว
 * แทนที่จะไปคลาย type ของโดเมนให้หลวมลงทั้งระบบ
 */
function asJson(value: unknown): Parameters<Db['json']>[0] {
  return value as Parameters<Db['json']>[0];
}

export type AnalysisStatus = 'queued' | 'running' | 'done' | 'failed';

export interface AnalysisRow {
  id: string;
  status: AnalysisStatus;
  stage: Stage | null;
  percent: number;
  message: string | null;
  requestedInput: string;
  host: string;
  owner: string;
  name: string;
  commitSha: string | null;
  branch: string | null;
  totals: AnalysisResult['totals'] | null;
  engines: AnalysisResult['engines'] | null;
  external: AnalysisResult['external'] | null;
  warnings: string[] | null;
  error: string | null;
  analyzerSchema: number;
  appVersion: string | null;
  durationMs: number | null;
  createdAt: string;
  finishedAt: string | null;
}

interface AnalysisDbRow {
  id: string;
  status: AnalysisStatus;
  stage: Stage | null;
  percent: number;
  message: string | null;
  requested_input: string;
  host: string;
  owner: string;
  name: string;
  commit_sha: string | null;
  branch: string | null;
  totals: AnalysisResult['totals'] | null;
  engines: AnalysisResult['engines'] | null;
  external: AnalysisResult['external'] | null;
  warnings: string[] | null;
  error: string | null;
  analyzer_schema: number;
  app_version: string | null;
  duration_ms: number | null;
  created_at: Date;
  finished_at: Date | null;
}

function toRow(row: AnalysisDbRow): AnalysisRow {
  return {
    id: row.id,
    status: row.status,
    stage: row.stage,
    percent: row.percent,
    message: row.message,
    requestedInput: row.requested_input,
    host: row.host,
    owner: row.owner,
    name: row.name,
    commitSha: row.commit_sha,
    branch: row.branch,
    totals: row.totals,
    engines: row.engines,
    external: row.external,
    warnings: row.warnings,
    error: row.error,
    analyzerSchema: row.analyzer_schema,
    appVersion: row.app_version,
    durationMs: row.duration_ms,
    createdAt: row.created_at.toISOString(),
    finishedAt: row.finished_at?.toISOString() ?? null,
  };
}

const SELECT_ANALYSIS = `
  select a.id, a.status, a.stage, a.percent, a.message, a.requested_input,
         r.host, r.owner, r.name,
         a.commit_sha, a.branch, a.totals, a.engines, a.external, a.warnings,
         a.error, a.analyzer_schema, a.app_version, a.duration_ms,
         a.created_at, a.finished_at
  from analyses a
  join repos r on r.id = a.repo_id
`;

export async function upsertRepo(sql: Db, ref: RepoRef): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    insert into repos ${sql({ host: ref.host, owner: ref.owner, name: ref.name })}
    on conflict (host, owner, name) do update set name = excluded.name
    returning id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('บันทึกข้อมูล repo ไม่สำเร็จ');
  return id;
}

export async function createAnalysis(
  sql: Db,
  input: { ref: RepoRef; requestedInput: string; analyzerSchema: number; appVersion: string },
): Promise<string> {
  const repoId = await upsertRepo(sql, input.ref);
  const rows = await sql<{ id: string }[]>`
    insert into analyses ${sql({
      repo_id: repoId,
      requested_input: input.requestedInput,
      status: 'queued',
      percent: 0,
      message: 'เข้าคิวรอวิเคราะห์',
      analyzer_schema: input.analyzerSchema,
      app_version: input.appVersion,
    })}
    returning id
  `;
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('สร้างงานวิเคราะห์ไม่สำเร็จ');
  return id;
}

export async function updateProgress(
  sql: Db,
  id: string,
  progress: { stage: Stage; percent: number; message: string },
): Promise<void> {
  await sql`
    update analyses
    set status = 'running',
        stage = ${progress.stage},
        percent = ${progress.percent},
        message = ${progress.message},
        started_at = coalesce(started_at, now())
    where id = ${id}
  `;
}

export async function markFailed(sql: Db, id: string, message: string): Promise<void> {
  await sql`
    update analyses
    set status = 'failed', error = ${message}, message = ${message}, finished_at = now()
    where id = ${id}
  `;
}

/** เขียนผลวิเคราะห์ทั้งก้อนในธุรกรรมเดียว จะได้ไม่มีสถานะครึ่ง ๆ กลาง ๆ ให้ผู้ใช้เห็น */
export async function saveResult(sql: Db, id: string, result: AnalysisResult): Promise<void> {
  const dependents = countDependents(result.edges);

  await sql.begin(async (tx) => {
    await tx`delete from files where analysis_id = ${id}`;
    await tx`delete from edges where analysis_id = ${id}`;
    await tx`delete from symbols where analysis_id = ${id}`;

    const fileRows = result.files.map((file) => ({
      analysis_id: id,
      path: file.path,
      language: file.language,
      bytes: file.bytes,
      loc: file.loc,
      hash: file.hash,
      parsed: file.parsed,
      skip_reason: file.skipReason,
      dependents: dependents.get(file.path) ?? 0,
    }));

    for (let i = 0; i < fileRows.length; i += 500) {
      await tx`insert into files ${tx(fileRows.slice(i, i + 500))}`;
    }

    const edgeRows = result.edges.map((edge) => ({
      analysis_id: id,
      src: edge.from,
      dst: edge.to,
      kind: edge.kind,
      line: edge.line,
      confidence: edge.confidence,
    }));

    for (let i = 0; i < edgeRows.length; i += 500) {
      await tx`insert into edges ${tx(edgeRows.slice(i, i + 500))}`;
    }

    const symbolRows = result.symbols.map((symbol) => ({
      analysis_id: id,
      path: symbol.path,
      name: symbol.name,
      kind: symbol.kind,
      line: symbol.line,
    }));

    for (let i = 0; i < symbolRows.length; i += 500) {
      await tx`insert into symbols ${tx(symbolRows.slice(i, i + 500))}`;
    }

    await tx`
      update analyses
      set status = 'done',
          stage = 'publish',
          percent = 100,
          message = 'วิเคราะห์เสร็จแล้ว',
          commit_sha = ${result.commitSha},
          branch = ${result.branch},
          totals = ${tx.json(asJson(result.totals))},
          engines = ${tx.json(asJson(result.engines))},
          external = ${tx.json(asJson(result.external.slice(0, 100)))},
          warnings = ${tx.json(asJson(result.warnings))},
          duration_ms = ${result.durationMs},
          error = null,
          finished_at = now()
      where id = ${id}
    `;
  });
}

export async function getAnalysis(sql: Db, id: string): Promise<AnalysisRow | null> {
  const rows = await sql.unsafe<AnalysisDbRow[]>(`${SELECT_ANALYSIS} where a.id = $1`, [id]);
  const row = rows[0];
  return row ? toRow(row) : null;
}

/** ผลวิเคราะห์ล่าสุดที่สำเร็จของคอมมิตเดียวกัน — ใช้ตอบทันทีแทนการวิเคราะห์ซ้ำ */
export async function findCachedAnalysis(
  sql: Db,
  ref: RepoRef,
  analyzerSchema: number,
): Promise<AnalysisRow | null> {
  const rows = await sql.unsafe<AnalysisDbRow[]>(
    `${SELECT_ANALYSIS}
     where r.host = $1 and r.owner = $2 and r.name = $3
       and a.status = 'done' and a.analyzer_schema = $4
     order by a.finished_at desc
     limit 1`,
    [ref.host, ref.owner, ref.name, analyzerSchema],
  );
  const row = rows[0];
  return row ? toRow(row) : null;
}

export interface FileRow {
  path: string;
  language: string | null;
  loc: number;
  bytes: number;
  parsed: boolean;
  skipReason: string | null;
  dependents: number;
}

export async function getFiles(
  sql: Db,
  id: string,
  options: { limit?: number; orderBy?: 'path' | 'dependents' } = {},
): Promise<FileRow[]> {
  const limit = Math.min(options.limit ?? 500, 5000);
  const rows =
    options.orderBy === 'dependents'
      ? await sql<
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
          from files where analysis_id = ${id}
          order by dependents desc, path asc limit ${limit}
        `
      : await sql<
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
          from files where analysis_id = ${id}
          order by path asc limit ${limit}
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

export interface EdgeRow {
  src: string;
  dst: string;
  kind: string;
  line: number;
  confidence: number;
}

export async function getEdges(sql: Db, id: string, limit = 5000): Promise<EdgeRow[]> {
  const rows = await sql<EdgeRow[]>`
    select src, dst, kind, line, confidence
    from edges where analysis_id = ${id}
    order by src asc, dst asc
    limit ${Math.min(limit, 20_000)}
  `;
  return rows.map((row) => ({ ...row, confidence: Number(row.confidence) }));
}

export async function countSymbols(sql: Db, id: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count from symbols where analysis_id = ${id}
  `;
  return Number(rows[0]?.count ?? 0);
}

export interface GraphNode {
  path: string;
  language: string | null;
  loc: number;
  /** จำนวนไฟล์ที่พึ่งพาไฟล์นี้ */
  dependents: number;
  /** จำนวนไฟล์ที่ไฟล์นี้พึ่งพา */
  dependencies: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: { src: string; dst: string; confidence: number }[];
  /** true เมื่อ repo ใหญ่เกินขีดจำกัด จึงส่งมาเฉพาะไฟล์ที่สำคัญที่สุด */
  truncated: boolean;
  totalNodes: number;
}

/**
 * ข้อมูลสำหรับวาดกราฟ
 *
 * repo ใหญ่มีไฟล์เป็นหมื่น การส่งทั้งหมดไปวาดพร้อมกันทำให้เบราว์เซอร์ค้าง
 * จึงตัดเอาเฉพาะไฟล์ที่มีความสัมพันธ์มากที่สุดตามจำนวนที่กำหนด แล้วบอกผู้ใช้ตรง ๆ ว่าตัดมา
 * และเก็บเฉพาะเส้นที่ปลายทั้งสองข้างยังอยู่ในชุดที่ส่งไป จะได้ไม่มีเส้นลอยไปหาโหนดที่ไม่มีอยู่
 */
export async function getGraph(sql: Db, id: string, limit = 3000): Promise<GraphData> {
  const capped = Math.min(Math.max(limit, 1), 20_000);

  const totals = await sql<{ count: string }[]>`
    select count(*)::text as count from files where analysis_id = ${id}
  `;
  const totalNodes = Number(totals[0]?.count ?? 0);

  const rows = await sql<
    {
      path: string;
      language: string | null;
      loc: number;
      dependents: number;
      dependencies: string;
    }[]
  >`
    select f.path,
           f.language,
           f.loc,
           f.dependents,
           (select count(*) from edges e where e.analysis_id = f.analysis_id and e.src = f.path)::text
             as dependencies
    from files f
    where f.analysis_id = ${id}
    order by f.dependents desc, f.loc desc, f.path asc
    limit ${capped}
  `;

  const nodes: GraphNode[] = rows.map((row) => ({
    path: row.path,
    language: row.language,
    loc: row.loc,
    dependents: row.dependents,
    dependencies: Number(row.dependencies),
  }));

  const visible = new Set(nodes.map((node) => node.path));
  const allEdges = await sql<{ src: string; dst: string; confidence: number }[]>`
    select src, dst, confidence from edges where analysis_id = ${id}
  `;

  const edges = allEdges
    .filter((edge) => visible.has(edge.src) && visible.has(edge.dst))
    .map((edge) => ({ src: edge.src, dst: edge.dst, confidence: Number(edge.confidence) }));

  return { nodes, edges, truncated: totalNodes > nodes.length, totalNodes };
}

export interface SymbolRow {
  name: string;
  kind: string;
  line: number;
}

/** ฟังก์ชันและคลาสในไฟล์เดียว เรียงตามลำดับที่ปรากฏในไฟล์ */
export async function getSymbols(sql: Db, id: string, path: string): Promise<SymbolRow[]> {
  return sql<SymbolRow[]>`
    select name, kind, line
    from symbols
    where analysis_id = ${id} and path = ${path}
    order by line asc
    limit 500
  `;
}

/** ไฟล์ที่พึ่งพาไฟล์นี้ และไฟล์ที่ไฟล์นี้พึ่งพา — ใช้ในแผงรายละเอียด */
export async function getNeighbours(
  sql: Db,
  id: string,
  path: string,
): Promise<{ dependents: string[]; dependencies: string[] }> {
  const [incoming, outgoing] = await Promise.all([
    sql<{ src: string }[]>`
      select distinct src from edges where analysis_id = ${id} and dst = ${path} order by src limit 200
    `,
    sql<{ dst: string }[]>`
      select distinct dst from edges where analysis_id = ${id} and src = ${path} order by dst limit 200
    `,
  ]);

  return {
    dependents: incoming.map((row) => row.src),
    dependencies: outgoing.map((row) => row.dst),
  };
}
