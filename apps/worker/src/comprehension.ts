import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Job } from 'bullmq';
import { comprehendRepo } from '@repolens/ai';
import { cloneRepo, isEntrypoint, parseRepoRef } from '@repolens/analyzer';
import {
  countFileSummaries,
  finishComprehension,
  getAnalysis,
  getComprehension,
  getComprehensionOwner,
  getNeighbours,
  getSymbols,
  listFilesForSummary,
  markComprehensionFailed,
  saveSummaries,
  updateComprehensionProgress,
  type SummaryInput,
} from '@repolens/db';
import {
  comprehensionChannel,
  type ComprehensionJob,
  type ComprehensionProgress,
  type ComprehensionStage,
} from '@repolens/shared';
import { KeyStore } from '@repolens/shared/node';
import { cache, log, publish, sql } from './runtime.js';

/**
 * งานสรุปเป็นภาษาไทย — ผูกกับผู้ใช้ที่เป็นเจ้าของกุญแจ ไม่ใช่ผลที่ใช้ร่วมกันได้
 *
 * งานนี้ต้องกลับไปอ่านซอร์สอีกรอบ เพราะโฟลเดอร์ที่โคลนมาตอนวิเคราะห์ถูกลบทิ้งไปแล้ว
 * การเก็บซอร์สของทุก repo ไว้รอเผื่อมีคนสั่งสรุปนั้นแพงกว่าการโคลนใหม่เมื่อถึงเวลาใช้จริงมาก
 */

const MAX_SOURCE_BYTES = 400 * 1024;

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ยังไม่ได้ตั้ง SESSION_SECRET — worker ถอดกุญแจของสมาชิกไม่ได้');
  }
  return 'repolens-dev-secret-ห้ามใช้บนเซิร์ฟเวอร์จริง';
}

