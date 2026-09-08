import { Worker } from 'bullmq';
import { runMigrations } from '@repolens/db';
import {
  ANALYSIS_QUEUE,
  COMPREHENSION_QUEUE,
  readBuildInfo,
  type AnalysisJob,
  type ComprehensionJob,
} from '@repolens/shared';
import { handleAnalysis } from './analysis.js';
import { handleComprehension } from './comprehension.js';
import { closeRuntime, connection, log, sql } from './runtime.js';

/**
 * ตัวรันงานเบื้องหลัง
 *
 * แยกออกจาก API โดยตั้งใจ เพราะการโคลนและอ่านโค้ดกินเวลาและหน่วยความจำ
 * ถ้าปล่อยให้ทำในกระบวนการเดียวกับ API หน้าเว็บจะหน่วงตามไปด้วยทุกครั้งที่มีคนสั่งงาน
 *
 * มีสองคิวแยกกัน เพราะงานสรุปด้วย AI ใช้เวลาเป็นนาทีและรอเครือข่ายเป็นหลัก
 * ถ้าอยู่คิวเดียวกับงานวิเคราะห์ คนที่แค่อยากดูกราฟจะต้องรอคิวของคนที่สั่งสรุปทั้ง repo
 */

const buildInfo = readBuildInfo(process.env);

const applied = await runMigrations(sql);
if (applied.length > 0) log('รัน migration แล้ว', { applied });

const analysisWorker = new Worker<AnalysisJob>(ANALYSIS_QUEUE, handleAnalysis, {
  connection,
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),
});

const comprehensionWorker = new Worker<ComprehensionJob>(COMPREHENSION_QUEUE, handleComprehension, {
  connection,
  concurrency: Number(process.env.COMPREHENSION_CONCURRENCY ?? 1),
});

for (const [name, worker] of [
  ['วิเคราะห์', analysisWorker],
  ['สรุป', comprehensionWorker],
] as const) {
  worker.on('ready', () => log(`worker ${name} พร้อมรับงาน`, { version: buildInfo.version }));
  worker.on('error', (error) => log(`worker ${name} มีปัญหา`, { error: error.message }));
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void (async () => {
      await Promise.all([analysisWorker.close(), comprehensionWorker.close()]);
      await closeRuntime();
      process.exit(0);
    })();
  });
}
