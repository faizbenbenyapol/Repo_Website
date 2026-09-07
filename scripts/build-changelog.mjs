#!/usr/bin/env node
// ประกอบ CHANGELOG.md จากไฟล์บันทึกรุ่นทุกไฟล์ — ใช้ตัวประกอบตัวเดียวกับที่หน้าเว็บใช้แสดงผล
import { writeFile } from 'node:fs/promises';
import { renderChangelog } from '@repolens/shared';
import { loadReleaseNotes } from '@repolens/shared/node';
import { CHANGELOG_DIR, CHANGELOG_FILE } from './paths.mjs';

const releases = await loadReleaseNotes(CHANGELOG_DIR);
await writeFile(CHANGELOG_FILE, renderChangelog(releases), 'utf8');
console.log(`ประกอบ CHANGELOG.md จากบันทึก ${releases.length} รุ่นเรียบร้อย`);
