import { describe, expect, it } from 'vitest';
import { parseRepoRef, repoSlug } from './repo-ref.js';

function expectOk(input: string, options?: { allowLocal?: boolean }) {
  const result = parseRepoRef(input, options);
  if (!result.ok) throw new Error(`ควรผ่านแต่ไม่ผ่าน: ${result.error}`);
  return result.ref;
}

describe('รูปแบบที่อยู่ที่รับได้', () => {
  it('รับแบบสั้น owner/name และเดาว่าเป็น GitHub', () => {
    const ref = expectOk('facebook/react');
    expect(ref).toMatchObject({ host: 'github.com', owner: 'facebook', name: 'react' });
    expect(ref.cloneUrl).toBe('https://github.com/facebook/react.git');
    expect(repoSlug(ref)).toBe('facebook/react');
  });

  it('รับลิงก์เต็ม พร้อมตัด .git และ path ส่วนเกินทิ้ง', () => {
    expect(expectOk('https://github.com/vercel/next.js.git')).toMatchObject({ name: 'next.js' });
    expect(expectOk('https://github.com/vercel/next.js/tree/main/packages')).toMatchObject({
      owner: 'vercel',
      name: 'next.js',
    });
  });

  it('รับรูปแบบ ssh และ www นำหน้า', () => {
    expect(expectOk('git@gitlab.com:group/project.git')).toMatchObject({
      host: 'gitlab.com',
      owner: 'group',
      name: 'project',
    });
    expect(expectOk('https://www.github.com/a/b')).toMatchObject({ host: 'github.com' });
  });
});

describe('ที่อยู่ที่ต้องปฏิเสธ', () => {
  it('ปฏิเสธโฮสต์นอกรายการที่อนุญาต', () => {
    const result = parseRepoRef('https://example.com/a/b');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('example.com');
  });

  it('ปฏิเสธที่อยู่ที่ชี้เข้าเครือข่ายภายใน', () => {
    for (const input of [
      'http://localhost/a/b',
      'https://127.0.0.1/a/b',
      'https://10.0.0.5/a/b',
      'https://gitlab.internal/a/b',
    ]) {
      const result = parseRepoRef(input);
      expect(result.ok, input).toBe(false);
    }
  });

  it('ปฏิเสธ http ธรรมดาและ protocol แปลก ๆ', () => {
    expect(parseRepoRef('http://github.com/a/b').ok).toBe(false);
    expect(parseRepoRef('ftp://github.com/a/b').ok).toBe(false);
  });

  it('ปฏิเสธที่อยู่ไม่ครบหรือมีอักขระที่ใช้ไม่ได้', () => {
    expect(parseRepoRef('').ok).toBe(false);
    expect(parseRepoRef('facebook').ok).toBe(false);
    expect(parseRepoRef('face book/react').ok).toBe(false);
  });

  it('รับ repo ในเครื่องเฉพาะตอนเปิดโหมดทดสอบเท่านั้น', () => {
    expect(parseRepoRef('/tmp/some-repo').ok).toBe(false);
    const ref = expectOk('/tmp/some-repo', { allowLocal: true });
    expect(ref.local).toBe(true);
    expect(ref.name).toBe('some-repo');
  });
});
