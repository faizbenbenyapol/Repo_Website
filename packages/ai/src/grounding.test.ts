import { describe, expect, it } from 'vitest';
import { extractJson, groundClaims, makeVerifier, readHeadline } from './grounding.js';

const verify = makeVerifier([
  { path: 'src/index.ts', loc: 40 },
  { path: 'src/util.ts', loc: 0 },
]);

describe('การแกะ JSON จากคำตอบของโมเดล', () => {
  it('อ่าน JSON ล้วนได้', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('อ่านได้แม้ถูกห่อด้วยรั้วโค้ด', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('อ่านได้แม้มีข้อความเกริ่นนำและปิดท้าย', () => {
    expect(extractJson('นี่คือผลลัพธ์ครับ {"a":1} หวังว่าจะช่วยได้')).toEqual({ a: 1 });
  });

  it('ไม่หลงวงเล็บที่อยู่ในสตริง', () => {
    expect(extractJson('{"text":"ปีกกา } ในข้อความ","b":2}')).toEqual({
      text: 'ปีกกา } ในข้อความ',
      b: 2,
    });
  });

  it('คืน null เมื่อไม่มี JSON ที่ใช้ได้ แทนที่จะโยน error', () => {
    for (const text of ['', 'ไม่มีอะไรเลย', '{"a":', '[1,2,3]']) {
      expect(extractJson(text)).toBeNull();
    }
  });
});

describe('การตรวจว่าอ้างอิงมีอยู่จริง', () => {
  it('ผ่านเมื่อไฟล์มีอยู่และบรรทัดอยู่ในช่วง', () => {
    expect(verify({ path: 'src/index.ts', line: 1 })).toBe(true);
    expect(verify({ path: 'src/index.ts', line: 40 })).toBe(true);
  });

  it('ไม่ผ่านเมื่อไฟล์ไม่มีอยู่ หรือบรรทัดเกินไฟล์', () => {
    expect(verify({ path: 'src/ไม่มีจริง.ts', line: 1 })).toBe(false);
    expect(verify({ path: 'src/index.ts', line: 41 })).toBe(false);
    expect(verify({ path: 'src/index.ts', line: 0 })).toBe(false);
  });

  it('ไฟล์ที่นับบรรทัดไม่ได้ ยังอ้างถึงบรรทัดแรกได้', () => {
    expect(verify({ path: 'src/util.ts', line: 1 })).toBe(true);
    expect(verify({ path: 'src/util.ts', line: 2 })).toBe(false);
  });
});

describe('การตัดข้อความที่อ้างอิงไม่ได้', () => {
  it('เก็บเฉพาะข้อที่ยังเหลืออ้างอิงจริงหลังกรอง', () => {
    const claims = groundClaims(
      [
        { text: 'ข้อที่อ้างอิงได้', lines: [10] },
        { text: 'ข้อที่ชี้บรรทัดเกินไฟล์', lines: [999] },
        { text: 'ข้อที่ไม่มีอ้างอิงเลย' },
      ],
      verify,
      'src/index.ts',
    );

    expect(claims).toHaveLength(1);
    expect(claims[0]?.text).toBe('ข้อที่อ้างอิงได้');
    expect(claims[0]?.citations).toEqual([{ path: 'src/index.ts', line: 10 }]);
  });

  it('รับอ้างอิงข้ามไฟล์ผ่าน refs และตัดไฟล์ที่ไม่มีอยู่ทิ้ง', () => {
    const claims = groundClaims(
      [
        {
          text: 'ข้ามไฟล์',
          refs: [
            { path: 'src/util.ts', line: 1 },
            { path: 'src/ปลอม.ts', line: 1 },
          ],
        },
      ],
      verify,
    );

    expect(claims[0]?.citations).toEqual([{ path: 'src/util.ts', line: 1 }]);
  });

  it('ตัดอ้างอิงซ้ำและจำกัดจำนวนข้อตามที่กำหนด', () => {
    const claims = groundClaims(
      [
        { text: 'ซ้ำ', lines: [5, 5, 5] },
        { text: 'สอง', lines: [6] },
        { text: 'สาม', lines: [7] },
      ],
      verify,
      'src/index.ts',
      2,
    );

    expect(claims).toHaveLength(2);
    expect(claims[0]?.citations).toHaveLength(1);
  });

  it('ข้อมูลที่ไม่ใช่รายการคืนรายการว่าง', () => {
    expect(groundClaims(null, verify)).toEqual([]);
    expect(groundClaims({ text: 'ไม่ใช่อาร์เรย์' }, verify)).toEqual([]);
  });
});

describe('หัวเรื่อง', () => {
  it('ใช้ค่าสำรองเมื่อโมเดลไม่ได้ส่งอะไรที่ใช้ได้', () => {
    expect(readHeadline(undefined, 'สำรอง')).toBe('สำรอง');
    expect(readHeadline('   ', 'สำรอง')).toBe('สำรอง');
    expect(readHeadline(42, 'สำรอง')).toBe('สำรอง');
  });

  it('ยุบช่องว่างและตัดเมื่อยาวเกิน', () => {
    expect(readHeadline('  หนึ่ง   สอง  ', 'สำรอง')).toBe('หนึ่ง สอง');
    expect(readHeadline('ก'.repeat(200), 'สำรอง')).toHaveLength(160);
  });
});
