import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './client.js';

/** โฟลเดอร์ migration อยู่ข้างโค้ดที่คอมไพล์แล้วเสมอ จึงหาเจอทั้งตอนพัฒนาและในอิมเมจ */
export function migrationsDirectory(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
}

/**
 * รัน migration ทั้งหมดที่ยังไม่เคยรัน เรียงตามชื่อไฟล์
 * ปลอดภัยเมื่อถูกเรียกพร้อมกันหลายตัว เพราะจับล็อกระดับฐานข้อมูลก่อน
 */
export async function runMigrations(sql: Db, directory = migrationsDirectory()): Promise<string[]> {
  await sql`
    create table if not exists schema_migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  await sql`select pg_advisory_lock(hashtext('repolens_migrations'))`;

  try {
    const applied = await sql<{ name: string }[]>`select name from schema_migrations`;
    const done = new Set(applied.map((row) => row.name));
    const names = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
    const ran: string[] = [];

    for (const name of names) {
      if (done.has(name)) continue;
      const statements = await readFile(join(directory, name), 'utf8');
      await sql.unsafe(statements);
      await sql`insert into schema_migrations ${sql({ name })}`;
      ran.push(name);
    }

    return ran;
  } finally {
    await sql`select pg_advisory_unlock(hashtext('repolens_migrations'))`;
  }
}
