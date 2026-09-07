import { z } from 'zod';

/** โฮสต์ที่อนุญาตให้โคลน — กันไม่ให้เซิร์ฟเวอร์ถูกใช้ยิงเครือข่ายภายใน (SSRF) */
export const ALLOWED_HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org'] as const;
export type AllowedHost = (typeof ALLOWED_HOSTS)[number];

export const repoRefSchema = z.object({
  host: z.string(),
  owner: z.string(),
  name: z.string(),
  cloneUrl: z.string(),
  /** true เมื่อเป็น repo ในเครื่อง ซึ่งเปิดใช้เฉพาะตอนทดสอบเท่านั้น */
  local: z.boolean(),
});

export type RepoRef = z.infer<typeof repoRefSchema>;

export type ParseResult = { ok: true; ref: RepoRef } | { ok: false; error: string };

const SEGMENT = /^[A-Za-z0-9._-]+$/;

function isPrivateHost(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.internal')) {
    return true;
  }
  // ที่อยู่ IP ทุกรูปแบบถือว่าไม่ปลอดภัย เพราะเลี่ยงรายชื่อโฮสต์ที่อนุญาตได้
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(lower) || lower.includes(':');
}

/**
 * รับได้ทั้ง "owner/name", ลิงก์ https, และรูป git@host:owner/name
 * ปฏิเสธทุกอย่างที่ไม่ได้อยู่ในรายชื่อโฮสต์ที่อนุญาต และคืนเหตุผลเป็นภาษาไทยให้แสดงกับผู้ใช้ได้ตรง ๆ
 */
export function parseRepoRef(input: string, options: { allowLocal?: boolean } = {}): ParseResult {
  const text = input.trim();
  if (!text) return { ok: false, error: 'ยังไม่ได้ใส่ที่อยู่ repo' };

  if (text.startsWith('file://') || text.startsWith('/')) {
    if (!options.allowLocal) {
      return { ok: false, error: 'รับเฉพาะ repo จาก GitHub, GitLab หรือ Bitbucket เท่านั้น' };
    }
    const path = text.replace(/^file:\/\//, '');
    const name = path.split('/').filter(Boolean).pop() ?? 'local';
    return {
      ok: true,
      ref: { host: 'local', owner: 'local', name, cloneUrl: path, local: true },
    };
  }

  let host = 'github.com';
  let rest = text;

  const sshMatch = /^git@([^:]+):(.+)$/.exec(text);
  if (sshMatch?.[1] && sshMatch[2]) {
    host = sshMatch[1];
    rest = sshMatch[2];
  } else if (/^https?:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return { ok: false, error: 'อ่านลิงก์นี้ไม่ออก ลองวางลิงก์เต็มของหน้า repo อีกครั้ง' };
    }
    if (url.protocol !== 'https:') {
      return { ok: false, error: 'รับเฉพาะลิงก์ https เท่านั้น' };
    }
    host = url.hostname;
    rest = url.pathname.replace(/^\//, '');
  } else if (text.includes('://')) {
    return { ok: false, error: 'รับเฉพาะลิงก์ https เท่านั้น' };
  }

  if (isPrivateHost(host)) {
    return { ok: false, error: 'ที่อยู่นี้ชี้ไปเครือข่ายภายใน จึงไม่อนุญาตให้วิเคราะห์' };
  }

  const normalizedHost = host.toLowerCase().replace(/^www\./, '');
  if (!ALLOWED_HOSTS.includes(normalizedHost as AllowedHost)) {
    return {
      ok: false,
      error: `ยังรองรับเฉพาะ ${ALLOWED_HOSTS.join(', ')} — ที่อยู่นี้มาจาก ${normalizedHost}`,
    };
  }

  const segments = rest
    .replace(/\.git$/i, '')
    .split('/')
    .filter(Boolean);
  const [owner, name] = segments;

  if (!owner || !name) {
    return {
      ok: false,
      error: 'ที่อยู่ไม่ครบ ต้องมีทั้งชื่อเจ้าของและชื่อ repo เช่น facebook/react',
    };
  }
  if (!SEGMENT.test(owner) || !SEGMENT.test(name)) {
    return { ok: false, error: 'ชื่อเจ้าของหรือชื่อ repo มีอักขระที่ใช้ไม่ได้' };
  }

  return {
    ok: true,
    ref: {
      host: normalizedHost,
      owner,
      name,
      cloneUrl: `https://${normalizedHost}/${owner}/${name}.git`,
      local: false,
    },
  };
}

export function repoSlug(ref: RepoRef): string {
  return `${ref.owner}/${ref.name}`;
}
