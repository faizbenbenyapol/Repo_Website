import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  countFileSummaries,
  createAnalysis,
  createComprehension,
  createDb,
  createSession,
  createUser,
  deleteExpiredSessions,
  deleteSession,
  findLatestComprehension,
  findSession,
  findUserByEmail,
  finishComprehension,
  getComprehension,
  getComprehensionOwner,
  getFileSummary,
  getModuleSummaries,
  getRepoDigest,
  markComprehensionFailed,
  runMigrations,
  saveSummaries,
  touchSession,
  updateComprehensionProgress,
  type Db,
} from './index.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('ต้องตั้ง DATABASE_URL ก่อนรันชุดทดสอบฐานข้อมูล');

let sql: Db;

const stamp = Date.now();
const ref = {
  host: 'github.com',
  owner: `บัญชี-${stamp}`,
  name: 'repo-ทดสอบ',
  cloneUrl: '',
  local: false,
};

const later = (): Date => new Date(Date.now() + 3600_000);

beforeAll(async () => {
  sql = createDb(url);
  await runMigrations(sql);
}, 60_000);

afterAll(async () => {
  await sql`delete from repos where owner = ${ref.owner}`;
  await sql`delete from users where email like ${`%-${stamp}@repolens.test`}`;
  await sql.end();
});

describe('บัญชีผู้ใช้', () => {
  it('สมัครแล้วหาเจอด้วยอีเมลที่พิมพ์ตัวใหญ่ตัวเล็กไม่เหมือนเดิม', async () => {
    const email = `คนแรก-${stamp}@repolens.test`;
    const user = await createUser(sql, { email, passwordHash: 'scrypt$ปลอม' });

    expect(user?.email).toBe(email);
    expect((await findUserByEmail(sql, email.toUpperCase()))?.id).toBe(user?.id);
  });

  it('อีเมลซ้ำคืน null แทนที่จะโยน error เพราะเป็นเรื่องปกติที่ผู้ใช้ทำ', async () => {
    const email = `ซ้ำ-${stamp}@repolens.test`;
    expect(await createUser(sql, { email, passwordHash: 'scrypt$ปลอม' })).not.toBeNull();
    expect(await createUser(sql, { email, passwordHash: 'scrypt$ปลอม' })).toBeNull();
  });

  it('อีเมลที่ไม่มีอยู่คืน null', async () => {
    expect(await findUserByEmail(sql, `ไม่มีจริง-${stamp}@repolens.test`)).toBeNull();
  });
});

describe('session', () => {
  it('หา session เจอจากค่าที่ย่อแล้วเท่านั้น', async () => {
    const user = await createUser(sql, {
      email: `เซสชัน-${stamp}@repolens.test`,
      passwordHash: 'scrypt$ปลอม',
    });
    if (!user) throw new Error('สร้างผู้ใช้ไม่สำเร็จ');

    const id = await createSession(sql, {
      userId: user.id,
      tokenHash: `hash-${stamp}`,
      expiresAt: later(),
    });

    const found = await findSession(sql, `hash-${stamp}`);
    expect(found).toMatchObject({ id, userId: user.id, email: user.email });
    expect(await findSession(sql, 'ค่าที่ไม่เคยมี')).toBeNull();
  });

  it('session ที่หมดอายุแล้วถือว่าไม่มี และถูกเก็บกวาดออกได้', async () => {
    const user = await createUser(sql, {
      email: `หมดอายุ-${stamp}@repolens.test`,
      passwordHash: 'scrypt$ปลอม',
    });
    if (!user) throw new Error('สร้างผู้ใช้ไม่สำเร็จ');

    await createSession(sql, {
      userId: user.id,
      tokenHash: `หมดอายุ-${stamp}`,
      expiresAt: new Date(Date.now() - 1000),
    });

    expect(await findSession(sql, `หมดอายุ-${stamp}`)).toBeNull();
    expect(await deleteExpiredSessions(sql)).toBeGreaterThan(0);
  });

  it('ต่ออายุแล้วใช้ได้ต่อ และลบแล้วต้องหายจริง', async () => {
    const user = await createUser(sql, {
      email: `ต่ออายุ-${stamp}@repolens.test`,
      passwordHash: 'scrypt$ปลอม',
    });
    if (!user) throw new Error('สร้างผู้ใช้ไม่สำเร็จ');

    const id = await createSession(sql, {
      userId: user.id,
      tokenHash: `ต่ออายุ-${stamp}`,
      expiresAt: later(),
    });

    await touchSession(sql, id, new Date(Date.now() + 7200_000));
    expect(await findSession(sql, `ต่ออายุ-${stamp}`)).not.toBeNull();

    await deleteSession(sql, `ต่ออายุ-${stamp}`);
    expect(await findSession(sql, `ต่ออายุ-${stamp}`)).toBeNull();
  });
});