export async function handleComprehension(job: Job<ComprehensionJob>): Promise<void> {
  const { comprehensionId, analysisId, sessionId } = job.data;
  const started = Date.now();
  log('รับงานสรุป', { comprehensionId, analysisId });

  const run = await getComprehension(sql, comprehensionId);
  const userId = await getComprehensionOwner(sql, comprehensionId);
  if (!run || !userId) {
    log('ไม่พบงานสรุปในฐานข้อมูล จึงข้ามไป', { comprehensionId });
    return;
  }

  const announce = (
    progress: Omit<ComprehensionProgress, 'comprehensionId' | 'analysisId'>,
  ): void => {
    void publish(comprehensionChannel(comprehensionId), {
      comprehensionId,
      analysisId,
      ...progress,
    }).catch(() => {});
  };

  const step = (
    stage: ComprehensionStage,
    percent: number,
    message: string,
    filesDone = 0,
    filesTotal = run.filesTotal,
  ): void => {
    void updateComprehensionProgress(sql, comprehensionId, {
      stage,
      percent,
      message,
      filesDone,
    }).catch(() => {});
    announce({ status: 'running', stage, percent, message, filesDone, filesTotal });
  };

  let cleanup: (() => Promise<void>) | null = null;

  try {
    step('prepare', 2, 'เตรียมงานสรุป');

    const keys = new KeyStore(cache, sessionSecret());
    const stored = await keys.get(sessionId);
    if (!stored) {
      throw new Error(
        'กุญแจที่ผูกไว้หมดอายุหรือถูกถอดออกแล้ว — ใส่ API key ใหม่แล้วสั่งสรุปอีกครั้ง',
      );
    }

    const analysis = await getAnalysis(sql, analysisId);
    if (!analysis) throw new Error('ไม่พบงานวิเคราะห์ที่จะสรุป');

    const parsed = parseRepoRef(analysis.requestedInput, {
      allowLocal: process.env.ALLOW_LOCAL_REPOS === '1',
    });
    if (!parsed.ok) throw new Error(parsed.error);

    step('fetch', 6, 'ดึงซอร์สโค้ดของคอมมิตนี้');
    const clone = await cloneRepo(parsed.ref, {
      depth: 1,
      checkout: analysis.commitSha ?? undefined,
      timeoutMs: Number(process.env.CLONE_TIMEOUT_MS ?? 180_000),
    });
    cleanup = clone.cleanup;

    const files = await listFilesForSummary(sql, analysisId);
    // ทำดัชนีไว้ก่อน เพราะตัวอ่านไฟล์ถูกเรียกครั้งหนึ่งต่อไฟล์
    // ถ้าไล่หาในอาร์เรย์ทุกครั้ง repo ที่มีไฟล์เป็นหมื่นจะกลายเป็นงานยกกำลังสอง
    const byPath = new Map(files.map((file) => [file.path, file]));
    const result = await comprehendRepo(
      {
        apiKey: stored.apiKey,
        repo: {
          owner: analysis.owner,
          name: analysis.name,
          branch: analysis.branch ?? clone.branch,
          commitSha: clone.commitSha,
        },
        files,
        languages: (analysis.totals?.languages ?? []).map((entry) => ({
          name: entry.language,
          files: entry.files,
        })),
        external: (analysis.external ?? []).map((entry) => entry.specifier),
        entrypoints: files
          .filter((file) => isEntrypoint(file.path) && file.loc > 0)
          .slice(0, 12)
          .map((file) => ({ path: file.path, line: 1 })),
        maxModelFiles: Number(process.env.COMPREHEND_MAX_FILES ?? 400),
        concurrency: Number(process.env.COMPREHEND_CONCURRENCY ?? 4),
        onProgress: (progress) => {
          void updateComprehensionProgress(sql, comprehensionId, {
            stage: progress.stage,
            percent: progress.percent,
            message: progress.message,
            filesDone: progress.filesDone,
            commitSha: clone.commitSha,
          }).catch(() => {});
          announce({
            status: 'running',
            stage: progress.stage,
            percent: progress.percent,
            message: progress.message,
            filesDone: progress.filesDone,
            filesTotal: progress.filesTotal,
          });
        },
      },
      {
        readFile: async (path) => {
          const file = byPath.get(path);
          if (file && file.bytes > MAX_SOURCE_BYTES) return null;
          return readFile(join(clone.dir, path), 'utf8').catch(() => null);
        },
        symbolsOf: (path) => getSymbols(sql, analysisId, path),
        neighboursOf: (path) => getNeighbours(sql, analysisId, path),
      },
    );

    const rows: SummaryInput[] = [
      ...result.files.map((summary) => ({
        scope: 'file' as const,
        key: summary.path,
        headline: summary.headline,
        points: summary.points,
        source: summary.source,
        model: summary.model,
      })),
      ...result.modules.map((summary) => ({
        scope: 'module' as const,
        key: summary.path,
        headline: summary.headline,
        points: summary.points,
        detail: { fileCount: summary.fileCount },
        source: summary.source,
        model: summary.model,
      })),
      {
        scope: 'repo' as const,
        key: '',
        headline: result.digest.headline,
        points: result.digest.purpose,
        detail: {
          purpose: result.digest.purpose,
          stack: result.digest.stack,
          entrypoints: result.digest.entrypoints,
          howToRun: result.digest.howToRun,
          notes: result.digest.notes,
        },
        source: result.digest.model ? ('model' as const) : ('analyzer' as const),
        model: result.digest.model,
      },
    ];

    await saveSummaries(sql, { comprehensionId, analysisId, userId }, rows);

    const covered = await countFileSummaries(sql, comprehensionId);
    await finishComprehension(sql, comprehensionId, {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      filesDone: covered,
    });

    announce({
      status: 'done',
      stage: 'publish',
      percent: 100,
      message: 'สรุปเสร็จแล้ว',
      filesDone: covered,
      filesTotal: run.filesTotal,
    });

    log('สรุปสำเร็จ', {
      comprehensionId,
      files: covered,
      modelFiles: result.modelFiles,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      warnings: result.warnings.length,
      ms: Date.now() - started,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'สรุปไม่สำเร็จ';
    await markComprehensionFailed(sql, comprehensionId, message);
    announce({
      status: 'failed',
      stage: null,
      percent: 100,
      message,
      filesDone: 0,
      filesTotal: run.filesTotal,
    });
    log('สรุปล้มเหลว', { comprehensionId, error: message });
  } finally {
    if (cleanup) await cleanup().catch(() => {});
  }
}
