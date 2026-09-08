'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  COMPREHENSION_STAGE_LABELS,
  type ComprehensionProgress,
  type ComprehensionRun,
  type SessionState,
} from '@repolens/shared';

interface Props {
  analysisId: string;
  session: SessionState | null;
  run: ComprehensionRun | null;
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
 * ปุ่มสั่งสรุปและแถบความคืบหน้า
 *
 * เมื่อยังใช้ไม่ได้ จะบอกเหตุผลและทางไปต่อเสมอ ไม่ใช่ปุ่มจาง ๆ ที่กดไม่ได้เฉย ๆ
 * เพราะคนที่เพิ่งเข้ามาไม่มีทางเดาได้เองว่าต้องล็อกอินแล้วผูกกุญแจก่อน
 */
export function ComprehendPanel({ analysisId, session, run }: Props) {
  const router = useRouter();
  const [progress, setProgress] = useState<ComprehensionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const streamRef = useRef<EventSource | null>(null);

  const active =
    progress?.status === 'running' ||
    progress?.status === 'queued' ||
    ((run?.status === 'running' || run?.status === 'queued') && progress === null);

  const follow = useCallback(
    (comprehensionId: string) => {
      streamRef.current?.close();
      const stream = new EventSource(`/api/comprehensions/${comprehensionId}/stream`);
      streamRef.current = stream;

      stream.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as ComprehensionProgress;
          setProgress(payload);
          if (payload.status === 'done' || payload.status === 'failed') {
            stream.close();
            // ดึงผลที่เพิ่งบันทึกเสร็จมาแสดง โดยไม่ต้องให้ผู้ใช้กดโหลดหน้าใหม่เอง
            router.refresh();
          }
        } catch {
          // ข้อความที่อ่านไม่ออกข้ามไป การเชื่อมต่อยังใช้ได้อยู่
        }
      };

      stream.onerror = () => {
        stream.close();
        setError('การติดตามความคืบหน้าขาดไป ลองโหลดหน้าใหม่เพื่อดูสถานะล่าสุด');
      };
    },
    [router],
  );

  useEffect(() => {
    if (run && (run.status === 'running' || run.status === 'queued')) follow(run.id);
    return () => streamRef.current?.close();
  }, [follow, run]);

  if (!session?.signedIn) {
    return (
      <Gate
        action="เข้าสู่ระบบ"
        href="/login"
        text="คำอธิบายภาษาไทยของ repo นี้เปิดให้สมาชิกที่ใส่ API key ของตัวเอง เพราะค่าเรียกใช้โมเดลคิดกับกุญแจของผู้ใช้โดยตรง"
      />
    );
  }

  if (!session.aiEnabled) {
    return (
      <Gate
        action="ไปหน้าตั้งค่า"
        href="/account"
        text={session.aiBlockedReason ?? 'ยังใช้คำอธิบายด้วย AI ไม่ได้'}
      />
    );
  }

  async function start() {
    setStarting(true);
    setError(null);

    try {
      const response = await fetch(`/api/analyses/${analysisId}/comprehension`, { method: 'POST' });
      const body = (await response.json().catch(() => null)) as {
        comprehension?: ComprehensionRun;
        error?: string;
      } | null;

      if (!response.ok || !body?.comprehension) {
        setError(body?.error ?? 'สั่งสรุปไม่สำเร็จ');
        return;
      }

      setProgress({
        comprehensionId: body.comprehension.id,
        analysisId,
        status: 'queued',
        stage: null,
        percent: 0,
        message: 'เข้าคิวรอสรุป',
        filesDone: 0,
        filesTotal: body.comprehension.filesTotal,
      });
      follow(body.comprehension.id);
    } catch {
      setError('ติดต่อเซิร์ฟเวอร์ไม่ได้ในขณะนี้');
    } finally {
      setStarting(false);
    }
  }

  const current = progress ?? {
    percent: run?.percent ?? 0,
    message: run?.message ?? '',
    stage: run?.stage ?? null,
    filesDone: run?.filesDone ?? 0,
    filesTotal: run?.filesTotal ?? 0,
    status: run?.status ?? 'queued',
  };

  return (
    <div className="panel flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label">คำอธิบายภาษาไทย</p>
          <p className="mt-1 text-sm text-muted">
            {run?.status === 'done'
              ? `สรุปครบ ${run.filesDone.toLocaleString('th-TH')} ไฟล์ ใช้โทเค็นไป ${(run.inputTokens + run.outputTokens).toLocaleString('th-TH')} หน่วยจากกุญแจของคุณ`
              : 'อ่านทุกไฟล์แล้วเขียนสรุปเป็นภาษาไทย โดยอ้างอิงบรรทัดจริงทุกข้อ'}
          </p>
        </div>

        <button
          className="rounded-[6px] bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity duration-150 disabled:opacity-50"
          disabled={starting || active}
          onClick={() => void start()}
          type="button"
        >
          {active ? 'กำลังสรุป…' : run?.status === 'done' ? 'สรุปใหม่อีกครั้ง' : 'สรุป repo นี้'}
        </button>
      </div>

      {active ? (
        <div className="flex flex-col gap-1.5">
          <div className="h-1 overflow-hidden rounded-full bg-sunken">
            <div
              className="h-full bg-accent transition-[width] duration-500 ease-out"
              style={{ width: `${Math.min(Math.max(current.percent, 2), 100)}%` }}
            />
          </div>
          <p className="font-mono text-[11px] text-faint">
            {current.stage ? COMPREHENSION_STAGE_LABELS[current.stage] : current.message}
            {current.filesTotal > 0 ? ` · ${current.filesDone}/${current.filesTotal} ไฟล์` : ''}
          </p>
        </div>
      ) : null}

      {run?.status === 'failed' && !active ? (
        <p className="border-l-2 border-crit pl-3 text-sm text-crit">{run.error}</p>
      ) : null}

      {error ? (
        <p className="border-l-2 border-crit pl-3 text-sm text-crit" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}
