import type { Claim } from '@repolens/shared';

/**
 * แสดงข้อความพร้อมบรรทัดที่รองรับ
 *
 * ทุกข้อที่ขึ้นหน้าจอต้องมีอ้างอิงติดมาด้วยเสมอ ข้อที่อ้างอิงไม่ผ่านถูกตัดไปตั้งแต่ตอนสร้างแล้ว
 * ผู้ใช้จึงตรวจได้ทุกประโยคว่าคำอธิบายนี้มาจากบรรทัดไหนของโค้ดจริง
 */
export function Claims({
  claims,
  onSelect,
  empty,
}: {
  claims: Claim[];
  empty?: string;
  onSelect?: (path: string) => void;
}) {
  if (claims.length === 0) {
    return empty ? <p className="mt-2 text-sm text-faint">{empty}</p> : null;
  }

  return (
    <ul className="mt-2 flex flex-col gap-2">
      {claims.map((claim, index) => (
        <li key={`${claim.text}-${index}`} className="text-sm">
          <p>{claim.text}</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {claim.citations.map((citation) => {
              const label = `${citation.path}:${citation.line}`;
              return (
                <li key={label}>
                  {onSelect ? (
                    <button
                      className="rounded-[4px] bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-muted transition-colors hover:text-accent"
                      onClick={() => onSelect(citation.path)}
                      title={label}
                      type="button"
                    >
                      {label}
                    </button>
                  ) : (
                    <span
                      className="rounded-[4px] bg-surface-2 px-1.5 py-0.5 font-mono text-[10.5px] text-muted"
                      title={label}
                    >
                      {label}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}
