import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '../../components/auth/auth-form';
import { getSession } from '../api-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'เข้าสู่ระบบ — RepoLens',
};

export default async function LoginPage() {
  const data = await getSession();
  if (data?.session.signedIn) redirect('/account');

  return (
    <div className="rise pt-16">
      <p className="label">สำหรับสมาชิก</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">เข้าสู่ระบบเพื่อเปิดชั้นคำอธิบาย</h1>
      <p className="mt-4 max-w-[62ch] text-muted">
        ผลวิเคราะห์เชิงโครงสร้างทั้งหมด — กราฟ ตัวชี้วัด จุดร้อน สแกนความปลอดภัย —
        เปิดให้ทุกคนอยู่แล้วโดยไม่ต้องล็อกอิน ส่วนคำอธิบายภาษาไทยต้องใช้ API key ของคุณเอง
        จึงต้องมีบัญชีไว้ผูกกุญแจกับตัวตน
      </p>

      <AuthForm />
    </div>
  );
}
