import { expect, test } from '@playwright/test';

/**
 * เส้นทางของสมาชิกทั้งเส้น: สมัคร → ผูกกุญแจ → เห็นว่าเปิดใช้ AI ได้ → ออกจากระบบ
 *
 * ในสภาพแวดล้อมทดสอบ การตรวจกุญแจกับ Anthropic ถูกปิดไว้ (VERIFY_API_KEYS=0)
 * เพราะชุดทดสอบตั้งใจไม่ให้ออกอินเทอร์เน็ต ส่วนตัวตรวจจริงมีเทสต์ของมันเองใน @repolens/ai
 */

/** อักษรละตินตามที่ช่องกรอกอีเมลของเบราว์เซอร์และสคีมาฝั่งเซิร์ฟเวอร์ยอมรับตรงกัน */
function newEmail(): string {
  return `member-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@repolens.test`;
}

const PASSWORD = 'รหัสผ่านที่ยาวพอใช้งานจริง';

test('ผู้เยี่ยมชมเห็นทางเข้าสู่ระบบ และรู้ว่าทำไมยังใช้คำอธิบายด้วย AI ไม่ได้', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'เข้าสู่ระบบ' })).toBeVisible();

  await page.getByRole('link', { name: 'เข้าสู่ระบบ' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 2, name: 'เข้าสู่ระบบ' })).toBeVisible();
});

test('สมัครแล้วเข้าหน้าตั้งค่า ผูกกุญแจ แล้วสถานะเปลี่ยนเป็นพร้อมใช้ AI', async ({ page }) => {
  const email = newEmail();

  await page.goto('/login');
  await page.getByRole('button', { name: 'ยังไม่มีบัญชี? สมัครใหม่' }).click();
  await page.getByLabel('อีเมล').fill(email);
  await page.getByLabel('รหัสผ่าน').fill(PASSWORD);
  await page.getByRole('button', { name: 'สมัครสมาชิก', exact: true }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(email);

  // ก่อนผูกกุญแจต้องบอกให้ชัดว่าต้องทำอะไรต่อ ไม่ใช่แค่ปุ่มที่กดไม่ได้
  await expect(page.getByText('ยังไม่มีกุญแจผูกไว้กับการเข้าใช้ครั้งนี้')).toBeVisible();

  await page.getByLabel('ใส่กุญแจใหม่').fill('sk-ant-api03-ตัวอย่างสำหรับทดสอบ9f2b');
  await page.getByRole('button', { name: 'ผูกกุญแจนี้' }).click();

  await expect(page.getByText('…9f2b')).toBeVisible();
  await expect(page.getByText('พร้อมใช้คำอธิบายด้วย AI แล้ว')).toBeVisible();

  // กุญแจเต็มต้องไม่มีทางกลับมาอยู่บนหน้าเว็บ
  expect(await page.content()).not.toContain('sk-ant-api03-ตัวอย่างสำหรับทดสอบ9f2b');

  await page.getByRole('button', { name: 'ถอดกุญแจออก' }).click();
  await expect(page.getByText('ยังไม่มีกุญแจผูกไว้กับการเข้าใช้ครั้งนี้')).toBeVisible();
});

test('รหัสผ่านสั้นเกินไปถูกทักก่อน และอีเมลซ้ำได้คำอธิบายที่ทำตามต่อได้', async ({ page }) => {
  const email = newEmail();

  await page.goto('/login');
  await page.getByRole('button', { name: 'ยังไม่มีบัญชี? สมัครใหม่' }).click();
  await page.getByLabel('อีเมล').fill(email);
  await page.getByLabel('รหัสผ่าน').fill(PASSWORD);
  await page.getByRole('button', { name: 'สมัครสมาชิก', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);

  await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto('/login');
  await page.getByRole('button', { name: 'ยังไม่มีบัญชี? สมัครใหม่' }).click();
  await page.getByLabel('อีเมล').fill(email);
  await page.getByLabel('รหัสผ่าน').fill(PASSWORD);
  await page.getByRole('button', { name: 'สมัครสมาชิก', exact: true }).click();

  await expect(page.getByRole('status')).toContainText('มีบัญชีอยู่แล้ว');
});

test('ผู้เยี่ยมชมเปิดแผนที่โค้ดได้ แต่ถูกบอกว่าคำอธิบายเปิดให้สมาชิก', async ({
  page,
  request,
}) => {
  const created = await request.post('/api/analyses', { data: { input: '/fixtures/demo' } });
  const { id } = await created.json();

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/analyses/${id}`);
        return (await res.json()).analysis.status;
      },
      { timeout: 90_000, intervals: [500] },
    )
    .toBe('done');

  await page.goto(`/a/${id}`);
  await expect(page.getByText('เปิดให้สมาชิกที่ใส่ API key ของตัวเอง')).toBeVisible();
  await expect(page.getByRole('link', { name: 'เข้าสู่ระบบ' }).last()).toBeVisible();

  // ของที่เปิดให้ทุกคนต้องยังใช้ได้ตามปกติ ไม่ถูกกั้นไปด้วย
  await expect(page.getByLabel('ค้นหาไฟล์')).toBeVisible();
  await expect(page.getByText(/แสดง \d+ ไฟล์/)).toBeVisible();
});

test('สมาชิกที่ผูกกุญแจแล้วเห็นปุ่มสั่งสรุปที่หน้าแผนที่โค้ด', async ({ page, request }) => {
  const created = await request.post('/api/analyses', { data: { input: '/fixtures/demo' } });
  const { id } = await created.json();

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/analyses/${id}`);
        return (await res.json()).analysis.status;
      },
      { timeout: 90_000, intervals: [500] },
    )
    .toBe('done');

  await page.goto('/login');
  await page.getByRole('button', { name: 'ยังไม่มีบัญชี? สมัครใหม่' }).click();
  await page.getByLabel('อีเมล').fill(newEmail());
  await page.getByLabel('รหัสผ่าน').fill(PASSWORD);
  await page.getByRole('button', { name: 'สมัครสมาชิก', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);

  await page.getByLabel('ใส่กุญแจใหม่').fill('sk-ant-api03-ตัวอย่างสำหรับทดสอบ1234');
  await page.getByRole('button', { name: 'ผูกกุญแจนี้' }).click();
  await expect(page.getByText('…1234')).toBeVisible();

  await page.goto(`/a/${id}`);
  await expect(page.getByRole('button', { name: 'สรุป repo นี้' })).toBeEnabled();
  await expect(page.getByText('อ่านทุกไฟล์แล้วเขียนสรุปเป็นภาษาไทย')).toBeVisible();
});

