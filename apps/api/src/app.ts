import cors from '@fastify/cors';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { analysisRoutes } from './routes/analyses.js';
import { healthRoutes } from './routes/health.js';
import { sessionRoutes } from './routes/session.js';
import { versionRoutes } from './routes/version.js';
import type { Services } from './services.js';

export async function buildApp(services: Services): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // กุญแจของผู้ใช้ต้องไม่มีทางหลุดลง log ไม่ว่าจะโดยตั้งใจหรือไม่
      redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
    },
  });

  await app.register(cors, { origin: false });
  await app.register(healthRoutes(services));
  await app.register(versionRoutes);
  await app.register(sessionRoutes);
  await app.register(analysisRoutes(services));

  app.setNotFoundHandler(async (request, reply) =>
    reply.status(404).send({ error: `ไม่พบเส้นทาง ${request.method} ${request.url}` }),
  );

  app.setErrorHandler(async (error: FastifyError, request, reply) => {
    request.log.error({ err: error }, 'คำขอล้มเหลว');
    return reply.status(error.statusCode ?? 500).send({
      error: error.statusCode && error.statusCode < 500 ? error.message : 'ระบบมีปัญหาชั่วคราว',
    });
  });

  return app;
}
