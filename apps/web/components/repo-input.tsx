'use client';

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
  const [value, setValue] = useState('');
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  return (
    <form
      className="mt-8"
      onSubmit={(event) => {
        event.preventDefault();
        const ref = parseRepoRef(value);
        if (!ref) {
          setMessage({
            kind: 'error',
            text: 'อ่านที่อยู่นี้ไม่ออก ลองใส่แบบ facebook/react หรือลิงก์เต็มของ GitHub',
          });
          return;
        }
        setMessage({
          kind: 'info',
          text: `อ่าน ${ref.owner}/${ref.name} ได้แล้ว — ไปป์ไลน์วิเคราะห์จะเปิดใช้ในรุ่น v0.2.0`,
        });
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          aria-label="ที่อยู่ repo ที่ต้องการอ่าน"
          className="w-full rounded-[6px] border border-line bg-surface px-4 py-3 font-mono text-sm outline-none transition-colors placeholder:text-faint focus:border-accent"
          onChange={(event) => {
            setValue(event.target.value);
            setMessage(null);
          }}
          placeholder="facebook/react หรือ https://github.com/facebook/react"
          spellCheck={false}
          value={value}
        />
        <button
          className="shrink-0 rounded-[6px] border border-accent bg-accent px-6 py-3 text-sm font-medium text-white transition-transform duration-150 hover:-translate-y-px active:translate-y-0"
          type="submit"
        >
          อ่าน repo นี้
        </button>
      </div>

      {message ? (
        <p
          className={`rise mt-3 text-sm ${message.kind === 'error' ? 'text-brass' : 'text-muted'}`}
          role="status"
        >
          {message.text}
        </p>
      ) : (
        <p className="mt-3 text-sm text-faint">
          ไม่ต้องล็อกอินก็ใช้ได้ — จะขอ API key ก็ต่อเมื่อคุณอยากให้ AI อธิบายให้ฟังเท่านั้น
        </p>
      )}
    </form>
  );
}
