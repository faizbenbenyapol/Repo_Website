import { TIER_INFO, type Feature, type Tier } from '@repolens/shared';
import { RepoInput } from '../components/repo-input';
import { getSession } from './api-client';

export const dynamic = 'force-dynamic';

function FeatureList({ features }: { features: Feature[] }) {
  return (
    <ul className="mt-4 flex flex-col gap-3">
      {features.map((feature) => (
        <li key={feature.id} className="text-sm">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-medium">{feature.name}</span>
            <span className="font-mono text-[11px] text-faint">
              {feature.status === 'shipped' ? 'ใช้ได้แล้ว' : `รุ่น v${feature.since}`}
            </span>
          </div>
          <p className="text-muted">{feature.detail}</p>
        </li>
      ))}
    </ul>
  );
}

export default async function HomePage() {
  const data = await getSession();
  const features = data?.features ?? [];
  const byTier = (tier: Tier) => features.filter((feature) => feature.tier === tier);

  return (
    <div className="rise">
      <section className="pt-16 pb-4">
        <p className="label">อ่านโค้ดทั้ง repo ให้เข้าใจ</p>
        <h1 className="mt-3 text-4xl leading-tight font-bold tracking-tight sm:text-5xl">
          วางลิงก์ repo หนึ่งอัน
          <br />
          แล้วให้เราอ่านทั้งก้อนแทนคุณ
        </h1>
        <p className="mt-5 max-w-[60ch] text-lg text-muted">
          แผนที่สถาปัตยกรรม กราฟความสัมพันธ์ระหว่างไฟล์ ตัวชี้วัดสุขภาพโค้ด
          และคำอธิบายภาษาไทยที่อ้างอิงถึงบรรทัดจริงได้ทุกประโยค
        </p>
        <RepoInput />
      </section>

      <section className="mt-16">
        <div className="flex items-baseline gap-4">
          <p className="label">สองระดับการใช้งาน</p>
          <span className="h-px flex-1 bg-line" />
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {(['visitor', 'member'] as const).map((tier) => {
            const info = TIER_INFO[tier];
            return (
              <article
                key={tier}
                className={`panel p-6 ${tier === 'member' ? 'border-l-2 border-l-accent' : ''}`}
              >
                <h2 className="text-lg font-semibold">{info.name}</h2>
                <p className="mt-1 text-sm text-muted">{info.summary}</p>
                <dl className="mt-4 flex flex-col gap-1 font-mono text-xs text-faint">
                  <div className="flex gap-2">
                    <dt>เงื่อนไข</dt>
                    <dd className="text-muted">{info.requirement}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt>ค่าใช้จ่าย</dt>
                    <dd className="text-muted">{info.costBearer}</dd>
                  </div>
                </dl>
                <FeatureList features={byTier(tier)} />
              </article>
            );
          })}
        </div>

        {data ? null : (
          <p className="mt-4 text-sm text-brass">
            ตอนนี้อ่านสถานะจาก API ไม่ได้ รายการฟีเจอร์ด้านบนจึงยังว่างอยู่
          </p>
        )}
      </section>

      <section className="mt-16">
        <div className="flex items-baseline gap-4">
          <p className="label">สถานะการพัฒนา</p>
          <span className="h-px flex-1 bg-line" />
        </div>
        <p className="mt-6 max-w-[65ch] text-muted">
          รุ่นนี้คือ v0.1.0 ซึ่งวางโครงและวินัยของโปรเจกต์ — โครงสร้างแพ็กเกจ สภาพแวดล้อม Docker
          ชุดทดสอบ และระบบบันทึกรุ่นที่อ่านย้อนหลังได้ทุกรุ่น การวิเคราะห์โค้ดจริงเริ่มที่รุ่นถัดไป
          ดูได้ว่าแต่ละรุ่นทำอะไรไปแล้วบ้างที่{' '}
          <a className="text-accent underline underline-offset-4" href="/versions">
            หน้าประวัติเวอร์ชัน
          </a>
        </p>
      </section>
    </div>
  );
}
