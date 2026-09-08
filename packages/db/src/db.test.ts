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
  getFileInsight,
  getFindings,
  getGraph,
  getNeighbours,
  getPreviousSnapshot,
  getRankedFiles,
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
    externalByFile: [{ path: 'src/index.ts', specifier: 'react', count: 3 }],
    unresolved: 0,
    symbols: [{ path: 'src/index.ts', name: 'main', kind: 'function', line: 3 }],
    insights: new Map([
      [
        'src/index.ts',
        { churn: 3, authors: [{ name: 'สมชาย', commits: 3 }], lastCommitAt: null, blast: 0 },
      ],
      [
        'src/util.ts',
        { churn: 9, authors: [{ name: 'สมหญิง', commits: 9 }], lastCommitAt: null, blast: 1 },
      ],
    ]),
    metrics: {
      health: {
        score: 84,
        grade: 'B' as const,
        breakdown: [
          { id: 'dead-code', label: 'โค้ดที่ไม่มีใครเรียกใช้', penalty: 16, detail: 'ทดสอบ' },
        ],
      },
      cycles: [],
      deadFiles: ['src/ลืมลบ.ts'],
      hotspots: [{ path: 'src/util.ts', churn: 9, loc: 4, dependents: 1, risk: 12.5 }],
      coupling: { averageDependencies: 0.5, highFanOut: [] },
    },
    findings: [
      {
        path: 'src/index.ts',
        line: 2,
        rule: 'hardcoded-secret',
        severity: 'high' as const,
        message: 'พบค่าที่ดูเหมือนกุญแจหรือรหัสผ่านเขียนตรง ๆ ในโค้ด',
        snippet: 'const key = "…ถูกกลบไว้…";',
      },
    ],
    engines: { treeSitter: 2, pattern: 0 },
    reusedFiles: 0,
    fileEngines: new Map([
      ['src/index.ts', 'tree-sitter'],
      ['src/util.ts', 'tree-sitter'],
    ]),
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

describe('ตัวชี้วัดของ v0.4.0', () => {
  async function seedMetrics(): Promise<string> {
    const id = await createAnalysis(sql, {
      ref,
      requestedInput: 'x',
      analyzerSchema: 1,
      appVersion: '0.4.0',
    });
    await saveResult(sql, id, makeResult());
    return id;
  }

  it('เก็บคะแนนสุขภาพและรายละเอียดการหักคะแนนไว้กับงานวิเคราะห์', async () => {
    const row = await getAnalysis(sql, await seedMetrics());
    expect(row?.metrics?.health.grade).toBe('B');
    expect(row?.metrics?.health.score).toBe(84);
    expect(row?.metrics?.deadFiles).toEqual(['src/ลืมลบ.ts']);
  });

  it('เก็บข้อสังเกตด้านความปลอดภัยโดยที่ค่าความลับถูกกลบมาแล้ว', async () => {
    const findings = await getFindings(sql, await seedMetrics());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('high');
    expect(findings[0]?.snippet).toContain('ถูกกลบไว้');
  });

  it('บันทึกซ้ำแล้วข้อสังเกตเก่าไม่ค้าง', async () => {
    const id = await seedMetrics();
    await saveResult(sql, id, makeResult({ findings: [] }));
    expect(await getFindings(sql, id)).toHaveLength(0);
  });

  it('เก็บจำนวนครั้งที่แก้ รัศมีผลกระทบ และเจ้าของโค้ดไว้กับไฟล์', async () => {
    const id = await seedMetrics();
    const insight = await getFileInsight(sql, id, 'src/util.ts');
    expect(insight?.churn).toBe(9);
    expect(insight?.blast).toBe(1);
    expect(insight?.authors[0]?.name).toBe('สมหญิง');
  });

  it('จัดอันดับไฟล์ได้ทั้งตามความถี่ที่แก้ และตามรัศมีผลกระทบ', async () => {
    const id = await seedMetrics();

    const byChurn = await getRankedFiles(sql, id, 'churn');
    expect(byChurn[0]?.path).toBe('src/util.ts');
    expect(byChurn[0]?.churn).toBe(9);

    const byBlast = await getRankedFiles(sql, id, 'blast');
    expect(byBlast[0]?.path).toBe('src/util.ts');

    const byDependents = await getRankedFiles(sql, id, 'dependents');
    expect(byDependents[0]?.path).toBe('src/util.ts');
  });

  it('กราฟส่งรัศมีผลกระทบไปด้วย เพื่อใช้ลงสีได้โดยไม่ต้องยิงเพิ่ม', async () => {
    const graph = await getGraph(sql, await seedMetrics());
    expect(graph.nodes.find((node) => node.path === 'src/util.ts')?.blast).toBe(1);
  });
});

