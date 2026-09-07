import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  countChanges,
  parseReleaseNote,
  renderChangelog,
  sortReleases,
} from './changelog.js';

const sample = `---
version: 0.2.0
date: 2026-10-01
title: ดึงและอ่านโค้ด
---

## เพิ่ม

- รับลิงก์ repo แล้วโคลนในแซนด์บ็อกซ์
- แยกโค้ดด้วย tree-sitter
  ต่อเนื่องบรรทัดเดียวกัน

## แก้

- ป้ายเวอร์ชันแสดงวันที่ผิดโซนเวลา
`;

describe('parseReleaseNote', () => {
  it('อ่านส่วนหัวและหัวข้อย่อยได้ครบ', () => {
    const release = parseReleaseNote(sample);
    expect(release.version).toBe('0.2.0');
    expect(release.date).toBe('2026-10-01');
    expect(release.title).toBe('ดึงและอ่านโค้ด');
    expect(release.sections).toHaveLength(2);
    expect(release.sections[0]?.heading).toBe('เพิ่ม');
    expect(countChanges(release)).toBe(3);
  });

  it('ต่อบรรทัดย่อหน้าเข้ากับรายการก่อนหน้า', () => {
    const release = parseReleaseNote(sample);
    expect(release.sections[0]?.items[1]).toBe('แยกโค้ดด้วย tree-sitter ต่อเนื่องบรรทัดเดียวกัน');
  });

  it('ปฏิเสธไฟล์ที่ไม่มีส่วนหัว', () => {
    expect(() => parseReleaseNote('## เพิ่ม\n- อะไรสักอย่าง')).toThrow(/ส่วนหัว/);
  });

  it('ปฏิเสธหัวข้อที่ไม่อยู่ในรายการที่อนุญาต', () => {
    const bad = `---
version: 1.0.0
date: 2026-01-01
title: ทดสอบ
---

## เปลี่ยนแปลง

- ไม่ควรผ่าน
`;
    expect(() => parseReleaseNote(bad)).toThrow(/ใช้ไม่ได้/);
  });

  it('ปฏิเสธเวอร์ชันที่รูปแบบผิด', () => {
    expect(() => parseReleaseNote(sample.replace('0.2.0', 'v0.2'))).toThrow(/x\.y\.z/);
  });
});

describe('การเรียงและการประกอบไฟล์', () => {
  it('เทียบเวอร์ชันแบบตัวเลข ไม่ใช่ตัวอักษร', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('เรียงรุ่นใหม่ขึ้นก่อนเสมอ', () => {
    const releases = [
      parseReleaseNote(sample),
      parseReleaseNote(sample.replace('0.2.0', '0.10.0')),
      parseReleaseNote(sample.replace('0.2.0', '0.1.0')),
    ];
    expect(sortReleases(releases).map((r) => r.version)).toEqual(['0.10.0', '0.2.0', '0.1.0']);
  });

  it('ประกอบ CHANGELOG ได้ผลเหมือนเดิมทุกครั้ง', () => {
    const releases = [parseReleaseNote(sample)];
    expect(renderChangelog(releases)).toBe(renderChangelog(releases));
    expect(renderChangelog(releases)).toContain('## v0.2.0 — ดึงและอ่านโค้ด');
  });
});
