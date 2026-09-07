#!/usr/bin/env node
/**
 * ประตูที่ทำให้ "อัปเดตบันทึกรุ่นทุกครั้งที่พัฒนา" เกิดขึ้นจริง ไม่ใช่แค่ความตั้งใจ
 * CI เรียกสคริปต์นี้ ถ้าไม่ผ่านคือ merge ไม่ได้
 */
import { readdir, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { renderChangelog } from '@repolens/shared';
import { loadReleaseNotes } from '@repolens/shared/node';
import { CHANGELOG_DIR, CHANGELOG_FILE, ROOT_PACKAGE, WORKSPACE_PACKAGES } from './paths.mjs';

const problems = [];

const rootPkg = JSON.parse(await readFile(ROOT_PACKAGE, 'utf8'));
const version = rootPkg.version;

let releases = [];
try {
  releases = await loadReleaseNotes(CHANGELOG_DIR);
} catch (error) {
  problems.push(`อ่านบันทึกรุ่นไม่สำเร็จ: ${error.message}`);
}

// 1. เวอร์ชันที่กำลังจะปล่อย ต้องมีไฟล์บันทึกรุ่นของตัวเอง
if (!releases.some((release) => release.version === version)) {
  problems.push(
    `ไม่พบบันทึกรุ่นของ v${version} — สร้างไฟล์ docs/changelog/v${version}.md แล้วเขียนว่ารุ่นนี้เปลี่ยนอะไร`,
  );
}

// 2. ชื่อไฟล์ต้องตรงกับเวอร์ชันข้างใน จะได้ไม่มีไฟล์ที่หาไม่เจอเวลาไล่ย้อนหลัง
const noteFiles = await readdir(CHANGELOG_DIR);
for (const release of releases) {
  const expected = `v${release.version}.md`;
  if (!noteFiles.includes(expected)) {
    problems.push(`บันทึกรุ่น v${release.version} ควรอยู่ในไฟล์ชื่อ ${expected}`);
  }
}

// 3. เวอร์ชันของทุกแพ็กเกจต้องเดินไปพร้อมกัน
for (const packagePath of WORKSPACE_PACKAGES) {
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  if (pkg.version !== version) {
    problems.push(
      `${pkg.name} อยู่ที่ v${pkg.version} แต่ที่เก็บโค้ดอยู่ที่ v${version} — รัน make release เพื่อเลื่อนพร้อมกัน`,
    );
  }
}

// 4. CHANGELOG.md ต้องเป็นผลของการประกอบล่าสุด ไม่ใช่ของที่แก้ด้วยมือ
if (releases.length > 0) {
  const expected = renderChangelog(releases);
  const actual = await readFile(CHANGELOG_FILE, 'utf8').catch(() => '');
  if (expected !== actual) {
    problems.push('CHANGELOG.md ไม่ตรงกับไฟล์บันทึกรุ่น — รัน make changelog แล้ว commit ผลลัพธ์');
  }
}

if (problems.length > 0) {
  console.error('ตรวจบันทึกรุ่นไม่ผ่าน:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `ตรวจบันทึกรุ่นผ่าน: v${version} มีบันทึกครบ และมีทั้งหมด ${releases.length} รุ่นในประวัติ`,
);
console.log(`  ไฟล์ล่าสุด: ${basename(CHANGELOG_FILE)}`);
