import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { createDb, runMigrations, type Db } from './index.js';

/**
 * migration ต้องทนต่อการถูกเรียกพร้อมกันจากหลายกระบวนการ
 *
 * บนเซิร์ฟเวอร์จริง API กับ worker ขึ้นพร้อมกันและต่างก็เรียก runMigrations เอง
 * ตอนฐานข้อมูลยังว่าง ทั้งคู่จะไปถึงคำสั่งสร้างตารางพร้อมกัน — ซึ่ง `create table if not exists`
 * ไม่ได้กันกรณีนี้ให้ ตัวที่แพ้จะล้มและกระบวนการนั้นเปิดไม่ขึ้น
 *
 * ทดสอบบนสคีมาแยกของตัวเอง เพื่อให้ได้ฐานข้อมูลที่ว่างจริงโดยไม่ไปแตะของที่ไฟล์ทดสอบอื่นใช้อยู่
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error('ต้องตั้ง DATABASE_URL ก่อนรันชุดทดสอบฐานข้อมูล');

const schema = `migrate_test_${Date.now()}`;

let root: Db;
const connections: Db[] = [];

beforeAll(async () => {
  root = createDb(url);
  await root.unsafe(`create schema "${schema}"`);
}, 60_000);

afterAll(async () => {
  await Promise.all(connections.map((connection) => connection.end()));
  await root.unsafe(`drop schema if exists "${schema}" cascade`);
  await root.end();
});

function isolated(): Db {
  const connection = postgres(url as string, {
    max: 5,
    onnotice: () => {},
    connection: { search_path: schema },
  });
  connections.push(connection);
  return connection;
}

describe('การรัน migration พร้อมกัน', () => {
  it('หลายตัวเรียกพร้อมกันบนฐานข้อมูลว่าง ต้องไม่มีตัวไหนล้ม', async () => {
    const results = await Promise.all([
      runMigrations(isolated()),
      runMigrations(isolated()),
      runMigrations(isolated()),
    ]);

    // ตัวเดียวเท่านั้นที่ได้รัน ที่เหลือต้องเห็นว่ามีคนทำไปแล้วและไม่ทำซ้ำ
    const didWork = results.filter((ran) => ran.length > 0);
    expect(didWork).toHaveLength(1);
    expect(didWork[0]).toContain('001_init.sql');
    expect(didWork[0]).toContain('003_accounts.sql');
    expect(results.filter((ran) => ran.length === 0)).toHaveLength(2);
  }, 60_000);

  it('ตารางที่ migration สร้างต้องมีอยู่จริงหลังรันเสร็จ', async () => {
    const rows = await root.unsafe<{ table_name: string }[]>(
      `select table_name from information_schema.tables where table_schema = $1`,
      [schema],
    );
    const tables = new Set(rows.map((row) => row.table_name));

    for (const name of [
      'schema_migrations',
      'repos',
      'analyses',
      'users',
      'sessions',
      'summaries',
    ]) {
      expect(tables.has(name)).toBe(true);
    }
  });

  it('รันซ้ำหลังจากนั้นต้องไม่ทำอะไรเพิ่ม', async () => {
    expect(await runMigrations(isolated())).toEqual([]);
  }, 30_000);
});
