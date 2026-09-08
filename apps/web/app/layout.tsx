import type { Metadata } from 'next';
import { SessionNav } from '../components/session-nav';
import { VersionChip } from '../components/version-chip';
import './globals.css';

// แถบบนอ่านสถานะการล็อกอินจากคุกกี้ของคำขอ จึงเรนเดอร์ล่วงหน้าตอน build ไม่ได้
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'RepoLens — อ่านโค้ดทั้ง repo ให้เข้าใจ',
  description:
    'วางลิงก์ repo หนึ่งอัน แล้วได้แผนที่สถาปัตยกรรม กราฟความสัมพันธ์ และคำอธิบายภาษาไทยที่อ้างอิงถึงบรรทัดจริง',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="min-h-screen">
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-6">
            <a href="/" className="font-display text-lg font-bold tracking-tight">
              Repo<span className="text-accent">Lens</span>
            </a>
            <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted sm:gap-x-5">
              <a className="transition-colors hover:text-accent" href="/versions">
                ประวัติเวอร์ชัน
              </a>
              <SessionNav />
              <a
                className="hidden transition-colors hover:text-accent sm:inline"
                href="https://github.com/braedonsaunders/codeflow"
                rel="noreferrer noopener"
                target="_blank"
              >
                ต้นทางแนวคิด
              </a>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-6 pb-20">{children}</main>

        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6">
            <p className="font-mono text-xs text-faint">repo.benyapol.com</p>
            <VersionChip />
          </div>
        </footer>
      </body>
    </html>
  );
}
