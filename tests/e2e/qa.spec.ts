import { expect, test } from '@playwright/test';

/**
 * ถาม–ตอบและเส้นทางอ่านโค้ดเรียกโมเดลจริงเมื่อใช้งาน จึงทดสอบแค่ว่าประตูสิทธิ์ทำงานถูกต้อง
 * และฟอร์มพร้อมใช้งานเมื่อมีสิทธิ์ — ไม่กดส่งจริง เพราะกุญแจในชุดทดสอบนี้เป็นของปลอม
 * (VERIFY_API_KEYS=0 ปิดการตรวจกับ Anthropic ไว้) การกดส่งจริงจะไปยิงเน็ตจริงโดยไม่จำเป็น
 */

function newEmail(): string {
  return `qa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@repolens.test`;
}

const PASSWORD = 'รหัสผ่านที่ยาวพอใช้งานจริง';

async function analyzedRepoId(
  request: import('@playwright/test').APIRequestContext,
): Promise<string> {
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

  return id;
}

test('ผู้เยี่ยมชมเปิดหน้าถาม–ตอบได้ แต่เห็นประตูให้เข้าสู่ระบบก่อน', async ({ page, request }) => {
  const id = await analyzedRepoId(request);

  await page.goto(`/a/${id}/chat`);
  await expect(page.getByText('เปิดให้สมาชิกที่ใส่ API key ของตัวเอง')).toBeVisible();
  await expect(page.getByLabel('ถามคำถามเกี่ยวกับ repo นี้')).toHaveCount(0);
});

test('สมาชิกที่ผูกกุญแจแล้วเห็นฟอร์มถามคำถามพร้อมใช้งาน', async ({ page, request }) => {
  const id = await analyzedRepoId(request);

  await page.goto('/login');
  await page.getByRole('button', { name: 'ยังไม่มีบัญชี? สมัครใหม่' }).click();
  await page.getByLabel('อีเมล').fill(newEmail());
  await page.getByLabel('รหัสผ่าน').fill(PASSWORD);
  await page.getByRole('button', { name: 'สมัครสมาชิก', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);

  await page.getByLabel('ใส่กุญแจใหม่').fill('sk-ant-api03-ตัวอย่างสำหรับทดสอบ5678');
  await page.getByRole('button', { name: 'ผูกกุญแจนี้' }).click();
  await expect(page.getByText('…5678')).toBeVisible();

  await page.goto(`/a/${id}/chat`);
  await expect(page.getByLabel('ถามคำถามเกี่ยวกับ repo นี้')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'ถาม' })).toBeDisabled();

  await page.getByLabel('ถามคำถามเกี่ยวกับ repo นี้').fill('ระบบนี้ทำอะไร');
  await expect(page.getByRole('button', { name: 'ถาม' })).toBeEnabled();
});

test('หน้ารายงานมีปุ่มสร้างเส้นทางอ่านโค้ดเมื่อมีสิทธิ์', async ({ page, request }) => {
  const id = await analyzedRepoId(request);

  await page.goto('/login');
  await page.getByRole('button', { name: 'ยังไม่มีบัญชี? สมัครใหม่' }).click();
  await page.getByLabel('อีเมล').fill(newEmail());
  await page.getByLabel('รหัสผ่าน').fill(PASSWORD);
  await page.getByRole('button', { name: 'สมัครสมาชิก', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);

  await page.getByLabel('ใส่กุญแจใหม่').fill('sk-ant-api03-ตัวอย่างสำหรับทดสอบ9012');
  await page.getByRole('button', { name: 'ผูกกุญแจนี้' }).click();
  await expect(page.getByText('…9012')).toBeVisible();

  await page.goto(`/a/${id}/report`);
  await expect(page.getByText('เส้นทางอ่านโค้ดสำหรับคนใหม่')).toBeVisible();
  await expect(page.getByRole('button', { name: 'สร้างเส้นทางอ่านโค้ด' })).toBeEnabled();
});
