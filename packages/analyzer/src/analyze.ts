import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cloneRepo, type CloneOptions } from './clone.js';
import { buildGraph, type Edge, type ExternalDependency, type FileExternalUsage } from './graph.js';
import { churnMap, readHistory, type FileHistory } from './history.js';
import { takeInventory, type FileEntry, type InventoryResult } from './inventory.js';
import { blastRadius, computeMetrics, type Metrics } from './metrics.js';
import {
  parseSource,
  treeSitterFailure,
  type ImportKind,
  type ParseEngine,
  type RawImport,
  type SymbolInfo,
} from './parse/index.js';
import { parseRepoRef, type RepoRef } from './repo-ref.js';
import { scanFile, summarize, type Finding } from './security.js';

/** ขั้นตอนที่ผู้ใช้เห็นบนหน้าจอระหว่างรอ ตรงกับที่ทำจริงในโค้ดนี้ */
export const STAGES = [
  'resolve',
  'fetch',
  'inventory',
  'parse',
  'link',
  'metrics',
  'publish',
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  resolve: 'ตรวจสอบที่อยู่ repo',
  fetch: 'ดาวน์โหลดซอร์สโค้ด',
  inventory: 'สำรวจไฟล์ทั้งหมด',
  parse: 'อ่านโครงสร้างโค้ด',
  link: 'เชื่อมความสัมพันธ์',
  metrics: 'คำนวณตัวชี้วัด',
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

/** ข้อมูลรายไฟล์ที่เพิ่มขึ้นมาจากประวัติและกราฟ */
export interface FileInsight {
  churn: number;
  authors: FileHistory['authors'];
  lastCommitAt: string | null;
  /** จำนวนไฟล์ที่ได้รับผลกระทบถ้าไฟล์นี้เปลี่ยน */
  blast: number;
}

export interface AnalysisResult {
  ref: RepoRef;
  commitSha: string;
  branch: string;
  files: FileEntry[];
  insights: Map<string, FileInsight>;
  totals: InventoryResult['totals'];
  edges: Edge[];
  external: ExternalDependency[];
  externalByFile: FileExternalUsage[];
  unresolved: number;
  symbols: FileSymbol[];
  metrics: Metrics;
  findings: Finding[];
  engines: { treeSitter: number; pattern: number };
  /** จำนวนไฟล์ที่ใช้ผลจากรอบวิเคราะห์ก่อนหน้าซ้ำ เพราะเนื้อหาไม่เปลี่ยน (v0.7.0) */
  reusedFiles: number;
  /** เครื่องมือพาร์สที่ใช้กับแต่ละไฟล์ (รวมไฟล์ที่ใช้ผลเดิมซ้ำด้วย) เก็บไว้ให้รอบถัดไปรวมยอด engines ถูกต้อง (v0.8.0) */
  fileEngines: Map<string, ParseEngine>;
  warnings: string[];
  durationMs: number;
}

/**
 * ผลจากไฟล์เดียวในรอบวิเคราะห์ก่อนหน้า — เก็บเท่าที่ต้องใช้เพื่อข้ามการพาร์สไฟล์ที่เนื้อหาไม่เปลี่ยน
 * โดยไม่ต้องอ่านหรือพาร์สไฟล์นั้นซ้ำเลย (v0.7.0)
 */
export interface PreviousFileSnapshot {
  hash: string;
  symbols: SymbolInfo[];
  /** เส้นที่แก้ไขจากไฟล์นี้ในรอบก่อน (ไม่รวมพาธต้นทางเพราะซ้ำกับ key ของ Map ที่เก็บอยู่แล้ว) */
  edges: { to: string; kind: ImportKind; line: number; confidence: number }[];
  findings: Omit<Finding, 'path'>[];
  externals: { specifier: string; count: number }[];
  /** เครื่องมือที่เคยพาร์สไฟล์นี้ — null ถ้าไฟล์นี้ไม่เคยผ่านการพาร์ส (v0.8.0) */
  engine: ParseEngine | null;
}

export interface AnalyzeOptions extends CloneOptions {
  allowLocal?: boolean;
  maxFileBytes?: number;
  maxFiles?: number;
  /** จำนวน symbol สูงสุดที่เก็บต่อไฟล์ กันไฟล์ที่ถูกสร้างอัตโนมัติทำให้ผลบวม */
  maxSymbolsPerFile?: number;
  maxCommits?: number;
  concurrency?: number;
  onProgress?: (event: ProgressEvent) => void;
  /**
   * ผลจากรอบวิเคราะห์ก่อนหน้าของ repo เดียวกัน — ไฟล์ที่ค่าแฮชตรงกับรอบนี้จะไม่ถูกอ่านหรือพาร์สใหม่เลย
   * ใช้ผลเดิมแทนทั้งหมด ไม่ระบุ = วิเคราะห์เต็มรูปแบบทุกไฟล์เหมือนเดิม
   */
  previousFiles?: Map<string, PreviousFileSnapshot>;
}

const STAGE_PERCENT: Record<Stage, number> = {
  resolve: 5,
  fetch: 20,
  inventory: 35,
  parse: 70,
  link: 82,
  metrics: 94,
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
 * ไปป์ไลน์เต็ม: ตรวจที่อยู่ → โคลน → สำรวจไฟล์ → อ่านโครงสร้าง → เชื่อมความสัมพันธ์ → คำนวณตัวชี้วัด
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
  // ดึงประวัติมาพอสมควร เพราะจุดร้อนกับเจ้าของโค้ดต้องใช้คอมมิตย้อนหลัง ไม่ใช่แค่คอมมิตล่าสุด
  const clone = await cloneRepo(ref, { depth: options.depth ?? 200, ...options });

  try {
    report('inventory', STAGE_LABELS.inventory);
    const inventory = await takeInventory(clone.dir, {
      maxFileBytes: options.maxFileBytes,
      maxFiles: options.maxFiles,
    });

    const readable = inventory.files.filter((file) => file.hash !== '' && file.loc > 0);
    report('parse', `${STAGE_LABELS.parse} — ${readable.length} ไฟล์`);

    const imports = new Map<string, RawImport[]>();
    const symbols: FileSymbol[] = [];
    const findings: Finding[] = [];
    const maxSymbols = options.maxSymbolsPerFile ?? 300;
    const engines = { treeSitter: 0, pattern: 0 };
    const reusedEdges: Edge[] = [];
    const reusedExternal: FileExternalUsage[] = [];
    const fileEngines = new Map<string, ParseEngine>();
    let reusedFiles = 0;

    await mapWithLimit(readable, options.concurrency ?? 8, async (file) => {
      // ไฟล์ที่แฮชตรงกับรอบก่อนหน้าเนื้อหาไม่เปลี่ยนแม้แต่ไบต์เดียว — ใช้ผลเดิมทั้งหมดแทน
      // โดยไม่อ่านหรือพาร์สไฟล์นี้ซ้ำเลย เพราะการอ่าน AST ด้วย tree-sitter คือส่วนที่กินเวลาที่สุด
      // ของทั้งไปป์ไลน์ ยิ่งข้ามได้มาก รอบวิเคราะห์ซ้ำของ repo ที่แก้แค่ไม่กี่ไฟล์ก็ยิ่งเร็วขึ้นมาก
      const previous = options.previousFiles?.get(file.path);
      if (previous && file.hash !== '' && previous.hash === file.hash) {
        reusedFiles += 1;
        for (const symbol of previous.symbols.slice(0, maxSymbols)) {
          symbols.push({ ...symbol, path: file.path });
        }
        for (const edge of previous.edges) {
          reusedEdges.push({
            from: file.path,
            to: edge.to,
            kind: edge.kind,
            line: edge.line,
            confidence: edge.confidence,
          });
        }
        for (const finding of previous.findings) {
          findings.push({ ...finding, path: file.path });
        }
        for (const usage of previous.externals) {
          reusedExternal.push({ path: file.path, specifier: usage.specifier, count: usage.count });
        }
        // ไฟล์นี้ไม่ถูกพาร์สใหม่ แต่เคยผ่านเครื่องมือไหนมาก่อนก็ยังนับรวมในยอด engines ของรอบนี้ด้วย
        // ไม่งั้นรอบที่ทุกไฟล์ไม่เปลี่ยนเลยจะรายงานยอด engines เป็น 0 ทั้งที่พาร์สจริงมาแล้วทุกไฟล์
        if (previous.engine) {
          fileEngines.set(file.path, previous.engine);
          if (previous.engine === 'tree-sitter') engines.treeSitter += 1;
          else engines.pattern += 1;
        }
        return;
      }

      const source = await readFile(join(clone.dir, file.path), 'utf8');

      // สแกนความปลอดภัยกับทุกไฟล์ที่อ่านเป็นข้อความได้ ไม่ใช่เฉพาะไฟล์โค้ด
      // เพราะกุญแจที่หลุดบ่อยที่สุดอยู่ในไฟล์ตั้งค่าและไฟล์สภาพแวดล้อม
      findings.push(...scanFile({ path: file.path, language: file.language, source }));

      if (!file.parsed || !file.language) return;

      const result = await parseSource(source, file.language);
      fileEngines.set(file.path, result.engine);
      if (result.engine === 'tree-sitter') engines.treeSitter += 1;
      else engines.pattern += 1;

      if (result.imports.length > 0) imports.set(file.path, result.imports);
      for (const symbol of result.symbols.slice(0, maxSymbols)) {
        symbols.push({ ...symbol, path: file.path });
      }
    });

    const failure = treeSitterFailure();
    if (failure && engines.treeSitter === 0 && inventory.totals.parsed > 0) {
      warnings.push(`tree-sitter ใช้ไม่ได้ (${failure}) จึงใช้ตัวแยกโค้ดสำรองแทนทั้งหมด`);
    }

    report('link', STAGE_LABELS.link);
    const graph = buildGraph({
      files: inventory.files.map((file) => ({ path: file.path, language: file.language })),
      imports,
      goModule: await readGoModule(clone.dir),
      reused: { edges: reusedEdges, externalByFile: reusedExternal },
    });

    report('metrics', STAGE_LABELS.metrics);
    const history = await readHistory(clone.dir, { maxCommits: options.maxCommits });
    if (history.commitsRead === 0) {
      warnings.push('อ่านประวัติการแก้ไขไม่ได้ จุดร้อนและเจ้าของโค้ดจึงยังว่างอยู่');
    }

    const churn = churnMap(history);
    const blast = blastRadius(graph.edges);
    const security = summarize(findings);

    const metrics = computeMetrics({
      files: inventory.files,
      edges: graph.edges,
      churn,
      securityPenalty: security.penalty,
      findingCounts: security.counts,
    });

    const insights = new Map(
      inventory.files.map((file) => {
        const entry = history.files.get(file.path);
        return [
          file.path,
          {
            churn: entry?.commits ?? 0,
            authors: entry?.authors ?? [],
            lastCommitAt: entry?.lastCommitAt ?? null,
            blast: blast.get(file.path) ?? 0,
          },
        ];
      }),
    );

    if (inventory.totals.files >= (options.maxFiles ?? 50_000)) {
      warnings.push('repo นี้ใหญ่เกินขีดจำกัด จึงวิเคราะห์เฉพาะไฟล์ชุดแรกเท่านั้น');
    }

    report('publish', STAGE_LABELS.publish);

    return {
      ref,
      commitSha: clone.commitSha,
      branch: clone.branch,
      files: inventory.files,
      insights,
      totals: inventory.totals,
      edges: graph.edges,
      external: graph.external,
      externalByFile: graph.externalByFile,
      unresolved: graph.unresolved,
      symbols,
      metrics,
      findings,
      engines,
      reusedFiles,
      fileEngines,
      warnings,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await clone.cleanup();
  }
}
