'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SessionState } from '@repolens/shared';

/**
 * ช่องใส่ API key ของสมาชิก
 *
 * กุญแจถูกส่งขึ้นไปครั้งเดียวแล้วไม่เคยถูกส่งกลับลงมาอีกเลย
 * สิ่งที่หน้านี้รู้ได้มากที่สุดคือสี่ตัวท้าย ซึ่งพอให้ผู้ใช้ดูออกว่าผูกกุญแจตัวไหนไว้
 */
export function ApiKeyForm({ session }: { session: SessionState }) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState('');
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(method: 'PUT' | 'DELETE') {
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch('/api/session/api-key', {
        method,
        headers: method === 'PUT' ? { 'content-type': 'application/json' } : undefined,
        body: method === 'PUT' ? JSON.stringify({ apiKey }) : undefined,
      });

      const body = (await response.json().catch(() => null)) as {
        error?: string;
        message?: string;
      } | null;

      if (!response.ok) {
        setMessage({ tone: 'bad', text: body?.error ?? 'ทำรายการไม่สำเร็จ' });
        return;
      }

      setApiKey('');
      setMessage({
        tone: 'good',
        text: method === 'PUT' ? (body?.message ?? 'ผูกกุญแจแล้ว') : 'ถอดกุญแจออกแล้ว',
      });
      router.refresh();
    } catch {
      setMessage({ tone: 'bad', text: 'ติดต่อเซิร์ฟเวอร์ไม่ได้ในขณะนี้' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-lg font-semibold">API key ของ Claude</h2>
        <p className="mt-1 max-w-[60ch] text-sm text-muted">
          คำอธิบายภาษาไทยทั้งหมดถูกสร้างด้วยกุญแจของคุณเอง ค่าเรียกใช้จึงคิดกับบัญชี Anthropic
          ของคุณโดยตรง เราเก็บกุญแจไว้แบบเข้ารหัสในหน่วยความจำเท่านั้น ไม่ลงฐานข้อมูล
          และหมดอายุเองใน 12 ชั่วโมง
        </p>
      </div>

      {session.apiKeyHint ? (
        <p className="font-mono text-[12.5px] text-muted">
          ตอนนี้ผูกกุญแจที่ลงท้ายด้วย{' '}
          <span className="rounded-[4px] bg-surface-2 px-1.5 py-0.5">…{session.apiKeyHint}</span>{' '}
          ไว้อยู่
        </p>
      ) : (
        <p className="text-[12.5px] text-faint">ยังไม่มีกุญแจผูกไว้กับการเข้าใช้ครั้งนี้</p>
      )}

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted">ใส่กุญแจใหม่</span>
        <input
          autoComplete="off"
          className="rounded-[6px] border border-line bg-surface px-3 py-2 font-mono text-[13px] outline-none transition-colors focus:border-accent"
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="sk-ant-…"
          spellCheck={false}
          type="password"
          value={apiKey}
        />
      </label>

      {message ? (
        <p
          className={`border-l-2 pl-3 text-sm ${
            message.tone === 'good' ? 'border-good text-good' : 'border-crit text-crit'
          }`}
          role="status"
        >
          {message.text}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          className="rounded-[6px] bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity duration-150 disabled:opacity-50"
          disabled={busy || apiKey.trim().length === 0}
          onClick={() => void send('PUT')}
          type="button"
        >
          {busy ? 'กำลังตรวจกุญแจ…' : 'ผูกกุญแจนี้'}
        </button>

        {session.apiKeyHint ? (
          <button
            className="rounded-[6px] border border-line px-4 py-2 text-sm transition-colors hover:border-crit hover:text-crit disabled:opacity-50"
            disabled={busy}
            onClick={() => void send('DELETE')}
            type="button"
          >
            ถอดกุญแจออก
          </button>
        ) : null}
      </div>
    </section>
  );
}
