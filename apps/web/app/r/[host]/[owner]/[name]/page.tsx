import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'เปิด repo — RepoLens',
};

const origin = process.env.API_ORIGIN ?? 'http://localhost:3001';

/**
 * ลิงก์ถาวรของ repo หนึ่งตัว — จำง่ายกว่ารหัสงานวิเคราะห์ที่เป็น UUID และใช้ซ้ำได้ตลอดไป
 *
 * เปิดหน้านี้แล้วจะได้ผลวิเคราะห์ล่าสุดที่มีอยู่ทันที หรือถ้ายังไม่เคยวิเคราะห์มาก่อน
 * ก็สั่งวิเคราะห์ใหม่ให้เอง — เบื้องหลังเรียก POST /api/analyses ตัวเดียวกับที่หน้าแรกใช้
 * ซึ่งดูแคชตาม repo ให้อยู่แล้ว จึงไม่มีทางวิเคราะห์ซ้ำโดยไม่จำเป็น
 */
export default async function PermalinkPage({
  params,
}: {
  params: Promise<{ host: string; owner: string; name: string }>;
}) {
  const { host, owner, name } = await params;

  const input =
    host.toLowerCase() === 'github.com' ? `${owner}/${name}` : `https://${host}/${owner}/${name}`;

  let body: { id?: string; error?: string } | null = null;
  try {
    const response = await fetch(`${origin}/api/analyses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input }),
      cache: 'no-store',
    });
    body = (await response.json()) as { id?: string; error?: string };
    if (!response.ok || !body.id) throw new Error(body.error ?? 'สั่งวิเคราะห์ไม่สำเร็จ');
  } catch (error) {
    return (
      <div className="rise pt-20">
        <h1 className="text-3xl font-bold tracking-tight">เปิด repo นี้ไม่สำเร็จ</h1>
        <p className="mt-4 max-w-[60ch] text-muted">
          {body?.error ??
            (error instanceof Error ? error.message : 'ติดต่อเซิร์ฟเวอร์ไม่ได้ในขณะนี้')}
        </p>
        <a className="mt-6 inline-block text-accent underline underline-offset-4" href="/">
          กลับไปหน้าแรก
        </a>
      </div>
    );
  }

  // หน้ากำลังวิเคราะห์เชื่อมต่อความคืบหน้าจริงอยู่แล้ว และพาไปหน้าผลลัพธ์เองทันทีที่เสร็จ
  // จึงพาไปที่นั่นเสมอไม่ว่าผลจะเป็นของเดิมที่วิเคราะห์เสร็จแล้วหรือเพิ่งเข้าคิว
  redirect(`/analyzing/${body.id}`);
}
