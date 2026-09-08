import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isEntrypoint } from '@repolens/analyzer';
import { answerQuestion, buildReadingPath, ClaudeError, summarizeAnswer } from '@repolens/ai';
import {
  getAnalysis,
  getEdges,
  getFiles,
  getFileSummary,
  getReadingPath,
  getRepoDigest,
  getSymbols,
  listFilesForSummary,
  listQaMessages,
  recentQaMessages,
  saveQaMessage,
  saveReadingPath,
  searchEvidence,
} from '@repolens/db';
import { resolveViewer } from '../auth/session.js';
import { RateLimiter } from '../rate-limit.js';
import type { Services } from '../services.js';

const idParam = z.object({ id: z.string().uuid('รหัสงานวิเคราะห์ไม่ถูกต้อง') });
const askBody = z.object({
  question: z.string().min(1, 'ยังไม่ได้ใส่คำถาม').max(500, 'คำถามยาวเกินไป'),
});

/** แปลงข้อผิดพลาดจากการเรียกโมเดลเป็นรหัสสถานะที่สื่อความหมาย — กุญแจผิดคือความผิดของผู้ใช้ ไม่ใช่ของเรา */
function statusFor(error: unknown): number {
  if (error instanceof ClaudeError) return error.status >= 400 && error.status < 500 ? 400 : 502;
  return 502;
}

/**
 * ถาม–ตอบกับ repo และเส้นทางอ่านโค้ดสำหรับคนใหม่ (v0.6.0)
 *
 * เปิดให้เฉพาะสมาชิกที่ผูกกุญแจของตัวเองไว้แล้ว เช่นเดียวกับชั้นความเข้าใจของ v0.5.0
 * เพราะทั้งสองฟีเจอร์เรียกใช้โมเดลด้วยกุญแจของผู้ใช้เอง ต่างจากงานสรุปตรงที่ทำงานเสร็จในคำขอเดียว
 * ไม่ต้องเข้าคิวเบื้องหลัง เพราะเรียกโมเดลแค่ครั้งเดียวต่อคำถามหรือต่อการสร้างเส้นทางหนึ่งชุด
 */
