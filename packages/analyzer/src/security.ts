export type Severity = 'high' | 'medium' | 'low';

export interface Finding {
  path: string;
  line: number;
  rule: string;
  severity: Severity;
  message: string;
  /** ข้อความรอบจุดที่พบ โดยกลบค่าที่ดูเหมือนความลับออกแล้ว */
  snippet: string;
}

interface Rule {
  id: string;
  severity: Severity;
  message: string;
  pattern: RegExp;
  /** ภาษาที่กฎนี้ใช้ได้ ว่างคือใช้กับทุกภาษา */
  languages?: string[];
  /** true เมื่อกฎนี้ไม่ควรทำงานกับไฟล์ทดสอบ ตัวอย่าง หรือเอกสาร */
  skipNonProduction?: boolean;
}

/**
 * กฎการสแกนเบื้องต้น
 *
 * ตั้งใจให้เป็น "ข้อสังเกตที่ควรไปดูด้วยตา" ไม่ใช่คำตัดสินว่าเป็นช่องโหว่
 * เครื่องมือที่แจ้งเตือนผิดบ่อย ๆ จะถูกผู้ใช้ปิดทิ้งทั้งชุด ซึ่งแย่กว่าไม่มีเลย
 * จึงเลือกกฎที่ผลบวกลวงต่ำ และยกเว้นไฟล์ทดสอบกับเอกสารในกฎที่มักเจอค่าตัวอย่าง
 */
const RULES: Rule[] = [
  {
    id: 'hardcoded-secret',
    severity: 'high',
    message: 'พบค่าที่ดูเหมือนกุญแจหรือรหัสผ่านเขียนตรง ๆ ในโค้ด',
    pattern:
      /\b(?:api[_-]?key|secret|password|passwd|token|credential)\b\s*[:=]\s*['"][A-Za-z0-9_\-./+=]{16,}['"]/i,
    skipNonProduction: true,
  },
  {
    id: 'private-key',
    severity: 'high',
    message: 'พบกุญแจส่วนตัวอยู่ในไฟล์',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
  {
    id: 'aws-access-key',
    severity: 'high',
    message: 'พบรูปแบบของ AWS access key',
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    id: 'sql-injection',
    severity: 'high',
    message: 'ต่อสตริงคำสั่ง SQL กับตัวแปรโดยตรง ควรใช้พารามิเตอร์แทน',
    pattern: /\b(?:select|insert|update|delete)\b[^;'"`\n]*['"`]\s*(?:\+|\$\{|%\s*\(|\.format\()/i,
    skipNonProduction: true,
  },
  {
    id: 'dangerous-eval',
    severity: 'medium',
    message: 'ใช้ eval หรือสร้างฟังก์ชันจากสตริง ซึ่งเปิดทางให้โค้ดแปลกปลอมทำงานได้',
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
    languages: ['javascript', 'typescript', 'tsx', 'python', 'php', 'ruby'],
    skipNonProduction: true,
  },
  {
    id: 'shell-injection',
    severity: 'medium',
    message: 'ส่งคำสั่งเข้า shell พร้อมค่าที่ประกอบจากตัวแปร',
    pattern: /(?:exec|execSync|spawnSync|system|popen|os\.system)\s*\([^)]*(?:\+|\$\{|%s|f['"])/,
    skipNonProduction: true,
  },
  {
    id: 'insecure-random',
    severity: 'low',
    message: 'ใช้ตัวสุ่มทั่วไปในบริบทที่ดูเหมือนงานด้านความปลอดภัย',
    pattern: /Math\.random\(\)[^\n]*\b(?:token|secret|password|key|salt|nonce)\b/i,
  },
  {
    id: 'debug-leftover',
    severity: 'low',
    message: 'มีคำสั่งดีบักค้างอยู่ในโค้ด',
    pattern: /\b(?:debugger|console\.debug|pdb\.set_trace|binding\.pry)\b/,
    skipNonProduction: true,
  },
  {
    id: 'disabled-tls',
    severity: 'high',
    message: 'ปิดการตรวจสอบใบรับรอง TLS ซึ่งทำให้การเชื่อมต่อถูกดักได้',
    pattern: /rejectUnauthorized\s*:\s*false|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true/,
  },
];

const NON_PRODUCTION =
  /(^|\/)(tests?|spec|__tests__|__mocks__|fixtures?|examples?|samples?|docs?|e2e)\/|\.(test|spec)\.[\w.]+$|\.md$/i;

const SEVERITY_WEIGHT: Record<Severity, number> = { high: 8, medium: 3, low: 1 };

/** กลบค่าที่ดูเหมือนความลับ ก่อนเก็บลงฐานข้อมูลหรือแสดงบนหน้าเว็บ */
export function redact(line: string): string {
  return line
    .replace(/(['"])([A-Za-z0-9_\-./+=]{16,})\1/g, (_match, quote) => `${quote}…ถูกกลบไว้…${quote}`)
    .replace(/-----BEGIN[^-]*-----/g, '-----BEGIN …ถูกกลบไว้… -----')
    .trim()
    .slice(0, 200);
}

export interface ScanInput {
  path: string;
  language: string | null;
  source: string;
}

export function scanFile(input: ScanInput): Finding[] {
  const findings: Finding[] = [];
  const nonProduction = NON_PRODUCTION.test(input.path);
  const lines = input.source.split('\n');

  for (const rule of RULES) {
    if (rule.skipNonProduction && nonProduction) continue;
    if (rule.languages && (!input.language || !rule.languages.includes(input.language))) continue;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if (line.length > 500) continue;
      if (!rule.pattern.test(line)) continue;

      findings.push({
        path: input.path,
        line: index + 1,
        rule: rule.id,
        severity: rule.severity,
        message: rule.message,
        snippet: redact(line),
      });

      // รายงานกฎละหนึ่งครั้งต่อไฟล์ก็พอ ไม่งั้นไฟล์เดียวจะกลบรายงานทั้งหมด
      break;
    }
  }

  return findings;
}

export function summarize(findings: Finding[]): {
  counts: { high: number; medium: number; low: number };
  penalty: number;
} {
  const counts = { high: 0, medium: 0, low: 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  const penalty =
    counts.high * SEVERITY_WEIGHT.high +
    counts.medium * SEVERITY_WEIGHT.medium +
    counts.low * SEVERITY_WEIGHT.low;

  return { counts, penalty };
}
