import { describe, expect, it, vi } from 'vitest';
import { answerQuestion, summarizeAnswer } from './ask.js';

const files = [
  { path: 'src/auth.ts', loc: 40 },
  { path: 'src/index.ts', loc: 10 },
];

function answer(payload: unknown) {
  return { text: JSON.stringify(payload), inputTokens: 12, outputTokens: 6 };
}

function baseOptions(overrides: Partial<Parameters<typeof answerQuestion>[0]> = {}) {
  return {
    apiKey: 'sk-ant-x',
    question: 'ระบบล็อกอินทำงานอย่างไร',
    evidence: [{ path: 'src/auth.ts', line: 12, text: 'function login' }],
    history: [],
    digest: null,
    files,
    ...overrides,
  };
}

describe('การตอบคำถามเกี่ยวกับ repo', () => {
  it('เก็บเฉพาะข้อที่อ้างอิงบรรทัดจริงในไฟล์ที่มีอยู่จริง', async () => {
    const ask = vi.fn(async () =>
      answer({
        claims: [
          { text: 'ล็อกอินเริ่มที่ฟังก์ชัน login', refs: [{ path: 'src/auth.ts', line: 12 }] },
          { text: 'อ้างไฟล์ที่ไม่มีอยู่', refs: [{ path: 'src/ไม่มีจริง.ts', line: 1 }] },
        ],
      }),
    );

    const result = await answerQuestion(baseOptions(), { ask });

    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]).toEqual({
      text: 'ล็อกอินเริ่มที่ฟังก์ชัน login',
      citations: [{ path: 'src/auth.ts', line: 12 }],
    });
    expect(result.model).toBe('claude-sonnet-5');
    expect(result.inputTokens).toBe(12);
    expect(result.outputTokens).toBe(6);
  });

  it('คำตอบที่ไม่มีอ้างอิงเลยคืนรายการว่าง ไม่ใช่ข้อความลอย ๆ', async () => {
    const ask = vi.fn(async () => answer({ claims: [{ text: 'ไม่มีอ้างอิงเลย' }] }));
    const result = await answerQuestion(baseOptions(), { ask });
    expect(result.claims).toEqual([]);
  });

  it('คำตอบที่แกะ JSON ไม่ได้ ไม่ทำให้ระบบล้ม แค่ได้คำตอบว่าง', async () => {
    const ask = vi.fn(async () => ({
      text: 'ข้อความที่ไม่ใช่ JSON เลย',
      inputTokens: 1,
      outputTokens: 1,
    }));
    const result = await answerQuestion(baseOptions(), { ask });
    expect(result.claims).toEqual([]);
  });

  it('ส่งคำถาม หลักฐาน และบทสนทนาก่อนหน้าเข้าไปในคำสั่งที่ส่งให้โมเดลจริง', async () => {
    const ask = vi.fn(async () => answer({ claims: [] }));

    await answerQuestion(
      baseOptions({
        history: [{ question: 'repo นี้ทำอะไร', answer: 'อ่านโค้ดแทนคุณ' }],
        digest: 'RepoLens อ่านโค้ดทั้ง repo',
      }),
      { ask },
    );

    const prompt = ask.mock.calls[0]?.[0]?.prompt ?? '';
    expect(prompt).toContain('ระบบล็อกอินทำงานอย่างไร');
    expect(prompt).toContain('src/auth.ts:12');
    expect(prompt).toContain('repo นี้ทำอะไร');
    expect(prompt).toContain('RepoLens อ่านโค้ดทั้ง repo');
  });
});

describe('การย่อคำตอบสำหรับบริบทบทสนทนาถัดไป', () => {
  it('บอกตรง ๆ เมื่อไม่มีคำตอบที่อ้างอิงได้', () => {
    expect(summarizeAnswer([])).toContain('ไม่พบคำตอบ');
  });

  it('รวมข้อความของทุกข้อเป็นประโยคเดียว', () => {
    const text = summarizeAnswer([
      { text: 'หนึ่ง', citations: [{ path: 'a.ts', line: 1 }] },
      { text: 'สอง', citations: [{ path: 'a.ts', line: 2 }] },
    ]);
    expect(text).toBe('หนึ่ง สอง');
  });
});
