import type { ReadingPath, ReadingPathStep } from '@repolens/shared';
import type { Db } from './client.js';

function asJson(value: unknown): Parameters<Db['json']>[0] {
  return value as Parameters<Db['json']>[0];
}

/**
 * เส้นทางอ่านโค้ดสำหรับคนใหม่ — เก็บไว้แค่ชุดล่าสุดต่อผู้ใช้หนึ่งคนต่องานวิเคราะห์หนึ่งงาน
 * สั่งใหม่ได้เสมอเมื่ออยากได้ชุดที่สดกว่าเดิม (เช่น หลังสรุป repo ด้วย AI แล้วในภายหลัง)
 */
export async function saveReadingPath(
  sql: Db,
  input: {
    analysisId: string;
    userId: string;
    steps: ReadingPathStep[];
    model: string | null;
    inputTokens: number;
    outputTokens: number;
  },
): Promise<void> {
  await sql`
    insert into reading_paths ${sql({
      analysis_id: input.analysisId,
      user_id: input.userId,
      steps: sql.json(asJson(input.steps)),
      model: input.model,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
    })}
    on conflict (analysis_id, user_id) do update
    set steps = excluded.steps,
        model = excluded.model,
        input_tokens = excluded.input_tokens,
        output_tokens = excluded.output_tokens,
        created_at = now()
  `;
}

export async function getReadingPath(
  sql: Db,
  analysisId: string,
  userId: string,
): Promise<ReadingPath | null> {
  const rows = await sql<{ steps: ReadingPathStep[]; model: string | null; created_at: Date }[]>`
    select steps, model, created_at
    from reading_paths
    where analysis_id = ${analysisId} and user_id = ${userId}
    limit 1
  `;

  const row = rows[0];
  if (!row) return null;
  return { steps: row.steps, model: row.model, createdAt: row.created_at.toISOString() };
}
