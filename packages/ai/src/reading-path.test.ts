import { describe, expect, it, vi } from 'vitest';
import { ClaudeError } from './anthropic.js';
import {
  buildReadingPath,
  selectReadingSteps,
  topologicalReadingOrder,
  type ReadingCandidate,
  type ReadingPathFile,
} from './reading-path.js';

describe('การเรียงลำดับแบบ topological', () => {
  it('ไฟล์ที่ไม่พึ่งพาใครเลยมาก่อนไฟล์ที่พึ่งพามัน', () => {
    const order = topologicalReadingOrder(
      ['src/util.ts', 'src/service.ts'],
      [{ from: 'src/service.ts', to: 'src/util.ts' }],
    );
    expect(order).toEqual(['src/util.ts', 'src/service.ts']);
  });

  it('โครงสร้างแบบเพชร — จุดยอดร่วมมาก่อนทั้งสองสาขา และปลายทางมาหลังสุด', () => {
    const order = topologicalReadingOrder(
      ['base.ts', 'left.ts', 'right.ts', 'top.ts'],
      [
        { from: 'left.ts', to: 'base.ts' },
        { from: 'right.ts', to: 'base.ts' },
        { from: 'top.ts', to: 'left.ts' },
        { from: 'top.ts', to: 'right.ts' },
      ],
    );
    expect(order[0]).toBe('base.ts');
    expect(order[3]).toBe('top.ts');
    expect(order.indexOf('left.ts')).toBeLessThan(order.indexOf('top.ts'));
    expect(order.indexOf('right.ts')).toBeLessThan(order.indexOf('top.ts'));
  });

  it('ไฟล์ที่พึ่งพากันเป็นวงยังปรากฏครบ เรียงตามพาธต่อท้ายส่วนที่เรียงได้จริง', () => {
    const order = topologicalReadingOrder(
      ['a.ts', 'b.ts', 'independent.ts'],
      [
        { from: 'a.ts', to: 'b.ts' },
        { from: 'b.ts', to: 'a.ts' },
      ],
    );
    expect(order).toHaveLength(3);
    expect(new Set(order)).toEqual(new Set(['a.ts', 'b.ts', 'independent.ts']));
    expect(order.indexOf('independent.ts')).toBeLessThan(order.indexOf('a.ts'));
  });

  it('ไม่สนใจเส้นที่ชี้ไปไฟล์ที่ไม่อยู่ในเซต เส้นชี้ตัวเอง และเส้นซ้ำ', () => {
    const order = topologicalReadingOrder(
      ['src/a.ts', 'src/b.ts'],
      [
        { from: 'src/a.ts', to: 'src/นอกเซต.ts' },
        { from: 'src/a.ts', to: 'src/a.ts' },
        { from: 'src/b.ts', to: 'src/a.ts' },
        { from: 'src/b.ts', to: 'src/a.ts' },
      ],
    );
    expect(order).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('ผลลัพธ์คงที่ทุกครั้งที่รันด้วยข้อมูลเดียวกัน (ไม่ขึ้นกับลำดับที่ใส่เข้ามา)', () => {
    const paths = ['c.ts', 'a.ts', 'b.ts'];
    const edges = [{ from: 'c.ts', to: 'a.ts' }];
    expect(topologicalReadingOrder(paths, edges)).toEqual(
      topologicalReadingOrder([...paths], edges),
    );
  });
});

describe('การเลือกขั้นตอนเด่น', () => {
  const order = Array.from({ length: 30 }, (_, i) => `file-${i}.ts`);

  function candidate(overrides: Partial<ReadingCandidate>): ReadingCandidate {
    return { path: '', dependents: 0, blast: 0, churn: 0, isEntrypoint: false, ...overrides };
  }

  it('repo เล็กกว่าเพดานต่ำสุด คืนไฟล์ทั้งหมดโดยไม่ตัด', () => {
    const small = ['a.ts', 'b.ts', 'c.ts'];
    expect(selectReadingSteps(small, new Map())).toEqual(small);
  });

  it('repo ใหญ่ถูกตัดให้อยู่ในช่วง min-max และคงลำดับสัมพัทธ์เดิม', () => {
    const candidates = new Map(order.map((path) => [path, candidate({ path })]));
    const selected = selectReadingSteps(order, candidates, { min: 7, max: 15 });

    expect(selected.length).toBeGreaterThanOrEqual(7);
    expect(selected.length).toBeLessThanOrEqual(15);

    const indices = selected.map((path) => order.indexOf(path));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('ไฟล์ที่ถูกพึ่งพามากและเป็นจุดเริ่มโปรแกรมถูกเลือกก่อนไฟล์ธรรมดา', () => {
    const candidates = new Map<string, ReadingCandidate>(
      order.map((path) => [path, candidate({ path })]),
    );
    candidates.set('file-5.ts', candidate({ path: 'file-5.ts', dependents: 50 }));
    candidates.set('file-20.ts', candidate({ path: 'file-20.ts', isEntrypoint: true }));

    const selected = selectReadingSteps(order, candidates, { min: 7, max: 10 });
    expect(selected).toContain('file-5.ts');
    expect(selected).toContain('file-20.ts');
  });
});

function makeFile(overrides: Partial<ReadingPathFile>): ReadingPathFile {
  return {
    path: 'src/index.ts',
    loc: 20,
    language: 'typescript',
    dependents: 0,
    dependencies: 0,
    blast: 0,
    churn: 0,
    isEntrypoint: false,
    ...overrides,
  };
}

function deps(overrides: Partial<Parameters<typeof buildReadingPath>[1]> = {}) {
  return {
    symbolsOf: async () => [],
    ...overrides,
  };
}

function answer(payload: unknown) {
  return { text: JSON.stringify(payload), inputTokens: 8, outputTokens: 4 };
}

describe('การสร้างเส้นทางอ่านโค้ด', () => {
  const files = [
    makeFile({ path: 'src/util.ts', loc: 10, dependents: 2 }),
    makeFile({ path: 'src/service.ts', loc: 30, dependents: 1 }),
    makeFile({ path: 'src/index.ts', loc: 5, isEntrypoint: true }),
  ];
  const edges = [
    { from: 'src/service.ts', to: 'src/util.ts' },
    { from: 'src/index.ts', to: 'src/service.ts' },
  ];

  it('ไม่มีไฟล์เลยคืนรายการว่างโดยไม่เรียกโมเดล', async () => {
    const ask = vi.fn();
    const result = await buildReadingPath(
      { apiKey: 'sk-ant-x', files: [], edges: [] },
      deps({ ask }),
    );
    expect(result.steps).toEqual([]);
    expect(ask).not.toHaveBeenCalled();
  });

  it('ประกอบขั้นตอนตามลำดับที่คำนวณไว้ พร้อมคำอธิบายจากโมเดล', async () => {
    const ask = vi.fn(async () =>
      answer({
        steps: [
          { why: [{ text: 'ฟังก์ชันพื้นฐานที่ตัวอื่นเรียกใช้', lines: [1] }], lookFor: [] },
          { why: [{ text: 'ประกอบ util เข้าด้วยกัน', lines: [1] }], lookFor: [] },
          { why: [{ text: 'จุดเริ่มโปรแกรม', lines: [1] }], lookFor: [] },
        ],
      }),
    );

    const result = await buildReadingPath({ apiKey: 'sk-ant-x', files, edges }, deps({ ask }));

    expect(result.steps.map((step) => step.path)).toEqual([
      'src/util.ts',
      'src/service.ts',
      'src/index.ts',
    ]);
    expect(result.steps.map((step) => step.order)).toEqual([1, 2, 3]);
    expect(result.steps[0]?.why[0]?.text).toBe('ฟังก์ชันพื้นฐานที่ตัวอื่นเรียกใช้');
    expect(result.model).toBe('claude-sonnet-5');
  });

  it('ข้อที่อ้างอิงบรรทัดไม่มีจริงถูกตัด แล้วใช้คำอธิบายสำรองแทน', async () => {
    const ask = vi.fn(async () =>
      answer({
        steps: [
          { why: [{ text: 'อ้างบรรทัดที่ไม่มีอยู่', lines: [9999] }], lookFor: [] },
          { why: [{ text: 'ok', lines: [1] }], lookFor: [] },
          { why: [{ text: 'ok', lines: [1] }], lookFor: [] },
        ],
      }),
    );

    const result = await buildReadingPath({ apiKey: 'sk-ant-x', files, edges }, deps({ ask }));
    const first = result.steps[0];
    expect(first?.why[0]?.text).not.toBe('อ้างบรรทัดที่ไม่มีอยู่');
    expect(first?.why.every((claim) => claim.citations.length > 0)).toBe(true);
  });

  it('เรียกโมเดลไม่สำเร็จ (ไม่ใช่ปัญหากุญแจ) คืนคำอธิบายสำรองทั้งชุดแทนที่จะล้ม', async () => {
    const ask = vi.fn(async () => {
      throw new ClaudeError('ฝั่ง Anthropic มีปัญหาชั่วคราว', 503, true);
    });

    const result = await buildReadingPath({ apiKey: 'sk-ant-x', files, edges }, deps({ ask }));
    expect(result.steps).toHaveLength(3);
    expect(result.model).toBeNull();
    expect(result.steps.every((step) => step.why.length > 0)).toBe(true);
  });

  it('กุญแจผิดต้องโยนต่อทันที ไม่ใช่เงียบแล้วใช้คำอธิบายสำรอง', async () => {
    const ask = vi.fn(async () => {
      throw new ClaudeError('Anthropic ปฏิเสธกุญแจนี้', 401, false);
    });

    await expect(
      buildReadingPath({ apiKey: 'sk-ant-x', files, edges }, deps({ ask })),
    ).rejects.toThrow(/ปฏิเสธกุญแจ/);
  });
});
