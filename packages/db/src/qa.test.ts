import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAnalysis,
  createDb,
  createUser,
  listQaMessages,
  recentQaMessages,
  runMigrations,
  saveQaMessage,
  type Db,
} from './index.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('ต้องตั้ง DATABASE_URL ก่อนรันชุดทดสอบฐานข้อมูล');

let sql: Db;
const stamp = Date.now();
const ref = { host: 'github.com', owner: `qa-${stamp}`, name: 'repo', cloneUrl: '', local: false };

let analysisId: string;
let userId: string;
let otherUserId: string;

beforeAll(async () => {
  sql = createDb(url);
  await runMigrations(sql);

  analysisId = await createAnalysis(sql, {
    ref,
    requestedInput: `${ref.owner}/${ref.name}`,
    analyzerSchema: 1,
    appVersion: '0.6.0',
  });

  const user = await createUser(sql, { email: `qa-${stamp}@repolens.test`, passwordHash: 'x' });
  const other = await createUser(sql, {
    email: `qa-other-${stamp}@repolens.test`,
    passwordHash: 'x',
  });
  if (!user || !other) throw new Error('สร้างผู้ใช้ไม่สำเร็จ');
  userId = user.id;
  otherUserId = other.id;
}, 60_000);

afterAll(async () => {
  await sql`delete from repos where owner = ${ref.owner}`;
  await sql`delete from users where email like ${`qa%-${stamp}@repolens.test`}`;
  await sql.end();
});

describe('การบันทึกและอ่านประวัติคำถาม', () => {
  it('บันทึกแล้วอ่านกลับได้ครบ พร้อมข้ออ้างอิง', async () => {
    const saved = await saveQaMessage(sql, {
      analysisId,
      userId,
      question: 'ระบบล็อกอินทำงานอย่างไร',
      claims: [{ text: 'ตรวจรหัสผ่านด้วย scrypt', citations: [{ path: 'src/auth.ts', line: 12 }] }],
      model: 'claude-sonnet-5',
      inputTokens: 100,
      outputTokens: 40,
    });

    expect(saved.question).toBe('ระบบล็อกอินทำงานอย่างไร');
    expect(saved.claims[0]?.citations[0]).toEqual({ path: 'src/auth.ts', line: 12 });

    const history = await listQaMessages(sql, analysisId, userId);
    expect(history.map((message) => message.id)).toContain(saved.id);
  });

  it('เรียงประวัติจากเก่าไปใหม่', async () => {
    await saveQaMessage(sql, {
      analysisId,
      userId,
      question: 'คำถามที่สอง',
      claims: [],
      model: null,
      inputTokens: 0,
      outputTokens: 0,
    });

    const history = await listQaMessages(sql, analysisId, userId);
    const times = history.map((message) => new Date(message.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('เห็นเฉพาะประวัติของผู้ใช้ตัวเอง ไม่ปนกับคนอื่น', async () => {
    await saveQaMessage(sql, {
      analysisId,
      userId: otherUserId,
      question: 'คำถามของอีกคน',
      claims: [],
      model: null,
      inputTokens: 0,
      outputTokens: 0,
    });

    const mine = await listQaMessages(sql, analysisId, userId);
    expect(mine.every((message) => message.question !== 'คำถามของอีกคน')).toBe(true);

    const theirs = await listQaMessages(sql, analysisId, otherUserId);
    expect(theirs.some((message) => message.question === 'คำถามของอีกคน')).toBe(true);
  });

  it('คำถามล่าสุดไม่กี่ข้อเรียงเก่าไปใหม่เช่นกัน และจำกัดจำนวนได้', async () => {
    const recent = await recentQaMessages(sql, analysisId, userId, 1);
    expect(recent).toHaveLength(1);
    expect(recent[0]?.question).toBe('คำถามที่สอง');
  });

  it('งานวิเคราะห์ที่ยังไม่มีใครถามอะไรเลยคืนรายการว่าง', async () => {
    const empty = await listQaMessages(sql, '00000000-0000-4000-8000-000000000000', userId);
    expect(empty).toEqual([]);
  });
});
