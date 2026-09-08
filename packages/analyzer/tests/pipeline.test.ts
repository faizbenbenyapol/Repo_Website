import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  analyzeRepo,
  countDependents,
  takeInventory,
  type AnalysisResult,
  type PreviousFileSnapshot,
  type ProgressEvent,
} from '../src/index.js';

/**
 * แปลงผลวิเคราะห์ครั้งก่อนให้อยู่ในรูปที่ analyzeRepo รับเป็น previousFiles ได้
 * เลียนแบบสิ่งที่ @repolens/db จะทำจริงตอนดึงผลของ repo เดียวกันจากรอบก่อนมาใช้ต่อ
 */
function toPreviousFiles(result: AnalysisResult): Map<string, PreviousFileSnapshot> {
  const map = new Map<string, PreviousFileSnapshot>();
  for (const file of result.files) {
    map.set(file.path, {
      hash: file.hash,
      symbols: result.symbols
        .filter((s) => s.path === file.path)
        .map(({ path: _p, ...rest }) => rest),
      edges: result.edges.filter((e) => e.from === file.path).map(({ from: _f, ...rest }) => rest),
      findings: result.findings
        .filter((f) => f.path === file.path)
        .map(({ path: _p, ...rest }) => rest),
      externals: result.externalByFile
        .filter((u) => u.path === file.path)
        .map(({ path: _p, ...rest }) => rest),
      engine: result.fileEngines.get(file.path) ?? null,
    });
  }
  return map;
}

const run = promisify(execFile);

/**
 * สร้าง repo จริงในเครื่องแล้ววิเคราะห์ทั้งไปป์ไลน์
 * ตั้งใจไม่แตะเครือข่าย เพื่อให้ชุดทดสอบเดินได้เหมือนกันทุกที่และไม่ล้มเพราะเน็ต
 */
const FILES: Record<string, string> = {
  'package.json': '{\n  "name": "ตัวอย่าง",\n  "type": "module"\n}\n',
  'src/index.ts': `import { greet } from './greet';
import { formatName } from './util/format';
import express from 'express';

export function main() {
  return greet(formatName('โลก'), express);
}
`,
  'src/greet.ts': `import { formatName } from './util/format';

export const greet = (name: string, extra?: unknown) => \`สวัสดี \${formatName(name)}\` + String(extra);
`,
  'src/util/format.ts': `export function formatName(name: string): string {
  return name.trim();
}

export class Formatter {
  run(value: string) {
    return formatName(value);
  }
}
`,
  'src/util/index.ts': "export * from './format';\n",
  'scripts/tool.py': `from src.helper import assist
import os

def start():
    return assist(os.getcwd())
`,
  'src/helper.py': `def assist(path):
    return path
`,
  'docs/readme.md': '# เอกสาร\n\nไฟล์นี้ไม่ใช่โค้ด แต่ต้องถูกนับ\n',
  'src/config.ts': 'export const apiKey = "sk_live_0123456789abcdefghij";\n',
  'node_modules/skipped/index.js': 'module.exports = 1;\n',
  'dist/bundle.js': 'console.log(1);\n',
};

let repoDir = '';

