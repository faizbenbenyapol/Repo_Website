import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/health', () => {
  it('ตอบว่าพร้อมใช้งาน', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    expect(res.json().uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe('GET /api/version', () => {
  it('บอกรุ่นที่กำลังรันและเลขสคีมาตัววิเคราะห์', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/version' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('gitSha');
    expect(body.analyzerSchema).toBe(1);
  });
});

describe('GET /api/versions', () => {
  it('อ่านบันทึกรุ่นจากไฟล์จริงและเรียงใหม่ไปเก่า', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/versions' });
    expect(res.statusCode).toBe(200);
    const { releases } = res.json();
    expect(releases.length).toBeGreaterThan(0);
    expect(releases.map((r: { version: string }) => r.version)).toContain('0.1.0');

    const versions = releases.map((r: { version: string }) => r.version);
    const sorted = [...versions].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    expect(versions).toEqual(sorted);
  });

  it('เปิดบันทึกรุ่นเดียวได้ทั้งแบบมีและไม่มี v นำหน้า', async () => {
    for (const url of ['/api/versions/0.1.0', '/api/versions/v0.1.0']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.json().version).toBe('0.1.0');
      expect(res.json().sections.length).toBeGreaterThan(0);
    }
  });

  it('ตอบ 404 พร้อมข้อความภาษาไทยเมื่อไม่มีรุ่นนั้น', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/versions/9.9.9' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('9.9.9');
  });
});

describe('GET /api/session', () => {
  it('รายงานว่าเป็นผู้เยี่ยมชมและบอกวิธีเปิดใช้ AI', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/session' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.session.tier).toBe('visitor');
    expect(body.session.signedIn).toBe(false);
    expect(body.session.aiEnabled).toBe(false);
    expect(body.session.aiBlockedReason).toContain('API key');
    expect(body.session.apiKeyHint).toBeNull();
  });

  it('ไม่ส่งกุญแจหรือร่องรอยของกุญแจกลับไปหน้าบ้าน', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/session' });
    expect(res.body).not.toMatch(/sk-ant/);
  });

  it('ส่งรายการฟีเจอร์ทั้งหมดพร้อมระดับที่ต้องใช้', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/session' });
    const { features } = res.json();
    expect(features.some((f: { tier: string }) => f.tier === 'member')).toBe(true);
    expect(features.some((f: { tier: string }) => f.tier === 'visitor')).toBe(true);
  });
});

describe('เส้นทางที่ไม่มีอยู่', () => {
  it('ตอบ 404 เป็นภาษาไทย ไม่ใช่หน้า error เปล่า', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ไม่มีอยู่จริง' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('ไม่พบเส้นทาง');
  });
});
