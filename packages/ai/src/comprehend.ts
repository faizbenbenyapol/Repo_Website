import {
  COMPREHENSION_STAGE_LABELS,
  MODELS,
  type Citation,
  type Claim,
  type ComprehensionStage,
  type FileSummary,
  type ModuleSummary,
  type RepoDigest,
} from '@repolens/shared';
import {
  askClaude,
  ClaudeError,
  type AskOptions,
  type AskReply,
  type AskRequest,
} from './anthropic.js';
import { extractJson, groundClaims, makeVerifier, readHeadline } from './grounding.js';
import {
  buildFilePrompt,
  buildModulePrompt,
  buildRepoPrompt,
  FILE_SYSTEM_PROMPT,
  MODULE_SYSTEM_PROMPT,
  numberLines,
  REPO_SYSTEM_PROMPT,
} from './prompts.js';

/**
 * ชั้นความเข้าใจแบบ map-reduce: ไฟล์ → โมดูล → ทั้ง repo
 *
 * ข้อบังคับสองข้อที่กำหนดรูปร่างของไฟล์นี้
 * หนึ่ง — ไฟล์ทุกไฟล์ต้องมีคำอธิบาย ไม่ใช่เฉพาะไฟล์ที่โมเดลอ่านไหว
 *        ไฟล์ที่ไม่ได้ส่งให้โมเดลจึงได้คำอธิบายที่ระบบเขียนเองจากสิ่งที่วัดได้จริง และติดป้ายไว้ว่ามาจากไหน
 * สอง — ค่าเรียกใช้โมเดลตกกับผู้ใช้ทุกบาท จำนวนครั้งที่เรียกจึงต้องมีเพดานที่คาดเดาได้
 *        ไม่ใช่โตตามขนาด repo แบบไม่มีที่สิ้นสุด
 */

export interface FileRecord {
  path: string;
  language: string | null;
  loc: number;
  bytes: number;
  parsed: boolean;
  skipReason: string | null;
  dependents: number;
}

export interface ComprehendProgress {
  stage: ComprehensionStage;
  percent: number;
  message: string;
  filesDone: number;
  filesTotal: number;
}

export interface ComprehendDeps {
  /** อ่านไฟล์จากซอร์สที่โคลนมา คืน null เมื่ออ่านไม่ได้ */
  readFile: (path: string) => Promise<string | null>;
  symbolsOf: (path: string) => Promise<{ name: string; kind: string; line: number }[]>;
  neighboursOf: (path: string) => Promise<{ dependents: string[]; dependencies: string[] }>;
  ask?: (request: AskRequest, options?: AskOptions) => Promise<AskReply>;
}

export interface ComprehendOptions {
  apiKey: string;
  repo: { owner: string; name: string; branch: string; commitSha: string };
  files: FileRecord[];
  languages?: { name: string; files: number }[];
  external?: string[];
  entrypoints?: { path: string; line: number }[];
  /** เพดานจำนวนไฟล์ที่ส่งให้โมเดลอ่านจริง ที่เหลือระบบเขียนคำอธิบายเองจากข้อเท็จจริง */
  maxModelFiles?: number;
  maxModelModules?: number;
  maxSourceLines?: number;
  concurrency?: number;
  onProgress?: (progress: ComprehendProgress) => void;
  askOptions?: AskOptions;
  signal?: AbortSignal;
}

export interface ComprehendResult {
  files: FileSummary[];
  modules: ModuleSummary[];
  digest: RepoDigest;
  inputTokens: number;
  outputTokens: number;
  /** จำนวนไฟล์ที่โมเดลอ่านจริง ที่เหลือคือคำอธิบายที่ระบบเขียนเอง */
  modelFiles: number;
  warnings: string[];
}

const DEFAULTS = {
  maxModelFiles: 400,
  maxModelModules: 30,
  maxSourceLines: 600,
  maxSourceChars: 24_000,
  concurrency: 4,
};

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        const item = items[index];
        if (item === undefined) return;
        results[index] = await worker(item, index);
      }
    }),
  );

  return results;
}

/** โฟลเดอร์ของไฟล์ ใช้ '.' แทนไฟล์ที่อยู่ที่รากของ repo */
export function moduleOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '.' : path.slice(0, cut);
}

