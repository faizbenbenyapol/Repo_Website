import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzeRepo, countDependents, takeInventory, type ProgressEvent } from '../src/index.js';

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

  it('ปฏิเสธที่อยู่ที่ไม่อนุญาตก่อนจะโคลนอะไรทั้งนั้น', async () => {
    await expect(analyzeRepo('https://example.com/a/b')).rejects.toThrow(/example.com/);
    await expect(analyzeRepo(repoDir)).rejects.toThrow(/GitHub/);
  });
});
