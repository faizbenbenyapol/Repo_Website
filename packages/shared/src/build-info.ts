import { z } from 'zod';

/**
 * เลขสคีมาของผลวิเคราะห์ แยกจากเวอร์ชันแอปโดยตั้งใจ
 * เปลี่ยนเลขนี้เมื่อผลวิเคราะห์ที่แคชไว้รูปแบบเดิมใช้ต่อไม่ได้ — ซึ่งแปลว่าต้องล้างแคชทั้งหมด
 */
export const ANALYZER_SCHEMA = 1;

export const buildInfoSchema = z.object({
  version: z.string(),
  gitSha: z.string(),
  builtAt: z.string().nullable(),
  analyzerSchema: z.number().int().positive(),
});

export type BuildInfo = z.infer<typeof buildInfoSchema>;

/** อ่านข้อมูลรุ่นจากตัวแปรสภาพแวดล้อมที่ฝังตอน build อิมเมจ */
export function readBuildInfo(env: Record<string, string | undefined>): BuildInfo {
  const sha = env.GIT_SHA?.trim();
  return {
    version: env.APP_VERSION?.trim() || '0.0.0-dev',
    gitSha: sha ? sha.slice(0, 7) : 'dev',
    builtAt: env.BUILT_AT?.trim() || null,
    analyzerSchema: ANALYZER_SCHEMA,
  };
}

/** ข้อความสั้นสำหรับป้ายมุมล่าง เช่น "v0.1.0 · 2026-09-07 · a1b2c3d" */
export function formatBuildLabel(info: BuildInfo): string {
  const parts = [`v${info.version}`];
  if (info.builtAt) parts.push(info.builtAt.slice(0, 10));
  parts.push(info.gitSha);
  return parts.join(' · ');
}