/** กุญแจที่ผิดคือเรื่องที่ลองใหม่กี่ครั้งก็ได้ผลเดิม ต้องหยุดทั้งงานทันทีแทนที่จะไล่เรียกจนครบทุกไฟล์ */
function isFatal(error: unknown): boolean {
  return error instanceof ClaudeError && (error.status === 401 || error.status === 403);
}

const KIND_LABELS: Record<string, string> = {
  function: 'ฟังก์ชัน',
  method: 'เมท็อด',
  class: 'คลาส',
  interface: 'อินเทอร์เฟซ',
  type: 'ชนิดข้อมูล',
};

/**
 * คำอธิบายที่ระบบเขียนเองจากสิ่งที่วัดได้
 * ไม่สวยเท่าที่โมเดลเขียน แต่ทุกคำตรวจย้อนกลับได้ร้อยเปอร์เซ็นต์เพราะไม่มีการตีความอะไรเลย
 */
export function describeWithoutModel(
  file: FileRecord,
  symbols: { name: string; kind: string; line: number }[],
): FileSummary {
  if (file.skipReason) {
    return {
      path: file.path,
      headline: `ไม่ได้อ่านเนื้อหาไฟล์นี้ — ${file.skipReason}`,
      points: [
        {
          text: `ไฟล์ขนาด ${file.bytes.toLocaleString('th-TH')} ไบต์ และมี ${file.dependents} ไฟล์ที่อ้างถึง`,
          citations: [{ path: file.path, line: 1 }],
        },
      ],
      source: 'analyzer',
      model: null,
    };
  }

  const declared = symbols.slice(0, 3).map((symbol) => ({
    text: `ประกาศ${KIND_LABELS[symbol.kind] ?? symbol.kind} ${symbol.name}`,
    citations: [{ path: file.path, line: symbol.line }],
  }));

  const headline =
    symbols.length > 0
      ? `ไฟล์ ${file.language ?? 'ไม่ทราบภาษา'} ${file.loc} บรรทัด ประกาศ ${symbols.length} อย่าง`
      : `ไฟล์ ${file.language ?? 'ไม่ทราบภาษา'} ${file.loc} บรรทัด`;

  return {
    path: file.path,
    headline,
    points:
      declared.length > 0
        ? declared
        : [
            {
              text: `ไฟล์นี้มี ${file.loc} บรรทัด และมี ${file.dependents} ไฟล์ที่เรียกใช้`,
              citations: [{ path: file.path, line: 1 }],
            },
          ],
    source: 'analyzer',
    model: null,
  };
}

/** ไฟล์ที่ส่งให้โมเดลอ่านได้ ต้องอ่านเป็นข้อความได้และมีเนื้อหาให้อ่าน */
export function isReadable(file: FileRecord): boolean {
  return file.skipReason === null && file.loc > 0 && file.bytes > 0;
}

interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * เดินไปป์ไลน์ความเข้าใจทั้งสามชั้น
 * รายงานความคืบหน้าออกไปทุกช่วง เพราะงานนี้กินเวลาเป็นนาที ไม่ใช่วินาที
 */
