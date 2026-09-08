import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AskPanel } from '../../../../components/qa/ask-panel';
import { getQaHistory, getSession } from '../../../api-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'ถาม–ตอบกับ repo — RepoLens',
};

const origin = process.env.API_ORIGIN ?? 'http://localhost:3001';

interface Analysis {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  owner: string;
  name: string;
}

async function load<T>(path: string): Promise<T | null> {
  try {
    const response = await fetch(`${origin}${path}`, { cache: 'no-store' });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const data = await load<{ analysis: Analysis }>(`/api/analyses/${id}`);
  if (!data) notFound();

  const { analysis } = data;
  if (analysis.status !== 'done') {
    return (
      <div className="rise pt-20">
        <h1 className="text-3xl font-bold tracking-tight">ยังถาม–ตอบไม่ได้</h1>
        <p className="mt-4 text-muted">งานวิเคราะห์นี้ยังไม่เสร็จ ถาม–ตอบต้องรอให้อ่านโค้ดจบก่อน</p>
        <a
          className="mt-6 inline-block text-accent underline underline-offset-4"
          href={`/analyzing/${id}`}
        >
          ดูความคืบหน้า
        </a>
      </div>
    );
  }

  const [sessionData, history] = await Promise.all([getSession(), getQaHistory(id)]);

  return (
    <div className="rise pt-12">
      <p className="label">ถาม–ตอบ</p>
      <h1 className="mt-2 font-mono text-2xl font-semibold tracking-tight">
        {analysis.owner}/{analysis.name}
      </h1>

      <div className="mt-6 flex flex-wrap gap-4 text-sm">
        <a className="text-accent underline underline-offset-4" href={`/a/${id}`}>
          ← กลับไปดูแผนที่โค้ด
        </a>
      </div>

      <div className="mt-6">
        <AskPanel
          analysisId={id}
          initialMessages={history?.messages ?? []}
          session={sessionData?.session ?? null}
        />
      </div>
    </div>
  );
}
