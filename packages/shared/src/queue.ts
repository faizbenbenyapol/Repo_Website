/** สัญญาระหว่าง API กับ worker — ทั้งสองฝั่งอ่านจากไฟล์นี้ไฟล์เดียว */
export const ANALYSIS_QUEUE = 'analysis';

export interface AnalysisJob {
  analysisId: string;
  input: string;
}

/** ช่องที่ worker ประกาศความคืบหน้า และ API เอาไปส่งต่อให้เบราว์เซอร์ผ่าน SSE */
export function progressChannel(analysisId: string): string {
  return `analysis:${analysisId}`;
}

export interface ProgressMessage {
  analysisId: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  stage: string | null;
  percent: number;
  message: string;
}
