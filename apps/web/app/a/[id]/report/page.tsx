import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'สรุปตัวเลข — RepoLens',
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
  durationMs: number | null;
  warnings: string[] | null;
  totals: {
    files: number;
    parsed: number;
    bytes: number;
    loc: number;
    languages: { language: string; files: number; loc: number }[];
  } | null;
  engines: { treeSitter: number; pattern: number } | null;
  external: { specifier: string; count: number }[] | null;
}

interface FileRow {
  path: string;
  language: string | null;
  loc: number;
  dependents: number;
  parsed: boolean;
  skipReason: string | null;
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="panel p-5">
      <p className="label">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-faint">{hint}</p> : null}
    </div>
  );
}

export default async function AnalysisPage({ params }: { params: Promise<{ id: string }> }) {
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

  const filesResponse = await load<{ files: FileRow[] }>(
    `/api/analyses/${id}/files?order=dependents&limit=15`,
  );
  const edgesResponse = await load<{ edges: unknown[] }>(`/api/analyses/${id}/edges`);

  const totals = analysis.totals;
  const topFiles = filesResponse?.files ?? [];
  const edgeCount = edgesResponse?.edges.length ?? 0;
  const languages = totals?.languages.slice(0, 8) ?? [];
  const maxLoc = languages[0]?.loc ?? 1;

  return (
    <div className="rise pt-16">
      <p className="label">สรุปตัวเลข</p>
      <h1 className="mt-3 font-mono text-3xl font-semibold tracking-tight">
        {analysis.owner}/{analysis.name}
      </h1>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-faint">
        <span>{analysis.host}</span>
        <span>สาขา {analysis.branch}</span>
        <span>คอมมิต {analysis.commitSha?.slice(0, 7)}</span>
        {analysis.durationMs ? (
          <span>ใช้เวลา {(analysis.durationMs / 1000).toFixed(1)} วินาที</span>
        ) : null}
      </p>

      <a
        className="mt-5 inline-block text-sm text-accent underline underline-offset-4"
        href={`/a/${id}`}
      >
        ← กลับไปดูกราฟและไฟล์
      </a>

      {analysis.warnings && analysis.warnings.length > 0 ? (
        <ul className="mt-6 flex flex-col gap-1 border-l-2 border-brass pl-4">
          {analysis.warnings.map((warning) => (
            <li key={warning} className="text-sm text-brass">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="ไฟล์ทั้งหมด"
          value={formatNumber(totals?.files ?? 0)}
          hint={`อ่านโครงสร้างได้ ${formatNumber(totals?.parsed ?? 0)} ไฟล์`}
        />
        <Stat
          label="บรรทัดโค้ด"
          value={formatNumber(totals?.loc ?? 0)}
          hint={formatBytes(totals?.bytes ?? 0)}
        />
        <Stat
          label="เส้นเชื่อมระหว่างไฟล์"
          value={formatNumber(edgeCount)}
          hint={`ฟังก์ชันและคลาสที่พบ ${formatNumber(symbolCount)}`}
        />
        <Stat
          label="ตัวแยกโค้ด"
          value={formatNumber(analysis.engines?.treeSitter ?? 0)}
          hint={`ใช้ตัวสำรองอีก ${formatNumber(analysis.engines?.pattern ?? 0)} ไฟล์`}
        />
      </div>

      <section className="mt-14">
        <div className="flex items-baseline gap-4">
          <p className="label">ไฟล์ที่ถูกพึ่งพามากที่สุด</p>
          <span className="h-px flex-1 bg-line" />
        </div>
        <p className="mt-3 max-w-[65ch] text-sm text-muted">
          ถ้าจะเริ่มอ่านโค้ดสัก repo หนึ่ง ไฟล์เหล่านี้คือจุดที่คุ้มที่สุดที่จะเริ่ม
          เพราะมีไฟล์อื่นพึ่งพามันมากที่สุด และเป็นจุดที่แก้แล้วกระทบกว้างที่สุดด้วย
        </p>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left">
                <th className="label py-2 font-normal">ไฟล์</th>
                <th className="label py-2 font-normal">ภาษา</th>
                <th className="label py-2 text-right font-normal">บรรทัด</th>
                <th className="label py-2 text-right font-normal">ถูกพึ่งพา</th>
              </tr>
            </thead>
            <tbody>
              {topFiles.map((file) => (
                <tr key={file.path} className="border-b border-line-soft last:border-0">
                  <td className="py-2 pr-4 font-mono text-[13px]">{file.path}</td>
                  <td className="py-2 pr-4 text-muted">{file.language ?? '—'}</td>
                  <td className="py-2 pr-4 text-right tabular-nums text-muted">
                    {formatNumber(file.loc)}
                  </td>
                  <td className="py-2 text-right tabular-nums">{formatNumber(file.dependents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-14 grid gap-10 md:grid-cols-2">
        <div>
          <div className="flex items-baseline gap-4">
            <p className="label">สัดส่วนภาษา</p>
            <span className="h-px flex-1 bg-line" />
          </div>
          <ul className="mt-5 flex flex-col gap-3">
            {languages.map((language) => (
              <li key={language.language}>
                <div className="flex items-baseline justify-between text-sm">
                  <span>{language.language}</span>
                  <span className="font-mono text-xs text-faint tabular-nums">
                    {formatNumber(language.files)} ไฟล์ · {formatNumber(language.loc)} บรรทัด
                  </span>
                </div>
                <div className="mt-1 h-[3px] w-full rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.max((language.loc / maxLoc) * 100, 2)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="flex items-baseline gap-4">
            <p className="label">พึ่งพาจากภายนอกมากที่สุด</p>
            <span className="h-px flex-1 bg-line" />
          </div>
          <ul className="mt-5 flex flex-col gap-2">
            {(analysis.external ?? []).slice(0, 10).map((item) => (
              <li
                key={item.specifier}
                className="flex items-baseline justify-between gap-4 text-sm"
              >
                <span className="font-mono text-[13px]">{item.specifier}</span>
                <span className="font-mono text-xs text-faint tabular-nums">
                  {formatNumber(item.count)} ครั้ง
                </span>
              </li>
            ))}
            {(analysis.external ?? []).length === 0 ? (
              <li className="text-sm text-faint">ไม่พบการพึ่งพาแพ็กเกจภายนอก</li>
            ) : null}
          </ul>
        </div>
      </section>

      <p className="mt-16 text-sm text-muted">
        ตัวชี้วัดสุขภาพโค้ด จุดร้อน และรัศมีผลกระทบจะมาในรุ่น v0.4.0
      </p>
    </div>
  );
}
