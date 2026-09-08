import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  hashToken,
  keyHint,
  open,
  randomToken,
  seal,
  verifyPassword,
} from './crypto.js';

describe('รหัสผ่าน', () => {
  it('แฮชแล้วตรวจกลับได้ และแฮชของรหัสเดียวกันสองครั้งต้องไม่เหมือนกัน', async () => {
    const stored = await hashPassword('รหัสผ่านที่ยาวพอ');
    const again = await hashPassword('รหัสผ่านที่ยาวพอ');

    expect(stored).not.toBe(again);
    expect(stored).toMatch(/^scrypt\$/);
    expect(await verifyPassword('รหัสผ่านที่ยาวพอ', stored)).toBe(true);
    expect(await verifyPassword('รหัสผ่านที่ยาวพอ', again)).toBe(true);
  }, 20_000);

  it('รหัสผิดหนึ่งตัวอักษรก็ต้องไม่ผ่าน', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse batteru', stored)).toBe(false);
  }, 20_000);

  it('ไม่เก็บรหัสผ่านต้นฉบับไว้ในผลลัพธ์', async () => {
    const stored = await hashPassword('ความลับที่ห้ามหลุด');
    expect(stored).not.toContain('ความลับที่ห้ามหลุด');
  }, 20_000);

  it('ข้อมูลที่เก็บไว้ผิดรูปแบบต้องตอบว่าไม่ผ่าน ไม่ใช่ระเบิด', async () => {
    for (const broken of ['', 'ไม่ใช่แฮช', 'scrypt$1$2$3', 'bcrypt$1$8$1$aa$bb']) {
      expect(await verifyPassword('อะไรก็ตาม', broken)).toBe(false);
    }
  });
});

describe('โทเค็นของ session', () => {
  it('สุ่มไม่ซ้ำและใช้ในคุกกี้ได้โดยไม่ต้องหนีอักขระ', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('ย่อแล้วได้ค่าเดิมเสมอ และย่อกลับเป็นโทเค็นเดิมไม่ได้', () => {
    const token = randomToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('การเข้ารหัสความลับ', () => {
  const secret = 'a'.repeat(64);

  it('เข้าแล้วถอดกลับได้ด้วยกุญแจเดิม', () => {
    const sealed = seal('sk-ant-ตัวอย่าง-1234', secret);
    expect(sealed).not.toContain('sk-ant');
    expect(open(sealed, secret)).toBe('sk-ant-ตัวอย่าง-1234');
  });

  it('กุญแจคนละดอกถอดไม่ได้ และคืน null แทนที่จะโยน error', () => {
    const sealed = seal('ความลับ', secret);
    expect(open(sealed, 'b'.repeat(64))).toBeNull();
  });

  it('ข้อมูลที่ถูกแก้ระหว่างทางต้องถอดไม่ผ่าน', () => {
    const sealed = seal('ความลับ', secret);
    const parts = sealed.split('.');
    const tampered = [parts[0], parts[1], Buffer.from('ปลอม').toString('base64url'), parts[3]].join(
      '.',
    );
    expect(open(tampered, secret)).toBeNull();
  });

  it('ค่าที่ผิดรูปแบบถอดไม่ได้แต่ไม่ทำให้ระบบล้ม', () => {
    for (const broken of ['', 'v1.a', 'v2.a.b.c', 'ไม่ใช่ของเรา']) {
      expect(open(broken, secret)).toBeNull();
    }
  });

  it('เข้ารหัสค่าเดิมสองครั้งได้ผลต่างกัน เพราะ iv สุ่มใหม่ทุกครั้ง', () => {
    expect(seal('ค่าเดียวกัน', secret)).not.toBe(seal('ค่าเดียวกัน', secret));
  });
});

describe('คำใบ้ของกุญแจ', () => {
  it('บอกได้แค่สี่ตัวท้าย', () => {
    expect(keyHint('sk-ant-api03-xxxxxxxxxxxx9f2b')).toBe('9f2b');
    expect(keyHint('  sk-ant-api03-abcd  ')).toBe('abcd');
  });
});
