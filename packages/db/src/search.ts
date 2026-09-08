import type { Db } from './client.js';

/**
 * ค้นคืนบริบทด้วย pg_trgm — จับคู่คำถามกับชื่อไฟล์ ชื่อฟังก์ชัน และข้อความสรุปที่มีอยู่แล้ว
 *
 * เลือกวิธีนี้แทนตัวฝังเวกเตอร์ เพราะสิ่งที่ต้องค้นเป็นข้อความสั้น ๆ ที่ตรงตัวอักษรกันได้ระดับหนึ่งอยู่แล้ว
 * (ชื่อไฟล์ ชื่อฟังก์ชัน หัวข้อสรุป) ไม่ใช่ประโยคยาวที่ต้องเข้าใจความหมายเพื่อจับคู่
 * pg_trgm มากับ Postgres อยู่แล้วโดยไม่ต้องเพิ่มคอนเทนเนอร์โมเดลฝังเวกเตอร์
 */

export interface Evidence {
  kind: 'symbol' | 'file' | 'point';
  path: string;
  line: number;
  text: string;
  score: number;
}

const MIN_SCORE = 0.1;

async function searchSymbols(sql: Db, analysisId: string, query: string): Promise<Evidence[]> {
  const rows = await sql<
    { path: string; name: string; kind: string; line: number; score: number }[]
  >`
    select path, name, kind, line, similarity(name, ${query}) as score
    from symbols
    where analysis_id = ${analysisId} and similarity(name, ${query}) > ${MIN_SCORE}
    order by score desc
    limit 20
  `;
  return rows.map((row) => ({
    kind: 'symbol',
    path: row.path,
    line: row.line,
    text: `${row.kind} ${row.name}`,
    score: Number(row.score),
  }));
}

async function searchFiles(sql: Db, analysisId: string, query: string): Promise<Evidence[]> {
  const rows = await sql<{ path: string; score: number }[]>`
    select path, similarity(path, ${query}) as score
    from files
    where analysis_id = ${analysisId} and similarity(path, ${query}) > ${MIN_SCORE}
    order by score desc
    limit 15
  `;
  return rows.map((row) => ({
    kind: 'file',
    path: row.path,
    line: 1,
    text: row.path,
    score: Number(row.score),
  }));
}

/**
 * ค้นในข้อความสรุปที่ทำไว้แล้วจากชั้นความเข้าใจของ v0.5.0 — ผูกกับผู้ใช้คนเดียวกันเท่านั้น
 * เพราะคำอธิบายจากโมเดลผูกกับคนที่จ่ายค่าเรียกใช้ ไม่ใช่ของที่แชร์กันได้เหมือนผลวิเคราะห์เชิงโครงสร้าง
 */
async function searchSummaryPoints(
  sql: Db,
  analysisId: string,
  userId: string,
  query: string,
): Promise<Evidence[]> {
  const rows = await sql<{ path: string; text: string; line: number | null; score: number }[]>`
    select s.key as path,
           elem ->> 'text' as text,
           (elem -> 'citations' -> 0 ->> 'line')::int as line,
           similarity(elem ->> 'text', ${query}) as score
    from summaries s, jsonb_array_elements(s.points) as elem
    where s.analysis_id = ${analysisId} and s.user_id = ${userId}
      and s.scope in ('file', 'module')
      and similarity(elem ->> 'text', ${query}) > ${MIN_SCORE}
    order by score desc
    limit 15
  `;
  return rows
    .filter((row) => row.line !== null)
    .map((row) => ({
      kind: 'point',
      path: row.path,
      line: row.line as number,
      text: row.text,
      score: Number(row.score),
    }));
}

/**
 * รวมผลจากทั้งสามแหล่ง เรียงตามคะแนน — ไม่มีผลตรงเลยคืนรายการว่าง
 * ผู้เรียกต้องมีทางเลือกสำรอง (เช่น ไฟล์ที่ถูกพึ่งพามากที่สุด) เมื่อค้นไม่เจออะไรตรงคำถามเลย
 */
export async function searchEvidence(
  sql: Db,
  analysisId: string,
  userId: string | null,
  query: string,
  limit = 20,
): Promise<Evidence[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const [symbols, files, points] = await Promise.all([
    searchSymbols(sql, analysisId, trimmed),
    searchFiles(sql, analysisId, trimmed),
    userId ? searchSummaryPoints(sql, analysisId, userId, trimmed) : Promise.resolve([]),
  ]);

  return [...symbols, ...files, ...points].sort((a, b) => b.score - a.score).slice(0, limit);
}
