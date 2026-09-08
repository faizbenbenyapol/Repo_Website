import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * ตรวจการเข้าถึงได้ด้วย axe-core ตามเกณฑ์ผ่านของ v0.8.0 — ต้องไม่มีปัญหาระดับ critical
 * ทดสอบเฉพาะ WCAG 2.1 AA เพราะเป็นระดับที่ PLAN.md อ้างอิง (คอนทราสต์ ≥ 4.5:1, โฟกัสเห็นชัด)
 *
 * ปิดแอนิเมชันก่อนสแกนเสมอ — องค์ประกอบที่กำลังจาง (.rise) ยังมีความทึบต่ำกว่า 1 ระหว่างเล่นอยู่
 * ถ้าสแกนตอนนั้นพอดี axe จะวัดคอนทราสต์ผิดเพี้ยนจากค่าจริงตอนแสดงผลนิ่งแล้ว (ผลลัพธ์สั่นไม่คงที่)
 */
async function scan(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  return new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
}

function describeViolations(results: Awaited<ReturnType<typeof scan>>): string {
  return results.violations
    .map((v) => `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} จุด)`)
    .join('\n');
}

async function expectNoCritical(page: Page) {
  const results = await scan(page);
  const critical = results.violations.filter((v) => v.impact === 'critical');
  expect(critical, describeViolations(results)).toEqual([]);
}

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

for (const [label, colorScheme] of [
  ['สว่าง', 'light'],
  ['มืด', 'dark'],
] as const) {
  test(`หน้าแรกไม่มีปัญหาการเข้าถึงระดับ critical (ธีม${label})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await expectNoCritical(page);
  });

  test(`หน้าเข้าสู่ระบบไม่มีปัญหาการเข้าถึงระดับ critical (ธีม${label})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/login');
    await expectNoCritical(page);
  });

  test(`หน้าสมัครสมาชิก (สลับฟอร์ม) ไม่มีปัญหาการเข้าถึงระดับ critical (ธีม${label})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/login');
    await page.getByRole('button', { name: 'ยังไม่มีบัญชี? สมัครใหม่' }).click();
    await expectNoCritical(page);
  });

  test(`หน้าประวัติเวอร์ชันไม่มีปัญหาการเข้าถึงระดับ critical (ธีม${label})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/versions');
    await expectNoCritical(page);
  });
}

test('หน้าแผนที่โค้ดไม่มีปัญหาการเข้าถึงระดับ critical', async ({ page, request }) => {
  const id = await analyzedRepoId(request);
  await page.goto(`/a/${id}`);
  await expectNoCritical(page);
});

test('หน้าสุขภาพโค้ดไม่มีปัญหาการเข้าถึงระดับ critical', async ({ page, request }) => {
  const id = await analyzedRepoId(request);
  await page.goto(`/a/${id}/report`);
  await expectNoCritical(page);
});

test('หน้าถาม–ตอบไม่มีปัญหาการเข้าถึงระดับ critical', async ({ page, request }) => {
  const id = await analyzedRepoId(request);
  await page.goto(`/a/${id}/chat`);
  await expectNoCritical(page);
});
