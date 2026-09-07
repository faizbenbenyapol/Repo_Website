import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createDb, runMigrations, type Db } from '@repolens/db';
import { ANALYSIS_QUEUE, type AnalysisJob } from '@repolens/shared';

/**
 * ทรัพยากรที่มีอายุเท่ากับกระบวนการ — ฐานข้อมูล คิวงาน และการติดตามความคืบหน้า
 * รวมไว้ที่เดียวเพื่อให้ปิดได้ครบตอนดับเซิร์ฟเวอร์ และให้ชุดทดสอบสร้าง/ทำลายได้เป็นชุด
 */
export interface Services {
  sql: Db;
  queue: Queue<AnalysisJob>;
  /** สร้างการเชื่อมต่อใหม่สำหรับ subscribe หนึ่งราย เพราะ Redis ห้ามใช้ช่องเดียวปนกับคำสั่งอื่น */
  createSubscriber: () => Redis;
  close: () => Promise<void>;
}

export async function createServices(): Promise<Services> {
  const redisUrl = process.env.REDIS_URL ?? 'redis://redis:6379';
  const sql = createDb();
  await runMigrations(sql);

  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue<AnalysisJob>(ANALYSIS_QUEUE, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 100 },
      attempts: 1,
    },
  });

  return {
    sql,
    queue,
    createSubscriber: () => new Redis(redisUrl, { maxRetriesPerRequest: null }),
    close: async () => {
      await queue.close();
      await connection.quit();
      await sql.end();
    },
  };
}
