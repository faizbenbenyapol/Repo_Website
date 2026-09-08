'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Mode = 'login' | 'register';

const COPY: Record<Mode, { title: string; action: string; switchTo: Mode; switchLabel: string }> = {
  login: {
    title: 'เข้าสู่ระบบ',
    action: 'เข้าสู่ระบบ',
    switchTo: 'register',
    switchLabel: 'ยังไม่มีบัญชี? สมัครใหม่',
  },
  register: {
    title: 'สมัครสมาชิก',
    action: 'สมัครสมาชิก',
    switchTo: 'login',
    switchLabel: 'มีบัญชีอยู่แล้ว? เข้าสู่ระบบ',
  },
};

/**
 * ฟอร์มเดียวทำได้ทั้งสมัครและเข้าสู่ระบบ
 * ข้อความผิดพลาดมาจาก API ตรง ๆ เพราะกติกาเรื่องรหัสผ่านถูกนิยามไว้ที่เดียวใน @repolens/shared
 * ถ้าหน้าเว็บเขียนข้อความเองจะกลายเป็นสองแหล่งที่พูดไม่ตรงกันทันทีที่กติกาเปลี่ยน
 */
export function AuthForm({ initialMode = 'login' }: { initialMode?: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const copy = COPY[mode];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง');
        return;
      }

      // รีเฟรชทั้งหน้าเพื่อให้ส่วนที่เรนเดอร์ฝั่งเซิร์ฟเวอร์เห็นสถานะใหม่ด้วย
      router.replace('/account');
      router.refresh();
    } catch {
      setError('ติดต่อเซิร์ฟเวอร์ไม่ได้ในขณะนี้');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel mt-6 flex max-w-md flex-col gap-4 p-6" onSubmit={submit}>
      <h2 className="text-xl font-semibold">{copy.title}</h2>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted">อีเมล</span>
        <input
          autoComplete="email"
          className="rounded-[6px] border border-line bg-surface px-3 py-2 font-mono text-[13px] outline-none transition-colors focus:border-accent"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-muted">รหัสผ่าน</span>
        <input
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          className="rounded-[6px] border border-line bg-surface px-3 py-2 font-mono text-[13px] outline-none transition-colors focus:border-accent"
          minLength={10}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
        {mode === 'register' ? (
          <span className="text-[12.5px] text-faint">
            อย่างน้อย 10 ตัวอักษร ยาวสำคัญกว่าซับซ้อน
          </span>
        ) : null}
      </label>

      {error ? (
        <p className="border-l-2 border-crit pl-3 text-sm text-crit" role="status">
          {error}
        </p>
      ) : null}

      <button
        className="rounded-[6px] bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-opacity duration-150 disabled:opacity-50"
        disabled={busy}
        type="submit"
      >
        {busy ? 'กำลังทำรายการ…' : copy.action}
      </button>

      <button
        className="self-start text-[13px] text-accent underline underline-offset-4"
        onClick={() => {
          setMode(copy.switchTo);
          setError(null);
        }}
        type="button"
      >
        {copy.switchLabel}
      </button>
    </form>
  );
}
