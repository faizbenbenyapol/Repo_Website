import type { Claim, ModuleSummary, RepoDigest } from '@repolens/shared';
import { Claims } from './claims';

const SECTIONS: { key: keyof RepoDigest; title: string; empty: string }[] = [
  {
    key: 'purpose',
    title: 'โปรเจกต์นี้ทำอะไร',
    empty: 'ยังไม่มีข้อสรุปที่ชี้บรรทัดรองรับได้',
  },
  { key: 'stack', title: 'สร้างด้วยอะไร', empty: 'ยังไม่มีข้อสรุปที่ชี้บรรทัดรองรับได้' },
  { key: 'entrypoints', title: 'เริ่มอ่านจากไฟล์ไหน', empty: 'ยังหาจุดเริ่มที่ยืนยันได้ไม่เจอ' },
  { key: 'howToRun', title: 'รันอย่างไร', empty: 'ยังไม่พบวิธีรันที่อ้างอิงถึงไฟล์จริงได้' },
  { key: 'notes', title: 'ข้อสังเกต', empty: 'ยังไม่มีข้อสังเกตที่ยืนยันได้' },
];

/**
 * ภาพรวมทั้ง repo เป็นภาษาไทย
 * หมวดที่ไม่มีข้อความผ่านการตรวจอ้างอิงจะบอกตรง ๆ ว่ายังไม่มี ไม่ใช่ซ่อนหัวข้อไปเฉย ๆ
 * เพราะการหายไปเงียบ ๆ ทำให้ผู้ใช้ไม่รู้ว่าระบบพยายามแล้วแต่ยืนยันไม่ได้ หรือไม่ได้ดูเรื่องนั้นเลย
 */
export function DigestPanel({ digest }: { digest: RepoDigest }) {
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-[70ch] text-lg">{digest.headline}</p>

      <div className="grid gap-6 md:grid-cols-2">
        {SECTIONS.map((section) => (
          <section key={section.key}>
            <p className="label">{section.title}</p>
            <Claims claims={digest[section.key] as Claim[]} empty={section.empty} />
          </section>
        ))}
      </div>

      {digest.model ? (
        <p className="font-mono text-[11px] text-faint">
          เขียนโดย {digest.model} จากกุญแจของคุณ · ทุกข้อผ่านการตรวจว่าบรรทัดที่อ้างมีอยู่จริง
        </p>
      ) : (
        <p className="font-mono text-[11px] text-brass">
          ยังไม่ได้สรุปด้วยโมเดล สิ่งที่เห็นมาจากโครงสร้างที่ตรวจวัดได้เท่านั้น
        </p>
      )}
    </div>
  );
}

/** คำอธิบายรายโมดูล เรียงตามพาธเพื่อให้ไล่อ่านจากรากลงไปได้เหมือนเดินในโฟลเดอร์จริง */
export function ModuleList({ modules }: { modules: ModuleSummary[] }) {
  if (modules.length === 0) return null;

  return (
    <ul className="flex flex-col gap-5">
      {modules.map((module) => (
        <li key={module.path}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-[13px]">
              {module.path === '.' ? 'รากของ repo' : module.path}
            </span>
            <span className="font-mono text-[11px] text-faint">{module.fileCount} ไฟล์</span>
            {module.source === 'analyzer' ? (
              <span className="font-mono text-[11px] text-brass">จากโครงสร้าง</span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted">{module.headline}</p>
          <Claims claims={module.points} />
        </li>
      ))}
    </ul>
  );
}
