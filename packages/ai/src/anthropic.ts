import type { KeyCheck } from '@repolens/shared';

/**
 * ตัวเรียก Claude API ขนาดเล็กที่เขียนบน fetch ของ Node เอง
 *
 * ไม่ใช้ SDK เพราะสิ่งที่เราต้องการมีแค่การส่งข้อความหนึ่งครั้งแล้วอ่านคำตอบ
 * การเพิ่ม dependency ที่ต้องไว้ใจเข้ามาสำหรับงานเท่านี้ไม่คุ้มกับผิวสัมผัสที่เพิ่มขึ้น
 * โดยเฉพาะเมื่อของที่ไหลผ่านตัวนี้คือกุญแจของผู้ใช้
 */

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODELS_ENDPOINT = 'https://api.anthropic.com/v1/models?limit=1';
const API_VERSION = '2023-06-01';

/** ให้ชุดทดสอบสวมตัวส่งของปลอมเข้ามาแทนได้ โดยไม่ต้องยิงเน็ตจริงและไม่ต้องมีกุญแจจริง */
export type Transport = (url: string, init: RequestInit) => Promise<Response>;

export interface AskOptions {
  transport?: Transport;
  timeoutMs?: number;
  /** จำนวนครั้งที่ลองใหม่เมื่อโดนจำกัดอัตราหรือฝั่งโน้นมีปัญหาชั่วคราว */
  retries?: number;
  /** หน่วงเวลาเริ่มต้นก่อนลองใหม่ ตั้งให้สั้นได้ตอนทดสอบ */
  retryBaseMs?: number;
  signal?: AbortSignal;
}

export interface AskRequest {
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  /**
   * ข้อความที่ให้โมเดลเขียนต่อ ใช้บังคับให้คำตอบเริ่มเป็น JSON ทันที
   * วิธีนี้ตัดปัญหาโมเดลเกริ่นนำก่อนตอบ ซึ่งทำให้ต้องมาแกะข้อความทีหลัง
   */
  prefill?: string;
}

export interface AskReply {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export class ClaudeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ClaudeError';
  }
}

/** ข้อความผิดพลาดจาก Anthropic เป็นภาษาอังกฤษ แปลงเป็นสิ่งที่ผู้ใช้ทำอะไรต่อได้ */
export function explainStatus(status: number): string {
  if (status === 401 || status === 403) {
    return 'Anthropic ปฏิเสธกุญแจนี้ — ตรวจว่าคัดลอกมาครบและยังไม่ถูกยกเลิก';
  }
  if (status === 429) return 'เรียกใช้ถี่เกินโควตาของกุญแจนี้ ลองใหม่อีกครั้งในอีกสักครู่';
  if (status === 400) return 'คำขอที่ส่งไปไม่ถูกต้อง — น่าจะเป็นข้อผิดพลาดของ RepoLens เอง';
  if (status === 402 || status === 413)
    return 'กุญแจนี้ใช้ต่อไม่ได้ในตอนนี้ ตรวจยอดคงเหลือของบัญชี Anthropic';
  if (status >= 500) return 'ฝั่ง Anthropic มีปัญหาชั่วคราว ลองใหม่อีกครั้ง';
  return `เรียก Claude ไม่สำเร็จ (รหัส ${status})`;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface MessagesResponse {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

/**
 * ส่งข้อความหนึ่งครั้งแล้วคืนข้อความที่ได้
 * ลองใหม่เฉพาะกรณีที่ลองแล้วมีโอกาสได้ผลต่างออกไป — โดนจำกัดอัตรา หรือฝั่งโน้นล่มชั่วคราว
 * ส่วนกุญแจผิดหรือคำขอผิด ลองกี่ครั้งก็ได้ผลเดิม จึงเลิกทันทีเพื่อไม่ให้ผู้ใช้รอฟรี
 */
export async function askClaude(request: AskRequest, options: AskOptions = {}): Promise<AskReply> {
  const transport = options.transport ?? fetch;
  const retries = options.retries ?? 3;
  const baseDelay = options.retryBaseMs ?? 1000;
  let lastError: ClaudeError | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timeout = AbortSignal.timeout(options.timeoutMs ?? 120_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await transport(ENDPOINT, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': request.apiKey,
          'anthropic-version': API_VERSION,
        },
        signal,
        body: JSON.stringify({
          model: request.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [
            { role: 'user', content: request.prompt },
            ...(request.prefill ? [{ role: 'assistant', content: request.prefill }] : []),
          ],
        }),
      });
    } catch (error) {
      if (options.signal?.aborted) throw new Error('งานถูกยกเลิกระหว่างเรียกโมเดล');
      lastError = new ClaudeError(
        `ต่อไปยัง Anthropic ไม่ได้: ${error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ'}`,
        0,
        true,
      );
      if (attempt < retries) {
        await sleep(baseDelay * 2 ** attempt);
        continue;
      }
      throw lastError;
    }

    if (response.ok) {
      const body = (await response.json()) as MessagesResponse;
      const text = (body.content ?? [])
        .filter((part) => part.type === 'text')
        .map((part) => part.text ?? '')
        .join('');

      return {
        text: `${request.prefill ?? ''}${text}`,
        inputTokens: body.usage?.input_tokens ?? 0,
        outputTokens: body.usage?.output_tokens ?? 0,
      };
    }

    const retryable = response.status === 429 || response.status >= 500;
    lastError = new ClaudeError(explainStatus(response.status), response.status, retryable);
    if (!retryable || attempt >= retries) throw lastError;

    const retryAfter = Number(response.headers.get('retry-after'));
    await sleep(
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30_000)
        : baseDelay * 2 ** attempt,
    );
  }

  throw lastError ?? new ClaudeError('เรียก Claude ไม่สำเร็จ', 0, false);
}

/**
 * ตรวจว่ากุญแจใช้ได้จริงก่อนรับเก็บ
 *
 * แยกผลเป็นสามทางโดยตั้งใจ — "ใช้ไม่ได้" กับ "ยังตรวจไม่ได้" ต้องไม่ถูกปนกัน
 * เพราะเซิร์ฟเวอร์ที่ต่อเน็ตไม่ได้ชั่วคราว ไม่ควรทำให้ผู้ใช้คิดว่ากุญแจตัวเองเสีย
 */
export async function verifyApiKey(
  apiKey: string,
  options: { transport?: Transport; timeoutMs?: number } = {},
): Promise<KeyCheck> {
  const transport = options.transport ?? fetch;

  try {
    const response = await transport(MODELS_ENDPOINT, {
      method: 'GET',
      headers: { 'x-api-key': apiKey, 'anthropic-version': API_VERSION },
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });

    if (response.ok) return 'ok';
    if (response.status === 401 || response.status === 403) return 'invalid';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
