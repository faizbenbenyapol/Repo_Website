import { expect, test } from '@playwright/test';

/**
 * ทดสอบไปป์ไลน์จริงทั้งเส้น: สั่งงาน → worker โคลน → อ่านโครงสร้าง → เก็บผล → หน้าเว็บแสดง
 * ใช้ repo ตัวอย่างที่ compose เตรียมไว้ในเครื่อง จึงไม่พึ่งเครือข่ายและได้ผลเหมือนกันทุกครั้ง
 */
test('สั่งวิเคราะห์แล้วได้แผนที่โค้ดที่มีข้อมูลจริง', async ({ page, request }) => {
  const created = await request.post('/api/analyses', {
    data: { input: '/fixtures/demo', refresh: true },
  });
  expect(created.status()).toBe(202);
  const { id } = await created.json();

  await page.goto(`/analyzing/${id}`);

  // repo ตัวอย่างเล็กมาก งานอาจเสร็จก่อนหน้าจะโหลดเสร็จด้วยซ้ำ
  // สิ่งที่ต้องเป็นจริงเสมอคือสุดท้ายผู้ใช้ต้องไปถึงหน้าผลลัพธ์เอง โดยไม่ต้องกดอะไร
  await expect(page).toHaveURL(new RegExp(`/a/${id}$`), { timeout: 90_000 });

  await expect(page.getByRole('heading', { level: 1 })).toContainText('demo');
  await expect(page.getByText(/แสดง \d+ ไฟล์/)).toBeVisible();
  await expect(page.getByLabel('ค้นหาไฟล์')).toBeVisible();
});

test('เลือกไฟล์จากรายการแล้วแผงรายละเอียดบอกทั้งฟังก์ชันและไฟล์ที่เกี่ยวข้อง', async ({
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

  // ก่อนเลือกอะไร แผงขวาต้องบอกว่าต้องทำอะไรต่อ ไม่ใช่ปล่อยว่าง
  await expect(page.getByText('ยังไม่ได้เลือกไฟล์')).toBeVisible();

  await page.getByLabel('ค้นหาไฟล์').fill('format');
  await page.getByRole('button', { name: 'format.ts' }).click();

  await expect(page.getByText('ไฟล์ที่เลือก')).toBeVisible();
  await expect(page.getByText('src/util/format.ts')).toBeVisible();
  await expect(page.getByText('formatName')).toBeVisible();
  await expect(page.getByText('ไฟล์ที่พึ่งพาไฟล์นี้')).toBeVisible();
  await expect(page.getByText('src/greet.ts')).toBeVisible();
});

test('สลับโหมดสีของกราฟได้ และหน้าสรุปตัวเลขยังเปิดได้จากหน้าแผนที่', async ({ page, request }) => {
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

  await page.getByRole('button', { name: 'ภาษา' }).click();
  await expect(page.getByText('ดูว่าแต่ละส่วนเขียนด้วยภาษาอะไร')).toBeVisible();

  await page.getByRole('button', { name: 'ความสำคัญ' }).click();
  await expect(page.getByText('ยิ่งเข้ม ยิ่งมีไฟล์อื่นพึ่งพามาก')).toBeVisible();

  await page.getByRole('link', { name: 'สรุปตัวเลขทั้งหมด' }).click();
  await expect(page).toHaveURL(new RegExp(`/a/${id}/report$`));
  await expect(page.getByText('ไฟล์ทั้งหมด')).toBeVisible();
  await expect(page.getByText('สัดส่วนภาษา')).toBeVisible();
});

test('หน้าสุขภาพโค้ดบอกเกรด ที่มาของคะแนน และข้อสังเกตด้านความปลอดภัย', async ({
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

  await page.goto(`/a/${id}/report`);

  await expect(page.getByRole('heading', { level: 1 })).toContainText('demo');
  await expect(page.getByText('คะแนนเริ่มจากเต็มร้อย แล้วหักตามที่พบ')).toBeVisible();

  // ทุกข้อที่หักคะแนนต้องอธิบายที่มาได้ ไม่ใช่โชว์แค่ตัวเลขรวม
  const breakdown = page.getByRole('list', { name: 'ที่มาของคะแนนสุขภาพ' });
  for (const label of ['โค้ดที่ไม่มีใครเรียกใช้', 'วงจรพึ่งพา', 'ความผูกกันแน่น', 'ความปลอดภัย']) {
    await expect(breakdown.getByText(label, { exact: true })).toBeVisible();
  }

  // repo ตัวอย่างมีกุญแจปลอมฝังไว้ ต้องถูกจับได้และค่าต้องถูกกลบ
  await expect(page.getByText('ข้อสังเกตด้านความปลอดภัย')).toBeVisible();
  await expect(page.getByText('พบค่าที่ดูเหมือนกุญแจหรือรหัสผ่านเขียนตรง ๆ ในโค้ด')).toBeVisible();
  await expect(page.locator('pre').filter({ hasText: 'ถูกกลบไว้' }).first()).toBeVisible();
  expect(await page.content()).not.toContain('sk_live_0123456789abcdefghij');

  await expect(page.getByText('รัศมีผลกระทบสูงสุด')).toBeVisible();
});

test('ส่งออกผลวิเคราะห์ทั้งชุดเป็น JSON ได้', async ({ request }) => {
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

  const response = await request.get(`/api/analyses/${id}/export`);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-disposition']).toContain('attachment');

  const body = await response.json();
  expect(body.repo.name).toBe('demo');
  expect(body.metrics.health.grade).toMatch(/^[ABCDF]$/);
  expect(body.files.length).toBeGreaterThan(3);
  expect(body.edges.length).toBeGreaterThan(0);
  expect(body.findings.some((f: { rule: string }) => f.rule === 'hardcoded-secret')).toBe(true);
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
    'คำนวณตัวชี้วัด',
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
