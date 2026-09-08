import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  getAnalysis,
  getFindings,
  getModuleSummaries,
  getReadingPath,
  getRepoDigest,
} from '@repolens/db';
import { renderReportMarkdown, reportFileSlug, type ReportData } from '@repolens/shared';
import { resolveViewer } from '../auth/session.js';
import type { Services } from '../services.js';

const idParam = z.object({ id: z.string().uuid('รหัสงานวิเคราะห์ไม่ถูกต้อง') });

/**
 * ส่งออกรายงานภาษาไทยเป็นไฟล์เดียว (v0.7.0)
 *
 * ต่างจาก GET /api/analyses/:id/export (v0.4.0, เปิดให้ทุกคน) ตรงที่รายงานนี้รวม
 * ชั้นความเข้าใจที่สมาชิกสั่งไว้ด้วย (สรุปภาพรวม, รายโมดูล, เส้นทางอ่านโค้ด) — ผูกกับผู้ใช้ที่จ่าย
 * ค่าเรียกใช้โมเดล จึงเปิดให้เฉพาะสมาชิกที่ล็อกอินอยู่ ไม่ต้องมี API key ที่ใช้ได้ในตอนนี้ก็ส่งออกได้
 * เพราะเป็นการอ่านผลที่มีอยู่แล้ว ไม่ได้เรียกโมเดลใหม่
 */
export function reportRoutes(services: Services) {
  return async function register(app: FastifyInstance): Promise<void> {
    app.get('/api/analyses/:id/export/report.md', async (request, reply) => {
      const params = idParam.safeParse(request.params);
      if (!params.success) return reply.status(400).send({ error: 'รหัสงานวิเคราะห์ไม่ถูกต้อง' });

      const viewer = await resolveViewer(services, request.headers.cookie);
      if (!viewer) {
        return reply.status(401).send({ error: 'ต้องเข้าสู่ระบบก่อนจึงจะส่งออกรายงานภาษาไทยได้' });
      }

      const analysis = await getAnalysis(services.sql, params.data.id);
      if (!analysis) return reply.status(404).send({ error: 'ไม่พบงานวิเคราะห์นี้' });
      if (analysis.status !== 'done') {
        return reply.status(409).send({ error: 'งานนี้ยังวิเคราะห์ไม่เสร็จ จึงยังส่งออกไม่ได้' });
      }

      const [findings, digest, modules, readingPath] = await Promise.all([
        getFindings(services.sql, analysis.id, 50),
        getRepoDigest(services.sql, analysis.id, viewer.userId),
        getModuleSummaries(services.sql, analysis.id, viewer.userId),
        getReadingPath(services.sql, analysis.id, viewer.userId),
      ]);

      const metrics = analysis.metrics;
      const data: ReportData = {
        repo: {
          host: analysis.host,
          owner: analysis.owner,
          name: analysis.name,
          branch: analysis.branch,
          commitSha: analysis.commitSha,
        },
        generatedAt: new Date().toISOString(),
        totals: {
          files: analysis.totals?.files ?? 0,
          parsedFiles: analysis.totals?.parsed ?? 0,
          loc: analysis.totals?.loc ?? 0,
          languages: analysis.totals?.languages ?? [],
        },
        health: metrics?.health ?? { score: 0, grade: 'F', breakdown: [] },
        cycles: (metrics?.cycles ?? []).map((cycle) => cycle.files),
        deadFiles: metrics?.deadFiles ?? [],
        hotspots: metrics?.hotspots ?? [],
        findings,
        external: analysis.external ?? [],
        digest,
        modules,
        readingSteps: readingPath?.steps ?? null,
      };

      const markdown = renderReportMarkdown(data);

      return reply
        .header('content-type', 'text/markdown; charset=utf-8')
        .header('content-disposition', `attachment; filename="${reportFileSlug(data.repo)}.md"`)
        .send(markdown);
    });
  };
}
