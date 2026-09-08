import type { Claim, ModuleSummary, ReadingPathStep, RepoDigest } from './comprehension.js';

/**
 * รายงานภาษาไทยที่ส่งออกได้ (v0.7.0)
 *
 * รวมทั้งผลวิเคราะห์เชิงโครงสร้าง (เปิดให้ทุกคน) และชั้นความเข้าใจที่สมาชิกสั่งไว้ (ถ้ามี)
 * เป็นเอกสารเดียวที่ส่งต่อให้ทีมได้ ไม่ต้องยิงหลายเส้นทางมาประกอบเอง
 *
 * ไม่นำเข้าชนิดจาก @repolens/analyzer เพราะแพ็กเกจนั้นพึ่งพา shared อยู่แล้ว
 * การนำเข้ากลับจะทำให้เกิดวงจรพึ่งพา จึงประกาศรูปทรงข้อมูลที่ต้องใช้ไว้เองที่นี่
 */

export interface ReportHealthBreakdown {
  id: string;
  label: string;
  penalty: number;
  detail: string;
}

export interface ReportHealth {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  breakdown: ReportHealthBreakdown[];
}

export interface ReportHotspot {
  path: string;
  churn: number;
  loc: number;
  dependents: number;
  risk: number;
}

export interface ReportFinding {
  path: string;
  line: number;
  rule: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
}

export interface ReportExternal {
  specifier: string;
  count: number;
}

export interface ReportData {
  repo: {
    host: string;
    owner: string;
    name: string;
    branch: string | null;
    commitSha: string | null;
  };
  generatedAt: string;
  totals: {
    files: number;
    parsedFiles: number;
    loc: number;
    languages: { language: string; files: number; loc: number }[];
  };
  health: ReportHealth;
  cycles: string[][];
  deadFiles: string[];
  hotspots: ReportHotspot[];
  findings: ReportFinding[];
  external: ReportExternal[];
  /** null เมื่อผู้ใช้ยังไม่เคยสั่งสรุป repo นี้ด้วย AI */
  digest: RepoDigest | null;
  modules: ModuleSummary[];
  /** null เมื่อยังไม่เคยสร้างเส้นทางอ่านโค้ด */
  readingSteps: ReadingPathStep[] | null;
}

const SEVERITY_LABEL: Record<ReportFinding['severity'], string> = {
  high: 'สูง',
  medium: 'กลาง',
  low: 'ต่ำ',
};

function citationOf(claim: Claim): string {
  if (claim.citations.length === 0) return claim.text;
  const refs = claim.citations.map((c) => `${c.path}:${c.line}`).join(', ');
  return `${claim.text} (\`${refs}\`)`;
}

function renderClaims(claims: Claim[], empty: string): string {
  if (claims.length === 0) return `_${empty}_`;
  return claims.map((claim) => `- ${citationOf(claim)}`).join('\n');
}

/** ชื่อไฟล์ที่ปลอดภัยสำหรับใช้เป็นชื่อไฟล์ดาวน์โหลด ตัดอักขระที่ระบบไฟล์ทั่วไปรับไม่ได้ทิ้ง */
export function reportFileSlug(repo: ReportData['repo']): string {
  const raw = `repolens-${repo.owner}-${repo.name}-${repo.commitSha?.slice(0, 7) ?? 'latest'}`;
  return raw.replace(/[^a-zA-Z0-9._-]/g, '-');
}

/**
 * ประกอบรายงานเป็น Markdown ล้วน — ใช้เป็นแหล่งความจริงเดียวสำหรับทั้งไฟล์ .md ที่ส่งออก
 * และเนื้อหาที่ป้อนต่อให้ตัวสร้าง PDF ฝั่ง API (ซึ่งวาดจาก ReportData ตัวเดียวกัน ไม่ใช่แปลงจาก markdown)
 */
