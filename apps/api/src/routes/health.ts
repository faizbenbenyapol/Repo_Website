import type { FastifyInstance } from 'fastify';
import type { Services } from '../services.js';

const startedAt = Date.now();

/**
 * healthcheck ต้องแตะฐานข้อมูลจริง ไม่ใช่ตอบ ok ลอย ๆ
 * ไม่งั้น compose จะคิดว่าบริการพร้อมทั้งที่ยังต่อฐานข้อมูลไม่ได้
 */
export function healthRoutes(services: Services) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get('/api/health', async (_request, reply) => {
      let database = 'up';
      try {
        await services.sql`select 1`;
      } catch {
        database = 'down';
      }

      const ok = database === 'up';
      return reply.status(ok ? 200 : 503).send({
        ok,
        database,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      });
    });
  };
}
