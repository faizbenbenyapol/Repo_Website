import type { Metadata } from 'next';
import { countChanges } from '@repolens/shared';
import { getReleases } from '../api-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'ประวัติเวอร์ชัน — RepoLens',
  description: 'บันทึกการเปลี่ยนแปลงทุกรุ่นของ RepoLens อ่านย้อนหลังได้ทั้งหมด',
};

export default async function VersionsPage() {
  const data = await getReleases();
  const releases = data?.releases ?? [];

  return (
    <div className="rise pt-16">
      <p className="label">ประวัติเวอร์ชัน</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">ทุกรุ่นที่ปล่อยมา</h1>
      <p className="mt-4 max-w-[65ch] text-muted">
        หน้านี้อ่านจากไฟล์บันทึกรุ่นในที่เก็บโค้ดโดยตรง ไม่ได้พิมพ์ซ้ำไว้ต่างหาก
        สิ่งที่เห็นตรงนี้จึงเป็นสิ่งเดียวกับที่อยู่ใน CHANGELOG.md เสมอ
      </p>

      {releases.length === 0 ? (
        <p className="mt-10 text-brass">ยังอ่านบันทึกรุ่นไม่ได้ตอนนี้ ลองโหลดหน้านี้ใหม่อีกครั้ง</p>
      ) : (
        <ol className="mt-10 flex flex-col gap-8 border-l border-line pl-6">
          {releases.map((release) => (
            <li key={release.version} className="relative">
              <span
                aria-hidden="true"
                className="absolute top-3 -left-[29px] size-2 rounded-full bg-brass"
              />
              <div className="flex flex-wrap items-baseline gap-3">
                <h2 className="font-mono text-base text-brass">v{release.version}</h2>
                <span className="font-display text-lg font-semibold">{release.title}</span>
                <span className="font-mono text-xs text-faint">
                  {release.date} · {countChanges(release)} รายการ
                </span>
              </div>

              <div className="mt-4 flex flex-col gap-4">
                {release.sections.map((section) => (
                  <section key={section.heading}>
                    <h3 className="label">{section.heading}</h3>
                    <ul className="mt-2 flex flex-col gap-2">
                      {section.items.map((item) => (
                        <li key={item} className="pl-4 text-sm -indent-4 text-muted">
                          — {item}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