export function qaRoutes(services: Services) {
  // คำถามหนึ่งข้อเรียกโมเดลครั้งเดียวและเบากว่างานสรุปมาก จึงให้โควตาต่อชั่วโมงสูงกว่า
  const askLimiter = new RateLimiter(
    Number(process.env.ASK_RATE_LIMIT ?? 20),
    Number(process.env.ASK_RATE_WINDOW_MS ?? 3_600_000),
  );
  // สร้างเส้นทางอ่านโค้ดหนึ่งครั้งเรียกโมเดลครั้งเดียวเหมือนกัน แต่ผลไม่ค่อยเปลี่ยนถ้าไม่ได้แก้ repo
  // จึงไม่มีเหตุผลให้สั่งซ้ำถี่ ๆ
  const readingPathLimiter = new RateLimiter(
    Number(process.env.READING_PATH_RATE_LIMIT ?? 5),
    Number(process.env.READING_PATH_RATE_WINDOW_MS ?? 3_600_000),
  );

  return async function register(app: FastifyInstance): Promise<void> {
    app.post('/api/analyses/:id/ask', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'รหัสงานวิเคราะห์ไม่ถูกต้อง' });

      const body = askBody.safeParse(request.body);
      if (!body.success) {
        return reply
          .status(400)
          .send({ error: body.error.issues[0]?.message ?? 'คำถามไม่ถูกต้อง' });
      }

      const viewer = await resolveViewer(services, request.headers.cookie);
      if (!viewer) return reply.status(401).send({ error: 'ต้องเข้าสู่ระบบก่อนจึงจะถามคำถามได้' });

      const key = await services.keys.get(viewer.sessionId);
      if (!key || key.check === 'invalid') {
        return reply
          .status(403)
          .send({ error: 'ยังไม่มี API key ที่ใช้ได้ผูกไว้ — ใส่กุญแจของคุณที่หน้าตั้งค่าก่อน' });
      }

      const analysis = await getAnalysis(services.sql, params.data.id);
      if (!analysis) return reply.status(404).send({ error: 'ไม่พบงานวิเคราะห์นี้' });
      if (analysis.status !== 'done') {
        return reply.status(409).send({ error: 'งานนี้ยังวิเคราะห์ไม่เสร็จ จึงยังถามไม่ได้' });
      }

      const gate = askLimiter.check(viewer.userId);
      if (!gate.allowed) {
        return reply
          .status(429)
          .header('retry-after', String(gate.retryAfterSeconds))
          .send({
            error: `ถามถี่เกินไป ลองใหม่อีกครั้งใน ${Math.ceil(gate.retryAfterSeconds / 60)} นาที`,
          });
      }

      const [evidence, files, digest, history] = await Promise.all([
        searchEvidence(services.sql, analysis.id, viewer.userId, body.data.question),
        getFiles(services.sql, analysis.id, { limit: 5000 }),
        getRepoDigest(services.sql, analysis.id, viewer.userId),
        recentQaMessages(services.sql, analysis.id, viewer.userId),
      ]);

      try {
        const result = await answerQuestion({
          apiKey: key.apiKey,
          question: body.data.question,
          evidence: evidence.map((item) => ({ path: item.path, line: item.line, text: item.text })),
          history: history.map((message) => ({
            question: message.question,
            answer: summarizeAnswer(message.claims),
          })),
          digest: digest?.headline ?? null,
          files: files.map((file) => ({ path: file.path, loc: file.loc })),
        });

        const saved = await saveQaMessage(services.sql, {
          analysisId: analysis.id,
          userId: viewer.userId,
          question: body.data.question,
          claims: result.claims,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        });

        return reply.status(201).send({ message: saved });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'ถามคำถามไม่สำเร็จ';
        return reply.status(statusFor(error)).send({ error: message });
      }
    });

    /** ประวัติบทสนทนาของผู้ใช้คนนี้กับงานวิเคราะห์นี้ ผู้เยี่ยมชมเห็นเป็นรายการว่างเสมอ */
    app.get('/api/analyses/:id/ask', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'รหัสงานวิเคราะห์ไม่ถูกต้อง' });

      const viewer = await resolveViewer(services, request.headers.cookie);
      if (!viewer) return { messages: [] };

      return { messages: await listQaMessages(services.sql, params.data.id, viewer.userId) };
    });

    app.post('/api/analyses/:id/reading-path', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'รหัสงานวิเคราะห์ไม่ถูกต้อง' });

      const viewer = await resolveViewer(services, request.headers.cookie);
      if (!viewer)
        return reply.status(401).send({ error: 'ต้องเข้าสู่ระบบก่อนจึงจะสร้างเส้นทางอ่านโค้ดได้' });

      const key = await services.keys.get(viewer.sessionId);
      if (!key || key.check === 'invalid') {
        return reply
          .status(403)
          .send({ error: 'ยังไม่มี API key ที่ใช้ได้ผูกไว้ — ใส่กุญแจของคุณที่หน้าตั้งค่าก่อน' });
      }

      const analysis = await getAnalysis(services.sql, params.data.id);
      if (!analysis) return reply.status(404).send({ error: 'ไม่พบงานวิเคราะห์นี้' });
      if (analysis.status !== 'done') {
        return reply
          .status(409)
          .send({ error: 'งานนี้ยังวิเคราะห์ไม่เสร็จ จึงยังสร้างเส้นทางอ่านโค้ดไม่ได้' });
      }

      const gate = readingPathLimiter.check(viewer.userId);
      if (!gate.allowed) {
        return reply
          .status(429)
          .header('retry-after', String(gate.retryAfterSeconds))
          .send({
            error: `สั่งสร้างถี่เกินไป ลองใหม่อีกครั้งใน ${Math.ceil(gate.retryAfterSeconds / 60)} นาที`,
          });
      }

      const [fileRows, edgeRows] = await Promise.all([
        listFilesForSummary(services.sql, analysis.id),
        getEdges(services.sql, analysis.id, 20_000),
      ]);

      // out-degree ต่อไฟล์ (จำนวนไฟล์ที่ตัวมันเองเรียกใช้) — files table เก็บแค่ in-degree (dependents) ไว้แล้ว
      const dependencies = new Map<string, number>();
      for (const edge of edgeRows)
        dependencies.set(edge.src, (dependencies.get(edge.src) ?? 0) + 1);

      const readingFiles = fileRows
        .filter((file) => file.skipReason === null && file.loc > 0)
        .map((file) => ({
          path: file.path,
          loc: file.loc,
          language: file.language,
          dependents: file.dependents,
          dependencies: dependencies.get(file.path) ?? 0,
          blast: file.blast,
          churn: file.churn,
          isEntrypoint: isEntrypoint(file.path),
        }));

      try {
        const result = await buildReadingPath(
          {
            apiKey: key.apiKey,
            files: readingFiles,
            edges: edgeRows.map((edge) => ({ from: edge.src, to: edge.dst })),
          },
          {
            symbolsOf: (path) => getSymbols(services.sql, analysis.id, path),
            summaryOf: async (path) => {
              const summary = await getFileSummary(services.sql, analysis.id, viewer.userId, path);
              return summary?.headline ?? null;
            },
          },
        );

        await saveReadingPath(services.sql, {
          analysisId: analysis.id,
          userId: viewer.userId,
          steps: result.steps,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        });

        return reply.status(201).send({
          path: { steps: result.steps, model: result.model, createdAt: new Date().toISOString() },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'สร้างเส้นทางอ่านโค้ดไม่สำเร็จ';
        return reply.status(statusFor(error)).send({ error: message });
      }
    });

    /** เส้นทางอ่านโค้ดชุดล่าสุดที่เคยสร้างไว้ ผู้เยี่ยมชมเห็นเป็น null เสมอ */
    app.get('/api/analyses/:id/reading-path', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'รหัสงานวิเคราะห์ไม่ถูกต้อง' });

      const viewer = await resolveViewer(services, request.headers.cookie);
      if (!viewer) return { path: null };

      return { path: await getReadingPath(services.sql, params.data.id, viewer.userId) };
    });
  };
}
