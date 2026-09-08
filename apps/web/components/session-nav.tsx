import { getSession } from '../app/api-client';

/**
 * แถบบนสุดบอกเสมอว่ากำลังดูอยู่ในฐานะใคร
 * ผู้ใช้ต้องรู้ได้ทันทีว่าทำไมบางอย่างใช้ได้และบางอย่างใช้ไม่ได้ โดยไม่ต้องเดา
 */
export async function SessionNav() {
  const data = await getSession();
  const session = data?.session;

  if (!session?.signedIn) {
    return (
      <a className="transition-colors hover:text-accent" href="/login">
        เข้าสู่ระบบ
      </a>
    );
  }

  return (
    <a className="flex items-center gap-2 transition-colors hover:text-accent" href="/account">
      <span
        aria-hidden="true"
        className={`size-1.5 rounded-full ${session.aiEnabled ? 'bg-good' : 'bg-brass'}`}
        title={session.aiEnabled ? 'พร้อมใช้ AI' : (session.aiBlockedReason ?? '')}
      />
      <span className="max-w-[18ch] truncate font-mono text-[12.5px]">{session.email}</span>
    </a>
  );
}
