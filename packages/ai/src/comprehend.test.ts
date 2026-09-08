import { describe, expect, it, vi } from 'vitest';
import { ClaudeError } from './anthropic.js';
import { comprehendRepo, describeWithoutModel, moduleOf, type FileRecord } from './comprehend.js';

const files: FileRecord[] = [
  {
    path: 'src/index.ts',
    language: 'typescript',
    loc: 40,
    bytes: 800,
    parsed: true,
    skipReason: null,
    dependents: 3,
  },
  {
    path: 'src/util/format.ts',
    language: 'typescript',
    loc: 20,
    bytes: 400,
    parsed: true,
    skipReason: null,
    dependents: 1,
  },
  {
    path: 'logo.png',
    language: null,
    loc: 0,
    bytes: 40_000,
    parsed: false,
    skipReason: 'ไฟล์ไบนารี',
    dependents: 0,
  },
];

function deps(overrides: Partial<Parameters<typeof comprehendRepo>[1]> = {}) {
  return {
    readFile: async (path: string) => (path.endsWith('.png') ? null : `บรรทัดหนึ่ง\nบรรทัดสอง`),
    symbolsOf: async (path: string) =>
      path === 'src/index.ts' ? [{ name: 'main', kind: 'function', line: 12 }] : [],
    neighboursOf: async () => ({ dependents: [], dependencies: [] }),
    ...overrides,
  };
}

const repo = { owner: 'ทดสอบ', name: 'repo', branch: 'main', commitSha: 'a'.repeat(40) };

function answer(payload: unknown) {
  return {
    text: JSON.stringify(payload),
    inputTokens: 10,
    outputTokens: 5,
  };
}

describe('โฟลเดอร์ของไฟล์', () => {
  it('ไฟล์ที่รากนับเป็นโมดูลจุด', () => {
    expect(moduleOf('README.md')).toBe('.');
    expect(moduleOf('src/index.ts')).toBe('src');
    expect(moduleOf('src/util/format.ts')).toBe('src/util');
  });
});

describe('คำอธิบายที่ระบบเขียนเอง', () => {
  it('ไฟล์ที่อ่านเนื้อหาไม่ได้ ต้องบอกเหตุผลตรง ๆ ไม่ใช่เงียบ', () => {
    const summary = describeWithoutModel(files[2] as FileRecord, []);
    expect(summary.headline).toContain('ไฟล์ไบนารี');
    expect(summary.source).toBe('analyzer');
    expect(summary.points[0]?.citations[0]).toEqual({ path: 'logo.png', line: 1 });
  });

  it('อ้างบรรทัดของ symbol จริงเมื่อมีให้อ้าง', () => {
    const summary = describeWithoutModel(files[0] as FileRecord, [
      { name: 'main', kind: 'function', line: 12 },
    ]);
    expect(summary.points[0]?.citations).toEqual([{ path: 'src/index.ts', line: 12 }]);
  });
});