export function renderReportMarkdown(data: ReportData): string {
  const { repo } = data;
  const parts: string[] = [];

  parts.push(`# ${repo.owner}/${repo.name}`, '');
  parts.push(
    `- โฮสต์: ${repo.host}`,
    `- สาขา: ${repo.branch ?? 'ไม่ทราบ'}`,
    `- คอมมิต: ${repo.commitSha ?? 'ไม่ทราบ'}`,
    `- สร้างรายงานเมื่อ: ${data.generatedAt}`,
    '',
  );

  if (data.digest) {
    parts.push('## สรุปภาพรวม', '', data.digest.headline, '');
    const sections: [string, Claim[]][] = [
      ['ทำอะไร', data.digest.purpose],
      ['สร้างด้วยอะไร', data.digest.stack],
      ['เริ่มอ่านจากไฟล์ไหน', data.digest.entrypoints],
      ['รันอย่างไร', data.digest.howToRun],
      ['ข้อสังเกต', data.digest.notes],
    ];
    for (const [heading, claims] of sections) {
      parts.push(`### ${heading}`, '', renderClaims(claims, 'ยังไม่มีข้อสรุปที่ยืนยันได้'), '');
    }
  }

  parts.push(
    '## คะแนนสุขภาพ',
    '',
    `เกรด **${data.health.grade}** (${data.health.score} / 100)`,
    '',
  );
  if (data.health.breakdown.length > 0) {
    parts.push('| หัวข้อ | หักคะแนน | รายละเอียด |', '| --- | --- | --- |');
    for (const item of data.health.breakdown) {
      parts.push(`| ${item.label} | ${item.penalty} | ${item.detail} |`);
    }
    parts.push('');
  }

  parts.push(
    '## ตัวเลขโดยรวม',
    '',
    `- ไฟล์ทั้งหมด: ${data.totals.files.toLocaleString('th-TH')} (อ่านโครงสร้างได้ ${data.totals.parsedFiles.toLocaleString('th-TH')})`,
    `- บรรทัดโค้ด: ${data.totals.loc.toLocaleString('th-TH')}`,
    '',
  );
  if (data.totals.languages.length > 0) {
    parts.push('### สัดส่วนภาษา', '', '| ภาษา | ไฟล์ | บรรทัด |', '| --- | --- | --- |');
    for (const lang of data.totals.languages.slice(0, 10)) {
      parts.push(`| ${lang.language} | ${lang.files} | ${lang.loc} |`);
    }
    parts.push('');
  }

  if (data.hotspots.length > 0) {
    parts.push(
      '## จุดร้อน',
      '',
      'ไฟล์ที่แก้บ่อย ใหญ่ และมีคนพึ่งพาเยอะ — มักเป็นจุดที่ควรระวังเวลาจะแก้',
      '',
      '| ไฟล์ | แก้กี่ครั้ง | บรรทัด | ถูกพึ่งพา |',
      '| --- | --- | --- | --- |',
    );
    for (const spot of data.hotspots.slice(0, 15)) {
      parts.push(`| \`${spot.path}\` | ${spot.churn} | ${spot.loc} | ${spot.dependents} |`);
    }
    parts.push('');
  }

  if (data.cycles.length > 0) {
    parts.push('## วงจรพึ่งพา', '');
    for (const cycle of data.cycles.slice(0, 10)) {
      parts.push(`- ${cycle.map((path) => `\`${path}\``).join(' → ')}`);
    }
    parts.push('');
  }

  if (data.deadFiles.length > 0) {
    parts.push('## โค้ดที่ไม่มีใครเรียกใช้', '');
    for (const path of data.deadFiles.slice(0, 30)) parts.push(`- \`${path}\``);
    parts.push('');
  }

  if (data.findings.length > 0) {
    parts.push(
      '## ข้อสังเกตด้านความปลอดภัย',
      '',
      '_การสแกนนี้เป็นการตรวจรูปแบบเบื้องต้น ไม่ใช่การตรวจสอบความปลอดภัยเต็มรูปแบบ_',
      '',
    );
    for (const finding of data.findings.slice(0, 50)) {
      parts.push(
        `- **[${SEVERITY_LABEL[finding.severity]}]** \`${finding.path}:${finding.line}\` — ${finding.message}`,
      );
    }
    parts.push('');
  }

  if (data.external.length > 0) {
    parts.push('## พึ่งพาจากภายนอกมากที่สุด', '');
    for (const dep of data.external.slice(0, 20)) {
      parts.push(`- ${dep.specifier} — ${dep.count} ครั้ง`);
    }
    parts.push('');
  }

  if (data.modules.length > 0) {
    parts.push('## แต่ละโมดูลรับผิดชอบอะไร', '');
    for (const module of data.modules) {
      parts.push(
        `### ${module.path === '.' ? 'รากของ repo' : module.path}`,
        '',
        module.headline,
        '',
        renderClaims(module.points, 'ยังไม่มีข้อสรุปที่ยืนยันได้'),
        '',
      );
    }
  }

  if (data.readingSteps && data.readingSteps.length > 0) {
    parts.push('## เส้นทางอ่านโค้ดสำหรับคนใหม่', '');
    for (const step of data.readingSteps) {
      parts.push(
        `### ${step.order}. \`${step.path}\``,
        '',
        renderClaims(step.why, 'ไม่มีคำอธิบาย'),
      );
      if (step.lookFor.length > 0) {
        parts.push('', '**สิ่งที่ควรสังเกต**', '', renderClaims(step.lookFor, 'ไม่มี'));
      }
      parts.push('');
    }
  }

  parts.push(
    '---',
    '',
    'สร้างโดย RepoLens · ทุกข้อความข้างต้นที่มีการอ้างอิงผ่านการตรวจแล้วว่าชี้บรรทัดจริง',
  );

  return parts.join('\n');
}
