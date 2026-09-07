import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnalysisResult } from '@repolens/analyzer';
import {
  countSymbols,
  createAnalysis,
  createDb,
  findCachedAnalysis,
  getAnalysis,
  getEdges,
  getFiles,
  getGraph,
  getNeighbours,
  getSymbols,
  markFailed,
  runMigrations,
  saveResult,
  updateProgress,
  type Db,
} from './index.js';

/**
 * ทดสอบกับ Postgres จริงที่ compose ยกขึ้นให้ ไม่ใช่ของปลอม
 * ถ้าไม่มีฐานข้อมูลให้ทดสอบ ต้องล้มดัง ๆ ไม่ใช่ข้ามเงียบ ๆ แล้วปล่อยให้ CI เขียวหลอก
 */
const url = process.env.DATABASE_URL;
if (!url) throw new Error('ต้องตั้ง DATABASE_URL ก่อนรันชุดทดสอบฐานข้อมูล');

let sql: Db;

const ref = { host: 'github.com', owner: 'ทดสอบ', name: 'repo-หนึ่ง', cloneUrl: '', local: false };

function makeResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    ref,
    commitSha: 'a'.repeat(40),
    branch: 'main',
    files: [
      {
        path: 'src/index.ts',
        language: 'typescript',
        bytes: 120,
        loc: 8,
        hash: 'abc',
        parsed: true,
        skipReason: null,
      },
      {
        path: 'src/util.ts',
        language: 'typescript',
        bytes: 60,
        loc: 4,
        hash: 'def',
        parsed: true,
        skipReason: null,
      },
      {
        path: 'logo.bin',
        language: null,
        bytes: 4,
        loc: 0,
        hash: 'ghi',
        parsed: false,
        skipReason: 'เป็นไฟล์ไบนารี',
      },
    ],
    totals: {
      files: 3,
      parsed: 2,
      bytes: 184,
      loc: 12,
      languages: [{ language: 'typescript', files: 2, loc: 12 }],
    },
    edges: [{ from: 'src/index.ts', to: 'src/util.ts', kind: 'from', line: 1, confidence: 0.9 }],
    external: [{ specifier: 'react', count: 3 }],
    unresolved: 0,
    symbols: [{ path: 'src/index.ts', name: 'main', kind: 'function', line: 3 }],
    engines: { treeSitter: 2, pattern: 0 },
    warnings: [],
    durationMs: 1234,
    ...overrides,
  };
}

beforeAll(async () => {
  sql = createDb(url);
  await runMigrations(sql);
  await sql`delete from repos where owner = ${ref.owner}`;
}, 60_000);

afterAll(async () => {
  await sql`delete from repos where owner = ${ref.owner}`;
  await sql.end();
});

describe('migration', () => {
  it('รันซ้ำได้โดยไม่พังและไม่ทำงานซ้ำ', async () => {
    const ran = await runMigrations(sql);
    expect(ran).toEqual([]);
  });
});

describe('วงจรชีวิตของงานวิเคราะห์', () => {
  it('สร้างงานแล้วอยู่ในสถานะรอคิว', async () => {
    const id = await createAnalysis(sql, {
      ref,
      requestedInput: 'ทดสอบ/repo-หนึ่ง',
      analyzerSchema: 1,
      appVersion: '0.2.0',
    });

    const row = await getAnalysis(sql, id);
    expect(row?.status).toBe('queued');
    expect(row?.percent).toBe(0);
    expect(row?.owner).toBe(ref.owner);
    expect(row?.message).toContain('คิว');
  });

  it('อัปเดตความคืบหน้าแล้วสถานะเปลี่ยนเป็นกำลังทำงาน', async () => {
    const id = await createAnalysis(sql, {
      ref,
      requestedInput: 'x',
      analyzerSchema: 1,
      appVersion: '0.2.0',
    });
    await updateProgress(sql, id, { stage: 'parse', percent: 80, message: 'อ่านโครงสร้างโค้ด' });

    const row = await getAnalysis(sql, id);
    expect(row?.status).toBe('running');
    expect(row?.stage).toBe('parse');
    expect(row?.percent).toBe(80);
  });

  it('บันทึกผลสำเร็จพร้อมไฟล์ เส้นเชื่อม และ symbol', async () => {
    const id = await createAnalysis(sql, {
      ref,
      requestedInput: 'x',
      analyzerSchema: 1,
      appVersion: '0.2.0',
    });
    await saveResult(sql, id, makeResult());

    const row = await getAnalysis(sql, id);
    expect(row?.status).toBe('done');
    expect(row?.percent).toBe(100);
    expect(row?.commitSha).toHaveLength(40);
    expect(row?.totals?.files).toBe(3);
    expect(row?.engines?.treeSitter).toBe(2);
    expect(row?.external?.[0]?.specifier).toBe('react');

    const files = await getFiles(sql, id);
    expect(files).toHaveLength(3);
    expect(files.find((file) => file.path === 'logo.bin')?.skipReason).toBe('เป็นไฟล์ไบนารี');

    const edges = await getEdges(sql, id);
    expect(edges[0]).toMatchObject({ src: 'src/index.ts', dst: 'src/util.ts' });
    expect(edges[0]?.confidence).toBeCloseTo(0.9, 5);

    expect(await countSymbols(sql, id)).toBe(1);
  });

  it('นับจำนวนไฟล์ที่พึ่งพาไว้กับไฟล์ปลายทาง เพื่อจัดอันดับได้ทันที', async () => {
    const id = await createAnalysis(sql, {
      ref,
      requestedInput: 'x',
      analyzerSchema: 1,
      appVersion: '0.2.0',
    });
    await saveResult(sql, id, makeResult());

    const ranked = await getFiles(sql, id, { orderBy: 'dependents' });
    expect(ranked[0]?.path).toBe('src/util.ts');
    expect(ranked[0]?.dependents).toBe(1);
  });

  it('บันทึกซ้ำแล้วไม่เกิดข้อมูลค้างจากรอบก่อน', async () => {
    const id = await createAnalysis(sql, {
      ref,
      requestedInput: 'x',
      analyzerSchema: 1,
      appVersion: '0.2.0',
    });
    await saveResult(sql, id, makeResult());
    await saveResult(sql, id, makeResult({ files: [], edges: [], symbols: [] }));

    expect(await getFiles(sql, id)).toHaveLength(0);
    expect(await getEdges(sql, id)).toHaveLength(0);
    expect(await countSymbols(sql, id)).toBe(0);
  });

  it('งานที่ล้มเหลวเก็บเหตุผลไว้ให้ผู้ใช้อ่าน', async () => {
    const id = await createAnalysis(sql, {
      ref,
      requestedInput: 'x',
      analyzerSchema: 1,
      appVersion: '0.2.0',
    });
    await markFailed(sql, id, 'ไม่พบ repo นี้');

    const row = await getAnalysis(sql, id);
    expect(row?.status).toBe('failed');
    expect(row?.error).toBe('ไม่พบ repo นี้');
  });
});

