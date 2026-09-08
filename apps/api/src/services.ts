import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createDb, runMigrations, type Db } from '@repolens/db';
import {
  ANALYSIS_QUEUE,
  COMPREHENSION_QUEUE,
  type AnalysisJob,
  type ComprehensionJob,
} from '@repolens/shared';
import { KeyStore } from '@repolens/shared/node';
import { config } from './config.js';

/**
 * ทรัพยากรที่มีอายุเท่ากับกระบวนการ — ฐานข้อมูล คิวงาน ที่เก็บกุญแจ และการติดตามความคืบหน้า
 * รวมไว้ที่เดียวเพื่อให้ปิดได้ครบตอนดับเซิร์ฟเวอร์ และให้ชุดทดสอบสร้าง/ทำลายได้เป็นชุด
 */
export interface Services {
  sql: Db;
  queue: Queue<AnalysisJob>;
  comprehensionQueue: Queue<ComprehensionJob>;
  /** กุญแจของสมาชิก อยู่ในหน่วยความจำของ Redis เท่านั้น ไม่ลงฐานข้อมูลหลัก */
  keys: KeyStore;
  /** สร้างการเชื่อมต่อใหม่สำหรับ subscribe หนึ่งราย เพราะ Redis ห้ามใช้ช่องเดียวปนกับคำสั่งอื่น */
  createSubscriber: () => Redis;
  close: () => Promise<void>;
}

export async function createServices(): Promise<Services> {
  const redisUrl = process.env.REDIS_URL ?? 'redis://redis:6379';
  const sql = createDb();
  await runMigrations(sql);

  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  // แยกช่องของที่เก็บกุญแจออกจากช่องที่ BullMQ ใช้ เพราะคิวงานถือครองช่องของมันเองตลอดเวลา
  const cache = new Redis(redisUrl, { maxRetriesPerRequest: null });

  const jobOptions = {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
    attempts: 1,
  };

  const queue = new Queue<AnalysisJob>(ANALYSIS_QUEUE, {
    connection,
    defaultJobOptions: jobOptions,
  });

  const comprehensionQueue = new Queue<ComprehensionJob>(COMPREHENSION_QUEUE, {
    connection,
    defaultJobOptions: jobOptions,
  });

  return {
    sql,
    queue,
    comprehensionQueue,
    keys: new KeyStore(cache, config.sessionSecret),
    createSubscriber: () => new Redis(redisUrl, { maxRetriesPerRequest: null }),
    close: async () => {
      await queue.close();
      await comprehensionQueue.close();
      await Promise.all([connection.quit(), cache.quit()]);
      await sql.end();
    },
  };
}
