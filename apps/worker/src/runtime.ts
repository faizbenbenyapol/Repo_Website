import { Redis } from 'ioredis';
import { createDb, type Db } from '@repolens/db';

/**
 * ทรัพยากรที่ worker ใช้ร่วมกันทุกชนิดงาน
 * แยกออกมาไฟล์เดียวเพื่อให้เปิดและปิดได้ครบ ไม่ว่าจะเพิ่มชนิดงานเข้ามาอีกกี่แบบ
 */

const redisUrl = process.env.REDIS_URL ?? 'redis://redis:6379';

export const sql: Db = createDb();
export const publisher = new Redis(redisUrl, { maxRetriesPerRequest: null });
export const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
/** ช่องแยกสำหรับอ่านกุญแจของสมาชิก เพราะช่องของ BullMQ ถูกจองไว้ตลอดเวลา */
export const cache = new Redis(redisUrl, { maxRetriesPerRequest: null });

export function log(message: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ at: new Date().toISOString(), message, ...extra }));
}

export async function publish(channel: string, payload: unknown): Promise<void> {
  await publisher.publish(channel, JSON.stringify(payload));
}

export async function closeRuntime(): Promise<void> {
  await Promise.all([publisher.quit(), connection.quit(), cache.quit()]);
  await sql.end();
}