describe('ผลจากรอบวิเคราะห์ก่อนหน้า (ใช้ข้ามการพาร์สไฟล์ที่ไม่เปลี่ยนในรอบใหม่)', () => {
  it('repo ที่ไม่เคยวิเคราะห์เสร็จมาก่อนคืน null', async () => {
    const neverAnalyzed = { ...ref, name: `ยังไม่เคย-${Date.now()}` };
    expect(await getPreviousSnapshot(sql, neverAnalyzed, 1)).toBeNull();
  });

  it('ประกอบสัญลักษณ์ เส้นเชื่อม ข้อสังเกต และแพ็กเกจภายนอกแยกตามไฟล์ได้ถูกต้อง', async () => {
    const id = await createAnalysis(sql, {
      ref,
      requestedInput: `${ref.owner}/${ref.name}`,
      analyzerSchema: 1,
      appVersion: '0.7.0-ทดสอบ',
    });
    await saveResult(sql, id, makeResult());

    const snapshot = await getPreviousSnapshot(sql, ref, 1);
    expect(snapshot).not.toBeNull();

    const indexFile = snapshot?.get('src/index.ts');
    expect(indexFile?.hash).toBe('abc');
    expect(indexFile?.engine).toBe('tree-sitter');
    expect(indexFile?.symbols).toEqual([{ name: 'main', kind: 'function', line: 3 }]);
    expect(indexFile?.edges).toEqual([
      { to: 'src/util.ts', kind: 'from', line: 1, confidence: 0.9 },
    ]);
    expect(indexFile?.findings).toHaveLength(1);
    expect(indexFile?.findings[0]?.rule).toBe('hardcoded-secret');
    expect(indexFile?.externals).toEqual([{ specifier: 'react', count: 3 }]);

    const utilFile = snapshot?.get('src/util.ts');
    expect(utilFile?.hash).toBe('def');
    expect(utilFile?.symbols).toEqual([]);
    expect(utilFile?.edges).toEqual([]);
  });

  it('ใช้ผลของงานวิเคราะห์ล่าสุดของ repo นี้เสมอ ไม่ใช่งานแรกที่เจอ', async () => {
    const first = await createAnalysis(sql, {
      ref,
      requestedInput: `${ref.owner}/${ref.name}`,
      analyzerSchema: 1,
      appVersion: '0.7.0-ทดสอบ',
    });
    await saveResult(sql, first, makeResult());

    const second = await createAnalysis(sql, {
      ref,
      requestedInput: `${ref.owner}/${ref.name}`,
      analyzerSchema: 1,
      appVersion: '0.7.0-ทดสอบ',
    });
    await saveResult(
      sql,
      second,
      makeResult({
        files: [
          {
            path: 'src/index.ts',
            language: 'typescript',
            bytes: 999,
            loc: 99,
            hash: 'ค่าใหม่',
            parsed: true,
            skipReason: null,
          },
        ],
        symbols: [],
        edges: [],
      }),
    );

    const snapshot = await getPreviousSnapshot(sql, ref, 1);
    expect(snapshot?.get('src/index.ts')?.hash).toBe('ค่าใหม่');
    expect(snapshot?.has('src/util.ts')).toBe(false);
  });
});
