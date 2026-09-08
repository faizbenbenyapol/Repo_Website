/**
 * คำสั่งที่ส่งให้โมเดล
 *
 * ทุกคำสั่งในไฟล์นี้ยืนอยู่บนกติกาเดียวกัน: ห้ามเขียนสิ่งที่ชี้บรรทัดรองรับไม่ได้
 * และถ้าไม่รู้ให้บอกว่าไม่รู้ ดีกว่าเดาให้ฟังดูดี
 * ตัวตรวจอีกชั้นจะตัดข้อที่อ้างอิงไม่ผ่านทิ้งอยู่แล้ว แต่การบอกกติกาตั้งแต่ต้น
 * ทำให้ได้ของที่ใช้ได้จริงมากกว่า และเสียโทเค็นไปกับข้อที่ต้องทิ้งน้อยลง
 */

const GROUND_RULE = [
  'กติกาที่ห้ามฝ่าฝืน:',
  '- เขียนเป็นภาษาไทยที่คนอ่านโค้ดเข้าใจ ใช้ศัพท์อังกฤษได้เมื่อมันคือชื่อจริงในโค้ด',
  '- ทุกข้อต้องชี้บรรทัดจริงที่รองรับข้อนั้นได้ ข้อที่ชี้ไม่ได้ให้ตัดทิ้ง อย่าเขียนออกมา',
  '- ห้ามเดาสิ่งที่ไม่ได้เห็น ถ้าข้อมูลที่ให้มาไม่พอจะสรุปเรื่องไหน ให้ข้ามเรื่องนั้นไป',
  '- ตอบเป็น JSON ล้วนตามรูปแบบที่กำหนด ห้ามมีข้อความอื่นนอก JSON',
].join('\n');

export const FILE_SYSTEM_PROMPT = [
  'คุณคือคนที่อ่านโค้ดแทนคนอื่น หน้าที่ของคุณคือบอกว่าไฟล์นี้รับผิดชอบอะไรในระบบ',
  'ไม่ใช่เล่าว่าโค้ดเขียนอะไรบรรทัดต่อบรรทัด',
  '',
  GROUND_RULE,
].join('\n');

export const MODULE_SYSTEM_PROMPT = [
  'คุณกำลังรวมคำอธิบายของไฟล์หลายไฟล์ให้เป็นภาพของโฟลเดอร์เดียว',
  'บอกให้ได้ว่าโฟลเดอร์นี้รับผิดชอบเรื่องอะไร และของข้างในแบ่งหน้าที่กันอย่างไร',
  '',
  GROUND_RULE,
].join('\n');

export const REPO_SYSTEM_PROMPT = [
  'คุณกำลังสรุปภาพรวมของทั้งโปรเจกต์ให้คนที่เพิ่งเปิด repo นี้ครั้งแรก',
  'สิ่งที่เขาอยากรู้เรียงตามลำดับคือ โปรเจกต์นี้ทำอะไร ใช้อะไรสร้าง เริ่มอ่านจากไฟล์ไหน',
  'รันอย่างไร และมีอะไรที่ควรระวัง',
  '',
  GROUND_RULE,
].join('\n');

export interface FilePromptInput {
  path: string;
  language: string | null;
  source: string;
  symbols: { name: string; kind: string; line: number }[];
  dependents: string[];
  dependencies: string[];
}

