import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RepoRef } from './repo-ref.js';

export interface CloneResult {
  dir: string;
  commitSha: string;
  branch: string;
  cleanup: () => Promise<void>;
}

export interface CloneOptions {
  timeoutMs?: number;
  /** ความลึกของประวัติที่ดึงมา — v0.2.0 ใช้แค่คอมมิตล่าสุด */
  depth?: number;
  parentDir?: string;
}

class CommandError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        // ห้าม git ถามรหัสผ่านหรือเปิด editor ระหว่างทำงานเบื้องหลัง
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: 'echo',
        GIT_CONFIG_NOSYSTEM: '1',
        GCM_INTERACTIVE: 'never',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new CommandError(`คำสั่ง ${command} ใช้เวลานานเกินกำหนด`, stderr));
    }, options.timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new CommandError(`เรียก ${command} ไม่สำเร็จ: ${error.message}`, stderr));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new CommandError(`${command} จบด้วยรหัส ${code}`, stderr.trim()));
    });
  });
}

/** ข้อความจาก git เป็นภาษาอังกฤษเสมอ แปลงเป็นเหตุผลที่ผู้ใช้เข้าใจได้ */
function explain(stderr: string): string {
  const text = stderr.toLowerCase();
  if (text.includes('repository not found') || text.includes('not found')) {
    return 'ไม่พบ repo นี้ อาจสะกดผิดหรือเป็น repo ส่วนตัว';
  }
  if (text.includes('could not resolve host') || text.includes('network')) {
    return 'ต่อไปยังผู้ให้บริการ repo ไม่ได้ ลองใหม่อีกครั้ง';
  }
  if (text.includes('authentication') || text.includes('permission denied')) {
    return 'ไม่มีสิทธิ์เข้าถึง repo นี้';
  }
  return 'โคลน repo ไม่สำเร็จ';
}

/**
 * โคลนแบบตื้นลงโฟลเดอร์ชั่วคราว
 * ปิด symlink ของ git ไว้ เพราะ repo ที่ไม่น่าไว้ใจใช้ลิงก์ชี้ออกนอกโฟลเดอร์ได้
 */
export async function cloneRepo(ref: RepoRef, options: CloneOptions = {}): Promise<CloneResult> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const depth = options.depth ?? 1;
  const parent = options.parentDir ?? tmpdir();
  const dir = await mkdtemp(join(parent, 'repolens-'));
  const cleanup = async (): Promise<void> => {
    await rm(dir, { recursive: true, force: true });
  };

  try {
    if (ref.local) {
      const source = await stat(ref.cloneUrl).catch(() => null);
      if (!source) throw new Error('ไม่พบโฟลเดอร์ที่ระบุ');
      if (!source.isDirectory()) throw new Error('ที่อยู่ในเครื่องไม่ใช่โฟลเดอร์');
    }

    await run(
      'git',
      [
        '-c',
        'core.symlinks=false',
        '-c',
        'advice.detachedHead=false',
        // git ปฏิเสธ repo ที่เจ้าของไฟล์ไม่ตรงกับผู้รันตั้งแต่ 2.35.2 เป็นต้นมา
        // การโคลนเป็นการอ่านอย่างเดียวและเราไม่รันอะไรจาก repo เลย ข้อจำกัดนี้จึงไม่ได้กันอะไรให้เรา
        // แต่ทำให้โคลนโฟลเดอร์ที่ mount เข้ามาไม่ได้ (เจอตอนทดสอบปลายทางของ v0.2.0)
        '-c',
        'safe.directory=*',
        'clone',
        '--depth',
        String(depth),
        '--single-branch',
        '--no-tags',
        '--quiet',
        ref.cloneUrl,
        dir,
      ],
      { timeoutMs },
    );

    const commitSha = await run('git', ['rev-parse', 'HEAD'], { cwd: dir, timeoutMs: 15_000 });
    const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: dir,
      timeoutMs: 15_000,
    });

    return { dir, commitSha, branch, cleanup };
  } catch (error) {
    await cleanup();
    if (error instanceof CommandError) {
      throw new Error(explain(error.stderr || error.message));
    }
    throw error;
  }
}
