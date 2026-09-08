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

describe('ส่งออกรายงานภาษาไทย', () => {
  it('ผู้เยี่ยมชมส่งออกไม่ได้ และรู้ว่าต้องเข้าสู่ระบบก่อน', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/analyses/${missing}/export/report.md`,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('เข้าสู่ระบบ');
  });

  it('สมาชิกที่ยังไม่ผูกกุญแจก็ยังส่งออกได้ — ไม่ต้องเรียกโมเดลใหม่', async () => {
    const cookie = cookieOf(await register(`report-nokey-${stamp}@repolens.test`));

    const created = await app.inject({
      method: 'POST',
      url: '/api/analyses',
      payload: { input: 'octocat/hello-world' },
    });
    const { id } = created.json();

    await new Promise((resolve) => setTimeout(resolve, 200));

    const res = await app.inject({
      method: 'GET',
      url: `/api/analyses/${id}/export/report.md`,
      headers: { cookie },
    });

    // งานยังไม่เสร็จ (worker แยกกระบวนการ ไม่ได้รันในเทสต์นี้) จึงต้องได้ 409 ไม่ใช่ 403
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('ยังวิเคราะห์ไม่เสร็จ');
  }, 30_000);

  it('รหัสงานวิเคราะห์ที่ไม่มีอยู่จริง ได้ 404', async () => {
    const cookie = cookieOf(await register(`report-missing-${stamp}@repolens.test`));
    const res = await app.inject({
      method: 'GET',
      url: `/api/analyses/${missing}/export/report.md`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
  }, 30_000);

  it('รหัสที่ผิดรูปแบบตอบ 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/analyses/ไม่ใช่รหัส/export/report.md',
    });
    expect(res.statusCode).toBe(400);
  });
});
