export * from './crypto.js';
export * from './keystore.js';

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseReleaseNote, sortReleases, type ReleaseNote } from './changelog.js';

/**
 * อ่านบันทึกรุ่นทุกไฟล์จากโฟลเดอร์เดียว
 * โมดูลนี้แยกจาก index เพราะแตะระบบไฟล์ — หน้าเว็บฝั่งเบราว์เซอร์ต้องไม่ดึงเข้าไป
 */
export async function loadReleaseNotes(dir: string): Promise<ReleaseNote[]> {
  const entries = await readdir(dir);
  const files = entries.filter((name) => name.endsWith('.md')).sort();

  const releases = await Promise.all(
    files.map(async (name) => parseReleaseNote(await readFile(join(dir, name), 'utf8'), name)),
  );

  return sortReleases(releases);
}
