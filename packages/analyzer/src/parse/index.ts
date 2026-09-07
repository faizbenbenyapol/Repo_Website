import { parseWithPatterns } from './patterns.js';
import { parseWithTreeSitter, supportsTreeSitter } from './tree-sitter.js';
import type { ParsedFile } from './types.js';

export * from './types.js';
export { supportsTreeSitter, treeSitterFailure } from './tree-sitter.js';
export { parseWithPatterns } from './patterns.js';

/**
 * ใช้ tree-sitter ก่อนเสมอเมื่อมีไวยากรณ์ของภาษานั้น
 * ถ้าโหลดไม่ได้หรือแยกไม่สำเร็จ ค่อยถอยไปใช้กฎรูปแบบข้อความ ผลลัพธ์จะหยาบกว่าแต่ยังใช้งานได้
 */
export async function parseSource(source: string, language: string): Promise<ParsedFile> {
  if (supportsTreeSitter(language)) {
    const parsed = await parseWithTreeSitter(source, language);
    if (parsed) return parsed;
  }
  return parseWithPatterns(source, language);
}
