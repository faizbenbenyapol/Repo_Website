import { expect, test } from '@playwright/test';

/**
 * ทดสอบไปป์ไลน์จริงทั้งเส้น: สั่งงาน → worker โคลน → อ่านโครงสร้าง → เก็บผล → หน้าเว็บแสดง
 * ใช้ repo ตัวอย่างที่ compose เตรียมไว้ในเครื่อง จึงไม่พึ่งเครือข่ายและได้ผลเหมือนกันทุกครั้ง
 */
test('สั่งวิเคราะห์แล้วได้หน้าผลลัพธ์ที่มีข้อมูลจริง', async ({ page, request }) => {
  const created = await request.post('/api/analyses', {
    data: { input: '/fixtures/demo', refresh: true },
  });
  expect(created.status()).toBe(202);
  const { id } = await created.json();

  await page.goto(`/analyzing/${id}`);

  // repo ตัวอย่างเล็กมาก งานอาจเสร็จก่อนหน้าจะโหลดเสร็จด้วยซ้ำ
  // สิ่งที่ต้องเป็นจริงเสมอคือสุดท้ายผู้ใช้ต้องไปถึงหน้าผลลัพธ์เอง โดยไม่ต้องกดอะไร
  await expect(page).toHaveURL(new RegExp(`/a/${id}$`), { timeout: 90_000 });

  await expect(page.getByText('ไฟล์ทั้งหมด')).toBeVisible();
  await expect(page.getByText('เส้นเชื่อมระหว่างไฟล์')).toBeVisible();
  await expect(page.getByRole('table')).toContainText('src/util/format.ts');
  await expect(page.getByText('สัดส่วนภาษา')).toBeVisible();
});

test('หน้าความคืบหน้าแสดงครบทุกขั้น และบอกเหตุผลเมื่อวิเคราะห์ไม่สำเร็จ', async ({
  page,
  request,
}) => {
  // ใช้ที่อยู่ที่ไม่มีอยู่จริง งานจะจบสถานะล้มเหลวแน่นอน หน้าจึงไม่เด้งไปไหนและตรวจได้นิ่ง ๆ
  const created = await request.post('/api/analyses', {
    data: { input: '/fixtures/ไม่มีโฟลเดอร์นี้', refresh: true },
  });
  const { id } = await created.json();

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/analyses/${id}`);
        return (await res.json()).analysis.status;
      },
      { timeout: 60_000, intervals: [500] },
    )
    .toBe('failed');

  await page.goto(`/analyzing/${id}`);

  for (const stage of [
    'ตรวจสอบที่อยู่ repo',
    'ดาวน์โหลดซอร์สโค้ด',
    'สำรวจไฟล์ทั้งหมด',
    'อ่านโครงสร้างโค้ด',
    'เชื่อมความสัมพันธ์',
    'สรุปผล',
  ]) {
    await expect(page.getByText(stage, { exact: true })).toBeVisible();
  }

  await expect(page.getByText('วิเคราะห์ไม่สำเร็จ')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('ไม่พบโฟลเดอร์ที่ระบุ');
  await expect(page.getByRole('link', { name: 'ลองที่อยู่อื่นอีกครั้ง' })).toBeVisible();
});

test('ผลวิเคราะห์ที่เก็บไว้ ตอบผ่าน API ได้ครบ', async ({ request }) => {
  const created = await request.post('/api/analyses', { data: { input: '/fixtures/demo' } });
  const { id } = await created.json();

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/analyses/${id}`);
        return (await res.json()).analysis.status;
      },
      { timeout: 90_000, intervals: [1000] },
    )
    .toBe('done');

  const detail = await (await request.get(`/api/analyses/${id}`)).json();
  expect(detail.analysis.totals.files).toBeGreaterThan(3);
  expect(detail.analysis.engines.treeSitter).toBeGreaterThan(0);
  expect(detail.analysis.commitSha).toHaveLength(40);

  const { files } = await (await request.get(`/api/analyses/${id}/files?order=dependents`)).json();
  expect(files[0].path).toBe('src/util/format.ts');
  expect(files[0].dependents).toBeGreaterThanOrEqual(2);

  const { edges } = await (await request.get(`/api/analyses/${id}/edges`)).json();
  expect(edges.some((edge: { src: string; dst: string }) => edge.src === 'src/index.ts')).toBe(
    true,
  );
  expect(edges.some((edge: { src: string; dst: string }) => edge.src === 'scripts/tool.py')).toBe(
    true,
  );
});

test('สั่งซ้ำด้วย repo เดิมได้ผลเดิมกลับมาทันที ไม่วิเคราะห์ใหม่', async ({ request }) => {
  const first = await request.post('/api/analyses', { data: { input: '/fixtures/demo' } });
  const firstBody = await first.json();

  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/analyses/${firstBody.id}`);
        return (await res.json()).analysis.status;
      },
      { timeout: 90_000, intervals: [1000] },
    )
    .toBe('done');

  const second = await request.post('/api/analyses', { data: { input: '/fixtures/demo' } });
  expect(second.status()).toBe(200);
  const secondBody = await second.json();
  expect(secondBody.cached).toBe(true);
  expect(secondBody.id).toBe(firstBody.id);
});

test('ปฏิเสธที่อยู่นอกรายชื่อโฮสต์ที่อนุญาต พร้อมบอกเหตุผลเป็นภาษาไทย', async ({ request }) => {
  const response = await request.post('/api/analyses', {
    data: { input: 'https://example.com/a/b' },
  });
  expect(response.status()).toBe(400);
  expect((await response.json()).error).toContain('example.com');
});
