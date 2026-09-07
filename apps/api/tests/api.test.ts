import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createServices, type Services } from '../src/services.js';

let app: FastifyInstance;
let services: Services;

beforeAll(async () => {
  process.env.ALLOW_LOCAL_REPOS = '1';
  services = await createServices();
  app = await buildApp(services);
  await app.ready();
}, 60_000);

afterAll(async () => {
  await app.close();
  await services.close();
});

describe('GET /api/health', () => {
  it('ตอบว่าพร้อมใช้งานและต่อฐานข้อมูลได้จริง', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, database: 'up' });
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
    const body = res.json();
    expect(body.session.tier).toBe('visitor');
    expect(body.session.aiEnabled).toBe(false);
    expect(body.session.aiBlockedReason).toContain('API key');
    expect(body.session.apiKeyHint).toBeNull();
    expect(res.body).not.toMatch(/sk-ant/);
  });
});

describe('POST /api/analyses', () => {
  it('ปฏิเสธที่อยู่ที่ไม่อยู่ในรายการโฮสต์ที่อนุญาต', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyses',
      payload: { input: 'https://example.com/a/b' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('example.com');
  });

  it('ปฏิเสธคำขอที่ไม่มีที่อยู่', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/analyses', payload: { input: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('รับงานแล้วคืนรหัสให้ไปติดตามต่อ', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyses',
      payload: { input: 'octocat/hello-world' },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.status).toBe('queued');

    const status = await app.inject({ method: 'GET', url: `/api/analyses/${body.id}` });
    expect(status.statusCode).toBe(200);
    expect(status.json().analysis.status).toBe('queued');
    expect(status.json().analysis.owner).toBe('octocat');
  });

  it('งานที่ยังไม่เสร็จยังไม่มีไฟล์หรือเส้นเชื่อมให้ดู', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/analyses',
      payload: { input: 'octocat/spoon-knife', refresh: true },
    });
    const id = created.json().id;

    expect(
      (await app.inject({ method: 'GET', url: `/api/analyses/${id}/files` })).json().files,
    ).toEqual([]);
    expect(
      (await app.inject({ method: 'GET', url: `/api/analyses/${id}/edges` })).json().edges,
    ).toEqual([]);
  });
});

describe('การติดตามงานที่ไม่มีอยู่', () => {
  it('รหัสที่ผิดรูปแบบตอบ 400 ไม่ใช่ 500', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/analyses/ไม่ใช่รหัส' });
    expect(res.statusCode).toBe(400);
  });

  it('รหัสถูกรูปแบบแต่ไม่มีอยู่ ตอบ 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/analyses/00000000-0000-4000-8000-000000000000',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('ไม่พบ');
  });
});

describe('เส้นทางที่ไม่มีอยู่', () => {
  it('ตอบ 404 เป็นภาษาไทย ไม่ใช่หน้า error เปล่า', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ไม่มีอยู่จริง' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain('ไม่พบเส้นทาง');
  });
});

describe('สตรีมความคืบหน้า', () => {
  it('ส่งสถานะปัจจุบันทันทีที่เชื่อมต่อ', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/analyses',
      payload: { input: 'octocat/git-consortium', refresh: true },
    });
    const id = created.json().id;

    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (typeof address === 'string' || address === null) throw new Error('เปิดพอร์ตทดสอบไม่สำเร็จ');

    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/analyses/${id}/stream`, {
      signal: controller.signal,
    });

    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body?.getReader();
    const chunk = await reader?.read();
    const text = new TextDecoder().decode(chunk?.value);
    controller.abort();

    expect(text).toContain('data:');
    const payload = JSON.parse(text.replace(/^data: /, '').trim());
    expect(payload.analysisId).toBe(id);
    expect(['queued', 'running']).toContain(payload.status);
  }, 30_000);
});

describe('ข้อมูลกราฟ', () => {
  it('รหัสที่ไม่มีอยู่คืนกราฟว่าง ไม่ใช่ error', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/analyses/00000000-0000-4000-8000-000000000000/graph',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ nodes: [], edges: [], truncated: false, totalNodes: 0 });
  });

  it('ปฏิเสธรหัสที่ผิดรูปแบบ', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/analyses/ไม่ใช่รหัส/graph' });
    expect(res.statusCode).toBe(400);
  });

  it('ต้องระบุพาธเมื่อขอรายละเอียดไฟล์', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/analyses/00000000-0000-4000-8000-000000000000/files/detail',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('พาธ');
  });

  it('ไฟล์ที่ไม่มีอยู่คืนรายการว่างทั้งสามชุด', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/analyses/00000000-0000-4000-8000-000000000000/files/detail?path=src/x.ts',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ symbols: [], dependents: [], dependencies: [] });
  });
});
