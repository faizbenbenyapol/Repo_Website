import type { BuildInfo, ReleaseNote, SessionState, Feature } from '@repolens/shared';

const origin = process.env.API_ORIGIN ?? 'http://localhost:3001';

/**
 * ฝั่งเซิร์ฟเวอร์เรียก Fastify ตรง ๆ ผ่านชื่อ service ในเครือข่าย Docker
 * ถ้า API ล่ม หน้าเว็บต้องยังเปิดได้และบอกผู้ใช้ว่าอะไรพัง ไม่ใช่จอขาว
 */
async function get<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${origin}${path}`, { cache: 'no-store' });
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
  return get<{ session: SessionState; features: Feature[] }>('/api/session');
}
