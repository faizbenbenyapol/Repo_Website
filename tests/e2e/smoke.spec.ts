import { expect, test } from '@playwright/test';

test('หน้าแรกบอกได้ว่าเว็บนี้ทำอะไรและใช้งานสองระดับอย่างไร', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('วางลิงก์ repo');
  await expect(page.getByRole('heading', { name: 'ผู้เยี่ยมชม' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'สมาชิก' })).toBeVisible();
  await expect(page.getByText('API key ของ Claude ที่เป็นของคุณเอง')).toBeVisible();
});

test('ช่องใส่ลิงก์ทักเมื่อพิมพ์ผิด และรับได้เมื่อพิมพ์ถูก', async ({ page }) => {
  await page.goto('/');
  const input = page.getByLabel('ที่อยู่ repo ที่ต้องการอ่าน');

  await input.fill('ไม่ใช่ลิงก์');
  await page.getByRole('button', { name: 'อ่าน repo นี้' }).click();
  await expect(page.getByRole('status')).toContainText('อ่านที่อยู่นี้ไม่ออก');

  await input.fill('https://github.com/facebook/react');
  await page.getByRole('button', { name: 'อ่าน repo นี้' }).click();
  await expect(page.getByRole('status')).toContainText('facebook/react');
});

test('ป้ายเวอร์ชันพาไปหน้าประวัติที่อ่านย้อนหลังได้', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('ดูบันทึกการเปลี่ยนแปลงย้อนหลังทุกรุ่น').click();
  await expect(page).toHaveURL(/\/versions$/);
  await expect(page.getByRole('heading', { name: 'ทุกรุ่นที่ปล่อยมา' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'v0.1.0' })).toBeVisible();
  await expect(page.getByText('โครงและวินัย')).toBeVisible();
});

test('API ตอบเรื่องรุ่นและสถานะการใช้งานผ่านโดเมนเดียวกับหน้าเว็บ', async ({ request }) => {
  const health = await request.get('/api/health');
  expect(health.ok()).toBeTruthy();

  const version = await request.get('/api/version');
  expect((await version.json()).analyzerSchema).toBe(1);

  const session = await request.get('/api/session');
  const body = await session.json();
  expect(body.session.tier).toBe('visitor');
  expect(body.session.aiEnabled).toBe(false);
});
