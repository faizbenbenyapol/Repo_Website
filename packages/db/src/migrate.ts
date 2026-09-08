import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './client.js';

/** โฟลเดอร์ migration อยู่ข้างโค้ดที่คอมไพล์แล้วเสมอ จึงหาเจอทั้งตอนพัฒนาและในอิมเมจ */
export function migrationsDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
}

const LOCK_KEY = 'repolens_migrations';

/**
 * รัน migration ทั้งหมดที่ยังไม่เคยรัน เรียงตามชื่อไฟล์
 *
 * ทุกคำสั่งต้องวิ่งบนการเชื่อมต่อเดียวกันกับที่จับล็อกไว้
 * เพราะ advisory lock ของ Postgres ผูกกับการเชื่อมต่อ ไม่ใช่กับฐานข้อมูล
 * ถ้าจับล็อกจากช่องหนึ่งแล้วไปสั่งงานจากอีกช่องหนึ่งที่ pool หยิบมาให้ ล็อกนั้นไม่ได้กันอะไรเลย
 * และตอนฐานข้อมูลยังว่าง สองกระบวนการที่ขึ้นพร้อมกัน (API กับ worker) จะชนกันที่คำสั่งสร้างตาราง
 * ซึ่ง `create table if not exists` ไม่ได้กันไว้ให้ — มันล้มด้วยข้อผิดพลาดเรื่องชนิดข้อมูลซ้ำ
 */
export async function runMigrations(sql: Db, directory = migrationsDirectory()): Promise<string[]> {
  const connection = await sql.reserve();

  try {
    await connection`select pg_advisory_lock(hashtext(${LOCK_KEY}))`;

    try {
      await connection`
        create table if not exists schema_migrations (
          name       text primary key,
          applied_at timestamptz not null default now()
        )
      `;

      const applied = await connection<{ name: string }[]>`select name from schema_migrations`;
      const done = new Set(applied.map((row) => row.name));
      const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
      const ran: string[] = [];

      for (const name of names) {
        if (done.has(name)) continue;
        const statements = await readFile(join(directory, name), 'utf8');
        await connection.unsafe(statements);
        await connection`insert into schema_migrations ${connection({ name })}`;
        ran.push(name);
      }

      return ran;
    } finally {
      await connection`select pg_advisory_unlock(hashtext(${LOCK_KEY}))`;
    }
  } finally {
    connection.release();
  }
}
