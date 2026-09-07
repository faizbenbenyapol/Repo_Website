'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/** ขั้นตอนที่ต้องตรงกับไปป์ไลน์จริงใน @repolens/analyzer */
const STAGES = [
  { id: 'resolve', label: 'ตรวจสอบที่อยู่ repo' },
  { id: 'fetch', label: 'ดาวน์โหลดซอร์สโค้ด' },
  { id: 'inventory', label: 'สำรวจไฟล์ทั้งหมด' },
  { id: 'parse', label: 'อ่านโครงสร้างโค้ด' },
  { id: 'link', label: 'เชื่อมความสัมพันธ์' },
  { id: 'publish', label: 'สรุปผล' },
] as const;

interface Update {
  status: 'queued' | 'running' | 'done' | 'failed';
  stage: string | null;
  percent: number;
  message: string;
}

export function ProgressTimeline({ analysisId }: { analysisId: string }) {
  const router = useRouter();
  const [update, setUpdate] = useState<Update>({
    status: 'queued',
    stage: null,
    percent: 0,
    message: 'กำลังเชื่อมต่อ',
  });

  useEffect(() => {
    const source = new EventSource(`/api/analyses/${analysisId}/stream`);

    source.onmessage = (event) => {
      const payload = JSON.parse(event.data) as Update;
      setUpdate(payload);
      if (payload.status === 'done') {
        source.close();
        router.replace(`/a/${analysisId}`);
      }
      if (payload.status === 'failed') source.close();
    };

    // ถ้าสตรีมหลุด ยังต้องรู้ผลได้ จึงถามสถานะซ้ำเป็นระยะ
    const poll = setInterval(async () => {
      const response = await fetch(`/api/analyses/${analysisId}`);
      if (!response.ok) return;
      const body = await response.json();
      if (body.analysis.status === 'done') {
        clearInterval(poll);
        source.close();
        router.replace(`/a/${analysisId}`);
      }
      if (body.analysis.status === 'failed') {
        clearInterval(poll);
        setUpdate({
          status: 'failed',
          stage: body.analysis.stage,
          percent: 100,
          message: body.analysis.error ?? 'วิเคราะห์ไม่สำเร็จ',
        });
      }
    }, 5000);

    return () => {
      clearInterval(poll);
      source.close();
    };
  }, [analysisId, router]);

  const activeIndex = STAGES.findIndex((stage) => stage.id === update.stage);
  const failed = update.status === 'failed';

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <p className="label">{failed ? 'วิเคราะห์ไม่สำเร็จ' : 'กำลังอ่าน repo'}</p>
        <span className="font-mono text-sm text-muted tabular-nums">{update.percent}%</span>
      </div>

      <div
        aria-valuenow={update.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-surface-2"
        role="progressbar"
      >
        <div
          className={`h-full transition-[width] duration-500 ease-out ${failed ? 'bg-brass' : 'bg-accent'}`}
          style={{ width: `${Math.max(update.percent, 3)}%` }}
        />
      </div>

      <ol className="mt-8 flex flex-col gap-3">
        {STAGES.map((stage, index) => {
          const done = !failed && (activeIndex > index || update.status === 'done');
          const active = !failed && activeIndex === index;

          return (
            <li key={stage.id} className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className={`size-2 rounded-full transition-colors duration-300 ${
                  done ? 'bg-accent' : active ? 'bg-accent' : 'bg-line'
                } ${active ? 'animate-pulse' : ''}`}
              />
              <span className={active || done ? 'text-text' : 'text-faint'}>{stage.label}</span>
            </li>
          );
        })}
      </ol>

      <p className={`mt-8 text-sm ${failed ? 'text-brass' : 'text-muted'}`} role="status">
        {update.message}
      </p>

      {failed ? (
        <a className="mt-4 inline-block text-sm text-accent underline underline-offset-4" href="/">
          ลองที่อยู่อื่นอีกครั้ง
        </a>
      ) : null}
    </div>
  );
}
