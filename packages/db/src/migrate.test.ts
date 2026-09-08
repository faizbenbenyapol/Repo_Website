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

  // ติดตั้ง pg_trgm ไว้ที่ public ให้แน่ใจก่อนเสมอ (v0.6.0 เพิ่ม extension นี้เข้ามาใน migration)
  // ไม่งั้นถ้าเป็นเทสต์แรกที่แตะฐานข้อมูลนี้ migration ที่แข่งกันอาจติดตั้งมันลงในสคีมาชั่วคราวของ
  // เทสต์นี้เอง แล้วโดนลบทิ้งไปพร้อมกับ `drop schema ... cascade` ตอนจบเทสต์ ซึ่งกระทบไฟล์ทดสอบอื่น
  // ที่รันพร้อมกันและอาศัย pg_trgm อยู่เหมือนกัน
  await root.unsafe('create extension if not exists pg_trgm with schema public');
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
    // ต้องมี public ต่อท้ายเสมอ เพราะ extension อย่าง pg_trgm (v0.6.0) ติดตั้งแบบทั้งฐานข้อมูลครั้งเดียว
    // ถ้าติดตั้งไปแล้วจากสคีมาอื่นในเทสต์ก่อนหน้า opclass ของมันจะอยู่ที่ public
    // สคีมาแยกของเทสต์นี้ต้องมองเห็น public ด้วย ไม่งั้นสร้างดัชนีที่ใช้ opclass นั้นไม่ได้
    connection: { search_path: `${schema},public` },
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