beforeAll(async () => {
  repoDir = await mkdtemp(join(tmpdir(), 'repolens-src-'));

  for (const [path, content] of Object.entries(FILES)) {
    const full = join(repoDir, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
  }
  await writeFile(join(repoDir, 'logo.bin'), Buffer.from([0, 1, 2, 0]));

  await run('git', ['init', '-q', '-b', 'main'], { cwd: repoDir });
  await run('git', ['config', 'user.email', 'test@example.com'], { cwd: repoDir });
  await run('git', ['config', 'user.name', 'ทดสอบ'], { cwd: repoDir });
  await run('git', ['add', '-A'], { cwd: repoDir });
  await run('git', ['commit', '-q', '-m', 'เริ่มต้น'], { cwd: repoDir });
}, 60_000);

afterAll(async () => {
  if (repoDir) await rm(repoDir, { recursive: true, force: true });
});

describe('สำรวจไฟล์', () => {
  it('ข้ามโฟลเดอร์ที่ถูกสร้างขึ้น และแยกไฟล์ไบนารีออกจากไฟล์ที่อ่านได้', async () => {
    const inventory = await takeInventory(repoDir);
    const paths = inventory.files.map((file) => file.path);

    expect(paths).toContain('src/index.ts');
    expect(paths).toContain('docs/readme.md');
    expect(paths.some((path) => path.startsWith('node_modules/'))).toBe(false);
    expect(paths.some((path) => path.startsWith('dist/'))).toBe(false);
    expect(paths.some((path) => path.startsWith('.git/'))).toBe(false);

    const binary = inventory.files.find((file) => file.path === 'logo.bin');
    expect(binary?.parsed).toBe(false);
    expect(binary?.skipReason).toBe('เป็นไฟล์ไบนารี');
  });

  it('สรุปสัดส่วนภาษาเรียงจากมากไปน้อย', async () => {
    const inventory = await takeInventory(repoDir);
    const languages = inventory.totals.languages.map((item) => item.language);
    expect(languages).toContain('typescript');
    expect(languages).toContain('python');
    expect(inventory.totals.loc).toBeGreaterThan(0);
    expect(inventory.totals.parsed).toBeLessThanOrEqual(inventory.totals.files);
  });

  it('ไฟล์ที่ใหญ่เกินขีดจำกัดยังถูกนับ แต่ไม่ถูกอ่านเนื้อหา', async () => {
    const inventory = await takeInventory(repoDir, { maxFileBytes: 10 });
    const big = inventory.files.find((file) => file.path === 'src/index.ts');
    expect(big?.parsed).toBe(false);
    expect(big?.skipReason).toContain('ใหญ่เกิน');
  });
});

describe('ไปป์ไลน์ทั้งหมดบน repo จริง', () => {
  it('โคลน อ่าน และเชื่อมความสัมพันธ์ได้ครบ', async () => {
    const stages: ProgressEvent[] = [];
    const result = await analyzeRepo(repoDir, {
      allowLocal: true,
      onProgress: (event) => stages.push(event),
    });

    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(result.branch).toBe('main');
    expect(result.ref.local).toBe(true);

    // ทุกขั้นต้องรายงานตามลำดับ และจบที่ 100
    expect(stages.map((item) => item.stage)).toEqual([
      'resolve',
      'fetch',
      'inventory',
      'parse',
      'link',
      'metrics',
      'publish',
    ]);
    expect(stages.at(-1)?.percent).toBe(100);

    const paths = result.files.map((file) => file.path);
    expect(paths).toContain('src/greet.ts');
    expect(paths).toContain('scripts/tool.py');

    const edge = result.edges.find(
      (item) => item.from === 'src/index.ts' && item.to === 'src/greet.ts',
    );
    expect(edge).toBeDefined();

    expect(
      result.edges.some((item) => item.from === 'src/greet.ts' && item.to === 'src/util/format.ts'),
    ).toBe(true);

    // การนำเข้าข้ามภาษาแบบ Python ต้องเชื่อมได้เหมือนกัน
    expect(
      result.edges.some((item) => item.from === 'scripts/tool.py' && item.to === 'src/helper.py'),
    ).toBe(true);

    expect(result.external.map((item) => item.specifier)).toContain('express');
    expect(result.symbols.map((item) => item.name)).toEqual(
      expect.arrayContaining(['main', 'greet', 'formatName', 'Formatter', 'assist']),
    );
  }, 60_000);

  it('จัดอันดับไฟล์ที่ถูกพึ่งพามากที่สุดได้', async () => {
    const result = await analyzeRepo(repoDir, { allowLocal: true });
    const dependents = countDependents(result.edges);
    expect(dependents.get('src/util/format.ts')).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('ใช้ tree-sitter กับไฟล์ที่รองรับ และไม่มีคำเตือนค้าง', async () => {
    const result = await analyzeRepo(repoDir, { allowLocal: true });
    expect(result.engines.treeSitter).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
  }, 60_000);

  it('คำนวณตัวชี้วัดจาก repo จริงได้ครบชุด', async () => {
    const result = await analyzeRepo(repoDir, { allowLocal: true });

    expect(['A', 'B', 'C', 'D', 'F']).toContain(result.metrics.health.grade);
    expect(result.metrics.health.breakdown).toHaveLength(4);
    expect(result.metrics.coupling.averageDependencies).toBeGreaterThan(0);

    // ไฟล์ที่ทุกคนเรียกใช้ต้องมีรัศมีผลกระทบกว้างที่สุด
    const format = result.insights.get('src/util/format.ts');
    expect(format?.blast).toBeGreaterThanOrEqual(2);

    // ประวัติต้องอ่านได้ และรู้ว่าใครแตะไฟล์นี้
    expect(format?.churn).toBeGreaterThan(0);
    expect(format?.authors[0]?.name).toBe('ทดสอบ');
    expect(format?.lastCommitAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
  }, 60_000);

  it('สแกนความปลอดภัยระหว่างอ่านไฟล์ และกลบค่าที่เป็นความลับ', async () => {
    const result = await analyzeRepo(repoDir, { allowLocal: true });
    const leak = result.findings.find((finding) => finding.rule === 'hardcoded-secret');

    expect(leak?.path).toBe('src/config.ts');
    expect(leak?.severity).toBe('high');
    expect(leak?.snippet).not.toContain('sk_live_0123456789abcdefghij');
    expect(
      result.metrics.health.breakdown.find((item) => item.id === 'security')?.penalty,
    ).toBeGreaterThan(0);
  }, 60_000);

  it('ปฏิเสธที่อยู่ที่ไม่อนุญาตก่อนจะโคลนอะไรทั้งนั้น', async () => {
    await expect(analyzeRepo('https://example.com/a/b')).rejects.toThrow(/example.com/);
    await expect(analyzeRepo(repoDir)).rejects.toThrow(/GitHub/);
  });
});

describe('วิเคราะห์ซ้ำแบบ incremental', () => {
  it('ข้ามการอ่านและพาร์สไฟล์ที่เนื้อหาไม่เปลี่ยนจากรอบก่อน แต่ยังพาร์สไฟล์ที่แก้ใหม่จริง', async () => {
    const first = await analyzeRepo(repoDir, { allowLocal: true });
    const previousFiles = toPreviousFiles(first);

    await writeFile(
      join(repoDir, 'src/greet.ts'),
      `import { formatName } from './util/format';

export const greet = (name: string, extra?: unknown) => \`สวัสดี \${formatName(name)}\` + String(extra);

export function shout(name: string): string {
  return formatName(name).toUpperCase();
}
`,
      'utf8',
    );
    await run('git', ['add', '-A'], { cwd: repoDir });
    await run('git', ['commit', '-q', '-m', 'เพิ่มฟังก์ชัน shout'], { cwd: repoDir });

    const second = await analyzeRepo(repoDir, { allowLocal: true, previousFiles });

    // ไฟล์ที่อ่านได้ทั้งหมดยกเว้นไฟล์ที่เพิ่งแก้ต้องถูกนับว่าใช้ผลเดิม
    const readableCount = second.files.filter((file) => file.hash !== '' && file.loc > 0).length;
    expect(second.reusedFiles).toBe(readableCount - 1);

    // ไฟล์ที่แก้ต้องถูกพาร์สใหม่จริง ไม่ใช่ใช้ของเดิม — เห็นฟังก์ชันใหม่ที่เพิ่งเพิ่มเข้าไป
    expect(
      second.symbols.some((symbol) => symbol.path === 'src/greet.ts' && symbol.name === 'shout'),
    ).toBe(true);
    expect(first.symbols.some((symbol) => symbol.name === 'shout')).toBe(false);

    // ไฟล์ python ที่ไม่ได้แตะเลยต้องยังมีเส้นเชื่อมเดิมอยู่ครบ แม้จะไม่ถูกพาร์สใหม่ในรอบนี้
    const reusedEdge = second.edges.find(
      (edge) => edge.from === 'scripts/tool.py' && edge.to === 'src/helper.py',
    );
    expect(reusedEdge).toBeDefined();
    const originalEdge = first.edges.find(
      (edge) => edge.from === 'scripts/tool.py' && edge.to === 'src/helper.py',
    );
    expect(reusedEdge).toEqual(originalEdge);

    // แพ็กเกจภายนอกจากไฟล์ที่ไม่เปลี่ยน (src/index.ts เรียก express) ต้องยังถูกนับรวมอยู่
    expect(second.external.map((item) => item.specifier)).toContain('express');

    // ข้อสังเกตด้านความปลอดภัยจากไฟล์ที่ไม่เปลี่ยนต้องยังอยู่ครบเช่นกัน
    expect(second.findings.some((finding) => finding.rule === 'hardcoded-secret')).toBe(true);

    // ยอด engines ต้องรวมทั้งไฟล์ที่พาร์สใหม่และไฟล์ที่ใช้ผลเดิมซ้ำ ไม่ใช่แค่ไฟล์ที่พาร์สใหม่ในรอบนี้
    // (เคยเป็นบั๊ก: รอบที่ทุกไฟล์ไม่เปลี่ยนเลยจะรายงาน engines เป็น 0 ทั้งที่พาร์สจริงมาก่อนแล้ว)
    expect(second.engines.treeSitter + second.engines.pattern).toBeGreaterThanOrEqual(
      first.engines.treeSitter + first.engines.pattern,
    );
  }, 90_000);

  it('ไฟล์ที่ถูกลบไปแล้วไม่ทิ้งเส้นลอยไว้ในรอบใหม่', async () => {
    const first = await analyzeRepo(repoDir, { allowLocal: true });
    const previousFiles = toPreviousFiles(first);

    // greet.ts ถูกลบไปในรอบนี้ — เส้นที่เคยชี้ไปหามันจากไฟล์อื่นต้องหายไปด้วย ไม่ใช่ค้างเป็นเส้นลอย
    await run('git', ['rm', '-q', 'src/greet.ts'], { cwd: repoDir });
    await writeFile(
      join(repoDir, 'src/index.ts'),
      `import { formatName } from './util/format';
import express from 'express';

export function main() {
  return formatName('โลก') + String(express);
}
`,
      'utf8',
    );
    await run('git', ['add', '-A'], { cwd: repoDir });
    await run('git', ['commit', '-q', '-m', 'ลบ greet.ts'], { cwd: repoDir });

    const second = await analyzeRepo(repoDir, { allowLocal: true, previousFiles });

    expect(second.files.some((file) => file.path === 'src/greet.ts')).toBe(false);
    expect(second.edges.some((edge) => edge.to === 'src/greet.ts')).toBe(false);

    // ไฟล์ python ที่ไม่เกี่ยวข้องกับการลบครั้งนี้เลยยังต้องถูกใช้ผลเดิมตามปกติ
    expect(second.reusedFiles).toBeGreaterThan(0);

    // คืน greet.ts กลับมาเพื่อไม่ให้กระทบเทสต์อื่นที่ใช้ repoDir ร่วมกัน
    await run('git', ['revert', '--no-edit', 'HEAD'], { cwd: repoDir });
  }, 90_000);
});
