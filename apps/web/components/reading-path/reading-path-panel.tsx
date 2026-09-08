'use client';

import { useState } from 'react';
import type { ReadingPath, SessionState } from '@repolens/shared';
import { Claims } from '../comprehension/claims';

interface Props {
  analysisId: string;
  session: SessionState | null;
  initialPath: ReadingPath | null;
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
 * เส้นทางอ่านโค้ดสำหรับคนใหม่
 *
 * ลำดับไฟล์คำนวณจากกราฟการพึ่งพาล้วน ๆ ไม่ใช่จากความเห็นของโมเดล — ไฟล์พื้นฐานที่ไฟล์อื่นเรียกใช้
 * มาก่อนเสมอ จุดเริ่มโปรแกรมมาสุดท้าย โมเดลมีหน้าที่แค่อธิบายว่าทำไมแต่ละขั้นถึงควรอ่านตอนนั้น
 */
export function ReadingPathPanel({ analysisId, session, initialPath }: Props) {
  const [path, setPath] = useState<ReadingPath | null>(initialPath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session?.signedIn) {
    return (
      <Gate
        action="เข้าสู่ระบบ"
        href="/login"
        text="เส้นทางอ่านโค้ดเปิดให้สมาชิกที่ใส่ API key ของตัวเอง เพราะค่าเรียกใช้โมเดลคิดกับกุญแจของผู้ใช้โดยตรง"
      />
    );
  }

  if (!session.aiEnabled) {
    return (
      <Gate
        action="ไปหน้าตั้งค่า"
        href="/account"
        text={session.aiBlockedReason ?? 'ยังสร้างเส้นทางอ่านโค้ดด้วย AI ไม่ได้'}
      />
    );
  }

  async function generate() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/analyses/${analysisId}/reading-path`, { method: 'POST' });
      const body = (await response.json().catch(() => null)) as {
        path?: ReadingPath;
        error?: string;
      } | null;

      if (!response.ok || !body?.path) {
        setError(body?.error ?? 'สร้างเส้นทางอ่านโค้ดไม่สำเร็จ');
        return;
      }

      setPath(body.path);
    } catch {
      setError('ติดต่อเซิร์ฟเวอร์ไม่ได้ในขณะนี้');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[60ch] text-sm text-muted">
          {path
            ? `เรียงไว้ ${path.steps.length} ขั้น จากไฟล์พื้นฐานไปจนถึงจุดเริ่มโปรแกรม`
            : 'จัดลำดับไฟล์ที่ควรอ่านก่อน-หลัง ตามความสัมพันธ์จริงในโค้ด'}
        </p>
        <button
          className="shrink-0 rounded-[6px] bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity duration-150 disabled:opacity-50"
          disabled={busy}
          onClick={() => void generate()}
          type="button"
        >
          {busy ? 'กำลังสร้าง…' : path ? 'สร้างใหม่อีกครั้ง' : 'สร้างเส้นทางอ่านโค้ด'}
        </button>
      </div>

      {error ? (
        <p className="border-l-2 border-crit pl-3 text-sm text-crit" role="status">
          {error}
        </p>
      ) : null}

      {path && path.steps.length > 0 ? (
        <ol className="flex flex-col gap-5">
          {path.steps.map((step) => (
            <li key={step.path} className="panel p-4">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-[11px] text-faint tabular-nums">
                  ขั้นที่ {step.order}
                </span>
                <span className="font-mono text-[13px]">{step.path}</span>
              </div>

              <Claims claims={step.why} empty="ยังไม่มีคำอธิบายที่อ้างอิงได้สำหรับขั้นนี้" />

              {step.lookFor.length > 0 ? (
                <div className="mt-3">
                  <p className="label">สิ่งที่ควรสังเกต</p>
                  <Claims claims={step.lookFor} />
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
