import type { FastifyInstance } from 'fastify';

const startedAt = Date.now();

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => ({
    ok: true,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
  }));
}