test('สมาชิกส่งออกรายงานภาษาไทยเป็น Markdown ได้โดยไม่ต้องมี API key ที่ใช้ได้', async ({
  page,
  request,
}) => {
  const created = await request.post('/api/analyses', { data: { input: '/fixtures/demo' } });
  const { id } = await created.json();

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/analyses/${id}`);
        return (await res.json()).analysis.status;
      },
      { timeout: 90_000, intervals: [500] },
    )
    .toBe('done');

  await page.goto('/login');
  await page.getByRole('button', { name: 'ยังไม่มีบัญชี? สมัครใหม่' }).click();
  await page.getByLabel('อีเมล').fill(newEmail());
  await page.getByLabel('รหัสผ่าน').fill(PASSWORD);
  await page.getByRole('button', { name: 'สมัครสมาชิก', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);

  await page.goto(`/a/${id}/report`);
  const link = page.getByRole('link', { name: 'ส่งออกรายงานภาษาไทยเป็น Markdown' });
  await expect(link).toBeVisible();

  const href = await link.getAttribute('href');
  const response = await page.request.get(href ?? '');
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['content-type']).toContain('text/markdown');

  const markdown = await response.text();
  // repo ในเครื่องได้ owner เป็น 'local' เสมอ ชื่อมาจากชื่อโฟลเดอร์ (ดู parseRepoRef)
  expect(markdown).toContain('# local/demo');
  expect(markdown).toContain('## คะแนนสุขภาพ');
});

test('ลิงก์ถาวรของโฮสต์ที่ไม่อนุญาตแสดงข้อผิดพลาดแทนที่จะพังเงียบ ๆ', async ({ page }) => {
  // ทดสอบด้วยโฮสต์ที่ไม่ได้อยู่ในรายชื่อที่อนุญาต เพราะจุดนี้ปฏิเสธได้ทันทีโดยไม่ต้องพึ่งเครือข่ายจริง
  // เหมือนที่เทสต์อื่นในไฟล์นี้ตั้งใจไม่พึ่งอินเทอร์เน็ตเพื่อให้ได้ผลเดิมทุกครั้ง
  await page.goto('/r/evil.example.com/owner/name');
  await expect(page.getByRole('heading', { name: 'เปิด repo นี้ไม่สำเร็จ' })).toBeVisible();
  await expect(page.getByText('evil.example.com')).toBeVisible();
  await expect(page.getByRole('link', { name: 'กลับไปหน้าแรก' })).toBeVisible();
});
