import { describe, expect, it } from 'vitest';
import { renderReportMarkdown, reportFileSlug, type ReportData } from './report.js';

function baseData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    repo: {
      host: 'github.com',
      owner: 'octocat',
      name: 'hello-world',
      branch: 'main',
      commitSha: 'a'.repeat(40),
    },
    generatedAt: '2026-09-08T00:00:00.000Z',
    totals: {
      files: 10,
      parsedFiles: 8,
      loc: 500,
      languages: [{ language: 'typescript', files: 8, loc: 500 }],
    },
    health: {
      score: 92,
      grade: 'A',
      breakdown: [
        { id: 'dead-code', label: 'โค้ดที่ไม่มีใครเรียกใช้', penalty: 8, detail: '1 ไฟล์' },
      ],
    },
    cycles: [],
    deadFiles: [],
    hotspots: [],
    findings: [],
    external: [],
    digest: null,
    modules: [],
    readingSteps: null,
    ...overrides,
  };
}

describe('renderReportMarkdown', () => {
  it('ใส่ข้อมูลของ repo และคะแนนสุขภาพไว้เสมอ', () => {
    const markdown = renderReportMarkdown(baseData());
    expect(markdown).toContain('# octocat/hello-world');
    expect(markdown).toContain('เกรด **A**');
    expect(markdown).toContain('โค้ดที่ไม่มีใครเรียกใช้');
  });

  it('ไม่มีชั้นความเข้าใจก็ยังสร้างรายงานได้ ไม่มีหัวข้อสรุปภาพรวมโผล่มา', () => {
    const markdown = renderReportMarkdown(baseData());
    expect(markdown).not.toContain('## สรุปภาพรวม');
  });

  it('มีชั้นความเข้าใจแล้วขึ้นหัวข้อสรุปภาพรวมพร้อมอ้างอิงบรรทัด', () => {
    const markdown = renderReportMarkdown(
      baseData({
        digest: {
          headline: 'เครื่องมืออ่านโค้ดแทนคุณ',
          purpose: [{ text: 'อ่านและอธิบายโค้ด', citations: [{ path: 'README.md', line: 1 }] }],
          stack: [],
          entrypoints: [],
          howToRun: [],
          notes: [],
          model: 'claude-opus-5',
        },
      }),
    );

    expect(markdown).toContain('## สรุปภาพรวม');
    expect(markdown).toContain('เครื่องมืออ่านโค้ดแทนคุณ');
    expect(markdown).toContain('อ่านและอธิบายโค้ด (`README.md:1`)');
  });

  it('หมวดที่ไม่มีข้อสรุปเลยบอกตรง ๆ ว่ายังไม่มี แทนที่จะว่างเปล่า', () => {
    const markdown = renderReportMarkdown(
      baseData({
        digest: {
          headline: 'สรุป',
          purpose: [],
          stack: [],
          entrypoints: [],
          howToRun: [],
          notes: [],
          model: null,
        },
      }),
    );
    expect(markdown).toContain('ยังไม่มีข้อสรุปที่ยืนยันได้');
  });

  it('รวมจุดร้อน วงจรพึ่งพา และข้อสังเกตด้านความปลอดภัยเมื่อมีข้อมูล', () => {
    const markdown = renderReportMarkdown(
      baseData({
        hotspots: [{ path: 'src/big.ts', churn: 20, loc: 400, dependents: 5, risk: 40000 }],
        cycles: [['a.ts', 'b.ts', 'a.ts']],
        findings: [
          {
            path: 'src/config.ts',
            line: 3,
            rule: 'hardcoded-secret',
            severity: 'high',
            message: 'พบกุญแจฝังตรง ๆ',
          },
        ],
      }),
    );

    expect(markdown).toContain('src/big.ts');
    expect(markdown).toContain('`a.ts` → `b.ts` → `a.ts`');
    expect(markdown).toContain('[สูง]');
    expect(markdown).toContain('พบกุญแจฝังตรง ๆ');
  });

  it('รวมเส้นทางอ่านโค้ดตามลำดับเมื่อมี', () => {
    const markdown = renderReportMarkdown(
      baseData({
        readingSteps: [
          {
            path: 'src/util.ts',
            order: 1,
            why: [
              { text: 'พื้นฐานที่ไฟล์อื่นเรียกใช้', citations: [{ path: 'src/util.ts', line: 1 }] },
            ],
            lookFor: [],
          },
        ],
      }),
    );

    expect(markdown).toContain('### 1. `src/util.ts`');
    expect(markdown).toContain('พื้นฐานที่ไฟล์อื่นเรียกใช้');
  });
});

describe('reportFileSlug', () => {
  it('ประกอบชื่อไฟล์จากเจ้าของ ชื่อ repo และคอมมิตย่อ', () => {
    expect(
      reportFileSlug({
        host: 'github.com',
        owner: 'octocat',
        name: 'hello-world',
        branch: 'main',
        commitSha: 'a'.repeat(40),
      }),
    ).toBe('repolens-octocat-hello-world-aaaaaaa');
  });

  it('ไม่มีคอมมิตยังได้ชื่อไฟล์ที่ใช้ได้', () => {
    expect(
      reportFileSlug({ host: 'github.com', owner: 'o', name: 'n', branch: null, commitSha: null }),
    ).toBe('repolens-o-n-latest');
  });
});
