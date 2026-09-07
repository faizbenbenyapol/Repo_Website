import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { analyzeRepo } from '@repolens/analyzer';
import {
  createDb,
  getAnalysis,
  markFailed,
  runMigrations,
  saveResult,
  updateProgress,
} from '@repolens/db';
import {
  ANALYSIS_QUEUE,
  progressChannel,
  readBuildInfo,
  type AnalysisJob,
  type ProgressMessage,
} from '@repolens/shared';

/**
 * ตัวรันงานวิเคราะห์
 *
 * แยกออกจาก API โดยตั้งใจ เพราะการโคลนและอ่านโค้ดกินเวลาและหน่วยความจำ
 * ถ้าปล่อยให้ทำในกระบวนการเดียวกับ API หน้าเว็บจะหน่วงตามไปด้วยทุกครั้งที่มีคนสั่งวิเคราะห์
 */

const buildInfo = readBuildInfo(process.env);
const redisUrl = process.env.REDIS_URL ?? 'redis://redis:6379';
const sql = createDb();
const publisher = new Redis(redisUrl, { maxRetriesPerRequest: null });
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

function log(message: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), message, ...extra }));
}

async function publish(update: ProgressMessage): Promise<void> {
  await publisher.publish(progressChannel(update.analysisId), JSON.stringify(update));
}

async function handle(job: Job<AnalysisJob>): Promise<void> {
  const { analysisId, input } = job.data;
  const started = Date.now();
  log('รับงานวิเคราะห์', { analysisId, input });

  const analysis = await getAnalysis(sql, analysisId);
  if (!analysis) {
    log('ไม่พบงานวิเคราะห์ในฐานข้อมูล จึงข้ามไป', { analysisId });
    return;
  }

  try {
    const result = await analyzeRepo(input, {
      allowLocal: process.env.ALLOW_LOCAL_REPOS === '1',
      maxFiles: Number(process.env.MAX_FILES ?? 50_000),
      maxFileBytes: Number(process.env.MAX_FILE_BYTES ?? 2 * 1024 * 1024),
      timeoutMs: Number(process.env.CLONE_TIMEOUT_MS ?? 180_000),
      onProgress: (event) => {
        // ไม่ await ในนี้เพื่อไม่ให้การรายงานความคืบหน้าไปหน่วงงานวิเคราะห์
        void updateProgress(sql, analysisId, event).catch(() => {});
        void publish({
          analysisId,
          status: 'running',
          stage: event.stage,
          percent: event.percent,
          message: event.message,
        }).catch(() => {});
      },
    });

    await saveResult(sql, analysisId, result);
    await publish({
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
      ms: Date.now() - started,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'วิเคราะห์ไม่สำเร็จ';
    await markFailed(sql, analysisId, message);
    await publish({ analysisId, status: 'failed', stage: null, percent: 100, message });
    log('วิเคราะห์ล้มเหลว', { analysisId, error: message });
    // ไม่โยนต่อ เพราะเหตุผลของความล้มเหลวถูกบันทึกให้ผู้ใช้เห็นแล้ว การลองใหม่อัตโนมัติจะได้ผลเดิม
  }
}

const applied = await runMigrations(sql);
if (applied.length > 0) log('รัน migration แล้ว', { applied });

const worker = new Worker<AnalysisJob>(ANALYSIS_QUEUE, handle, {
  connection,
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
});

worker.on('ready', () => log('worker พร้อมรับงาน', { version: buildInfo.version }));
worker.on('error', (error) => log('worker มีปัญหา', { error: error.message }));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      await worker.close();
      await Promise.all([publisher.quit(), connection.quit(), sql.end()]);
      process.exit(0);
    })();
  });
}
