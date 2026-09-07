import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cloneRepo, type CloneOptions } from './clone.js';
import { buildGraph, type Edge, type ExternalDependency } from './graph.js';
import { takeInventory, type FileEntry, type InventoryResult } from './inventory.js';
import { parseSource, treeSitterFailure, type RawImport, type SymbolInfo } from './parse/index.js';
import { parseRepoRef, type RepoRef } from './repo-ref.js';

/** ขั้นตอนที่ผู้ใช้เห็นบนหน้าจอระหว่างรอ ตรงกับที่ทำจริงในโค้ดนี้ */
export const STAGES = ['resolve', 'fetch', 'inventory', 'parse', 'link', 'publish'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  resolve: 'ตรวจสอบที่อยู่ repo',
  fetch: 'ดาวน์โหลดซอร์สโค้ด',
  inventory: 'สำรวจไฟล์ทั้งหมด',
  parse: 'อ่านโครงสร้างโค้ด',
  link: 'เชื่อมความสัมพันธ์',
  publish: 'สรุปผล',
};

export interface ProgressEvent {
  stage: Stage;
  /** ความคืบหน้ารวมทั้งงาน 0–100 */
  percent: number;
  message: string;
}

export interface FileSymbol extends SymbolInfo {
  path: string;
}

export interface AnalysisResult {
  ref: RepoRef;
  commitSha: string;
  branch: string;
  files: FileEntry[];
  totals: InventoryResult['totals'];
  edges: Edge[];
  external: ExternalDependency[];
  unresolved: number;
  symbols: FileSymbol[];
  engines: { treeSitter: number; pattern: number };
  warnings: string[];
  durationMs: number;
}

export interface AnalyzeOptions extends CloneOptions {
  allowLocal?: boolean;
  maxFileBytes?: number;
  maxFiles?: number;
  /** จำนวน symbol สูงสุดที่เก็บต่อไฟล์ กันไฟล์ที่ถูกสร้างอัตโนมัติทำให้ผลบวม */
  maxSymbolsPerFile?: number;
  concurrency?: number;
  onProgress?: (event: ProgressEvent) => void;
}

const STAGE_PERCENT: Record<Stage, number> = {
  resolve: 5,
  fetch: 25,
  inventory: 40,
  parse: 80,
  link: 95,
  publish: 100,
};

async function readGoModule(root: string): Promise<string | null> {
  try {
    const text = await readFile(join(root, 'go.mod'), 'utf8');
    return /^module\s+(\S+)/m.exec(text)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** ทำงานทีละชุดเพื่อไม่ให้เปิดไฟล์พร้อมกันจนหน่วยความจำบาน */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item, index);
    }
  });

  await Promise.all(runners);
  return results;
}

/**
 * ไปป์ไลน์เต็มของ v0.2.0: ตรวจที่อยู่ → โคลน → สำรวจไฟล์ → อ่านโครงสร้าง → เชื่อมความสัมพันธ์
 * ทุกขั้นรายงานความคืบหน้าออกไป เพื่อให้ผู้ใช้เห็นว่าระบบกำลังทำอะไรอยู่จริง ๆ ไม่ใช่แถบหลอก
 */
export async function analyzeRepo(
  input: string,
  options: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  const report = (stage: Stage, message: string): void => {
    options.onProgress?.({ stage, percent: STAGE_PERCENT[stage], message });
  };

  report('resolve', STAGE_LABELS.resolve);
  const parsed = parseRepoRef(input, { allowLocal: options.allowLocal });
  if (!parsed.ok) throw new Error(parsed.error);
  const ref = parsed.ref;

  report('fetch', `${STAGE_LABELS.fetch} — ${ref.owner}/${ref.name}`);
  const clone = await cloneRepo(ref, options);

  try {
    report('inventory', STAGE_LABELS.inventory);
    const inventory = await takeInventory(clone.dir, {
      maxFileBytes: options.maxFileBytes,
      maxFiles: options.maxFiles,
    });

    const parsable = inventory.files.filter((file) => file.parsed && file.language);
    report('parse', `${STAGE_LABELS.parse} — ${parsable.length} ไฟล์`);

    const imports = new Map<string, RawImport[]>();
    const symbols: FileSymbol[] = [];
    const maxSymbols = options.maxSymbolsPerFile ?? 300;
    const engines = { treeSitter: 0, pattern: 0 };

    await mapWithLimit(parsable, options.concurrency ?? 8, async (file) => {
      const source = await readFile(join(clone.dir, file.path), 'utf8');
      const result = await parseSource(source, file.language as string);

      if (result.engine === 'tree-sitter') engines.treeSitter += 1;
      else engines.pattern += 1;

      if (result.imports.length > 0) imports.set(file.path, result.imports);
      for (const symbol of result.symbols.slice(0, maxSymbols)) {
        symbols.push({ ...symbol, path: file.path });
      }
    });

    const failure = treeSitterFailure();
    if (failure && engines.treeSitter === 0 && parsable.length > 0) {
      warnings.push(`tree-sitter ใช้ไม่ได้ (${failure}) จึงใช้ตัวแยกโค้ดสำรองแทนทั้งหมด`);
    }

    report('link', STAGE_LABELS.link);
    const graph = buildGraph({
      files: inventory.files.map((file) => ({ path: file.path, language: file.language })),
      imports,
      goModule: await readGoModule(clone.dir),
    });

    if (inventory.totals.files >= (options.maxFiles ?? 50_000)) {
      warnings.push('repo นี้ใหญ่เกินขีดจำกัด จึงวิเคราะห์เฉพาะไฟล์ชุดแรกเท่านั้น');
    }

    report('publish', STAGE_LABELS.publish);

    return {
      ref,
      commitSha: clone.commitSha,
      branch: clone.branch,
      files: inventory.files,
      totals: inventory.totals,
      edges: graph.edges,
      external: graph.external,
      unresolved: graph.unresolved,
      symbols,
      engines,
      warnings,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await clone.cleanup();
  }
}
