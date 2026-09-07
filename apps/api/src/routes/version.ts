import type { FastifyInstance } from 'fastify';
import { loadReleaseNotes } from '@repolens/shared/node';
import { config } from '../config.js';

export async function versionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/version', async () => config.buildInfo);

  app.get('/api/versions', async (_request, reply) => {
    try {
      return { releases: await loadReleaseNotes(config.changelogDir) };
    } catch (error) {
      app.log.error({ err: error }, 'อ่านบันทึกรุ่นไม่สำเร็จ');
      return reply.status(500).send({ error: 'อ่านบันทึกรุ่นไม่สำเร็จ' });
    }
  });

  app.get<{ Params: { version: string } }>('/api/versions/:version', async (request, reply) => {
    const wanted = request.params.version.replace(/^v/, '');
    const releases = await loadReleaseNotes(config.changelogDir);
    const release = releases.find((item) => item.version === wanted);
    if (!release) {
      return reply.status(404).send({ error: `ไม่พบบันทึกรุ่น v${wanted}` });
    }
    return release;
  });
}
