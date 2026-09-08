import type { Job } from 'bullmq';
import { analyzeRepo, parseRepoRef } from '@repolens/analyzer';
import {
  getAnalysis,
  getPreviousSnapshot,
  markFailed,
  saveResult,
  updateProgress,
} from '@repolens/db';
import {
  ANALYZER_SCHEMA,
  progressChannel,
  type AnalysisJob,
  type ProgressMessage,
} from '@repolens/shared';
import { log, publish, sql } from './runtime.js';

/**
 * งานวิเคราะห์เชิงโครงสร้าง — โคลน อ่านโค้ด เชื่อมความสัมพันธ์ แล้วคำนวณตัวชี้วัด
 * ผลของงานนี้ใช้ร่วมกันได้ทุกคน เพราะมันขึ้นกับคอมมิตอย่างเดียว ไม่ได้ขึ้นกับว่าใครเป็นคนสั่ง
 */
export async function handleAnalysis(job: Job<AnalysisJob>): Promise<void> {
  const { analysisId, input } = job.data;
  const started = Date.now();
  log('รับงานวิเคราะห์', { analysisId, input });

  const analysis = await getAnalysis(sql, analysisId);
  if (!analysis) {
    log('ไม่พบงานวิเคราะห์ในฐานข้อมูล จึงข้ามไป', { analysisId });
    return;
  }

  const announce = (update: ProgressMessage): Promise<void> =>
    publish(progressChannel(analysisId), update);

  const allowLocal = process.env.ALLOW_LOCAL_REPOS === '1';

  // ผลจากรอบก่อนของ repo เดียวกัน (ถ้ามี) ใช้ข้ามการอ่านและพาร์สไฟล์ที่เนื้อหาไม่เปลี่ยน (v0.7.0)
  // แยกไว้ก่อนอ่าน ไม่ให้ปัญหาระหว่างค้นผลเก่าไปทำให้งานวิเคราะห์รอบนี้ล้มไปด้วย
  const parsedRef = parseRepoRef(input, { allowLocal });
  const previousFiles = parsedRef.ok
    ? await getPreviousSnapshot(sql, parsedRef.ref, ANALYZER_SCHEMA).catch(() => null)
    : null;

  try {
    const result = await analyzeRepo(input, {
      allowLocal,
      maxFiles: Number(process.env.MAX_FILES ?? 50_000),
      maxFileBytes: Number(process.env.MAX_FILE_BYTES ?? 2 * 1024 * 1024),
      timeoutMs: Number(process.env.CLONE_TIMEOUT_MS ?? 180_000),
      previousFiles: previousFiles ?? undefined,
      onProgress: (event) => {
        // ไม่ await ในนี้เพื่อไม่ให้การรายงานความคืบหน้าไปหน่วงงานวิเคราะห์
        void updateProgress(sql, analysisId, event).catch(() => {});
        void announce({
          analysisId,
          status: 'running',
          stage: event.stage,
          percent: event.percent,
          message: event.message,
        }).catch(() => {});
      },
    });

    await saveResult(sql, analysisId, result);
    await announce({
      analysisId,
      status: 'done',
      stage: 'publish',
      percent: 100,
      message: 'วิเคราะห์เสร็จแล้ว',
    });

    log('วิเคราะห์สำเร็จ', {
      analysisId,
      files: result.totals.files,
      edges: result.edges.length,
      reusedFiles: result.reusedFiles,
      ms: Date.now() - started,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'วิเคราะห์ไม่สำเร็จ';
    await markFailed(sql, analysisId, message);
    await announce({ analysisId, status: 'failed', stage: null, percent: 100, message });
    log('วิเคราะห์ล้มเหลว', { analysisId, error: message });
    // ไม่โยนต่อ เพราะเหตุผลของความล้มเหลวถูกบันทึกให้ผู้ใช้เห็นแล้ว การลองใหม่อัตโนมัติจะได้ผลเดิม
  }
}
