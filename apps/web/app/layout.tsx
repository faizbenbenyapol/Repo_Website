import type { Metadata } from 'next';
import { VersionChip } from '../components/version-chip';
import './globals.css';

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
          href="https://fonts.googleapis.com/css2?family=Bai+Jamjuree:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans+Thai:wght@400;500;600&display=swap"
        />
      </head>
      <body className="min-h-screen">
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
            <a href="/" className="font-display text-lg font-semibold tracking-tight">
              RepoLens
            </a>
            <nav className="flex items-center gap-5 text-sm text-muted">
              <a className="transition-colors hover:text-accent" href="/versions">
                ประวัติเวอร์ชัน
              </a>
              <a
                className="transition-colors hover:text-accent"
                href="https://github.com/braedonsaunders/codeflow"
                rel="noreferrer noopener"
                target="_blank"
              >
                ต้นทางแนวคิด
              </a>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-6 pb-20">{children}</main>

        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-6 py-6">
            <p className="font-mono text-xs text-faint">repo.benyapol.com</p>
            <VersionChip />
          </div>
        </footer>
      </body>
    </html>
  );
}