/** ใส่เลขบรรทัดให้ซอร์ส เพื่อให้โมเดลอ้างอิงบรรทัดได้ตรงกับที่เราตรวจได้ */
export function numberLines(source: string, maxLines: number, maxChars: number): string {
  const lines = source.split('\n');
  const kept = lines.slice(0, maxLines);
  let text = kept.map((line, index) => `${index + 1}\t${line}`).join('\n');

  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n…(ตัดเพราะยาวเกิน)`;
  if (lines.length > maxLines) {
    text += `\n…(ไฟล์นี้มี ${lines.length} บรรทัด แสดงมา ${maxLines} บรรทัดแรก)`;
  }
  return text;
}

export function buildFilePrompt(input: FilePromptInput): string {
  const symbols =
    input.symbols.length > 0
      ? input.symbols
          .slice(0, 60)
          .map((symbol) => `- บรรทัด ${symbol.line}: ${symbol.kind} ${symbol.name}`)
          .join('\n')
      : '- ไม่พบฟังก์ชันหรือคลาสที่ประกาศไว้';

  const dependents =
    input.dependents.length > 0
      ? input.dependents.slice(0, 15).join(', ')
      : 'ไม่มีไฟล์อื่นเรียกใช้ไฟล์นี้';

  const dependencies =
    input.dependencies.length > 0
      ? input.dependencies.slice(0, 15).join(', ')
      : 'ไฟล์นี้ไม่ได้เรียกใช้ไฟล์อื่นในโปรเจกต์';

  return [
    `ไฟล์: ${input.path}`,
    `ภาษา: ${input.language ?? 'ไม่ทราบ'}`,
    '',
    'สิ่งที่ประกาศไว้ในไฟล์นี้:',
    symbols,
    '',
    `ไฟล์ที่พึ่งพาไฟล์นี้: ${dependents}`,
    `ไฟล์ที่ไฟล์นี้เรียกใช้: ${dependencies}`,
    '',
    'เนื้อไฟล์ (ตัวเลขหน้าแท็บคือเลขบรรทัด):',
    input.source,
    '',
    'ตอบเป็น JSON รูปนี้:',
    '{"headline":"หนึ่งประโยคว่าไฟล์นี้รับผิดชอบอะไร","points":[{"text":"ข้อสังเกตหนึ่งข้อ","lines":[12]}]}',
    'ใส่ points ได้ไม่เกิน 4 ข้อ เอาเฉพาะข้อที่คนอ่านโค้ดจริงอยากรู้',
    'lines คือเลขบรรทัดในไฟล์นี้ที่รองรับข้อนั้น ต้องมีอย่างน้อยหนึ่งเลขเสมอ',
  ].join('\n');
}

export interface ModulePromptInput {
  path: string;
  files: { path: string; headline: string; anchor: number }[];
}

export function buildModulePrompt(input: ModulePromptInput): string {
  const files = input.files
    .slice(0, 80)
    .map((file) => `- ${file.path} (อ้างอิงได้ที่บรรทัด ${file.anchor}): ${file.headline}`)
    .join('\n');

  return [
    `โฟลเดอร์: ${input.path === '.' ? 'รากของ repo' : input.path}`,
    `จำนวนไฟล์ที่สรุปมาแล้ว: ${input.files.length}`,
    '',
    'คำอธิบายของแต่ละไฟล์ข้างใน:',
    files,
    '',
    'ตอบเป็น JSON รูปนี้:',
    '{"headline":"หนึ่งประโยคว่าโฟลเดอร์นี้รับผิดชอบอะไร","points":[{"text":"ข้อสังเกต","refs":[{"path":"a/b.ts","line":1}]}]}',
    'ใส่ points ได้ไม่เกิน 4 ข้อ',
    'refs ต้องเป็นไฟล์ที่อยู่ในรายการข้างบนเท่านั้น และใช้เลขบรรทัดที่ระบุไว้ให้',
  ].join('\n');
}

export interface RepoPromptInput {
  owner: string;
  name: string;
  branch: string;
  totals: { files: number; loc: number };
  languages: { name: string; files: number }[];
  modules: { path: string; headline: string; anchor: { path: string; line: number } }[];
  entrypoints: { path: string; line: number }[];
  external: string[];
  readme: string | null;
  readmePath: string | null;
}

export function buildRepoPrompt(input: RepoPromptInput): string {
  const modules = input.modules
    .slice(0, 40)
    .map(
      (module) =>
        `- ${module.path} (อ้างอิงได้ที่ ${module.anchor.path} บรรทัด ${module.anchor.line}): ${module.headline}`,
    )
    .join('\n');

  const entrypoints =
    input.entrypoints.length > 0
      ? input.entrypoints.map((entry) => `- ${entry.path} (บรรทัด ${entry.line})`).join('\n')
      : '- ไม่พบไฟล์ที่ดูเหมือนจุดเริ่มโปรแกรมชัดเจน';

  const languages = input.languages
    .slice(0, 8)
    .map((language) => `${language.name} ${language.files} ไฟล์`)
    .join(', ');

  const parts = [
    `repo: ${input.owner}/${input.name} สาขา ${input.branch}`,
    `ขนาด: ${input.totals.files} ไฟล์ ${input.totals.loc} บรรทัด`,
    `ภาษาที่ใช้: ${languages || 'ไม่ทราบ'}`,
    `แพ็กเกจภายนอกที่ถูกเรียกใช้บ่อย: ${input.external.slice(0, 25).join(', ') || 'ไม่พบ'}`,
    '',
    'โมดูลและหน้าที่ของแต่ละโมดูล:',
    modules || '- ไม่มีข้อมูลโมดูล',
    '',
    'ไฟล์ที่น่าจะเป็นจุดเริ่มโปรแกรม:',
    entrypoints,
  ];

  if (input.readme && input.readmePath) {
    parts.push('', `ข้อความจาก ${input.readmePath} (ใส่เลขบรรทัดไว้ให้แล้ว):`, input.readme);
  }

  parts.push(
    '',
    'ตอบเป็น JSON รูปนี้:',
    '{"headline":"ประโยคเดียวว่าโปรเจกต์นี้คืออะไร",' +
      '"purpose":[{"text":"...","refs":[{"path":"...","line":1}]}],' +
      '"stack":[{"text":"...","refs":[{"path":"...","line":1}]}],' +
      '"entrypoints":[{"text":"...","refs":[{"path":"...","line":1}]}],' +
      '"howToRun":[{"text":"...","refs":[{"path":"...","line":1}]}],' +
      '"notes":[{"text":"...","refs":[{"path":"...","line":1}]}]}',
    'แต่ละหมวดใส่ได้ไม่เกิน 4 ข้อ หมวดไหนไม่มีข้อมูลรองรับให้ส่งเป็นรายการว่าง',
    'refs ต้องเป็นไฟล์และบรรทัดที่ปรากฏในข้อมูลข้างบนเท่านั้น',
  );

  return parts.join('\n');
}

export const QA_SYSTEM_PROMPT = [
  'คุณตอบคำถามเกี่ยวกับ repo หนึ่งตัวให้คนที่กำลังอ่านโค้ดอยู่',
  'คุณเห็นเฉพาะหลักฐานที่ถูกส่งมาให้เท่านั้น ไม่ได้เห็นซอร์สทั้ง repo',
  'ถ้าหลักฐานที่ให้มาไม่พอจะตอบคำถามนี้ ให้บอกตรง ๆ ว่าไม่พอ อย่าเดาหรือแต่งเติม',
  '',
  GROUND_RULE,
].join('\n');

export interface EvidenceItem {
  path: string;
  line: number;
  text: string;
}

export interface QaPromptInput {
  question: string;
  /** คำถามและคำตอบก่อนหน้าในบทสนทนาเดียวกัน ใช้ให้เข้าใจคำถามที่อ้างถึง "มัน" หรือ "ไฟล์นั้น" ได้ */
  history: { question: string; answer: string }[];
  evidence: EvidenceItem[];
  digest: string | null;
}

export function buildQaPrompt(input: QaPromptInput): string {
  const parts: string[] = [];

  if (input.digest) {
    parts.push(`ภาพรวมของ repo นี้: ${input.digest}`, '');
  }

  if (input.history.length > 0) {
    parts.push('บทสนทนาก่อนหน้า:');
    for (const turn of input.history) {
      parts.push(`- ถาม: ${turn.question}`, `  ตอบ: ${turn.answer}`);
    }
    parts.push('');
  }

  parts.push(
    'หลักฐานที่ค้นเจอเกี่ยวข้องกับคำถามนี้:',
    input.evidence.length > 0
      ? input.evidence.map((item) => `- ${item.path}:${item.line} — ${item.text}`).join('\n')
      : '- ไม่พบหลักฐานที่ตรงกับคำถามนี้เลย',
    '',
    `คำถาม: ${input.question}`,
    '',
    'ตอบเป็น JSON รูปนี้:',
    '{"claims":[{"text":"ส่วนหนึ่งของคำตอบ","refs":[{"path":"...","line":1}]}]}',
    'แบ่งคำตอบเป็นข้อย่อยได้หลายข้อถ้าจำเป็น ไม่เกิน 6 ข้อ',
    'refs ต้องเป็นพาธและบรรทัดที่ปรากฏในหลักฐานข้างบนเท่านั้น',
    'ถ้าหลักฐานไม่พอจะตอบ ให้ส่ง claims เป็นรายการว่างแทนการเดา',
  );

  return parts.join('\n');
}

export const READING_PATH_SYSTEM_PROMPT = [
  'คุณกำลังเขียนคำแนะนำให้คนที่เพิ่งเห็น repo นี้ครั้งแรกว่าควรอ่านไฟล์ไหนก่อน-หลัง',
  'ลำดับไฟล์ถูกจัดมาให้แล้วตามความสัมพันธ์ในโค้ดจริง หน้าที่ของคุณคืออธิบายแต่ละขั้นเท่านั้น',
  'ไม่ต้องเปลี่ยนลำดับหรือเพิ่มไฟล์ใหม่',
  '',
  GROUND_RULE,
].join('\n');

export interface ReadingStepInput {
  path: string;
  language: string | null;
  loc: number;
  dependents: number;
  dependencies: number;
  symbols: { name: string; kind: string; line: number }[];
  /** หัวเรื่องจากคำอธิบายที่สรุปไว้แล้ว ถ้ามี ใช้ช่วยให้อธิบายแม่นขึ้นโดยไม่ต้องอ่านซอร์สใหม่ */
  summary: string | null;
}

export function buildReadingPathPrompt(steps: ReadingStepInput[]): string {
  const listing = steps
    .map((step, index) => {
      const symbols =
        step.symbols.length > 0
          ? step.symbols
              .map((symbol) => `บรรทัด ${symbol.line}: ${symbol.kind} ${symbol.name}`)
              .join(', ')
          : 'ไม่พบฟังก์ชันหรือคลาสที่ประกาศไว้';

      return [
        `ขั้นที่ ${index + 1}: ${step.path}`,
        `  ภาษา: ${step.language ?? 'ไม่ทราบ'} · ${step.loc} บรรทัด · ถูกพึ่งพา ${step.dependents} ไฟล์ · พึ่งพา ${step.dependencies} ไฟล์`,
        step.summary ? `  สรุปที่มีอยู่แล้ว: ${step.summary}` : null,
        `  ประกาศไว้: ${symbols}`,
      ]
        .filter((line): line is string => line !== null)
        .join('\n');
    })
    .join('\n\n');

  return [
    `ไฟล์ทั้งหมด ${steps.length} ไฟล์ เรียงลำดับที่ควรอ่านมาให้แล้ว:`,
    '',
    listing,
    '',
    'ตอบเป็น JSON รูปนี้ โดยมีสมาชิกในอาร์เรย์ steps เท่ากับจำนวนไฟล์ข้างบนและเรียงลำดับเดียวกันทุกประการ:',
    '{"steps":[{"why":[{"text":"ทำไมต้องอ่านไฟล์นี้ตอนนี้","refs":[{"path":"...","line":1}]}],' +
      '"lookFor":[{"text":"สิ่งที่ควรสังเกตในไฟล์นี้","refs":[{"path":"...","line":1}]}]}]}',
    'แต่ละหมวดใส่ได้ 1-2 ข้อ refs ต้องเป็นไฟล์และบรรทัดที่ปรากฏในรายการข้างบนเท่านั้น',
  ].join('\n');
}
