import { describe, expect, it } from 'vitest';
import type { Edge } from './graph.js';
import type { FileEntry } from './inventory.js';
import { blastRadius, computeMetrics, findCycles, isEntrypoint } from './metrics.js';

const edge = (from: string, to: string): Edge => ({
  from,
  to,
  kind: 'from',
  line: 1,
  confidence: 1,
});

const file = (path: string, loc = 50, parsed = true): FileEntry => ({
  path,
  language: 'typescript',
  bytes: loc * 20,
  loc,
  hash: 'abc',
  parsed,
  skipReason: null,
});

describe('วงจรพึ่งพา', () => {
  it('หาเจอเมื่อไฟล์พึ่งพากันเป็นวง', () => {
    const cycles = findCycles([edge('a.ts', 'b.ts'), edge('b.ts', 'c.ts'), edge('c.ts', 'a.ts')]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]?.files).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('ไม่รายงานอะไรเมื่อกราฟไม่มีวง', () => {
    expect(findCycles([edge('a.ts', 'b.ts'), edge('b.ts', 'c.ts')])).toEqual([]);
  });

  it('แยกหลายวงออกจากกัน และเรียงวงใหญ่ขึ้นก่อน', () => {
    const cycles = findCycles([
      edge('a.ts', 'b.ts'),
      edge('b.ts', 'a.ts'),
      edge('x.ts', 'y.ts'),
      edge('y.ts', 'z.ts'),
      edge('z.ts', 'x.ts'),
    ]);
    expect(cycles).toHaveLength(2);
    expect(cycles[0]?.files).toHaveLength(3);
    expect(cycles[1]?.files).toEqual(['a.ts', 'b.ts']);
  });

  it('ไม่ล้นแม้กราฟจะลึกมาก', () => {
    const edges: Edge[] = [];
    for (let i = 0; i < 20_000; i += 1) edges.push(edge(`f${i}.ts`, `f${i + 1}.ts`));
    expect(findCycles(edges)).toEqual([]);
  });
});

describe('รัศมีผลกระทบ', () => {
  it('นับไฟล์ที่ได้รับผลทางอ้อมด้วย ไม่ใช่แค่ที่เรียกใช้ตรง ๆ', () => {
    const radius = blastRadius([
      edge('a.ts', 'core.ts'),
      edge('b.ts', 'a.ts'),
      edge('c.ts', 'b.ts'),
    ]);
    expect(radius.get('core.ts')).toBe(3);
    expect(radius.get('a.ts')).toBe(2);
    expect(radius.get('b.ts')).toBe(1);
  });

  it('ไม่วนไม่จบเมื่อเจอวงจร', () => {
    const radius = blastRadius([edge('a.ts', 'b.ts'), edge('b.ts', 'a.ts')]);
    expect(radius.get('a.ts')).toBe(1);
    expect(radius.get('b.ts')).toBe(1);
  });
});

describe('จุดเริ่มโปรแกรม', () => {
  it('ไม่นับไฟล์เหล่านี้ว่าเป็นโค้ดตาย', () => {
    for (const path of [
      'src/index.ts',
      'apps/web/app/page.tsx',
      'main.go',
      'pkg/__init__.py',
      'tests/thing.test.ts',
      'scripts/build.mjs',
      'next.config.mjs',
    ]) {
      expect(isEntrypoint(path), path).toBe(true);
    }
  });

  it('ไฟล์ธรรมดายังถือว่าไม่ใช่จุดเริ่ม', () => {
    expect(isEntrypoint('src/util/format.ts')).toBe(false);
  });
});

describe('คะแนนสุขภาพ', () => {
  const clean = {
    files: [file('src/index.ts'), file('src/util.ts'), file('src/greet.ts')],
    edges: [
      edge('src/index.ts', 'src/util.ts'),
      edge('src/index.ts', 'src/greet.ts'),
      edge('src/greet.ts', 'src/util.ts'),
    ],
    churn: new Map<string, number>(),
    securityPenalty: 0,
    findingCounts: { high: 0, medium: 0, low: 0 },
  };

  it('โปรเจกต์ที่สะอาดได้เกรด A และคะแนนเต็ม', () => {
    const metrics = computeMetrics(clean);
    expect(metrics.health.score).toBe(100);
    expect(metrics.health.grade).toBe('A');
    expect(metrics.deadFiles).toEqual([]);
    expect(metrics.cycles).toEqual([]);
  });

  it('ทุกข้อที่หักคะแนนต้องอธิบายที่มาได้', () => {
    const metrics = computeMetrics(clean);
    expect(metrics.health.breakdown).toHaveLength(4);
    for (const item of metrics.health.breakdown) {
      expect(item.detail.length).toBeGreaterThan(0);
      expect(item.penalty).toBeGreaterThanOrEqual(0);
    }
  });

  it('โค้ดที่ไม่มีใครเรียกใช้ทำให้คะแนนลด', () => {
    const metrics = computeMetrics({
      ...clean,
      files: [...clean.files, file('src/ลืมลบ.ts')],
    });
    expect(metrics.deadFiles).toEqual(['src/ลืมลบ.ts']);
    expect(metrics.health.score).toBeLessThan(100);
  });

  it('วงจรพึ่งพาทำให้คะแนนลดและถูกรายงานออกมา', () => {
    const metrics = computeMetrics({
      ...clean,
      edges: [
        ...clean.edges,
        edge('src/util.ts', 'src/greet.ts'),
        edge('src/greet.ts', 'src/util.ts'),
      ],
    });
    expect(metrics.cycles.length).toBeGreaterThan(0);
    expect(metrics.health.breakdown.find((item) => item.id === 'cycles')?.penalty).toBeGreaterThan(
      0,
    );
  });

  it('ช่องโหว่ระดับสูงกดคะแนนลงแรงกว่าระดับต่ำ', () => {
    const high = computeMetrics({
      ...clean,
      securityPenalty: 16,
      findingCounts: { high: 2, medium: 0, low: 0 },
    });
    const low = computeMetrics({
      ...clean,
      securityPenalty: 2,
      findingCounts: { high: 0, medium: 0, low: 2 },
    });
    expect(high.health.score).toBeLessThan(low.health.score);
  });

  it('คะแนนไม่ต่ำกว่าศูนย์ แม้ทุกอย่างจะแย่พร้อมกัน', () => {
    const metrics = computeMetrics({
      files: Array.from({ length: 10 }, (_, i) => file(`src/f${i}.ts`)),
      edges: [edge('src/f0.ts', 'src/f1.ts'), edge('src/f1.ts', 'src/f0.ts')],
      churn: new Map(),
      securityPenalty: 500,
      findingCounts: { high: 60, medium: 0, low: 0 },
    });
    expect(metrics.health.score).toBeGreaterThanOrEqual(0);
    expect(metrics.health.grade).toBe('F');
  });

  it('จุดร้อนต้องมาจากไฟล์ที่แก้บ่อยจริง ไม่ใช่ไฟล์ใหญ่เฉย ๆ', () => {
    const metrics = computeMetrics({
      ...clean,
      files: [file('src/index.ts', 20), file('src/util.ts', 900), file('src/greet.ts', 30)],
      churn: new Map([
        ['src/greet.ts', 40],
        ['src/util.ts', 2],
      ]),
    });

    expect(metrics.hotspots[0]?.path).toBe('src/greet.ts');
    expect(metrics.hotspots.every((item) => item.churn > 1)).toBe(true);
  });
});
