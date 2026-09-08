import { describe, expect, it, vi } from 'vitest';
import { askClaude, ClaudeError, verifyApiKey, type Transport } from './anthropic.js';

function reply(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

const ok = {
  content: [{ type: 'text', text: '"headline":"สวัสดี"}' }],
  usage: { input_tokens: 120, output_tokens: 30 },
};

const request = {
  apiKey: 'sk-ant-ทดสอบ',
  model: 'claude-haiku-4-5-20251001',
  system: 'ระบบ',
  prompt: 'คำถาม',
  maxTokens: 100,
};

describe('การเรียก Claude', () => {
  it('ส่งกุญแจและรุ่นของ API ไปในหัวข้อคำขอ แล้วคืนข้อความกับจำนวนโทเค็น', async () => {
    const transport = vi.fn<Transport>(async () => reply(ok));
    const result = await askClaude(request, { transport });

    expect(result.text).toBe('"headline":"สวัสดี"}');
    expect(result.inputTokens).toBe(120);
    expect(result.outputTokens).toBe(30);

    const [url, init] = transport.mock.calls[0] ?? [];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-ทดสอบ');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('ต่อข้อความที่บังคับให้ขึ้นต้นไว้กลับเข้าไปในคำตอบ', async () => {
    const transport = vi.fn<Transport>(async () => reply(ok));
    const result = await askClaude({ ...request, prefill: '{' }, { transport });

    expect(result.text).toBe('{"headline":"สวัสดี"}');
    const body = JSON.parse(String(transport.mock.calls[0]?.[1]?.body));
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1]).toEqual({ role: 'assistant', content: '{' });
  });

  it('ลองใหม่เมื่อโดนจำกัดอัตรา แล้วสำเร็จในครั้งถัดไป', async () => {
    const transport = vi
      .fn<Transport>()
      .mockResolvedValueOnce(
        reply({ error: { message: 'rate limit' } }, 429, { 'retry-after': '0' }),
      )
      .mockResolvedValueOnce(reply(ok));

    const result = await askClaude(request, { transport, retryBaseMs: 1 });
    expect(result.outputTokens).toBe(30);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('กุญแจผิดต้องเลิกทันที ไม่ลองใหม่ เพราะลองกี่ครั้งก็ได้ผลเดิม', async () => {
    const transport = vi.fn<Transport>(async () => reply({ error: { message: 'invalid' } }, 401));

    await expect(askClaude(request, { transport, retryBaseMs: 1 })).rejects.toThrow(
      /Anthropic ปฏิเสธกุญแจนี้/,
    );
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('บอกสถานะที่ทำให้ตัดสินใจต่อได้ ไม่ใช่แค่ข้อความ', async () => {
    const transport = vi.fn<Transport>(async () => reply({}, 403));
    const error = await askClaude(request, { transport, retryBaseMs: 1 }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ClaudeError);
    expect((error as ClaudeError).status).toBe(403);
    expect((error as ClaudeError).retryable).toBe(false);
  });

  it('ยอมแพ้หลังลองครบตามจำนวนที่ตั้งไว้ และบอกเป็นภาษาไทย', async () => {
    const transport = vi.fn<Transport>(async () => reply({}, 503));

    await expect(askClaude(request, { transport, retries: 2, retryBaseMs: 1 })).rejects.toThrow(
      /ฝั่ง Anthropic มีปัญหาชั่วคราว/,
    );
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('ต่อเน็ตไม่ได้ก็ลองใหม่ แล้วค่อยยอมแพ้พร้อมบอกสาเหตุ', async () => {
    const transport = vi.fn<Transport>(async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    });

    await expect(askClaude(request, { transport, retries: 1, retryBaseMs: 1 })).rejects.toThrow(
      /ต่อไปยัง Anthropic ไม่ได้/,
    );
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

describe('การตรวจกุญแจก่อนรับเก็บ', () => {
  it('ตอบว่าใช้ได้เมื่อ Anthropic รับ', async () => {
    expect(await verifyApiKey('sk-ant-x', { transport: async () => reply({ data: [] }) })).toBe(
      'ok',
    );
  });

  it('ตอบว่าใช้ไม่ได้เมื่อถูกปฏิเสธเรื่องสิทธิ์', async () => {
    for (const status of [401, 403]) {
      expect(await verifyApiKey('sk-ant-x', { transport: async () => reply({}, status) })).toBe(
        'invalid',
      );
    }
  });

  it('แยก "ยังตรวจไม่ได้" ออกจาก "ใช้ไม่ได้" เพราะสองอย่างนี้ผู้ใช้ต้องทำต่างกัน', async () => {
    expect(await verifyApiKey('sk-ant-x', { transport: async () => reply({}, 500) })).toBe(
      'unknown',
    );
    expect(
      await verifyApiKey('sk-ant-x', {
        transport: async () => {
          throw new Error('เน็ตล่ม');
        },
      }),
    ).toBe('unknown');
  });
});
