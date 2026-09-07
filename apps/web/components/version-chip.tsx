import { formatBuildLabel } from '@repolens/shared';
import { getBuildInfo } from '../app/api-client';

/**
 * ป้ายบอกรุ่นที่กำลังรันจริง อ่านจาก API ไม่ใช่ค่าที่ hardcode ไว้ในหน้าเว็บ
 * ถ้าอ่านไม่ได้ต้องบอกตรง ๆ ว่าอ่านไม่ได้ ดีกว่าแสดงเลขที่อาจไม่ตรงกับของที่รันอยู่
 */
export async function VersionChip() {
  const info = await getBuildInfo();

  return (
    <a
      href="/versions"
      className="rounded-full border border-line bg-surface px-3 py-1 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent"
      title="ดูบันทึกการเปลี่ยนแปลงย้อนหลังทุกรุ่น"
    >
      {info ? formatBuildLabel(info) : 'อ่านรุ่นที่รันอยู่ไม่ได้'}
    </a>
  );
}
