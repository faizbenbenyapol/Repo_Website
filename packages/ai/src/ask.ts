import { QA_MODEL, type Citation, type Claim } from '@repolens/shared';
import { askClaude, type AskOptions, type AskReply, type AskRequest } from './anthropic.js';
import { extractJson, groundClaims, makeVerifier, type FileFact } from './grounding.js';
import { buildQaPrompt, QA_SYSTEM_PROMPT, type EvidenceItem } from './prompts.js';

/**
 * ถาม–ตอบกับ repo
 *
 * โมเดลเห็นเฉพาะหลักฐานที่ค้นมาให้เท่านั้น ไม่เห็นซอร์สทั้ง repo และไม่มีทางอ่านไฟล์เพิ่มเอง
 * เพราะการกลับไปโคลนซอร์สทุกครั้งที่มีคนถามคำถามช้าเกินกว่าจะเป็นบทสนทนา
 * คำตอบที่ได้จึงแม่นเท่ากับหลักฐานที่ค้นเจอ — ถ้าค้นไม่เจออะไรตรงคำถาม ต้องบอกตรง ๆ ว่าไม่รู้
 * ไม่ใช่เดาจากความรู้ทั่วไปเกี่ยวกับโค้ดที่หน้าตาคล้ายกัน
 */

export interface AskDeps {
  ask?: (request: AskRequest, options?: AskOptions) => Promise<AskReply>;
}

export interface AskOptionsInput {
  apiKey: string;
  question: string;
  evidence: EvidenceItem[];
  history: { question: string; answer: string }[];
  digest: string | null;
  /** ไฟล์ทั้งหมดของงานวิเคราะห์นี้ ใช้ตรวจว่าอ้างอิงที่โมเดลให้มาชี้ไปยังบรรทัดที่มีอยู่จริง */
  files: FileFact[];
  askOptions?: AskOptions;
}

export interface AskResult {
  claims: Claim[];
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export async function answerQuestion(
  options: AskOptionsInput,
  deps: AskDeps = {},
): Promise<AskResult> {
  const ask = deps.ask ?? askClaude;
  const verify = makeVerifier(options.files);

  const reply = await ask(
    {
      apiKey: options.apiKey,
      model: QA_MODEL,
      system: QA_SYSTEM_PROMPT,
      maxTokens: 900,
      prefill: '{',
      prompt: buildQaPrompt({
        question: options.question,
        history: options.history,
        evidence: options.evidence,
        digest: options.digest,
      }),
    },
    options.askOptions,
  );

  const parsed = extractJson(reply.text) as { claims?: unknown } | null;
  const claims: Claim[] = parsed ? groundClaims(parsed.claims, verify, null, 6) : [];

  return {
    claims,
    model: QA_MODEL,
    inputTokens: reply.inputTokens,
    outputTokens: reply.outputTokens,
  };
}

/** ย่อคำตอบก่อนหน้าให้เป็นประโยคเดียวสั้น ๆ สำหรับใส่ในบริบทบทสนทนาของคำถามถัดไป */
export function summarizeAnswer(claims: Claim[]): string {
  if (claims.length === 0) return 'ไม่พบคำตอบที่มีอ้างอิงรองรับ';
  return claims.map((claim) => claim.text).join(' ');
}

export type { Citation };
