import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { TIER_INFO } from '@repolens/shared';
import { ApiKeyForm } from '../../components/auth/api-key-form';
import { SignOutButton } from '../../components/auth/sign-out-button';
import { getSession } from '../api-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'ตั้งค่าบัญชี — RepoLens',
};

export default async function AccountPage() {
  const data = await getSession();
  if (!data?.session.signedIn) redirect('/login');

  const { session } = data;
  const info = TIER_INFO[session.tier];

  return (
    <div className="rise flex flex-col gap-6 pt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <p className="label">บัญชีของคุณ</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{session.email}</h1>
        </div>
        <SignOutButton />
      </div>

      <section className="panel p-6">
        <h2 className="text-lg font-semibold">ระดับการใช้งาน · {info.name}</h2>
        <p className="mt-1 text-sm text-muted">{info.summary}</p>
        <p
          className={`mt-3 border-l-2 pl-3 text-sm ${
            session.aiEnabled ? 'border-good text-good' : 'border-brass text-brass'
          }`}
        >
          {session.aiEnabled
            ? 'พร้อมใช้คำอธิบายด้วย AI แล้ว — เปิดหน้าแผนที่โค้ดของ repo ไหนก็ได้แล้วกดสั่งสรุป'
            : session.aiBlockedReason}
        </p>
      </section>

      <ApiKeyForm session={session} />
    </div>
  );
}