describe('แคชตามคอมมิต', () => {
  it('คืนผลล่าสุดที่สำเร็จของ repo เดียวกัน', async () => {
    const id = await createAnalysis(sql, {
      ref,
      requestedInput: 'x',
      analyzerSchema: 1,
      appVersion: '0.2.0',
    });
    await saveResult(sql, id, makeResult());

    const cached = await findCachedAnalysis(sql, ref, 1);
    expect(cached?.status).toBe('done');
  });

  it('ไม่คืนผลที่สร้างจากตัววิเคราะห์คนละรุ่น เพราะรูปแบบข้อมูลใช้ต่อไม่ได้', async () => {
    expect(await findCachedAnalysis(sql, ref, 99)).toBeNull();
  });

  it('ไม่คืนผลของ repo อื่น', async () => {
    const other = { ...ref, name: 'ไม่มีอยู่จริง' };
    expect(await findCachedAnalysis(sql, other, 1)).toBeNull();
  });
});

describe('ข้อมูลสำหรับวาดกราฟ', () => {
  async function seed(): Promise<string> {
    const id = await createAnalysis(sql, {
      ref,
      requestedInput: 'x',
      analyzerSchema: 1,
      appVersion: '0.3.0',
    });
    await saveResult(sql, id, makeResult());
    return id;
  }

  it('ส่งโหนดพร้อมจำนวนขาเข้าและขาออกของแต่ละไฟล์', async () => {
    const graph = await getGraph(sql, await seed());

    expect(graph.nodes).toHaveLength(3);
    expect(graph.truncated).toBe(false);
    expect(graph.totalNodes).toBe(3);

    const target = graph.nodes.find((node) => node.path === 'src/util.ts');
    expect(target?.dependents).toBe(1);
    expect(target?.dependencies).toBe(0);

    const source = graph.nodes.find((node) => node.path === 'src/index.ts');
    expect(source?.dependencies).toBe(1);
    expect(source?.dependents).toBe(0);
  });

  it('เรียงไฟล์ที่ถูกพึ่งพามากที่สุดมาก่อน เพราะเป็นชุดที่ตัดเหลือเมื่อ repo ใหญ่', async () => {
    const graph = await getGraph(sql, await seed(), 1);

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0]?.path).toBe('src/util.ts');
    expect(graph.truncated).toBe(true);
    expect(graph.totalNodes).toBe(3);
  });

  it('ตัดเส้นที่ปลายอีกข้างไม่ได้ถูกส่งไปด้วย จะได้ไม่มีเส้นลอย', async () => {
    const graph = await getGraph(sql, await seed(), 1);
    expect(graph.edges).toHaveLength(0);
  });

  it('ส่งเส้นครบเมื่อไม่ได้ตัดโหนด', async () => {
    const graph = await getGraph(sql, await seed());
    expect(graph.edges).toEqual([
      { src: 'src/index.ts', dst: 'src/util.ts', confidence: expect.closeTo(0.9, 5) },
    ]);
  });
});

describe('รายละเอียดของไฟล์เดียว', () => {
  it('บอกฟังก์ชันในไฟล์ และไฟล์ที่เกี่ยวข้องทั้งสองทิศทาง', async () => {
    const id = await createAnalysis(sql, {
      ref,
      requestedInput: 'x',
      analyzerSchema: 1,
      appVersion: '0.3.0',
    });
    await saveResult(sql, id, makeResult());

    const symbols = await getSymbols(sql, id, 'src/index.ts');
    expect(symbols).toEqual([{ name: 'main', kind: 'function', line: 3 }]);

    const from = await getNeighbours(sql, id, 'src/index.ts');
    expect(from.dependencies).toEqual(['src/util.ts']);
    expect(from.dependents).toEqual([]);

    const to = await getNeighbours(sql, id, 'src/util.ts');
    expect(to.dependents).toEqual(['src/index.ts']);
    expect(to.dependencies).toEqual([]);
  });

  it('ไฟล์ที่ไม่มี symbol คืนรายการว่าง ไม่ใช่ error', async () => {
    const id = await createAnalysis(sql, {
      ref,
      requestedInput: 'x',
      analyzerSchema: 1,
      appVersion: '0.3.0',
    });
    await saveResult(sql, id, makeResult());
    expect(await getSymbols(sql, id, 'logo.bin')).toEqual([]);
  });
});
