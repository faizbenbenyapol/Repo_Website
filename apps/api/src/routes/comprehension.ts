import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createComprehension,
  findLatestComprehension,
  getAnalysis,
  getComprehension,
  getComprehensionOwner,
  getFileSummary,
  getModuleSummaries,
  getRepoDigest,
  listFilesForSummary,
} from '@repolens/db';
import { comprehensionChannel, type ComprehensionProgress } from '@repolens/shared';
import { resolveViewer } from '../auth/session.js';
import { RateLimiter } from '../rate-limit.js';
import type { Services } from '../services.js';

const idParam = z.object({ id: z.string().uuid('รหัสไม่ถูกต้อง') });

/**
 * ชั้นความเข้าใจ — เส้นทางทั้งหมดในไฟล์นี้เปิดให้เฉพาะสมาชิกที่ผูกกุญแจของตัวเองไว้แล้ว
 *
 * ผลวิเคราะห์เชิงโครงสร้างใช้ร่วมกันได้ทุกคนเพราะมันเหมือนกันไม่ว่าใครสั่ง
 * แต่คำอธิบายจากโมเดลผูกกับคนที่จ่ายค่าเรียกใช้ จึงเห็นได้เฉพาะเจ้าของเท่านั้น
 */
export function comprehensionRoutes(services: Services) {
  // การสรุปหนึ่งรอบเรียกโมเดลหลายร้อยครั้งด้วยกุญแจของผู้ใช้ ยิงรัวได้แปลว่าเผาเงินเขาได้
  const limiter = new RateLimiter(
    Number(process.env.COMPREHENSION_RATE_LIMIT ?? 5),
    Number(process.env.COMPREHENSION_RATE_WINDOW_MS ?? 3_600_000),
  );

  return async function register(app: FastifyInstance): Promise<void> {
    app.post('/api/analyses/:id/comprehension', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'รหัสงานวิเคราะห์ไม่ถูกต้อง' });

      const viewer = await resolveViewer(services, request.headers.cookie);
      if (!viewer) {
        return reply.status(401).send({ error: 'ต้องเข้าสู่ระบบก่อนจึงจะสั่งสรุปด้วย AI ได้' });
      }

      const key = await services.keys.describe(viewer.sessionId);
      if (!key || key.check === 'invalid') {
        return reply
          .status(403)
          .send({ error: 'ยังไม่มี API key ที่ใช้ได้ผูกไว้ — ใส่กุญแจของคุณที่หน้าตั้งค่าก่อน' });
      }

      const analysis = await getAnalysis(services.sql, params.data.id);
      if (!analysis) return reply.status(404).send({ error: 'ไม่พบงานวิเคราะห์นี้' });
      if (analysis.status !== 'done') {
        return reply.status(409).send({ error: 'งานนี้ยังวิเคราะห์ไม่เสร็จ จึงยังสรุปไม่ได้' });
      }

      const existing = await findLatestComprehension(services.sql, analysis.id, viewer.userId);
      if (existing && (existing.status === 'queued' || existing.status === 'running')) {
        return reply.status(200).send({ comprehension: existing, started: false });
      }

      const gate = limiter.check(viewer.userId);
      if (!gate.allowed) {
        return reply
          .status(429)
          .header('retry-after', String(gate.retryAfterSeconds))
          .send({
            error: `สั่งสรุปถี่เกินไป ลองใหม่อีกครั้งใน ${Math.ceil(gate.retryAfterSeconds / 60)} นาที`,
          });
      }

      const files = await listFilesForSummary(services.sql, analysis.id);
      const id = await createComprehension(services.sql, {
        analysisId: analysis.id,
        userId: viewer.userId,
        filesTotal: files.length,
      });

      await services.comprehensionQueue.add('comprehend', {
        comprehensionId: id,
        analysisId: analysis.id,
        sessionId: viewer.sessionId,
      });

      return reply.status(202).send({
        comprehension: await getComprehension(services.sql, id),
        started: true,
      });
    });

    /** สถานะและผลของงานสรุปล่าสุดของผู้ใช้คนนี้กับงานวิเคราะห์นี้ */
    app.get('/api/analyses/:id/comprehension', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'รหัสงานวิเคราะห์ไม่ถูกต้อง' });

      const viewer = await resolveViewer(services, request.headers.cookie);
      if (!viewer) return { comprehension: null, digest: null, modules: [] };

      const comprehension = await findLatestComprehension(
        services.sql,
        params.data.id,
        viewer.userId,
      );

      if (!comprehension) return { comprehension: null, digest: null, modules: [] };

      const [digest, modules] = await Promise.all([
        getRepoDigest(services.sql, params.data.id, viewer.userId),
        getModuleSummaries(services.sql, params.data.id, viewer.userId),
      ]);

      return { comprehension, digest, modules };
    });

    /** คำอธิบายของไฟล์เดียว โหลดแยกเพราะแผงรายละเอียดเปิดทีละไฟล์อยู่แล้ว */
    app.get('/api/analyses/:id/files/summary', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'รหัสงานวิเคราะห์ไม่ถูกต้อง' });

      const query = z.object({ path: z.string().min(1).max(1000) }).safeParse(request.query ?? {});
      if (!query.success) return reply.status(400).send({ error: 'ต้องระบุพาธของไฟล์' });

      const viewer = await resolveViewer(services, request.headers.cookie);
      if (!viewer) return { summary: null };

      return {
        summary: await getFileSummary(services.sql, params.data.id, viewer.userId, query.data.path),
      };
    });

    /**
     * ติดตามความคืบหน้าของงานสรุปแบบสตรีม
     * ส่งสถานะปัจจุบันไปก่อนหนึ่งครั้งเสมอ เผื่อผู้ใช้เปิดหน้าหลังงานเริ่มไปแล้ว
     */
    app.get('/api/comprehensions/:id/stream', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'รหัสงานสรุปไม่ถูกต้อง' });

      const viewer = await resolveViewer(services, request.headers.cookie);
      const owner = await getComprehensionOwner(services.sql, params.data.id);
      if (!owner) return reply.status(404).send({ error: 'ไม่พบงานสรุปนี้' });
      if (!viewer || viewer.userId !== owner) {
        return reply.status(403).send({ error: 'งานสรุปนี้เป็นของผู้ใช้คนอื่น' });
      }

      const run = await getComprehension(services.sql, params.data.id);
      if (!run) return reply.status(404).send({ error: 'ไม่พบงานสรุปนี้' });

      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });

      const send = (payload: ComprehensionProgress): void => {
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      };

      send({
        comprehensionId: run.id,
        analysisId: run.analysisId,
        status: run.status,
        stage: run.stage,
        percent: run.percent,
        message: run.message ?? 'กำลังเตรียมงาน',
        filesDone: run.filesDone,
        filesTotal: run.filesTotal,
      });

      if (run.status === 'done' || run.status === 'failed') {
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

      await subscriber.subscribe(comprehensionChannel(run.id));
      subscriber.on('message', (_channel, raw) => {
        try {
          const payload = JSON.parse(raw) as ComprehensionProgress;
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
