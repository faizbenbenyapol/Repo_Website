import { keepGrounded, type Citation, type Claim } from '@repolens/shared';

/**
 * เปลี่ยนข้อความจากโมเดลให้เป็นข้อมูลที่เชื่อได้
 *
 * ทุกอย่างในไฟล์นี้ตั้งอยู่บนสมมติฐานเดียว: โมเดลอาจเขียนอะไรออกมาก็ได้
 * ทั้งเลขบรรทัดที่ไม่มีอยู่จริง พาธที่สะกดเอง หรือ JSON ที่ปิดวงเล็บไม่ครบ
 * หน้าที่ของชั้นนี้คือรับสิ่งนั้นมาแล้วส่งต่อเฉพาะส่วนที่ตรวจสอบย้อนกลับได้
 */

/**
 * ดึงก้อน JSON ก้อนแรกออกจากข้อความ
 * เผื่อกรณีที่โมเดลใส่รั้วโค้ดหรือเขียนเกริ่นนำมาด้วย ทั้งที่สั่งไปแล้วว่าให้ตอบ JSON ล้วน
 */
export function extractJson(text: string): unknown | null {
  const trimmed = text.trim();
  const withoutFence = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
    : trimmed;

  const direct = tryParse(withoutFence);
  if (direct !== null) return direct;

  const start = withoutFence.indexOf('{');
  if (start === -1) return null;

  // ไล่หาวงเล็บปิดที่คู่กันจริง เพราะสตริงข้างในอาจมีวงเล็บปนอยู่
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < withoutFence.length; i += 1) {
    const char = withoutFence[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') inString = !inString;
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return tryParse(withoutFence.slice(start, i + 1));
    }
  }

  return null;
}

function tryParse(text: string): unknown | null {
  try {
    const value: unknown = JSON.parse(text);
    // ต้องเป็นวัตถุเท่านั้น อาร์เรย์หรือค่าเดี่ยวถือว่าใช้ไม่ได้
    // เพราะทุกที่ที่เรียกตัวนี้อ่านผลเป็นวัตถุที่มีฟิลด์ชื่อรู้จัก การคืนอาร์เรย์จึงกลายเป็นชนิดผิดแบบเงียบ ๆ
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export interface FileFact {
  path: string;
  loc: number;
}

/**
 * สร้างตัวตรวจว่า `ไฟล์:บรรทัด` หนึ่งคู่มีอยู่จริงหรือไม่
 * ไฟล์ที่นับบรรทัดไม่ได้ให้ผ่านที่บรรทัดแรกได้ เพราะการมีอยู่ของไฟล์เองก็เป็นข้อเท็จจริงที่ตรวจได้
 */
export function makeVerifier(files: Iterable<FileFact>): (citation: Citation) => boolean {
  const lines = new Map<string, number>();
  for (const file of files) lines.set(file.path, Math.max(file.loc, 1));

  return (citation) => {
    const max = lines.get(citation.path);
    if (max === undefined) return false;
    return Number.isInteger(citation.line) && citation.line >= 1 && citation.line <= max;
  };
}

interface RawClaim {
  text?: unknown;
  /** เลขบรรทัดในไฟล์ที่กำลังสรุปอยู่ ใช้ตอนสรุปรายไฟล์ */
  lines?: unknown;
  /** อ้างอิงข้ามไฟล์ ใช้ตอนสรุปโมดูลและทั้ง repo */
  refs?: unknown;
}

function toCitations(raw: RawClaim, defaultPath: string | null): Citation[] {
  const citations: Citation[] = [];

  if (Array.isArray(raw.lines) && defaultPath) {
    for (const line of raw.lines) {
      if (typeof line === 'number') citations.push({ path: defaultPath, line: Math.trunc(line) });
    }
  }

  if (Array.isArray(raw.refs)) {
    for (const ref of raw.refs) {
      if (typeof ref !== 'object' || ref === null) continue;
      const { path, line } = ref as { path?: unknown; line?: unknown };
      if (typeof path === 'string' && typeof line === 'number') {
        citations.push({ path, line: Math.trunc(line) });
      }
    }
  }

  return citations;
}

/**
 * แปลงรายการข้อความจากโมเดลเป็นข้ออ้างที่มีบรรทัดจริงกำกับ
 * ข้อไหนไม่เหลืออ้างอิงที่ตรวจผ่าน ข้อนั้นถูกตัดทิ้ง ไม่ใช่แสดงแบบไม่มีที่มา
 */
export function groundClaims(
  value: unknown,
  verify: (citation: Citation) => boolean,
  defaultPath: string | null = null,
  limit = 8,
): Claim[] {
  if (!Array.isArray(value)) return [];

  const claims: Claim[] = [];
  for (const entry of value.slice(0, limit * 2)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const raw = entry as RawClaim;
    const text = typeof raw.text === 'string' ? raw.text.trim() : '';
    if (text.length === 0) continue;

    const citations = toCitations(raw, defaultPath);
    // ตัดอ้างอิงซ้ำออก เพราะโมเดลชอบใส่บรรทัดเดิมหลายรอบเวลาไม่แน่ใจ
    const unique = new Map(citations.map((c) => [`${c.path}:${c.line}`, c]));
    claims.push({ text, citations: [...unique.values()] });
  }

  return keepGrounded(claims, verify).slice(0, limit);
}

/** หัวเรื่องหนึ่งบรรทัด ไม่ต้องมีอ้างอิงเพราะเป็นชื่อเรียก ไม่ใช่ข้อกล่าวอ้างเรื่องพฤติกรรมของโค้ด */
export function readHeadline(value: unknown, fallback: string, maxLength = 160): string {
  if (typeof value !== 'string') return fallback;
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length === 0) return fallback;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}
