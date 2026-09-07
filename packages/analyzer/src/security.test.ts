import { describe, expect, it } from 'vitest';
import { redact, scanFile, summarize } from './security.js';

function scan(path: string, source: string, language: string | null = 'typescript') {
  return scanFile({ path, language, source });
}

describe('การหาความลับที่หลุดเข้ามาในโค้ด', () => {
  it('เจอกุญแจที่เขียนตรง ๆ ในโค้ดที่ใช้งานจริง', () => {
    const findings = scan('src/config.ts', `const apiKey = "sk_live_9f8a7b6c5d4e3f2a1b0c";`);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe('hardcoded-secret');
    expect(findings[0]?.severity).toBe('high');
    expect(findings[0]?.line).toBe(1);
  });

  it('ไม่รายงานค่าตัวอย่างในไฟล์ทดสอบและเอกสาร', () => {
    const source = `const apiKey = "sk_live_9f8a7b6c5d4e3f2a1b0c";`;
    expect(scan('tests/auth.test.ts', source)).toEqual([]);
    expect(scan('docs/setup.md', source, 'markdown')).toEqual([]);
    expect(scan('src/__tests__/auth.ts', source)).toEqual([]);
  });

  it('กุญแจส่วนตัวและ AWS key รายงานทุกที่ แม้แต่ในไฟล์ทดสอบ', () => {
    expect(scan('tests/keys.ts', '-----BEGIN RSA PRIVATE KEY-----')[0]?.rule).toBe('private-key');
    expect(scan('tests/keys.ts', 'const id = "AKIAIOSFODNN7EXAMPLE";')[0]?.rule).toBe(
      'aws-access-key',
    );
  });

  it('กลบค่าที่เป็นความลับก่อนเก็บและก่อนแสดงผล', () => {
    const findings = scan('src/config.ts', `const token = "abcdefghijklmnopqrstuvwxyz123456";`);
    expect(findings[0]?.snippet).not.toContain('abcdefghijklmnopqrstuvwxyz123456');
    expect(findings[0]?.snippet).toContain('ถูกกลบไว้');
  });

  it('ตัวกลบทำงานกับทั้งสตริงยาวและกุญแจแบบบล็อก', () => {
    expect(redact('key = "0123456789abcdef0123"')).toContain('ถูกกลบไว้');
    expect(redact('-----BEGIN PRIVATE KEY-----')).toContain('ถูกกลบไว้');
    expect(redact('const a = 1;')).toBe('const a = 1;');
  });
});

describe('รูปแบบที่เสี่ยงอื่น ๆ', () => {
  it('เจอการต่อสตริง SQL กับตัวแปร', () => {
    const findings = scan('src/db.ts', 'const q = "select * from users where id = " + id;');
    expect(findings.map((item) => item.rule)).toContain('sql-injection');
  });

  it('เจอ eval และ new Function เฉพาะภาษาที่มีจริง', () => {
    expect(scan('src/run.ts', 'eval(userInput);').map((f) => f.rule)).toContain('dangerous-eval');
    expect(scan('main.go', 'eval(userInput);', 'go').map((f) => f.rule)).not.toContain(
      'dangerous-eval',
    );
  });

  it('เจอการปิดการตรวจใบรับรอง TLS', () => {
    expect(scan('src/http.ts', 'const agent = { rejectUnauthorized: false };')[0]?.rule).toBe(
      'disabled-tls',
    );
    expect(scan('main.go', 'tls.Config{InsecureSkipVerify: true}', 'go')[0]?.rule).toBe(
      'disabled-tls',
    );
  });

  it('เจอคำสั่งดีบักที่ค้างอยู่ แต่ให้ความรุนแรงต่ำ', () => {
    const findings = scan('src/app.ts', 'debugger;');
    expect(findings[0]?.rule).toBe('debug-leftover');
    expect(findings[0]?.severity).toBe('low');
  });

  it('โค้ดที่ปกติต้องไม่ถูกรายงาน', () => {
    const source = `import { readFile } from 'node:fs/promises';

export async function load(path: string) {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text);
}
`;
    expect(scan('src/load.ts', source)).toEqual([]);
  });

  it('รายงานกฎละหนึ่งครั้งต่อไฟล์ ไม่ให้ไฟล์เดียวท่วมรายงานทั้งชุด', () => {
    const source = Array.from({ length: 30 }, () => 'debugger;').join('\n');
    expect(scan('src/app.ts', source)).toHaveLength(1);
  });
});

describe('การสรุปผลรวม', () => {
  it('นับแยกตามความรุนแรง และคิดคะแนนหักตามน้ำหนัก', () => {
    const findings = [
      ...scan('src/a.ts', 'const apiKey = "sk_live_9f8a7b6c5d4e3f2a1b0c";'),
      ...scan('src/b.ts', 'debugger;'),
    ];
    const summary = summarize(findings);

    expect(summary.counts.high).toBe(1);
    expect(summary.counts.low).toBe(1);
    expect(summary.penalty).toBe(9);
  });

  it('ไม่มีอะไรผิดปกติ = ไม่หักคะแนน', () => {
    expect(summarize([])).toEqual({ counts: { high: 0, medium: 0, low: 0 }, penalty: 0 });
  });
});
