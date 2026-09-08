import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ANALYZER_SCHEMA, progressChannel, type ProgressMessage } from '@repolens/shared';
import { parseRepoRef } from '@repolens/analyzer';
import {
  countSymbols,
  createAnalysis,
  findCachedAnalysis,
  getAnalysis,
  getEdges,
  getFiles,
  getFileInsight,
  getFindings,
  getGraph,
  getNeighbours,
  getRankedFiles,
  getSymbols,
} from '@repolens/db';
import { config } from '../config.js';
import { RateLimiter } from '../rate-limit.js';
import type { Services } from '../services.js';

const createBody = z.object({
  input: z.string().min(1, 'ยังไม่ได้ใส่ที่อยู่ repo').max(400),
  /** ขอวิเคราะห์ใหม่แม้จะมีผลเดิมอยู่แล้ว */
  refresh: z.boolean().optional(),
});

const idParam = z.object({ id: z.string().uuid('รหัสงานวิเคราะห์ไม่ถูกต้อง') });

export function analysisRoutes(services: Services) {
  // การโคลน repo กินทรัพยากรจริง จึงเปิดให้ยิงรัวจากที่อยู่เดียวไม่ได้
  const limiter = new RateLimiter(
    Number(process.env.ANALYSIS_RATE_LIMIT ?? 10),
    Number(process.env.ANALYSIS_RATE_WINDOW_MS ?? 60_000),
  );

  return async function register(app: FastifyInstance): Promise<void> {
    app.post('/api/analyses', async (request, reply) => {
      const body = createBody.safeParse(request.body);
      if (!body.success) {
        return reply
          .status(400)
          .send({ error: body.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' });
      }

      const parsed = parseRepoRef(body.data.input, { allowLocal: config.allowLocalRepos });
      if (!parsed.ok) return reply.status(400).send({ error: parsed.error });

      // ดูแคชก่อนหักโควตา เพราะโควตานี้มีไว้กันการโคลนซ้ำ ๆ ไม่ใช่กันการอ่านผลที่มีอยู่แล้ว
      // คำขอที่จบลงด้วยการคืนผลเดิมไม่ได้ทำให้เครื่องทำงานหนักขึ้นเลย จึงไม่ควรกินโควตาของใคร
      if (!body.data.refresh) {
        const cached = await findCachedAnalysis(services.sql, parsed.ref, ANALYZER_SCHEMA);
        if (cached) {
          return reply.status(200).send({ id: cached.id, cached: true, status: cached.status });
        }
      }

      const gate = limiter.check(request.ip);
      if (!gate.allowed) {
        return reply
          .status(429)
          .header('retry-after', String(gate.retryAfterSeconds))
          .send({
            error: `สั่งวิเคราะห์ถี่เกินไป ลองใหม่อีกครั้งใน ${gate.retryAfterSeconds} วินาที`,
          });
      }

      const id = await createAnalysis(services.sql, {
        ref: parsed.ref,
        requestedInput: body.data.input,
        analyzerSchema: ANALYZER_SCHEMA,
        appVersion: config.buildInfo.version,
      });

      await services.queue.add('analyze', { analysisId: id, input: body.data.input });

      return reply.status(202).send({ id, cached: false, status: 'queued' });
    });

    app.get('/api/analyses/:id', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'รหัสงานวิเคราะห์ไม่ถูกต้อง' });

      const analysis = await getAnalysis(services.sql, params.data.id);
      if (!analysis) return reply.status(404).send({ error: 'ไม่พบงานวิเคราะห์นี้' });

      const symbols =
        analysis.status === 'done' ? await countSymbols(services.sql, analysis.id) : 0;
      return { analysis, symbolCount: symbols };
    });

    app.get('/api/analyses/:id/files', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'รหัสงานวิเคราะห์ไม่ถูกต้อง' });

      const query = z
        .object({
          order: z.enum(['path', 'dependents']).optional(),
          limit: z.coerce.number().int().positive().max(5000).optional(),
        })
        .parse(request.query ?? {});

      const files = await getFiles(services.sql, params.data.id, {
        orderBy: query.order ?? 'path',
        limit: query.limit,
      });

      return { files };
    });

    app.get('/api/analyses/:id/graph', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'รหัสงานวิเคราะห์ไม่ถูกต้อง' });

      const query = z
        .object({ limit: z.coerce.number().int().positive().max(20_000).optional() })
        .parse(request.query ?? {});

      return getGraph(services.sql, params.data.id, query.limit);
    });

    app.get('/api/analyses/:id/files/detail', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'รหัสงานวิเคราะห์ไม่ถูกต้อง' });

      const query = z.object({ path: z.string().min(1).max(1000) }).safeParse(request.query ?? {});
      if (!query.success) return reply.status(400).send({ error: 'ต้องระบุพาธของไฟล์' });

      const [symbols, neighbours, insight] = await Promise.all([
        getSymbols(services.sql, params.data.id, query.data.path),
        getNeighbours(services.sql, params.data.id, query.data.path),
        getFileInsight(services.sql, params.data.id, query.data.path),
      ]);

      return {
        path: query.data.path,
        symbols,
        ...neighbours,
        churn: insight?.churn ?? 0,
        blast: insight?.blast ?? 0,
        authors: insight?.authors ?? [],
      };
    });

    app.get('/api/analyses/:id/findings', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'รหัสงานวิเคราะห์ไม่ถูกต้อง' });
      return { findings: await getFindings(services.sql, params.data.id) };
    });

    app.get('/api/analyses/:id/ranked', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'รหัสงานวิเคราะห์ไม่ถูกต้อง' });

      const query = z
        .object({
          by: z.enum(['churn', 'blast', 'dependents']).default('dependents'),
          limit: z.coerce.number().int().positive().max(200).optional(),
        })
        .parse(request.query ?? {});

      return { files: await getRankedFiles(services.sql, params.data.id, query.by, query.limit) };
    });

    /**
     * ส่งออกผลวิเคราะห์ทั้งชุดเป็นไฟล์เดียว
     * ให้เอาไปต่อยอดในเครื่องมืออื่นหรือใน CI ของผู้ใช้เองได้ โดยไม่ต้องยิงหลายเส้นทางมาประกอบเอง
     */
    app.get('/api/analyses/:id/export', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'รหัสงานวิเคราะห์ไม่ถูกต้อง' });

      const analysis = await getAnalysis(services.sql, params.data.id);
      if (!analysis) return reply.status(404).send({ error: 'ไม่พบงานวิเคราะห์นี้' });
      if (analysis.status !== 'done') {
        return reply.status(409).send({ error: 'งานนี้ยังวิเคราะห์ไม่เสร็จ จึงยังส่งออกไม่ได้' });
      }

      const [files, edges, findings] = await Promise.all([
        getFiles(services.sql, params.data.id, { limit: 5000 }),
        getEdges(services.sql, params.data.id),
        getFindings(services.sql, params.data.id, 500),
      ]);

      return reply
        .header(
          'content-disposition',
          `attachment; filename="repolens-${analysis.owner}-${analysis.name}-${analysis.commitSha?.slice(0, 7)}.json"`,
        )
        .send({
          schema: ANALYZER_SCHEMA,
          exportedAt: new Date().toISOString(),
          repo: {
            host: analysis.host,
            owner: analysis.owner,
            name: analysis.name,
            branch: analysis.branch,
            commitSha: analysis.commitSha,
          },
          totals: analysis.totals,
          metrics: analysis.metrics,
          external: analysis.external,
          files,
          edges,
          findings,
        });
    });

    app.get('/api/analyses/:id/edges', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'รหัสงานวิเคราะห์ไม่ถูกต้อง' });
      return { edges: await getEdges(services.sql, params.data.id) };
    });

    /**
     * ส่งความคืบหน้าแบบสตรีม
     * ส่งสถานะปัจจุบันไปก่อนหนึ่งครั้งเสมอ เผื่อผู้ใช้เปิดหน้าหลังงานเริ่มไปแล้ว
     * จะได้ไม่เห็นหน้าจอว่างเปล่าจนกว่าจะมีเหตุการณ์ถัดไป
     */
    app.get('/api/analyses/:id/stream', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'รหัสงานวิเคราะห์ไม่ถูกต้อง' });

      const analysis = await getAnalysis(services.sql, params.data.id);
      if (!analysis) return reply.status(404).send({ error: 'ไม่พบงานวิเคราะห์นี้' });

      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });

      const send = (payload: ProgressMessage): void => {
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      send({
        analysisId: analysis.id,
        status: analysis.status,
        stage: analysis.stage,
        percent: analysis.percent,
        message: analysis.message ?? 'กำลังเตรียมงาน',
      });

      if (analysis.status === 'done' || analysis.status === 'failed') {
        reply.raw.end();
        return reply;
      }

      const subscriber = services.createSubscriber();
      const heartbeat = setInterval(() => reply.raw.write(': ยังอยู่\n\n'), 15_000);

      const close = (): void => {
        clearInterval(heartbeat);
        void subscriber.quit().catch(() => {});
        reply.raw.end();
      };

      await subscriber.subscribe(progressChannel(analysis.id));
      subscriber.on('message', (_channel, raw) => {
        try {
          const payload = JSON.parse(raw) as ProgressMessage;
          send(payload);
          if (payload.status === 'done' || payload.status === 'failed') close();
        } catch {
          // ข้อความที่อ่านไม่ออกไม่ควรทำให้การเชื่อมต่อของผู้ใช้ขาด
        }
      });

      request.raw.on('close', close);
      return reply;
    });
  };
}
