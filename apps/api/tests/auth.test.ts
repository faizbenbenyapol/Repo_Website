import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { createServices, type Services } from '../src/services.js';

let app: FastifyInstance;
let services: Services;

/**
 * อีเมลไม่ซ้ำต่อการรันหนึ่งครั้ง เพราะฐานข้อมูลทดสอบใช้ร่วมกับไฟล์เทสต์อื่น
 * ส่วนที่หน้าอีเมลเป็นอักษรละตินตามที่สคีมาและช่องกรอกของเบราว์เซอร์ยอมรับตรงกัน
 * ส่วนรหัสผ่านตั้งใจใส่ภาษาไทย เพราะผู้ใช้ของเว็บนี้ตั้งรหัสแบบนั้นได้จริง
 */
const stamp = Date.now();
const email = `member-${stamp}@repolens.test`;
const password = 'รหัสผ่านที่ยาวพอใช้งาน';

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

async function register(overrides: { email?: string; password?: string } = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: overrides.email ?? email, password: overrides.password ?? password },
  });
}

function cookieOf(res: Awaited<ReturnType<typeof register>>): string {
  const value = res.cookies.find((cookie) => cookie.name === 'repolens_session')?.value;
  if (!value) throw new Error('ไม่ได้รับคุกกี้ session กลับมา');
  return `repolens_session=${value}`;
}

describe('การสมัครสมาชิก', () => {
  it('สมัครแล้วได้คุกกี้ที่เบราว์เซอร์อ่านไม่ได้ด้วยสคริปต์', async () => {
    const res = await register();

    expect(res.statusCode).toBe(201);
    expect(res.json().session).toMatchObject({ tier: 'member', signedIn: true, aiEnabled: false });

    const cookie = res.cookies.find((c) => c.name === 'repolens_session');
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite?.toLowerCase()).toBe('lax');
    expect(cookie?.path).toBe('/');
  }, 30_000);

  it('บอกทันทีว่ายังต้องใส่ API key ก่อนถึงจะใช้ AI ได้', async () => {
    const res = await register({ email: `second-${stamp}@repolens.test` });
    expect(res.json().session.aiBlockedReason).toContain('API key');
  }, 30_000);

  it('รหัสผ่านสั้นเกินไปถูกปฏิเสธพร้อมบอกเกณฑ์เป็นภาษาไทย', async () => {
    const res = await register({ email: `short-${stamp}@repolens.test`, password: 'สั้นไป' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('10 ตัวอักษร');
  });

  it('อีเมลผิดรูปแบบถูกปฏิเสธ', async () => {
    const res = await register({ email: 'ไม่ใช่อีเมล' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('อีเมล');
  });

  it('อีเมลซ้ำบอกให้ไปเข้าสู่ระบบแทน ไม่ใช่ error ดิบ', async () => {
    const res = await register();
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('เข้าสู่ระบบ');
  }, 30_000);
});

describe('การเข้าสู่ระบบ', () => {
  it('รหัสถูกต้องได้ session ใหม่', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().session.email).toBe(email);
  }, 30_000);

  it('อีเมลผิดกับรหัสผิดต้องได้ข้อความเดียวกัน จะได้ใช้ไล่หาว่าใครมีบัญชีไม่ได้', async () => {
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'รหัสผ่านที่ไม่ถูกต้องเลย' },
    });
    const noSuchUser = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: `nobody-${stamp}@repolens.test`, password },
    });

    expect(wrongPassword.statusCode).toBe(401);
    expect(noSuchUser.statusCode).toBe(401);
    expect(wrongPassword.json().error).toBe(noSuchUser.json().error);
  }, 30_000);
});

describe('กุญแจของสมาชิก', () => {
  const keyEmail = `withkey-${stamp}@repolens.test`;
  let cookie = '';

  beforeAll(async () => {
    cookie = cookieOf(await register({ email: keyEmail }));
  }, 30_000);

  it('ผูกกุญแจไม่ได้ถ้ายังไม่ล็อกอิน', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/session/api-key',
      payload: { apiKey: 'sk-ant-api03-ตัวอย่างที่ยาวพอสมควร' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('เข้าสู่ระบบ');
  });

  it('กุญแจที่ไม่ได้ขึ้นต้นด้วย sk-ant- ถูกปฏิเสธตั้งแต่ยังไม่ต้องถามใคร', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/session/api-key',
      headers: { cookie },
      payload: { apiKey: 'ไม่ใช่กุญแจของ Claude แต่ยาวพอ' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('sk-ant-');
  });

  it('ผูกกุญแจแล้วเปิดใช้ AI ได้ และคำตอบต้องไม่มีกุญแจเต็มปนกลับมา', async () => {
    const secret = 'sk-ant-api03-ความลับที่ห้ามหลุด9f2b';
    const res = await app.inject({
      method: 'PUT',
      url: '/api/session/api-key',
      headers: { cookie },
      payload: { apiKey: secret },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().session).toMatchObject({ aiEnabled: true, apiKeyHint: '9f2b' });
    expect(res.body).not.toContain(secret);
    expect(res.body).not.toContain('ความลับที่ห้ามหลุด');
  });

  it('สถานะที่อ่านทีหลังก็ยังบอกได้แค่สี่ตัวท้ายเช่นกัน', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie } });

    expect(res.json().session).toMatchObject({
      tier: 'member',
      aiEnabled: true,
      apiKeyHint: '9f2b',
    });
    expect(res.body).not.toContain('sk-ant');
  });

  it('ถอดกุญแจออกแล้วต้องใช้ AI ไม่ได้ทันที', async () => {
    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/session/api-key',
      headers: { cookie },
    });

    expect(removed.statusCode).toBe(200);
    expect(removed.json().session).toMatchObject({ aiEnabled: false, apiKeyHint: null });
  });
});

describe('การออกจากระบบ', () => {
  it('ลบคุกกี้และกลับไปเป็นผู้เยี่ยมชม', async () => {
    const cookie = cookieOf(await register({ email: `signout-${stamp}@repolens.test` }));

    const res = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(res.json().session).toMatchObject({ tier: 'visitor', signedIn: false });

    const after = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie } });
    expect(after.json().session.signedIn).toBe(false);
  }, 30_000);
});

describe('สิทธิ์ของชั้นความเข้าใจ', () => {
  it('ผู้เยี่ยมชมสั่งสรุปไม่ได้ และได้รู้ว่าต้องทำอะไรก่อน', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyses/00000000-0000-4000-8000-000000000000/comprehension',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('เข้าสู่ระบบ');
  });

  it('สมาชิกที่ยังไม่ผูกกุญแจก็สั่งไม่ได้ และถูกชี้ไปหน้าตั้งค่า', async () => {
    const cookie = cookieOf(await register({ email: `nokey-${stamp}@repolens.test` }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/analyses/00000000-0000-4000-8000-000000000000/comprehension',
      headers: { cookie },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('API key');
  }, 30_000);

  it('ผู้เยี่ยมชมขอดูผลสรุปได้ แต่ได้ของว่างเสมอ เพราะผลผูกกับคนที่จ่ายค่าโมเดล', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/analyses/00000000-0000-4000-8000-000000000000/comprehension',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ comprehension: null, digest: null, modules: [] });
  });

  it('งานสรุปที่ไม่มีอยู่ตอบ 404 ไม่ใช่ 500', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/comprehensions/00000000-0000-4000-8000-000000000000/stream',
    });

    expect(res.statusCode).toBe(404);
  });
});
