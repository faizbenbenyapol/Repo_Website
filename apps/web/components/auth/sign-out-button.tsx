'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** ออกจากระบบแล้วกุญแจที่ผูกไว้ต้องถูกทิ้งไปด้วย ซึ่งฝั่ง API จัดการให้ในคำขอเดียวกัน */
export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      className="rounded-[6px] border border-line px-3 py-1.5 text-[13px] text-muted transition-colors hover:border-crit hover:text-crit disabled:opacity-50"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void fetch('/api/auth/logout', { method: 'POST' })
          .then(() => {
            router.replace('/');
            router.refresh();
          })
          .finally(() => setBusy(false));
      }}
      type="button"
    >
      {busy ? 'กำลังออก…' : 'ออกจากระบบ'}
    </button>
  );
}