export async function comprehendRepo(
  options: ComprehendOptions,
  deps: ComprehendDeps,
): Promise<ComprehendResult> {
  const ask = deps.ask ?? askClaude;
  const askOptions = { ...options.askOptions, signal: options.signal };
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const warnings: string[] = [];
  const verify = makeVerifier(options.files);
  const total = options.files.length;

  const maxModelFiles = options.maxModelFiles ?? DEFAULTS.maxModelFiles;
  const report = (
    stage: ComprehensionStage,
    percent: number,
    filesDone: number,
    message = COMPREHENSION_STAGE_LABELS[stage],
  ): void => {
    options.onProgress?.({ stage, percent, message, filesDone, filesTotal: total });
  };

  // ── ชั้นที่หนึ่ง: ไฟล์ ────────────────────────────────
  // เรียงตามจำนวนไฟล์ที่พึ่งพา เพราะถ้าเพดานไม่พอสำหรับทั้ง repo
  // ไฟล์ที่คนอื่นพึ่งพามากที่สุดคือไฟล์ที่คุ้มที่สุดที่จะให้โมเดลอ่าน
  const readable = options.files.filter(isReadable);
  const forModel = new Set(
    [...readable]
      .sort((a, b) => b.dependents - a.dependents || a.path.localeCompare(b.path))
      .slice(0, maxModelFiles)
      .map((file) => file.path),
  );

  if (readable.length > forModel.size) {
    warnings.push(
      `repo นี้มีไฟล์ที่อ่านได้ ${readable.length} ไฟล์ เกินเพดาน ${maxModelFiles} ไฟล์ต่อหนึ่งรอบ ` +
        'ไฟล์ที่เหลือได้คำอธิบายที่ระบบเขียนเองจากโครงสร้างแทน',
    );
  }

  report('files', 10, 0);
  let done = 0;
  let modelFiles = 0;
  let fatal: unknown = null;

  const files = await mapWithLimit(
    options.files,
    options.concurrency ?? DEFAULTS.concurrency,
    async (file): Promise<FileSummary> => {
      const symbols = await deps.symbolsOf(file.path).catch(() => []);
      const finish = (summary: FileSummary): FileSummary => {
        done += 1;
        if (done % 5 === 0 || done === total) {
          report('files', 10 + Math.round((done / Math.max(total, 1)) * 65), done);
        }
        return summary;
      };

      if (fatal !== null || !forModel.has(file.path)) {
        return finish(describeWithoutModel(file, symbols));
      }

      const source = await deps.readFile(file.path).catch(() => null);
      if (source === null) return finish(describeWithoutModel(file, symbols));

      try {
        const neighbours = await deps.neighboursOf(file.path).catch(() => ({
          dependents: [],
          dependencies: [],
        }));

        const reply = await ask(
          {
            apiKey: options.apiKey,
            model: MODELS.file,
            system: FILE_SYSTEM_PROMPT,
            maxTokens: 700,
            prefill: '{',
            prompt: buildFilePrompt({
              path: file.path,
              language: file.language,
              source: numberLines(
                source,
                options.maxSourceLines ?? DEFAULTS.maxSourceLines,
                DEFAULTS.maxSourceChars,
              ),
              symbols,
              dependents: neighbours.dependents,
              dependencies: neighbours.dependencies,
            }),
          },
          askOptions,
        );

        usage.inputTokens += reply.inputTokens;
        usage.outputTokens += reply.outputTokens;

        const parsed = extractJson(reply.text) as { headline?: unknown; points?: unknown } | null;
        if (!parsed) return finish(describeWithoutModel(file, symbols));

        const points = groundClaims(parsed.points, verify, file.path, 4);
        const fallback = describeWithoutModel(file, symbols);
        modelFiles += 1;

        return finish({
          path: file.path,
          headline: readHeadline(parsed.headline, fallback.headline),
          // ข้อที่อ้างอิงไม่ผ่านถูกตัดไปแล้ว ถ้าไม่เหลือเลยให้ใช้ข้อเท็จจริงที่ระบบยืนยันเองแทน
          points: points.length > 0 ? points : fallback.points,
          source: 'model',
          model: MODELS.file,
        });
      } catch (error) {
        if (isFatal(error)) fatal = error;
        else if (warnings.length < 5) {
          warnings.push(
            `สรุป ${file.path} ด้วยโมเดลไม่สำเร็จ (${error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ'}) จึงใช้คำอธิบายจากโครงสร้างแทน`,
          );
        }
        return finish(describeWithoutModel(file, symbols));
      }
    },
  );

  if (fatal !== null) throw fatal;

  // ── ชั้นที่สอง: โมดูล ─────────────────────────────────
  report('modules', 76, done);

  const grouped = new Map<string, FileSummary[]>();
  for (const summary of files) {
    const key = moduleOf(summary.path);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(summary);
    else grouped.set(key, [summary]);
  }

  const anchorOf = (summary: FileSummary): Citation =>
    summary.points[0]?.citations[0] ?? { path: summary.path, line: 1 };

  const describeModuleWithoutModel = (path: string, members: FileSummary[]): ModuleSummary => ({
    path,
    headline: `โฟลเดอร์นี้มี ${members.length} ไฟล์`,
    points: members.slice(0, 3).map((member) => ({
      text: `${member.path} — ${member.headline}`,
      citations: [anchorOf(member)],
    })),
    fileCount: members.length,
    source: 'analyzer',
    model: null,
  });

  const moduleEntries = [...grouped.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );
  const modelModules = new Set(
    moduleEntries.slice(0, options.maxModelModules ?? DEFAULTS.maxModelModules).map(([key]) => key),
  );

  const modules = await mapWithLimit(
    moduleEntries,
    options.concurrency ?? DEFAULTS.concurrency,
    async ([path, members]): Promise<ModuleSummary> => {
      if (!modelModules.has(path)) return describeModuleWithoutModel(path, members);

      try {
        const reply = await ask(
          {
            apiKey: options.apiKey,
            model: MODELS.module,
            system: MODULE_SYSTEM_PROMPT,
            maxTokens: 700,
            prefill: '{',
            prompt: buildModulePrompt({
              path,
              files: members.map((member) => ({
                path: member.path,
                headline: member.headline,
                anchor: anchorOf(member).line,
              })),
            }),
          },
          askOptions,
        );

        usage.inputTokens += reply.inputTokens;
        usage.outputTokens += reply.outputTokens;

        const parsed = extractJson(reply.text) as { headline?: unknown; points?: unknown } | null;
        const fallback = describeModuleWithoutModel(path, members);
        if (!parsed) return fallback;

        const points = groundClaims(parsed.points, verify, null, 4);
        return {
          path,
          headline: readHeadline(parsed.headline, fallback.headline),
          points: points.length > 0 ? points : fallback.points,
          fileCount: members.length,
          source: 'model',
          model: MODELS.module,
        };
      } catch (error) {
        if (isFatal(error)) throw error;
        return describeModuleWithoutModel(path, members);
      }
    },
  );

  modules.sort((a, b) => a.path.localeCompare(b.path));

  // ── ชั้นที่สาม: ทั้ง repo ─────────────────────────────
  report('repo', 89, done);

  const readmeFile = options.files.find((file) => /^readme(\.[a-z]+)?$/i.test(file.path));
  const readmeSource = readmeFile ? await deps.readFile(readmeFile.path).catch(() => null) : null;

  const digestFallback: RepoDigest = {
    headline: `${options.repo.owner}/${options.repo.name} — ${options.files.length} ไฟล์ในสาขา ${options.repo.branch}`,
    purpose: [],
    stack: [],
    entrypoints: (options.entrypoints ?? []).slice(0, 4).map((entry) => ({
      text: `${entry.path} เป็นไฟล์ที่มีลักษณะของจุดเริ่มโปรแกรม`,
      citations: [entry],
    })),
    howToRun: [],
    notes: [],
    model: null,
  };

  let digest = digestFallback;

  try {
    const reply = await ask(
      {
        apiKey: options.apiKey,
        model: MODELS.repo,
        system: REPO_SYSTEM_PROMPT,
        maxTokens: 2000,
        prefill: '{',
        prompt: buildRepoPrompt({
          owner: options.repo.owner,
          name: options.repo.name,
          branch: options.repo.branch,
          totals: {
            files: options.files.length,
            loc: options.files.reduce((sum, file) => sum + file.loc, 0),
          },
          languages: options.languages ?? [],
          modules: modules
            .slice()
            .sort((a, b) => b.fileCount - a.fileCount)
            .slice(0, 40)
            .map((module) => ({
              path: module.path,
              headline: module.headline,
              anchor: module.points[0]?.citations[0] ?? { path: module.path, line: 1 },
            })),
          entrypoints: options.entrypoints ?? [],
          external: options.external ?? [],
          readme: readmeSource ? numberLines(readmeSource, 120, 6000) : null,
          readmePath: readmeSource ? (readmeFile?.path ?? null) : null,
        }),
      },
      askOptions,
    );

    usage.inputTokens += reply.inputTokens;
    usage.outputTokens += reply.outputTokens;

    const parsed = extractJson(reply.text) as Record<string, unknown> | null;
    if (parsed) {
      const section = (key: string): Claim[] => groundClaims(parsed[key], verify, null, 4);
      const entrypoints = section('entrypoints');

      digest = {
        headline: readHeadline(parsed.headline, digestFallback.headline),
        purpose: section('purpose'),
        stack: section('stack'),
        entrypoints: entrypoints.length > 0 ? entrypoints : digestFallback.entrypoints,
        howToRun: section('howToRun'),
        notes: section('notes'),
        model: MODELS.repo,
      };
    }
  } catch (error) {
    if (isFatal(error)) throw error;
    warnings.push(
      `สรุปภาพรวมทั้ง repo ไม่สำเร็จ (${error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ'}) จึงเหลือเฉพาะสิ่งที่ยืนยันได้จากโครงสร้าง`,
    );
  }

  report('publish', 97, done);

  return {
    files,
    modules,
    digest,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    modelFiles,
    warnings,
  };
}
