import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAnalysis,
  createDb,
  createUser,
  getReadingPath,
  runMigrations,
  saveReadingPath,
  type Db,
} from './index.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('ต้องตั้ง DATABASE_URL ก่อนรันชุดทดสอบฐานข้อมูล');

let sql: Db;
const stamp = Date.now();
const ref = { host: 'github.com', owner: `rp-${stamp}`, name: 'repo', cloneUrl: '', local: false };

let analysisId: string;
let userId: string;

beforeAll(async () => {
  sql = createDb(url);
  await runMigrations(sql);

  analysisId = await createAnalysis(sql, {
    ref,
    requestedInput: `${ref.owner}/${ref.name}`,
    analyzerSchema: 1,
    appVersion: '0.6.0',
  });

  const user = await createUser(sql, { email: `rp-${stamp}@repolens.test`, passwordHash: 'x' });
  if (!user) throw new Error('สร้างผู้ใช้ไม่สำเร็จ');
  userId = user.id;
}, 60_000);

afterAll(async () => {
  await sql`delete from repos where owner = ${ref.owner}`;
  await sql`delete from users where email = ${`rp-${stamp}@repolens.test`}`;
  await sql.end();
});

describe('เส้นทางอ่านโค้ด', () => {
  it('ยังไม่เคยสร้างคืน null', async () => {
    expect(await getReadingPath(sql, analysisId, userId)).toBeNull();
  });

  it('บันทึกแล้วอ่านกลับได้ครบทุกขั้นตอน', async () => {
    await saveReadingPath(sql, {
      analysisId,
      userId,
      steps: [
        {
          path: 'src/util.ts',
          order: 1,
          why: [
            { text: 'พื้นฐานที่ไฟล์อื่นเรียกใช้', citations: [{ path: 'src/util.ts', line: 1 }] },
          ],
          lookFor: [],
        },
        {
          path: 'src/index.ts',
          order: 2,
          why: [{ text: 'จุดเริ่มโปรแกรม', citations: [{ path: 'src/index.ts', line: 1 }] }],
          lookFor: [],
        },
      ],
      model: 'claude-sonnet-5',
      inputTokens: 500,
      outputTokens: 200,
    });

    const path = await getReadingPath(sql, analysisId, userId);
    expect(path?.steps).toHaveLength(2);
    expect(path?.steps[0]?.path).toBe('src/util.ts');
    expect(path?.model).toBe('claude-sonnet-5');
  });

  it('สั่งใหม่แล้วแทนที่ชุดเดิม ไม่ใช่เพิ่มแถวใหม่', async () => {
    await saveReadingPath(sql, {
      analysisId,
      userId,
      steps: [
        {
          path: 'src/index.ts',
          order: 1,
          why: [{ text: 'ชุดใหม่', citations: [{ path: 'src/index.ts', line: 1 }] }],
          lookFor: [],
        },
      ],
      model: 'claude-sonnet-5',
      inputTokens: 10,
      outputTokens: 5,
    });

    const path = await getReadingPath(sql, analysisId, userId);
    expect(path?.steps).toHaveLength(1);
    expect(path?.steps[0]?.why[0]?.text).toBe('ชุดใหม่');
  });
});
