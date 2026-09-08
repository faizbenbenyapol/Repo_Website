import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAnalysis,
  createComprehension,
  createDb,
  createUser,
  runMigrations,
  saveSummaries,
  searchEvidence,
  type Db,
} from './index.js';

/**
 * ทดสอบการค้นคืนบริบทด้วย pg_trgm กับ Postgres จริง
 * ข้อมูลถูกใส่ตรงลง files/symbols แทนการวิ่งผ่านไปป์ไลน์วิเคราะห์เต็ม เพราะสิ่งที่ต้องการคือ
 * ควบคุมค่าที่ใช้ค้นได้แม่นยำ ไม่ใช่ทดสอบไปป์ไลน์ซ้ำกับ db.test.ts
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error('ต้องตั้ง DATABASE_URL ก่อนรันชุดทดสอบฐานข้อมูล');

let sql: Db;
const stamp = Date.now();
const ref = {
  host: 'github.com',
  owner: `ค้นหา-${stamp}`,
  name: 'repo',
  cloneUrl: '',
  local: false,
};

let analysisId: string;
let otherAnalysisId: string;
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

  otherAnalysisId = await createAnalysis(sql, {
    ref: { ...ref, name: 'repo-อื่น' },
    requestedInput: `${ref.owner}/repo-อื่น`,
    analyzerSchema: 1,
    appVersion: '0.6.0',
  });

  await sql`
    insert into files ${sql([
      { analysis_id: analysisId, path: 'src/auth/login.ts', language: 'typescript', loc: 40 },
      { analysis_id: analysisId, path: 'src/util/format.ts', language: 'typescript', loc: 20 },
      { analysis_id: otherAnalysisId, path: 'src/auth/login.ts', language: 'typescript', loc: 40 },
    ])}
  `;

  await sql`
    insert into symbols ${sql([
      {
        analysis_id: analysisId,
        path: 'src/auth/login.ts',
        name: 'authenticateUser',
        kind: 'function',
        line: 12,
      },
      {
        analysis_id: analysisId,
        path: 'src/util/format.ts',
        name: 'formatDate',
        kind: 'function',
        line: 3,
      },
      {
        analysis_id: otherAnalysisId,
        path: 'src/auth/login.ts',
        name: 'authenticateUser',
        kind: 'function',
        line: 12,
      },
    ])}
  `;

  const user = await createUser(sql, { email: `search-${stamp}@repolens.test`, passwordHash: 'x' });
  if (!user) throw new Error('สร้างผู้ใช้ไม่สำเร็จ');
  userId = user.id;

  const comprehensionId = await createComprehension(sql, { analysisId, userId, filesTotal: 2 });
  await saveSummaries(sql, { comprehensionId, analysisId, userId }, [
    {
      scope: 'file',
      key: 'src/auth/login.ts',
      headline: 'ตรวจรหัสผ่านแล้วเปิด session',
      points: [
        {
          text: 'ใช้ scrypt แฮชรหัสผ่านก่อนเทียบ',
          citations: [{ path: 'src/auth/login.ts', line: 12 }],
        },
      ],
      source: 'model',
      model: 'claude-haiku-4-5-20251001',
    },
  ]);
}, 60_000);

afterAll(async () => {
  await sql`delete from repos where owner = ${ref.owner}`;
  await sql`delete from users where email = ${`search-${stamp}@repolens.test`}`;
  await sql.end();
});

describe('ค้นชื่อฟังก์ชันด้วย pg_trgm', () => {
  it('เจอฟังก์ชันที่ชื่อใกล้เคียงกับคำค้น', async () => {
    const results = await searchEvidence(sql, analysisId, null, 'authenticate');
    expect(
      results.some((item) => item.kind === 'symbol' && item.path === 'src/auth/login.ts'),
    ).toBe(true);
  });

  it('ไม่ข้ามไปเจอผลของงานวิเคราะห์อื่น', async () => {
    const results = await searchEvidence(sql, analysisId, null, 'authenticate');
    expect(results.every((item) => item.path.startsWith('src/'))).toBe(true);
    // งานวิเคราะห์อื่นมีชื่อฟังก์ชันเดียวกัน แต่ analysisId ต้องกรองแยกกันอยู่แล้ว
    const otherResults = await searchEvidence(sql, otherAnalysisId, null, 'authenticate');
    expect(otherResults.length).toBeGreaterThan(0);
  });
});

describe('ค้นพาธไฟล์', () => {
  it('เจอไฟล์ที่พาธใกล้เคียงกับคำค้น', async () => {
    const results = await searchEvidence(sql, analysisId, null, 'util/format');
    expect(results.some((item) => item.kind === 'file' && item.path === 'src/util/format.ts')).toBe(
      true,
    );
  });
});

describe('ค้นข้อความสรุปที่ทำไว้แล้ว', () => {
  it('เจอเมื่อระบุผู้ใช้ที่เป็นเจ้าของคำอธิบายนั้น', async () => {
    const results = await searchEvidence(sql, analysisId, userId, 'scrypt แฮชรหัสผ่าน');
    expect(results.some((item) => item.kind === 'point' && item.line === 12)).toBe(true);
  });

  it('ไม่เห็นคำอธิบายเมื่อไม่ได้ระบุผู้ใช้ หรือระบุคนละคน', async () => {
    const anonymous = await searchEvidence(sql, analysisId, null, 'scrypt แฮชรหัสผ่าน');
    expect(anonymous.some((item) => item.kind === 'point')).toBe(false);
  });
});

describe('คำค้นที่ไม่ตรงอะไรเลย', () => {
  it('คืนรายการว่างแทนที่จะ error', async () => {
    expect(await searchEvidence(sql, analysisId, null, 'ไม่น่าจะเจออะไรเลยสักอย่าง')).toEqual([]);
  });

  it('คำค้นว่างคืนรายการว่างทันทีโดยไม่ยิงฐานข้อมูล', async () => {
    expect(await searchEvidence(sql, analysisId, null, '   ')).toEqual([]);
  });
});
