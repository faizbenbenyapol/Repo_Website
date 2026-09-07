import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { healthRoutes } from './routes/health.js';
import { sessionRoutes } from './routes/session.js';
import { versionRoutes } from './routes/version.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // กุญแจของผู้ใช้ต้องไม่มีทางหลุดลง log ไม่ว่าจะโดยตั้งใจหรือไม่
      redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
    },
  });

  await app.register(cors, { origin: false });
  await app.register(healthRoutes);
  await app.register(versionRoutes);
  await app.register(sessionRoutes);

  app.setNotFoundHandler(async (request, reply) =>
    reply.status(404).send({ error: `ไม่พบเส้นทาง ${request.method} ${request.url}` }),
  );

  return app;
}
