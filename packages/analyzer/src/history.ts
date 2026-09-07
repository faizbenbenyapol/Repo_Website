import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface FileHistory {
  /** จำนวนคอมมิตที่แตะไฟล์นี้ ในช่วงประวัติที่ดึงมา */
  commits: number;
  /** ผู้เขียนสามอันดับแรก เรียงตามจำนวนคอมมิตที่แตะไฟล์นี้ */
  authors: { name: string; commits: number }[];
  lastCommitAt: string | null;
}

export interface HistoryResult {
  files: Map<string, FileHistory>;
  /** จำนวนคอมมิตที่อ่านได้จริง — น้อยกว่าที่ขอได้ถ้า repo ยังใหม่ */
  commitsRead: number;
}

const SEPARATOR = '';

/**
 * อ่านประวัติการแก้ไขจาก git log
 *
 * ใช้ตอบสองคำถาม: ไฟล์ไหนถูกแก้บ่อย (จุดร้อน) และควรถามใครเรื่องไฟล์นี้ (เจ้าของโค้ด)
 * ตัดคอมมิตที่รวมสาขาออก เพราะมันแตะไฟล์จำนวนมากโดยไม่ได้แก้อะไรจริง ๆ
 * และจำกัดจำนวนคอมมิตไว้ เพราะ repo เก่าที่มีประวัติเป็นแสนคอมมิตทำให้ขั้นนี้กินเวลานานกว่าการอ่านโค้ดทั้ง repo
 */
export async function readHistory(
  dir: string,
  options: { maxCommits?: number; timeoutMs?: number } = {},
): Promise<HistoryResult> {
  const maxCommits = options.maxCommits ?? 300;
  const files = new Map<string, FileHistory>();
  const authorCounts = new Map<string, Map<string, number>>();

  let stdout = '';
  try {
    const result = await run(
      'git',
      [
        '-c',
        'safe.directory=*',
        'log',
        '--no-merges',
        `--max-count=${maxCommits}`,
        `--format=${SEPARATOR}%H${SEPARATOR}%an${SEPARATOR}%cI`,
        '--name-only',
      ],
      { cwd: dir, timeout: options.timeoutMs ?? 60_000, maxBuffer: 32 * 1024 * 1024 },
    );
    stdout = result.stdout;
  } catch {
    // repo ที่โคลนมาแบบตื้นมากหรือยังไม่มีคอมมิต ให้ถือว่าไม่มีประวัติ ไม่ใช่ความล้มเหลวของงานทั้งชิ้น
    return { files, commitsRead: 0 };
  }

  let author = '';
  let committedAt = '';
  let commitsRead = 0;

  for (const rawLine of stdout.split('\n')) {
    if (rawLine.startsWith(SEPARATOR)) {
      const [, , name, date] = rawLine.split(SEPARATOR);
      author = name ?? '';
      committedAt = date ?? '';
      commitsRead += 1;
      continue;
    }

    const path = rawLine.trim();
    if (!path) continue;

    const current = files.get(path) ?? { commits: 0, authors: [], lastCommitAt: null };
    current.commits += 1;
    if (!current.lastCommitAt && committedAt) current.lastCommitAt = committedAt;
    files.set(path, current);

    if (author) {
      const perFile = authorCounts.get(path) ?? new Map<string, number>();
      perFile.set(author, (perFile.get(author) ?? 0) + 1);
      authorCounts.set(path, perFile);
    }
  }

  for (const [path, counts] of authorCounts) {
    const entry = files.get(path);
    if (!entry) continue;
    entry.authors = [...counts.entries()]
      .map(([name, commits]) => ({ name, commits }))
      .sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name))
      .slice(0, 3);
  }

  return { files, commitsRead };
}

/** จำนวนคอมมิตต่อไฟล์ในรูปแบบที่ตัวคำนวณตัวชี้วัดใช้ */
export function churnMap(history: HistoryResult): Map<string, number> {
  return new Map([...history.files].map(([path, entry]) => [path, entry.commits]));
}
