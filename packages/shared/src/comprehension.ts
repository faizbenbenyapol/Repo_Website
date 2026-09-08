import { z } from 'zod';

/**
 * ชั้นความเข้าใจ — คำอธิบายภาษาไทยที่ผูกกับบรรทัดจริงของโค้ด
 *
 * กติกาข้อเดียวที่ทั้งไปป์ไลน์ยึด: ข้อความที่อ้างอิงบรรทัดจริงไม่ได้ จะไม่ถูกแสดง
 * เพราะคำอธิบายที่ตรวจสอบย้อนกลับไม่ได้ ไม่ต่างอะไรกับการเดา และการเดาที่ดูน่าเชื่อ
 * อันตรายกว่าการไม่มีคำอธิบายเลย
 */

export const COMPREHENSION_STAGES = [
  'prepare',
  'fetch',
  'files',
  'modules',
  'repo',
  'publish',
] as const;

export type ComprehensionStage = (typeof COMPREHENSION_STAGES)[number];

export const COMPREHENSION_STAGE_LABELS: Record<ComprehensionStage, string> = {
  prepare: 'เตรียมงานสรุป',
  fetch: 'ดึงซอร์สโค้ดของคอมมิตนี้',
  files: 'สรุปทีละไฟล์',
  modules: 'รวมเป็นภาพของแต่ละโมดูล',
  repo: 'สรุปภาพรวมทั้ง repo',
  publish: 'บันทึกผล',
};

export type ComprehensionStatus = 'queued' | 'running' | 'done' | 'failed';

/** ที่มาของคำอธิบาย — โมเดลเขียน หรือระบบเขียนเองจากสิ่งที่วัดได้ */
export type SummarySource = 'model' | 'analyzer';

export type SummaryScope = 'file' | 'module' | 'repo';

export const citationSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
});

export type Citation = z.infer<typeof citationSchema>;

/** ข้อความหนึ่งข้อพร้อมบรรทัดที่ยืนยันได้ว่ามาจากไหน */
export const claimSchema = z.object({
  text: z.string().min(1),
  citations: z.array(citationSchema).default([]),
});

export type Claim = z.infer<typeof claimSchema>;

export interface FileSummary {
  path: string;
  headline: string;
  points: Claim[];
  source: SummarySource;
  model: string | null;
}

export interface ModuleSummary {
  /** พาธของโฟลเดอร์ ใช้ '.' แทนรากของ repo */
  path: string;
  headline: string;
  points: Claim[];
  fileCount: number;
  source: SummarySource;
  model: string | null;
}

export interface RepoDigest {
  headline: string;
  purpose: Claim[];
  stack: Claim[];
  entrypoints: Claim[];
  howToRun: Claim[];
  notes: Claim[];
  model: string | null;
}

export interface ComprehensionRun {
  id: string;
  analysisId: string;
  status: ComprehensionStatus;
  stage: ComprehensionStage | null;
  percent: number;
  message: string | null;
  filesDone: number;
  filesTotal: number;
  /** จำนวนไฟล์ที่มีคำอธิบายแล้ว หารด้วยไฟล์ทั้งหมดของงานวิเคราะห์ */
  coverage: number;
  inputTokens: number;
  outputTokens: number;
  commitSha: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface ComprehensionProgress {
  comprehensionId: string;
  analysisId: string;
  status: ComprehensionStatus;
  stage: ComprehensionStage | null;
  percent: number;
  message: string;
  filesDone: number;
  filesTotal: number;
}

/**
 * โมเดลที่ใช้ในแต่ละงาน
 *
 * สรุปรายไฟล์มีจำนวนมากและแต่ละครั้งมองแค่ไฟล์เดียว จึงใช้ตัวเล็กที่เร็วและถูก
 * ส่วนภาพรวมทั้ง repo ต้องร้อยเรียงของหลายสิบโมดูลเข้าด้วยกัน จึงคุ้มที่จะใช้ตัวใหญ่
 * ค่าเรียกใช้ทั้งหมดตกกับกุญแจของผู้ใช้ ตัวเลือกนี้จึงมีผลกับเงินในกระเป๋าเขาโดยตรง
 */
export const MODELS = {
  file: 'claude-haiku-4-5-20251001',
  module: 'claude-sonnet-5',
  repo: 'claude-opus-5',
} as const;

/** ช่องประกาศความคืบหน้าของงานสรุป แยกจากช่องของงานวิเคราะห์ */
export function comprehensionChannel(comprehensionId: string): string {
  return `comprehension:${comprehensionId}`;
}

export const COMPREHENSION_QUEUE = 'comprehension';

export interface ComprehensionJob {
  comprehensionId: string;
  analysisId: string;
  /** รหัส session ที่ถือกุญแจอยู่ — worker ไปถอดเอาเองจากที่เก็บชั่วคราว ไม่ส่งกุญแจมากับงาน */
  sessionId: string;
}

/** ตัดข้อความที่อ้างอิงบรรทัดจริงไม่ได้ทิ้ง ตามกติกาข้อเดียวของชั้นนี้ */
export function keepGrounded(claims: Claim[], isReal: (citation: Citation) => boolean): Claim[] {
  return claims
    .map((claim) => ({ ...claim, citations: claim.citations.filter(isReal) }))
    .filter((claim) => claim.citations.length > 0);
}
