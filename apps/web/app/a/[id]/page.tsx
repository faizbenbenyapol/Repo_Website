import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ComprehendPanel } from '../../../components/comprehension/comprehend-panel';
import { Explorer } from '../../../components/explorer/explorer';
import type { GraphData } from '../../../lib/graph-view';
import { getComprehension, getSession } from '../../api-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'แผนที่โค้ด — RepoLens',
};

const origin = process.env.API_ORIGIN ?? 'http://localhost:3001';

interface Analysis {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  owner: string;
  name: string;
  host: string;
  commitSha: string | null;
  branch: string | null;
  error: string | null;
  totals: { files: number; parsed: number; loc: number } | null;
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

function formatNumber(value: number): string {
  return new Intl.NumberFormat('th-TH').format(value);
}

export default async function ExplorerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const data = await load<{ analysis: Analysis; symbolCount: number }>(`/api/analyses/${id}`);
  if (!data) notFound();

  const { analysis, symbolCount } = data;

  if (analysis.status !== 'done') {
    return (
      <div className="rise pt-20">
        <h1 className="text-3xl font-bold tracking-tight">
          {analysis.status === 'failed' ? 'อ่าน repo นี้ไม่สำเร็จ' : 'ยังอ่านไม่เสร็จ'}
        </h1>
        <p className="mt-4 text-muted">
          {analysis.error ?? 'งานนี้ยังทำงานอยู่ ลองกลับมาดูอีกครั้ง'}
        </p>
        <a
          className="mt-6 inline-block text-accent underline underline-offset-4"
          href={`/analyzing/${id}`}
        >
          ดูความคืบหน้า
        </a>
      </div>
    );
  }

  const [graph, sessionData, comprehension] = await Promise.all([
    load<GraphData>(`/api/analyses/${id}/graph`),
    getSession(),
    getComprehension(id),
  ]);

  const graphData = graph ?? { nodes: [], edges: [], truncated: false, totalNodes: 0 };
  const session = sessionData?.session ?? null;
  const digest = comprehension?.digest ?? null;

  return (
    <div className="rise pt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div>
          <p className="label">แผนที่โค้ด</p>
          <h1 className="mt-2 font-mono text-2xl font-semibold tracking-tight">
            {analysis.owner}/{analysis.name}
          </h1>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 font-mono text-[11px] text-faint">
          <span>สาขา {analysis.branch}</span>
          <span>คอมมิต {analysis.commitSha?.slice(0, 7)}</span>
          <span>{formatNumber(analysis.totals?.files ?? 0)} ไฟล์</span>
          <span>{formatNumber(analysis.totals?.loc ?? 0)} บรรทัด</span>
          <span>{formatNumber(symbolCount)} ฟังก์ชันและคลาส</span>
          <a className="text-accent underline underline-offset-4" href={`/a/${id}/report`}>
            สรุปตัวเลขทั้งหมด
          </a>
        </div>
      </div>

      {digest ? (
        <p className="mt-4 max-w-[70ch] text-[15px]">{digest.headline}</p>
      ) : (
        <p className="mt-4 max-w-[70ch] text-sm text-muted">
          แต่ละจุดคือหนึ่งไฟล์ เส้นคือการที่ไฟล์หนึ่งเรียกใช้อีกไฟล์ ยิ่งจุดใหญ่ยิ่งมีโค้ดมาก
          กลุ่มก้อนที่เกาะกันแน่นมักเป็นโมดูลเดียวกัน ส่วนจุดที่โดดเดี่ยวคือไฟล์ที่ไม่มีใครเรียกใช้
        </p>
      )}

      <div className="mt-6">
        <ComprehendPanel
          analysisId={id}
          run={comprehension?.comprehension ?? null}
          session={session}
        />
      </div>

      <div className="mt-4">
        <Explorer aiEnabled={session?.aiEnabled ?? false} analysisId={id} data={graphData} />
      </div>
    </div>
  );
}
