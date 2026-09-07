import type { Metadata } from 'next';
import { ProgressTimeline } from '../../../components/progress-timeline';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'กำลังอ่าน repo — RepoLens',
};

export default async function AnalyzingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="rise pt-20">
      <h1 className="text-3xl font-bold tracking-tight">กำลังอ่าน repo ให้อยู่</h1>
      <p className="mt-3 max-w-[60ch] text-muted">
        ทุกบรรทัดด้านล่างคือขั้นตอนที่ระบบทำอยู่จริง ไม่ใช่แถบโหลดหลอกตา
        เมื่ออ่านเสร็จจะพาไปหน้าผลลัพธ์ให้เอง
      </p>

      <div className="panel mt-10 p-8">
        <ProgressTimeline analysisId={id} />
      </div>

      <p className="mt-6 font-mono text-xs text-faint">รหัสงาน {id}</p>
    </div>
  );
}
