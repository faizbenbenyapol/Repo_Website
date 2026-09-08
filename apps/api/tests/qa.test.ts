import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createServices, type Services } from '../src/services.js';

let app: FastifyInstance;
let services: Services;

const stamp = Date.now();
const missing = '00000000-0000-4000-8000-000000000000';

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

async function register(email: string) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password: 'รหัสผ่านที่ยาวพอใช้งาน' },
  });
}

function cookieOf(res: Awaited<ReturnType<typeof register>>): string {
  const value = res.cookies.find((cookie) => cookie.name === 'repolens_session')?.value;
  if (!value) throw new Error('ไม่ได้รับคุกกี้ session กลับมา');
  return `repolens_session=${value}`;
}

/** สมาชิกที่ผูกกุญแจไว้แล้ว — ชุดทดสอบปิดการตรวจกุญแจกับ Anthropic (VERIFY_API_KEYS=0) */
async function memberWithKey(email: string): Promise<string> {
  const cookie = cookieOf(await register(email));
  await app.inject({
    method: 'PUT',
    url: '/api/session/api-key',
    headers: { cookie },
    payload: { apiKey: 'sk-ant-api03-ตัวอย่างสำหรับทดสอบ1234' },
  });
  return cookie;
}

describe('ถาม–ตอบกับ repo', () => {
  it('ผู้เยี่ยมชมถามไม่ได้ และรู้ว่าต้องเข้าสู่ระบบก่อน', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/analyses/${missing}/ask`,
      payload: { question: 'ระบบนี้ทำอะไร' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('เข้าสู่ระบบ');
  });

  it('ผู้เยี่ยมชมขอประวัติคำถามได้ แต่ได้รายการว่างเสมอ', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/analyses/${missing}/ask` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ messages: [] });
  });

  it('สมาชิกที่ยังไม่ผูกกุญแจถามไม่ได้ และถูกชี้ไปหน้าตั้งค่า', async () => {
    const cookie = cookieOf(await register(`ask-nokey-${stamp}@repolens.test`));
    const res = await app.inject({
      method: 'POST',
      url: `/api/analyses/${missing}/ask`,
      headers: { cookie },
      payload: { question: 'ระบบนี้ทำอะไร' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('API key');
  }, 30_000);

  it('คำถามว่างหรือยาวเกินไปถูกปฏิเสธก่อนถึงจะไปตรวจสิทธิ์', async () => {
    const cookie = await memberWithKey(`ask-badq-${stamp}@repolens.test`);

    const empty = await app.inject({
      method: 'POST',
      url: `/api/analyses/${missing}/ask`,
      headers: { cookie },
      payload: { question: '' },
    });
    expect(empty.statusCode).toBe(400);

    const long = await app.inject({
      method: 'POST',
      url: `/api/analyses/${missing}/ask`,
      headers: { cookie },
      payload: { question: 'ก'.repeat(600) },
    });
    expect(long.statusCode).toBe(400);
  }, 30_000);

  it('สมาชิกที่ผูกกุญแจแล้วถามงานวิเคราะห์ที่ไม่มีอยู่จริง ได้ 404', async () => {
    const cookie = await memberWithKey(`ask-missing-${stamp}@repolens.test`);
    const res = await app.inject({
      method: 'POST',
      url: `/api/analyses/${missing}/ask`,
      headers: { cookie },
      payload: { question: 'ระบบล็อกอินทำงานอย่างไร' },
    });
    expect(res.statusCode).toBe(404);
  }, 30_000);

  it('ถามงานที่ยังวิเคราะห์ไม่เสร็จ ได้ 409 พร้อมเหตุผลภาษาไทย', async () => {
    const cookie = await memberWithKey(`ask-pending-${stamp}@repolens.test`);
    const created = await app.inject({
      method: 'POST',
      url: '/api/analyses',
      payload: { input: 'octocat/hello-world', refresh: true },
    });
    const { id } = created.json();

    const res = await app.inject({
      method: 'POST',
      url: `/api/analyses/${id}/ask`,
      headers: { cookie },
      payload: { question: 'ระบบล็อกอินทำงานอย่างไร' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('ยังวิเคราะห์ไม่เสร็จ');
  }, 30_000);
});

describe('เส้นทางอ่านโค้ด', () => {
  it('ผู้เยี่ยมชมสร้างไม่ได้ และรู้ว่าต้องเข้าสู่ระบบก่อน', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/analyses/${missing}/reading-path` });
    expect(res.statusCode).toBe(401);
  });

  it('ผู้เยี่ยมชมขอเส้นทางที่มีอยู่ได้ แต่ได้ null เสมอ', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/analyses/${missing}/reading-path` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ path: null });
  });

  it('สมาชิกที่ยังไม่ผูกกุญแจสร้างไม่ได้', async () => {
    const cookie = cookieOf(await register(`rp-nokey-${stamp}@repolens.test`));
    const res = await app.inject({
      method: 'POST',
      url: `/api/analyses/${missing}/reading-path`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(403);
  }, 30_000);

  it('สร้างจากงานวิเคราะห์ที่ไม่มีอยู่จริง ได้ 404', async () => {
    const cookie = await memberWithKey(`rp-missing-${stamp}@repolens.test`);
    const res = await app.inject({
      method: 'POST',
      url: `/api/analyses/${missing}/reading-path`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  }, 30_000);

  it('สร้างจากงานที่ยังวิเคราะห์ไม่เสร็จ ได้ 409', async () => {
    const cookie = await memberWithKey(`rp-pending-${stamp}@repolens.test`);
    const created = await app.inject({
      method: 'POST',
      url: '/api/analyses',
      payload: { input: 'octocat/spoon-knife', refresh: true },
    });
    const { id } = created.json();

    const res = await app.inject({
      method: 'POST',
      url: `/api/analyses/${id}/reading-path`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(409);
  }, 30_000);
});