describe('ไปป์ไลน์ความเข้าใจ', () => {
  it('ทุกไฟล์ต้องมีคำอธิบาย แม้ไฟล์ที่โมเดลอ่านไม่ได้', async () => {
    const ask = vi.fn(async () => answer({ headline: 'ทำหน้าที่หลัก', points: [] }));
    const result = await comprehendRepo({ apiKey: 'sk-ant-x', repo, files }, deps({ ask }));

    expect(result.files).toHaveLength(files.length);
    expect(new Set(result.files.map((f) => f.path))).toEqual(new Set(files.map((f) => f.path)));

    const binary = result.files.find((f) => f.path === 'logo.png');
    expect(binary?.source).toBe('analyzer');
    expect(result.modelFiles).toBe(2);
  });

  it('ตัดข้อที่ชี้บรรทัดไม่มีอยู่จริงทิ้ง แล้วใช้ข้อเท็จจริงจากโครงสร้างแทน', async () => {
    const ask = vi.fn(async () =>
      answer({
        headline: 'ไฟล์เริ่มโปรแกรม',
        points: [{ text: 'อ้างบรรทัดที่ไม่มีอยู่', lines: [9999] }],
      }),
    );

    const result = await comprehendRepo({ apiKey: 'sk-ant-x', repo, files }, deps({ ask }));
    const index = result.files.find((f) => f.path === 'src/index.ts');

    expect(index?.headline).toBe('ไฟล์เริ่มโปรแกรม');
    expect(index?.points.every((point) => point.citations.length > 0)).toBe(true);
    expect(index?.points.some((point) => point.text === 'อ้างบรรทัดที่ไม่มีอยู่')).toBe(false);
  });

  it('เก็บข้อที่อ้างอิงบรรทัดจริงไว้ พร้อมบอกว่ามาจากโมเดล', async () => {
    const ask = vi.fn(async () =>
      answer({
        headline: 'ไฟล์เริ่มโปรแกรม',
        points: [{ text: 'เรียก main ที่นี่', lines: [12] }],
      }),
    );

    const result = await comprehendRepo({ apiKey: 'sk-ant-x', repo, files }, deps({ ask }));
    const index = result.files.find((f) => f.path === 'src/index.ts');

    expect(index?.source).toBe('model');
    expect(index?.points[0]).toEqual({
      text: 'เรียก main ที่นี่',
      citations: [{ path: 'src/index.ts', line: 12 }],
    });
  });

  it('เพดานจำนวนไฟล์ทำให้เรียกโมเดลไม่เกินที่กำหนด และบอกผู้ใช้ว่าตัดมา', async () => {
    const ask = vi.fn(async () => answer({ headline: 'สรุป', points: [] }));
    const result = await comprehendRepo(
      { apiKey: 'sk-ant-x', repo, files, maxModelFiles: 1, maxModelModules: 1 },
      deps({ ask }),
    );

    expect(result.modelFiles).toBe(1);
    expect(result.warnings.some((warning) => warning.includes('เกินเพดาน'))).toBe(true);
    // ไฟล์ที่ถูกพึ่งพามากที่สุดต้องเป็นไฟล์ที่ได้เข้าโมเดลก่อน
    expect(result.files.find((f) => f.path === 'src/index.ts')?.source).toBe('model');
  });

  it('รวมไฟล์เป็นโมดูลตามโฟลเดอร์ และนับจำนวนไฟล์ในแต่ละโมดูลไว้', async () => {
    const ask = vi.fn(async () => answer({ headline: 'สรุป', points: [] }));
    const result = await comprehendRepo({ apiKey: 'sk-ant-x', repo, files }, deps({ ask }));

    expect(result.modules.map((module) => module.path)).toEqual(['.', 'src', 'src/util']);
    expect(result.modules.find((module) => module.path === 'src')?.fileCount).toBe(1);
  });

  it('รวมโทเค็นที่ใช้ไปทั้งงาน เพื่อให้ผู้ใช้รู้ว่าจ่ายไปเท่าไร', async () => {
    const ask = vi.fn(async () => answer({ headline: 'สรุป', points: [] }));
    const result = await comprehendRepo({ apiKey: 'sk-ant-x', repo, files }, deps({ ask }));

    expect(result.inputTokens).toBe(ask.mock.calls.length * 10);
    expect(result.outputTokens).toBe(ask.mock.calls.length * 5);
  });

  it('กุญแจผิดต้องหยุดทั้งงานทันที ไม่ไล่เรียกจนครบทุกไฟล์', async () => {
    const ask = vi.fn(async () => {
      throw new ClaudeError('Anthropic ปฏิเสธกุญแจนี้', 401, false);
    });

    await expect(
      comprehendRepo({ apiKey: 'sk-ant-x', repo, files }, deps({ ask })),
    ).rejects.toThrow(/ปฏิเสธกุญแจ/);
  });

  it('โมเดลล่มบางไฟล์ไม่ทำให้ทั้งงานพัง แต่ต้องบอกว่าไฟล์ไหนไม่ได้สรุปด้วยโมเดล', async () => {
    let calls = 0;
    const ask = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new ClaudeError('ฝั่ง Anthropic มีปัญหาชั่วคราว', 503, true);
      return answer({ headline: 'สรุป', points: [] });
    });

    const result = await comprehendRepo({ apiKey: 'sk-ant-x', repo, files }, deps({ ask }));
    expect(result.files).toHaveLength(files.length);
    expect(result.warnings.some((warning) => warning.includes('ไม่สำเร็จ'))).toBe(true);
  });

  it('รายงานความคืบหน้าตามลำดับขั้นจริง และจบที่ขั้นบันทึกผล', async () => {
    const stages: string[] = [];
    const ask = vi.fn(async () => answer({ headline: 'สรุป', points: [] }));

    await comprehendRepo(
      { apiKey: 'sk-ant-x', repo, files, onProgress: (progress) => stages.push(progress.stage) },
      deps({ ask }),
    );

    expect(stages[0]).toBe('files');
    expect(stages).toContain('modules');
    expect(stages).toContain('repo');
    expect(stages.at(-1)).toBe('publish');
  });

  it('ภาพรวมทั้ง repo ต้องไม่แสดงข้อที่อ้างอิงไม่ผ่าน', async () => {
    const ask = vi.fn(async (request: { model: string }) => {
      if (request.model.includes('opus')) {
        return answer({
          headline: 'เครื่องมืออ่านโค้ด',
          purpose: [{ text: 'มีอ้างอิงจริง', refs: [{ path: 'src/index.ts', line: 12 }] }],
          stack: [{ text: 'อ้างไฟล์ที่ไม่มี', refs: [{ path: 'ไม่มีไฟล์นี้', line: 1 }] }],
          notes: [{ text: 'ไม่มีอ้างอิงเลย' }],
        });
      }
      return answer({ headline: 'สรุป', points: [] });
    });

    const result = await comprehendRepo({ apiKey: 'sk-ant-x', repo, files }, deps({ ask }));

    expect(result.digest.headline).toBe('เครื่องมืออ่านโค้ด');
    expect(result.digest.purpose).toHaveLength(1);
    expect(result.digest.stack).toEqual([]);
    expect(result.digest.notes).toEqual([]);
  });
});
