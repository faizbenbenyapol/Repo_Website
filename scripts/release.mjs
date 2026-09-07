#!/usr/bin/env node
/**
 * เลื่อนเวอร์ชันทุกแพ็กเกจพร้อมกัน สร้างโครงบันทึกรุ่นให้เขียนต่อ แล้วประกอบ CHANGELOG ใหม่
 * ใช้ผ่าน: make release V=0.2.0
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CHANGELOG_DIR, ROOT_PACKAGE, WORKSPACE_PACKAGES } from './paths.mjs';

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('ต้องระบุเวอร์ชันในรูป x.y.z เช่น: make release V=0.2.0');
  process.exit(1);
}

const rootPkg = JSON.parse(await readFile(ROOT_PACKAGE, 'utf8'));
const compare = (a, b) => {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

if (compare(version, rootPkg.version) <= 0) {
  console.error(`v${version} ไม่ได้ใหม่กว่า v${rootPkg.version} ที่เป็นรุ่นปัจจุบัน`);
  process.exit(1);
}

for (const packagePath of [ROOT_PACKAGE, ...WORKSPACE_PACKAGES]) {
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  pkg.version = version;
  await writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
}

const notePath = join(CHANGELOG_DIR, `v${version}.md`);
if (existsSync(notePath)) {
  console.log(`มีบันทึกรุ่น v${version} อยู่แล้ว ไม่เขียนทับ`);
} else {
  const today = new Date().toISOString().slice(0, 10);
  const template = `---
version: ${version}
date: ${today}
title: ตั้งชื่อรุ่นนี้
---

## เพิ่ม

- เขียนว่ารุ่นนี้เพิ่มอะไร แล้วลบบรรทัดนี้ทิ้ง
`;
  await writeFile(notePath, template, 'utf8');
  console.log(
    `สร้างโครงบันทึกรุ่นที่ docs/changelog/v${version}.md แล้ว — เขียนเนื้อหาให้ครบก่อน commit`,
  );
}

console.log(
  `เลื่อนทุกแพ็กเกจไปที่ v${version} เรียบร้อย ขั้นต่อไป: make changelog แล้วตรวจด้วย make test`,
);
