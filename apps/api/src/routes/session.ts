import type { FastifyInstance } from 'fastify';
import { verifyApiKey } from '@repolens/ai';
import { apiKeyBodySchema, FEATURES, featuresForTier, KEY_CHECK_MESSAGES } from '@repolens/shared';
import { describeSession, resolveViewer } from '../auth/session.js';
import { config } from '../config.js';
import type { Services } from '../services.js';

/**
 * สถานะการใช้งานปัจจุบัน และช่องใส่กุญแจของสมาชิก
 *
 * ทั้งหน้าบ้านและหลังบ้านอ่านตารางฟีเจอร์จาก @repolens/shared ตัวเดียวกัน
 * จึงไม่มีทางเกิดกรณีที่หน้าเว็บโชว์ปุ่มให้กดแล้ว API ปฏิเสธ
 */
export function sessionRoutes(services: Services) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get('/api/session', async (request) => {
      const viewer = await resolveViewer(services, request.headers.cookie);
      const session = await describeSession(services, viewer);

      return {
        session,
        features: FEATURES,
        availableNow: featuresForTier(session.tier).filter((f) => f.status === 'shipped'),
      };
    });

    /**
     * ผูกกุญแจกับ session ปัจจุบัน
     * ตรวจกับ Anthropic ก่อนรับเก็บ เพื่อให้ผู้ใช้รู้ตั้งแต่ตอนนี้ว่าพิมพ์ผิดหรือเปล่า
     * แทนที่จะไปรู้ตอนสั่งสรุปแล้วรอไปสองนาทีเพื่อได้ข้อความว่ากุญแจใช้ไม่ได้
     */
    app.put('/api/session/api-key', async (request, reply) => {
      const viewer = await resolveViewer(services, request.headers.cookie);
      if (!viewer) {
        return reply.status(401).send({ error: 'ต้องเข้าสู่ระบบก่อนจึงจะผูก API key ได้' });
      }

      const body = apiKeyBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply
          .status(400)
          .send({ error: body.error.issues[0]?.message ?? 'API key ไม่ถูกต้อง' });
      }

      const check = config.verifyApiKeys ? await verifyApiKey(body.data.apiKey) : 'unknown';
      if (check === 'invalid') {
        return reply.status(400).send({ error: KEY_CHECK_MESSAGES.invalid });
      }

      await services.keys.put(viewer.sessionId, body.data.apiKey, check);

      return {
        session: await describeSession(services, viewer),
        check,
        message: KEY_CHECK_MESSAGES[check],
      };
    });

    app.delete('/api/session/api-key', async (request, reply) => {
      const viewer = await resolveViewer(services, request.headers.cookie);
      if (!viewer) {
        return reply.status(401).send({ error: 'ต้องเข้าสู่ระบบก่อน' });
      }

      await services.keys.drop(viewer.sessionId);
      return { session: await describeSession(services, viewer) };
    });
  };
}
