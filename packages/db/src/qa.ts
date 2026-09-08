import type { Claim, QaMessage } from '@repolens/shared';
import type { Db } from './client.js';

function asJson(value: unknown): Parameters<Db['json']>[0] {
  return value as Parameters<Db['json']>[0];
}

interface QaDbRow {
  id: string;
  analysis_id: string;
  question: string;
  claims: Claim[] | null;
  model: string | null;
  created_at: Date;
}

function toMessage(row: QaDbRow): QaMessage {
  return {
    id: row.id,
    analysisId: row.analysis_id,
    question: row.question,
    claims: row.claims ?? [],
    model: row.model,
    createdAt: row.created_at.toISOString(),
  };
}

export async function saveQaMessage(
  sql: Db,
  input: {
    analysisId: string;
    userId: string;
    question: string;
    claims: Claim[];
    model: string | null;
    inputTokens: number;
    outputTokens: number;
  },
): Promise<QaMessage> {
  const rows = await sql<QaDbRow[]>`
    insert into qa_messages ${sql({
      analysis_id: input.analysisId,
      user_id: input.userId,
      question: input.question,
      claims: sql.json(asJson(input.claims)),
      model: input.model,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
    })}
    returning id, analysis_id, question, claims, model, created_at
  `;

  const row = rows[0];
  if (!row) throw new Error('บันทึกคำถามไม่สำเร็จ');
  return toMessage(row);
}

/** ประวัติคำถามของผู้ใช้คนนี้กับงานวิเคราะห์นี้ เรียงเก่าไปใหม่เหมือนอ่านบทสนทนาต่อกัน */
export async function listQaMessages(
  sql: Db,
  analysisId: string,
  userId: string,
  limit = 50,
): Promise<QaMessage[]> {
  const rows = await sql<QaDbRow[]>`
    select id, analysis_id, question, claims, model, created_at
    from qa_messages
    where analysis_id = ${analysisId} and user_id = ${userId}
    order by created_at asc
    limit ${Math.min(limit, 200)}
  `;
  return rows.map(toMessage);
}

/** คำถามล่าสุดไม่กี่ข้อ ใช้เป็นบริบทบทสนทนาต่อเนื่องเวลาถามคำถามใหม่ */
export async function recentQaMessages(
  sql: Db,
  analysisId: string,
  userId: string,
  count = 3,
): Promise<QaMessage[]> {
  const rows = await sql<QaDbRow[]>`
    select id, analysis_id, question, claims, model, created_at
    from qa_messages
    where analysis_id = ${analysisId} and user_id = ${userId}
    order by created_at desc
    limit ${count}
  `;
  return rows.map(toMessage).reverse();
}
