import { describe, expect, it } from 'vitest';
import { FEATURES, featuresForTier, isAvailable, TIER_INFO } from './tiers.js';
import { formatBuildLabel, readBuildInfo } from './build-info.js';

describe('ระดับการใช้งาน', () => {
  it('ผู้เยี่ยมชมเห็นเฉพาะฟีเจอร์เชิงโครงสร้าง', () => {
    const visitor = featuresForTier('visitor');
    expect(visitor.length).toBeGreaterThan(0);
    expect(visitor.every((f) => f.tier === 'visitor')).toBe(true);
    expect(visitor.some((f) => f.id === 'ask-repo')).toBe(false);
  });

  it('สมาชิกเห็นทุกฟีเจอร์', () => {
    expect(featuresForTier('member')).toHaveLength(FEATURES.length);
  });

  it('ฟีเจอร์ที่ยังไม่ปล่อยยังใช้ไม่ได้แม้เป็นสมาชิก', () => {
    expect(isAvailable('thai-report', 'member')).toBe(false);
    expect(isAvailable('ไม่มีอยู่จริง', 'member')).toBe(false);
  });

  it('ทุกระดับมีคำอธิบายว่าต้องทำอะไรถึงใช้ได้', () => {
    for (const info of Object.values(TIER_INFO)) {
      expect(info.requirement.length).toBeGreaterThan(0);
      expect(info.costBearer.length).toBeGreaterThan(0);
    }
  });

  it('ฟีเจอร์ทุกตัวมีรุ่นที่จะใช้ได้จริงกำกับ', () => {
    for (const feature of FEATURES) {
      expect(feature.since).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

describe('ข้อมูลรุ่นที่กำลังรัน', () => {
  it('ใช้ค่าเริ่มต้นเมื่อยังไม่ได้ฝังค่าตอน build', () => {
    const info = readBuildInfo({});
    expect(info.version).toBe('0.0.0-dev');
    expect(info.gitSha).toBe('dev');
    expect(info.builtAt).toBeNull();
  });

  it('ตัด git sha เหลือเจ็ดตัวและจัดข้อความป้ายได้', () => {
    const info = readBuildInfo({
      APP_VERSION: '0.1.0',
      GIT_SHA: 'a1b2c3d4e5f6',
      BUILT_AT: '2026-09-07T10:00:00Z',
    });
    expect(info.gitSha).toBe('a1b2c3d');
    expect(formatBuildLabel(info)).toBe('v0.1.0 · 2026-09-07 · a1b2c3d');
  });
});
