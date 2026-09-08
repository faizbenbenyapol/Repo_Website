import { expect, test, type Page } from '@playwright/test';

/**
 * ตรวจว่าหน้าไม่ล้นแนวนอนที่ความกว้างมือถือ (375px) — เกณฑ์ผ่านของ v0.8.0
 * เคยพบว่าแถบหัวเว็บ (โลโก้ + ลิงก์ + ชิปเซสชัน) ล้นออกนอกจอจริง (scrollWidth 396 vs clientWidth 375)
 * จึงยึด document.documentElement.scrollWidth เทียบ clientWidth เป็นตัวชี้วัดตรง ๆ แทนการดูภาพ
 */
async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    scrollWidth,
    `เนื้อหาล้นแนวนอน: scrollWidth=${scrollWidth} clientWidth=${clientWidth}`,
  ).toBe(clientWidth);
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

test.use({ viewport: { width: 375, height: 812 } });

test('หน้าแรกไม่ล้นแนวนอนที่ความกว้างมือถือ', async ({ page }) => {
  await page.goto('/');
  await expectNoHorizontalOverflow(page);
});

test('หน้าเข้าสู่ระบบไม่ล้นแนวนอนที่ความกว้างมือถือ', async ({ page }) => {
  await page.goto('/login');
  await expectNoHorizontalOverflow(page);
});

test('หน้าประวัติเวอร์ชันไม่ล้นแนวนอนที่ความกว้างมือถือ', async ({ page }) => {
  await page.goto('/versions');
  await expectNoHorizontalOverflow(page);
});

test('หน้าแผนที่โค้ดไม่ล้นแนวนอนที่ความกว้างมือถือ', async ({ page, request }) => {
  const id = await analyzedRepoId(request);
  await page.goto(`/a/${id}`);
  await expectNoHorizontalOverflow(page);
});

test('หน้าสุขภาพโค้ดไม่ล้นแนวนอนที่ความกว้างมือถือ', async ({ page, request }) => {
  const id = await analyzedRepoId(request);
  await page.goto(`/a/${id}/report`);
  await expectNoHorizontalOverflow(page);
});

test('หน้าถาม–ตอบไม่ล้นแนวนอนที่ความกว้างมือถือ', async ({ page, request }) => {
  const id = await analyzedRepoId(request);
  await page.goto(`/a/${id}/chat`);
  await expectNoHorizontalOverflow(page);
});
