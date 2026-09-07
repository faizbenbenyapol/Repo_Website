import type { FastifyInstance } from 'fastify';
import { ANONYMOUS_SESSION, FEATURES, featuresForTier } from '@repolens/shared';

/**
 * รุ่นนี้ยังไม่มีระบบล็อกอินจริง (มาพร้อมชั้นความเข้าใจใน v0.5.0)
 * เส้นทางนี้จึงรายงานสถานะผู้เยี่ยมชมเสมอ แต่รูปแบบข้อมูลเป็นตัวจริงที่หน้าบ้านจะใช้ต่อไป
 */
export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/session', async () => ({
    session: ANONYMOUS_SESSION,
    features: FEATURES,
    availableNow: featuresForTier(ANONYMOUS_SESSION.tier).filter((f) => f.status === 'shipped'),
  }));
}