describe('งานสรุปและคำอธิบาย', () => {
  let analysisId = '';
  let userId = '';
  let comprehensionId = '';

  beforeAll(async () => {
    const user = await createUser(sql, {
      email: `สรุป-${stamp}@repolens.test`,
      passwordHash: 'scrypt$ปลอม',
    });
    if (!user) throw new Error('สร้างผู้ใช้ไม่สำเร็จ');
    userId = user.id;

    analysisId = await createAnalysis(sql, {
      ref,
      requestedInput: `${ref.owner}/${ref.name}`,
      analyzerSchema: 1,
      appVersion: '0.5.0',
    });

    comprehensionId = await createComprehension(sql, { analysisId, userId, filesTotal: 3 });
  }, 60_000);

  it('งานที่เพิ่งสร้างเข้าคิวไว้ และรู้ว่าใครเป็นเจ้าของ', async () => {
    const run = await getComprehension(sql, comprehensionId);
    expect(run).toMatchObject({ status: 'queued', filesTotal: 3, filesDone: 0, coverage: 0 });
    expect(await getComprehensionOwner(sql, comprehensionId)).toBe(userId);
  });

  it('ความคืบหน้าที่อัปเดตแล้วอ่านกลับได้ตรง', async () => {
    await updateComprehensionProgress(sql, comprehensionId, {
      stage: 'files',
      percent: 40,
      message: 'สรุปทีละไฟล์',
      filesDone: 1,
      commitSha: 'b'.repeat(40),
    });

    const run = await getComprehension(sql, comprehensionId);
    expect(run).toMatchObject({ status: 'running', stage: 'files', percent: 40, filesDone: 1 });
    expect(run?.commitSha).toBe('b'.repeat(40));
  });

  it('เก็บคำอธิบายทั้งสามระดับแล้วอ่านกลับได้แยกกัน', async () => {
    await saveSummaries(sql, { comprehensionId, analysisId, userId }, [
      {
        scope: 'file',
        key: 'src/index.ts',
        headline: 'จุดเริ่มของโปรแกรม',
        points: [{ text: 'เรียก main ที่นี่', citations: [{ path: 'src/index.ts', line: 12 }] }],
        source: 'model',
        model: 'claude-haiku-4-5-20251001',
      },
      {
        scope: 'module',
        key: 'src',
        headline: 'โค้ดหลักของโปรเจกต์',
        points: [],
        detail: { fileCount: 2 },
        source: 'model',
        model: 'claude-sonnet-5',
      },
      {
        scope: 'repo',
        key: '',
        headline: 'เครื่องมืออ่านโค้ด',
        points: [{ text: 'ทำอะไร', citations: [{ path: 'src/index.ts', line: 1 }] }],
        detail: {
          purpose: [{ text: 'ทำอะไร', citations: [{ path: 'src/index.ts', line: 1 }] }],
          stack: [],
          entrypoints: [],
          howToRun: [],
          notes: [],
        },
        source: 'model',
        model: 'claude-opus-5',
      },
    ]);

    const file = await getFileSummary(sql, analysisId, userId, 'src/index.ts');
    expect(file).toMatchObject({ headline: 'จุดเริ่มของโปรแกรม', source: 'model' });
    expect(file?.points[0]?.citations[0]).toEqual({ path: 'src/index.ts', line: 12 });

    const modules = await getModuleSummaries(sql, analysisId, userId);
    expect(modules).toHaveLength(1);
    expect(modules[0]).toMatchObject({ path: 'src', fileCount: 2 });

    const digest = await getRepoDigest(sql, analysisId, userId);
    expect(digest?.headline).toBe('เครื่องมืออ่านโค้ด');
    expect(digest?.purpose).toHaveLength(1);
  });

  it('เขียนคำอธิบายของไฟล์เดิมซ้ำได้ ผลลัพธ์คือของใหม่ ไม่ใช่แถวซ้ำ', async () => {
    await saveSummaries(sql, { comprehensionId, analysisId, userId }, [
      {
        scope: 'file',
        key: 'src/index.ts',
        headline: 'คำอธิบายที่แก้แล้ว',
        points: [],
        source: 'analyzer',
        model: null,
      },
    ]);

    expect((await getFileSummary(sql, analysisId, userId, 'src/index.ts'))?.headline).toBe(
      'คำอธิบายที่แก้แล้ว',
    );
    expect(await countFileSummaries(sql, comprehensionId)).toBe(1);
  });

  it('คำอธิบายของผู้ใช้คนอื่นต้องมองไม่เห็น', async () => {
    const other = await createUser(sql, {
      email: `คนอื่น-${stamp}@repolens.test`,
      passwordHash: 'scrypt$ปลอม',
    });
    if (!other) throw new Error('สร้างผู้ใช้ไม่สำเร็จ');

    expect(await getFileSummary(sql, analysisId, other.id, 'src/index.ts')).toBeNull();
    expect(await getRepoDigest(sql, analysisId, other.id)).toBeNull();
    expect(await getModuleSummaries(sql, analysisId, other.id)).toEqual([]);
  });

  it('ปิดงานแล้วคิดความครอบคลุมจากไฟล์ที่สรุปได้จริง', async () => {
    await finishComprehension(sql, comprehensionId, {
      inputTokens: 1200,
      outputTokens: 300,
      filesDone: 3,
    });

    const run = await findLatestComprehension(sql, analysisId, userId);
    expect(run).toMatchObject({ status: 'done', percent: 100, filesDone: 3, coverage: 1 });
    expect(run?.inputTokens).toBe(1200);
  });

  it('งานที่ล้มเหลวเก็บเหตุผลไว้ให้ผู้ใช้อ่าน', async () => {
    const failing = await createComprehension(sql, { analysisId, userId, filesTotal: 1 });
    await markComprehensionFailed(sql, failing, 'กุญแจหมดอายุแล้ว');

    const run = await getComprehension(sql, failing);
    expect(run).toMatchObject({ status: 'failed', error: 'กุญแจหมดอายุแล้ว' });
  });
});
