import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { detectLanguage, isAnalyzable } from './languages.js';

export interface FileEntry {
  path: string;
  language: string | null;
  bytes: number;
  loc: number;
  hash: string;
  /** false เมื่อไฟล์ใหญ่เกิน เป็นไบนารี หรือเป็นภาษาที่ยังอ่านโครงสร้างไม่ได้ */
  parsed: boolean;
  skipReason: string | null;
}

export interface InventoryResult {
  files: FileEntry[];
  totals: {
    files: number;
    parsed: number;
    bytes: number;
    loc: number;
    /** จำนวนไฟล์แยกตามภาษา เรียงจากมากไปน้อย */
    languages: { language: string; files: number; loc: number }[];
  };
}

/**
 * โฟลเดอร์ที่ข้ามเสมอ — เป็นของที่ถูกสร้างขึ้นหรือถูกคัดลอกมา ไม่ใช่โค้ดที่โปรเจกต์นี้เขียนเอง
 * การนับรวมพวกนี้ทำให้ตัวชี้วัดทุกตัวเพี้ยนและกราฟรกจนอ่านไม่ออก
 */
export const SKIP_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  'Pods',
  '.gradle',
  '.idea',
  '.vscode',
  'playwright-report',
  'test-results',
]);

const SKIP_FILE_PATTERNS = [
  /^pnpm-lock\.yaml$/,
  /^package-lock\.json$/,
  /^yarn\.lock$/,
  /^poetry\.lock$/,
  /^Cargo\.lock$/,
  /^go\.sum$/,
  /\.min\.(js|css)$/,
  /\.map$/,
];

export interface InventoryOptions {
  /** ไฟล์ที่ใหญ่กว่านี้ยังถูกนับ แต่ไม่ถูกอ่านเนื้อหา */
  maxFileBytes?: number;
  maxFiles?: number;
}

function isBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 4096);
  return sample.includes(0);
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  let lines = 1;
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) lines += 1;
  return lines;
}

/**
 * เดินไฟล์ทั้งหมดใน repo ที่โคลนมา
 * ไม่เดินตาม symlink โดยตั้งใจ เพราะ repo ที่ไม่น่าไว้ใจสามารถวางลิงก์ชี้ออกนอกโฟลเดอร์ได้
 */
export async function takeInventory(
  root: string,
  options: InventoryOptions = {},
): Promise<InventoryResult> {
  const maxFileBytes = options.maxFileBytes ?? 2 * 1024 * 1024;
  const maxFiles = options.maxFiles ?? 50_000;
  const files: FileEntry[] = [];

  async function walk(dir: string): Promise<void> {
    if (files.length >= maxFiles) return;
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const full = join(dir, entry.name);

      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SKIP_FILE_PATTERNS.some((pattern) => pattern.test(entry.name))) continue;

      const path = relative(root, full).split(sep).join('/');
      const stats = await lstat(full);
      const language = detectLanguage(path);

      if (stats.size > maxFileBytes) {
        files.push({
          path,
          language,
          bytes: stats.size,
          loc: 0,
          hash: '',
          parsed: false,
          skipReason: 'ไฟล์ใหญ่เกินกว่าจะอ่านเนื้อหา',
        });
        continue;
      }

      const buffer = await readFile(full);
      if (isBinary(buffer)) {
        files.push({
          path,
          language,
          bytes: stats.size,
          loc: 0,
          hash: createHash('sha256').update(buffer).digest('hex').slice(0, 16),
          parsed: false,
          skipReason: 'เป็นไฟล์ไบนารี',
        });
        continue;
      }

      const text = buffer.toString('utf8');
      files.push({
        path,
        language,
        bytes: stats.size,
        loc: countLines(text),
        hash: createHash('sha256').update(buffer).digest('hex').slice(0, 16),
        parsed: isAnalyzable(language),
        skipReason: isAnalyzable(language) ? null : 'ยังไม่รองรับการอ่านโครงสร้างของภาษานี้',
      });
    }
  }

  await walk(root);
  files.sort((a, b) => a.path.localeCompare(b.path));

  const byLanguage = new Map<string, { files: number; loc: number }>();
  let bytes = 0;
  let loc = 0;
  let parsed = 0;

  for (const file of files) {
    bytes += file.bytes;
    loc += file.loc;
    if (file.parsed) parsed += 1;
    const key = file.language ?? 'อื่น ๆ';
    const current = byLanguage.get(key) ?? { files: 0, loc: 0 };
    current.files += 1;
    current.loc += file.loc;
    byLanguage.set(key, current);
  }

  const languages = [...byLanguage.entries()]
    .map(([language, value]) => ({ language, ...value }))
    .sort((a, b) => b.loc - a.loc || b.files - a.files);

  return { files, totals: { files: files.length, parsed, bytes, loc, languages } };
}
