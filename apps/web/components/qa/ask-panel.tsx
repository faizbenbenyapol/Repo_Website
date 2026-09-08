'use client';

import { useState } from 'react';
import type { QaMessage, SessionState } from '@repolens/shared';
import { Claims } from '../comprehension/claims';

interface Props {
  analysisId: string;
  session: SessionState | null;
  initialMessages: QaMessage[];
}

function Gate({ text, href, action }: { text: string; href: string; action: string }) {
  return (
    <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
      <p className="max-w-[62ch] text-sm text-muted">{text}</p>
      <a
        className="rounded-[6px] border border-line px-3 py-1.5 text-[13px] transition-colors hover:border-accent hover:text-accent"
        href={href}
      >
        {action}
      </a>
    </div>
  );
}

/**
 * ถาม–ตอบกับ repo
 *
 * โมเดลเห็นเฉพาะหลักฐานที่ค้นเจอ ไม่ได้อ่านซอร์สทั้ง repo ใหม่ทุกครั้งที่ถาม
 * คำตอบที่ไม่มีข้ออ้างอิงเหลือเลยแปลว่าค้นไม่เจออะไรตรงคำถาม ไม่ใช่ระบบพัง — ต้องบอกตรง ๆ ไม่ใช่ซ่อนไว้
 */
export function AskPanel({ analysisId, session, initialMessages }: Props) {
  const [messages, setMessages] = useState<QaMessage[]>(initialMessages);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session?.signedIn) {
    return (
      <Gate
        action="เข้าสู่ระบบ"
        href="/login"
        text="ถาม–ตอบกับ repo นี้เปิดให้สมาชิกที่ใส่ API key ของตัวเอง เพราะค่าเรียกใช้โมเดลคิดกับกุญแจของผู้ใช้โดยตรง"
      />
    );
  }

  if (!session.aiEnabled) {
    return (
      <Gate
        action="ไปหน้าตั้งค่า"
        href="/account"
        text={session.aiBlockedReason ?? 'ยังใช้ถาม–ตอบด้วย AI ไม่ได้'}
      />
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = question.trim();
    if (trimmed.length === 0 || busy) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/analyses/${analysisId}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: trimmed }),
      });

      const body = (await response.json().catch(() => null)) as {
        message?: QaMessage;
        error?: string;
      } | null;

      if (!response.ok || !body?.message) {
        setError(body?.error ?? 'ถามคำถามไม่สำเร็จ');
        return;
      }

      setMessages((prev) => [...prev, body.message as QaMessage]);
      setQuestion('');
    } catch {
      setError('ติดต่อเซิร์ฟเวอร์ไม่ได้ในขณะนี้');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {messages.length === 0 ? (
        <p className="text-sm text-muted">
          ถามอะไรก็ได้เกี่ยวกับ repo นี้ เช่น "ระบบล็อกอินทำงานอย่างไร" หรือ
          "ไฟล์ไหนจัดการเรื่องฐานข้อมูล" คำตอบทุกข้อจะมีบรรทัดโค้ดจริงกำกับไว้
          ถ้าค้นไม่เจออะไรตรงคำถาม จะบอกตรง ๆ ว่าไม่รู้
        </p>
      ) : (
        <ul className="flex flex-col gap-6">
          {messages.map((message) => (
            <li key={message.id} className="panel p-4">
              <p className="label">ถาม</p>
              <p className="mt-1 text-sm">{message.question}</p>

              <div className="mt-3">
                <p className="label">ตอบ</p>
                <Claims
                  claims={message.claims}
                  empty="ยังไม่พบคำตอบที่มีบรรทัดอ้างอิงรองรับ ลองถามให้เจาะจงขึ้น หรือลองสั่งสรุป repo ก่อน"
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="flex gap-2" onSubmit={submit}>
        <input
          aria-label="ถามคำถามเกี่ยวกับ repo นี้"
          className="flex-1 rounded-[6px] border border-line bg-surface px-3 py-2 text-[13px] outline-none transition-colors placeholder:text-faint focus:border-accent"
          maxLength={500}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="ถามอะไรก็ได้เกี่ยวกับ repo นี้…"
          value={question}
        />
        <button
          className="shrink-0 rounded-[6px] bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity duration-150 disabled:opacity-50"
          disabled={busy || question.trim().length === 0}
          type="submit"
        >
          {busy ? 'กำลังตอบ…' : 'ถาม'}
        </button>
      </form>

      {error ? (
        <p className="border-l-2 border-crit pl-3 text-sm text-crit" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}
