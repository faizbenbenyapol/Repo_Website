'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** ยอมรับทั้ง "owner/name", ลิงก์เต็ม และลิงก์ที่มี .git หรือ path ต่อท้าย */
export function parseRepoRef(input: string): { owner: string; name: string } | null {
  const text = input.trim();
  if (!text) return null;

  const cleaned = text
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '');

  const [owner, name] = cleaned.split('/');
  if (!owner || !name) return null;
  if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(name)) return null;

  return { owner, name };
}

export function RepoInput() {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!parseRepoRef(value)) {
      setError('อ่านที่อยู่นี้ไม่ออก ลองใส่แบบ facebook/react หรือลิงก์เต็มของ GitHub');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/analyses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: value.trim() }),
      });
      const body = (await response.json()) as { id?: string; error?: string };

      if (!response.ok || !body.id) {
        setError(body.error ?? 'สั่งวิเคราะห์ไม่สำเร็จ ลองใหม่อีกครั้ง');
        setBusy(false);
        return;
      }

      router.push(`/analyzing/${body.id}`);
    } catch {
      setError('ติดต่อเซิร์ฟเวอร์ไม่ได้ ลองใหม่อีกครั้ง');
      setBusy(false);
    }
  }

  return (
    <form className="mt-8" onSubmit={submit}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          aria-label="ที่อยู่ repo ที่ต้องการอ่าน"
          className="w-full rounded-[6px] border border-line bg-surface px-4 py-3 font-mono text-sm outline-none transition-colors placeholder:text-faint focus:border-accent"
          disabled={busy}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          placeholder="facebook/react หรือ https://github.com/facebook/react"
          spellCheck={false}
          value={value}
        />
        <button
          className="shrink-0 rounded-[6px] border border-accent bg-accent px-6 py-3 text-sm font-medium text-white transition-transform duration-150 hover:-translate-y-px active:translate-y-0 disabled:opacity-60"
          disabled={busy}
          type="submit"
        >
          {busy ? 'กำลังส่งงาน…' : 'อ่าน repo นี้'}
        </button>
      </div>

      {error ? (
        <p className="rise mt-3 text-sm text-brass" role="status">
          {error}
        </p>
      ) : (
        <p className="mt-3 text-sm text-faint">
          ไม่ต้องล็อกอินก็ใช้ได้ — จะขอ API key ก็ต่อเมื่อคุณอยากให้ AI อธิบายให้ฟังเท่านั้น
        </p>
      )}
    </form>
  );
}
