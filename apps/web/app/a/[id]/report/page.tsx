import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DigestPanel, ModuleList } from '../../../../components/comprehension/digest-panel';
import { ReadingPathPanel } from '../../../../components/reading-path/reading-path-panel';
import { getComprehension, getReadingPath, getSession } from '../../../api-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'สุขภาพโค้ด — RepoLens',
};

const origin = process.env.API_ORIGIN ?? 'http://localhost:3001';

interface HealthBreakdown {
  id: string;
  label: string;
  penalty: number;
  detail: string;
}

interface Metrics {
  health: { score: number; grade: string; breakdown: HealthBreakdown[] };
  cycles: { files: string[] }[];
  deadFiles: string[];
  hotspots: { path: string; churn: number; loc: number; dependents: number; risk: number }[];
  coupling: {
    averageDependencies: number;
    highFanOut: { path: string; dependencies: number }[];
  };
}

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
  metrics: Metrics | null;
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

interface Finding {
  path: string;
  line: number;
  rule: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
  snippet: string | null;
}

interface RankedFile {
  path: string;
  language: string | null;
  loc: number;
  dependents: number;
  churn: number;
  blast: number;
  authors: { name: string; commits: number }[];
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

const SEVERITY_LABEL: Record<Finding['severity'], string> = {
  high: 'สูง',
  medium: 'กลาง',
  low: 'ต่ำ',
};

const GRADE_TONE: Record<string, string> = {
  A: 'text-good',
  B: 'text-good',
  C: 'text-brass',
  D: 'text-brass',
  F: 'text-crit',
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="panel p-5">
      <p className="label">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-faint">{hint}</p> : null}
    </div>
  );
}

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-5">
      <div className="flex items-baseline gap-4">
        <p className="label">{title}</p>
        <span className="h-px flex-1 bg-line" />
      </div>
      {hint ? <p className="mt-2 max-w-[65ch] text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
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

  const [findingsResponse, blastResponse, edgesResponse, comprehension, sessionData, readingPath] =
    await Promise.all([
      load<{ findings: Finding[] }>(`/api/analyses/${id}/findings`),
      load<{ files: RankedFile[] }>(`/api/analyses/${id}/ranked?by=blast&limit=10`),
      load<{ edges: unknown[] }>(`/api/analyses/${id}/edges`),
      getComprehension(id),
      getSession(),
      getReadingPath(id),
    ]);

  const totals = analysis.totals;
  const metrics = analysis.metrics;
  const findings = findingsResponse?.findings ?? [];
  const blastFiles = blastResponse?.files ?? [];
  const edgeCount = edgesResponse?.edges.length ?? 0;
  const languages = totals?.languages.slice(0, 8) ?? [];
  const maxLoc = languages[0]?.loc ?? 1;

  return (
    <div className="rise pt-16">
      <p className="label">สุขภาพโค้ด</p>
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

      <div className="mt-5 flex flex-wrap gap-4">
        <a className="text-sm text-accent underline underline-offset-4" href={`/a/${id}`}>
          ← กลับไปดูแผนที่โค้ด
        </a>
        <a
          className="text-sm text-accent underline underline-offset-4"
          href={`/api/analyses/${id}/export`}
        >
          ส่งออกผลทั้งชุดเป็น JSON
        </a>
      </div>

      {analysis.warnings && analysis.warnings.length > 0 ? (
        <ul className="mt-6 flex flex-col gap-1 border-l-2 border-brass pl-4">
          {analysis.warnings.map((warning) => (
            <li key={warning} className="text-sm text-brass">
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

      {comprehension?.digest ? (
        <section className="mt-12">
          <div className="flex items-baseline gap-4">
            <p className="label">สรุปเป็นภาษาไทย</p>
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="mt-6">
            <DigestPanel digest={comprehension.digest} />
          </div>
        </section>
      ) : null}

      {comprehension && comprehension.modules.length > 0 ? (
        <section className="mt-14">
          <div className="flex items-baseline gap-4">
            <p className="label">แต่ละโมดูลรับผิดชอบอะไร</p>
            <span className="h-px flex-1 bg-line" />
          </div>
          <div className="mt-6">
            <ModuleList modules={comprehension.modules} />
          </div>
        </section>
      ) : null}

      <section className="mt-14">
        <div className="flex items-baseline gap-4">
          <p className="label">เส้นทางอ่านโค้ดสำหรับคนใหม่</p>
          <span className="h-px flex-1 bg-line" />
        </div>
        <div className="mt-6">
          <ReadingPathPanel
            analysisId={id}
            initialPath={readingPath?.path ?? null}
            session={sessionData?.session ?? null}
          />
        </div>
      </section>

      {metrics ? (
        <section className="mt-10">
          <div className="panel flex flex-col gap-6 p-6 md:flex-row md:items-start">
            <div className="shrink-0 text-center md:w-40">
              <p className={`font-display text-6xl font-bold ${GRADE_TONE[metrics.health.grade]}`}>
                {metrics.health.grade}
              </p>
              <p className="mt-1 font-mono text-sm text-muted tabular-nums">
                {metrics.health.score} / 100
              </p>
              <p className="mt-2 text-xs text-faint">คะแนนเริ่มจากเต็มร้อย แล้วหักตามที่พบ</p>
            </div>

            <ul aria-label="ที่มาของคะแนนสุขภาพ" className="flex flex-1 flex-col gap-4">
              {metrics.health.breakdown.map((item) => (
                <li key={item.id}>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-sm font-medium">{item.label}</span>
                    <span
                      className={`font-mono text-xs tabular-nums ${item.penalty > 0 ? 'text-brass' : 'text-faint'}`}
                    >
                      {item.penalty > 0 ? `−${item.penalty}` : 'ไม่หัก'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted">{item.detail}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
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

      {metrics && metrics.hotspots.length > 0 ? (
        <section className="mt-14">
          <SectionHeading
            hint="ไฟล์ที่แก้บ่อย ตัวใหญ่ และมีคนพึ่งพาเยอะพร้อมกัน คือที่ที่บั๊กมักเกิดและควรมีเทสต์คุมมากที่สุด"
            title="จุดร้อน"
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line-soft text-left">
                  <th className="label py-2 font-normal">ไฟล์</th>
                  <th className="label py-2 text-right font-normal">แก้ไปแล้ว</th>
                  <th className="label py-2 text-right font-normal">บรรทัด</th>
                  <th className="label py-2 text-right font-normal">ถูกพึ่งพา</th>
                  <th className="label py-2 text-right font-normal">คะแนนเสี่ยง</th>
                </tr>
              </thead>
              <tbody>
                {metrics.hotspots.slice(0, 10).map((item) => (
                  <tr key={item.path} className="border-b border-line-soft last:border-0">
                    <td className="py-2 pr-4 font-mono text-[13px]">{item.path}</td>
                    <td className="py-2 pr-4 text-right tabular-nums text-muted">
                      {formatNumber(item.churn)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-muted">
                      {formatNumber(item.loc)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-muted">
                      {formatNumber(item.dependents)}
                    </td>
                    <td className="py-2 text-right tabular-nums">{item.risk}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {blastFiles.length > 0 ? (
        <section className="mt-14">
          <SectionHeading
            hint="ถ้าแก้ไฟล์เหล่านี้ ไฟล์อื่นได้รับผลกระทบมากที่สุด นับรวมผลทางอ้อมที่ไล่ต่อกันไปเป็นทอด ๆ"
            title="รัศมีผลกระทบสูงสุด"
          />
          <ul className="flex flex-col gap-2">
            {blastFiles.map((file) => (
              <li key={file.path} className="flex items-baseline justify-between gap-4">
                <span className="truncate font-mono text-[13px]">{file.path}</span>
                <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
                  กระทบ {formatNumber(file.blast)} ไฟล์
                  {file.authors[0] ? ` · ${file.authors[0].name}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-14">
        <SectionHeading
          hint={
            findings.length === 0
              ? 'การสแกนนี้เป็นการตรวจรูปแบบเบื้องต้น ไม่ใช่การตรวจสอบความปลอดภัยเต็มรูปแบบ'
              : 'เป็นข้อสังเกตที่ควรไปดูด้วยตา ไม่ใช่คำตัดสินว่าเป็นช่องโหว่ — ค่าที่ดูเหมือนความลับถูกกลบไว้แล้ว'
          }
          title="ข้อสังเกตด้านความปลอดภัย"
        />
        {findings.length === 0 ? (
          <p className="text-sm text-muted">ไม่พบรูปแบบที่น่ากังวลจากการสแกนเบื้องต้น</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {findings.slice(0, 20).map((finding) => (
              <li key={`${finding.path}-${finding.rule}-${finding.line}`} className="panel p-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span
                    className={`font-mono text-[11px] ${
                      finding.severity === 'high'
                        ? 'text-crit'
                        : finding.severity === 'medium'
                          ? 'text-brass'
                          : 'text-faint'
                    }`}
                  >
                    ระดับ{SEVERITY_LABEL[finding.severity]}
                  </span>
                  <span className="text-sm">{finding.message}</span>
                </div>
                <p className="mt-2 font-mono text-[12px] text-muted">
                  {finding.path}:{finding.line}
                </p>
                {finding.snippet ? (
                  <pre className="mt-2 overflow-x-auto rounded-[4px] bg-sunken p-2 font-mono text-[11.5px] text-muted">
                    {finding.snippet}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {metrics && (metrics.cycles.length > 0 || metrics.deadFiles.length > 0) ? (
        <section className="mt-14 grid gap-10 md:grid-cols-2">
          <div>
            <SectionHeading
              hint="ไฟล์ที่พึ่งพากันเป็นวงกลม ทำให้แยกไปทดสอบหรือแก้ทีละชิ้นได้ยาก"
              title="วงจรพึ่งพา"
            />
            {metrics.cycles.length === 0 ? (
              <p className="text-sm text-muted">ไม่พบวงจรพึ่งพา</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {metrics.cycles.slice(0, 5).map((cycle) => (
                  <li key={cycle.files.join('|')} className="panel p-3">
                    <ul className="flex flex-col gap-0.5">
                      {cycle.files.slice(0, 6).map((path) => (
                        <li key={path} className="truncate font-mono text-[12px] text-muted">
                          {path}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <SectionHeading
              hint="ไม่มีไฟล์ไหนเรียกใช้ และไม่ใช่จุดเริ่มโปรแกรม — ควรไปดูว่ายังต้องเก็บไว้ไหม"
              title="ไฟล์ที่ไม่มีใครเรียกใช้"
            />
            {metrics.deadFiles.length === 0 ? (
              <p className="text-sm text-muted">ไม่พบไฟล์ที่ไม่มีใครเรียกใช้</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {metrics.deadFiles.slice(0, 15).map((path) => (
                  <li key={path} className="truncate font-mono text-[12.5px] text-muted">
                    {path}
                  </li>
                ))}
                {metrics.deadFiles.length > 15 ? (
                  <li className="text-xs text-faint">
                    และอีก {formatNumber(metrics.deadFiles.length - 15)} ไฟล์
                  </li>
                ) : null}
              </ul>
            )}
          </div>
        </section>
      ) : null}

      <section className="mt-14 grid gap-10 md:grid-cols-2">
        <div>
          <SectionHeading title="สัดส่วนภาษา" />
          <ul className="flex flex-col gap-3">
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
          <SectionHeading title="พึ่งพาจากภายนอกมากที่สุด" />
          <ul className="flex flex-col gap-2">
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
        คำอธิบายภาษาไทยรายไฟล์และการถาม–ตอบกับ repo จะมาในรุ่น v0.5.0 สำหรับสมาชิกที่ใส่ API key
        ของตัวเอง
      </p>
    </div>
  );
}
