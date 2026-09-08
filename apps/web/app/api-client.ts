import { headers } from 'next/headers';
import type {
  BuildInfo,
  ComprehensionRun,
  Feature,
  ModuleSummary,
  QaMessage,
  ReadingPath,
  ReleaseNote,
  RepoDigest,
  SessionState,
} from '@repolens/shared';

const origin = process.env.API_ORIGIN ?? 'http://localhost:3001';

/**
 * ฝั่งเซิร์ฟเวอร์เรียก Fastify ตรง ๆ ผ่านชื่อ service ในเครือข่าย Docker
 * ถ้า API ล่ม หน้าเว็บต้องยังเปิดได้และบอกผู้ใช้ว่าอะไรพัง ไม่ใช่จอขาว
 */
async function get<T>(path: string, options: { withSession?: boolean } = {}): Promise<T | null> {
  try {
    // คุกกี้ของผู้ใช้ต้องถูกส่งต่อไปด้วย ไม่งั้น API จะมองว่าเป็นผู้เยี่ยมชมเสมอ
    // แม้คนที่เปิดหน้านั้นจะล็อกอินอยู่ก็ตาม
    const cookie = options.withSession ? ((await headers()).get('cookie') ?? '') : '';

    const res = await fetch(`${origin}${path}`, {
      cache: 'no-store',
      headers: cookie ? { cookie } : undefined,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function getBuildInfo(): Promise<BuildInfo | null> {
  return get<BuildInfo>('/api/version');
}

export function getReleases(): Promise<{ releases: ReleaseNote[] } | null> {
  return get<{ releases: ReleaseNote[] }>('/api/versions');
}

export function getSession(): Promise<{
  session: SessionState;
  features: Feature[];
} | null> {
  return get<{ session: SessionState; features: Feature[] }>('/api/session', { withSession: true });
}

export interface ComprehensionView {
  comprehension: ComprehensionRun | null;
  digest: RepoDigest | null;
  modules: ModuleSummary[];
}

export function getComprehension(analysisId: string): Promise<ComprehensionView | null> {
  return get<ComprehensionView>(`/api/analyses/${analysisId}/comprehension`, { withSession: true });
}

export function getQaHistory(analysisId: string): Promise<{ messages: QaMessage[] } | null> {
  return get<{ messages: QaMessage[] }>(`/api/analyses/${analysisId}/ask`, { withSession: true });
}

export function getReadingPath(analysisId: string): Promise<{ path: ReadingPath | null } | null> {
  return get<{ path: ReadingPath | null }>(`/api/analyses/${analysisId}/reading-path`, {
    withSession: true,
  });
}
