import cors from '@fastify/cors';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { analysisRoutes } from './routes/analyses.js';
import { authRoutes } from './routes/auth.js';
import { comprehensionRoutes } from './routes/comprehension.js';
import { healthRoutes } from './routes/health.js';
import { qaRoutes } from './routes/qa.js';
import { reportRoutes } from './routes/report.js';
import { sessionRoutes } from './routes/session.js';
import { versionRoutes } from './routes/version.js';
import type { Services } from './services.js';

export async function buildApp(services: Services): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // กุญแจของผู้ใช้ต้องไม่มีทางหลุดลง log ไม่ว่าจะโดยตั้งใจหรือไม่
      // คุกกี้อยู่ในรายการนี้ด้วยเพราะมันคือโทเค็นที่สวมรอยเป็นเจ้าของบัญชีได้ทันที
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
      ],
    },
  });

  await app.register(cors, { origin: false });
  await app.register(healthRoutes(services));
  await app.register(versionRoutes);
  await app.register(sessionRoutes(services));
  await app.register(authRoutes(services));
  await app.register(analysisRoutes(services));
  await app.register(comprehensionRoutes(services));
  await app.register(qaRoutes(services));
  await app.register(reportRoutes(services));

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
