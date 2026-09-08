import type { Claim, ReadingPathStep } from '@repolens/shared';
import { READING_PATH_MODEL } from '@repolens/shared';
import {
  askClaude,
  isAuthError,
  type AskOptions,
  type AskReply,
  type AskRequest,
} from './anthropic.js';
import { extractJson, groundClaims, makeVerifier, type FileFact } from './grounding.js';
import {
  buildReadingPathPrompt,
  READING_PATH_SYSTEM_PROMPT,
  type ReadingStepInput,
} from './prompts.js';

/**
 * เส้นทางอ่านโค้ดสำหรับคนใหม่
 *
 * ลำดับไฟล์คำนวณจากกราฟความสัมพันธ์ล้วน ๆ ไม่ใช้โมเดลตัดสินว่าไฟล์ไหนมาก่อนหลัง
 * เพราะลำดับที่ "โมเดลรู้สึกว่าน่าจะใช่" เปลี่ยนไปมาได้ทุกครั้งที่เรียก แต่กราฟการพึ่งพาไม่เปลี่ยน
 * หน้าที่ของโมเดลมีแค่อธิบายว่าทำไมแต่ละขั้นถึงควรอ่านตอนนั้น — ไม่ใช่เลือกว่าจะอ่านไฟล์ไหน
 */

export interface DependencyEdge {
  from: string;
  to: string;
}

/**
 * เรียงไฟล์แบบ topological sort บนกราฟการนำเข้า — ไฟล์ที่ไม่พึ่งพาไฟล์ไหนในเซตนี้เลย (โค้ดพื้นฐาน)
 * มาก่อนเสมอ ไฟล์ที่พึ่งพาไฟล์อื่นมาก (มักเป็นจุดเริ่มโปรแกรม) มาทีหลัง
 * ไฟล์ที่อยู่ในวงจรพึ่งพากันเป็นวงไม่มีลำดับที่ถูกต้องแท้จริง จึงต่อท้ายเรียงตามพาธแทน
 */
export function topologicalReadingOrder(paths: string[], edges: DependencyEdge[]): string[] {
  const known = new Set(paths);
  const seenEdge = new Set<string>();
  const dependents = new Map<string, string[]>();
  const remaining = new Map<string, number>(paths.map((path) => [path, 0]));

  for (const edge of edges) {
    if (edge.from === edge.to || !known.has(edge.from) || !known.has(edge.to)) continue;
    const key = `${edge.from} ${edge.to}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);

    remaining.set(edge.from, (remaining.get(edge.from) ?? 0) + 1);
    const list = dependents.get(edge.to);
    if (list) list.push(edge.from);
    else dependents.set(edge.to, [edge.from]);
  }

  let queue = paths.filter((path) => (remaining.get(path) ?? 0) === 0).sort();
  const order: string[] = [];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const next: string[] = [];
    for (const current of queue) {
      if (seen.has(current)) continue;
      seen.add(current);
      order.push(current);

      for (const dependent of dependents.get(current) ?? []) {
        const left = (remaining.get(dependent) ?? 1) - 1;
        remaining.set(dependent, left);
        if (left === 0) next.push(dependent);
      }
    }
    queue = next.sort();
  }

  const leftover = paths.filter((path) => !seen.has(path)).sort();
  return [...order, ...leftover];
}

export interface ReadingCandidate {
  path: string;
  dependents: number;
  blast: number;
  churn: number;
  isEntrypoint: boolean;
}

function importance(candidate: ReadingCandidate | undefined): number {
  if (!candidate) return 0;
  return (
    candidate.dependents * 3 +
    candidate.blast +
    candidate.churn * 0.5 +
    (candidate.isEntrypoint ? 5 : 0)
  );
}

/**
 * เลือกไฟล์เด่นจากลำดับเต็ม โดยคงลำดับสัมพัทธ์เดิมไว้ — ส่วนย่อยของลำดับที่ถูกต้องแล้วยังถูกต้องอยู่
 * จึงไม่ต้องเรียงใหม่ จำนวนขั้นปรับตามขนาด repo แต่ไม่ต่ำกว่า min และไม่เกิน max ที่กำหนด
 */
export function selectReadingSteps(
  order: string[],
  candidates: Map<string, ReadingCandidate>,
  options: { min?: number; max?: number } = {},
): string[] {
  const min = options.min ?? 7;
  const max = options.max ?? 15;
  if (order.length <= min) return order;

  const target = Math.min(max, Math.max(min, Math.round(order.length / 12)));

  return order
    .map((path, index) => ({ path, index, score: importance(candidates.get(path)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, target)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.path);
}

export interface ReadingPathFile extends FileFact {
  language: string | null;
  dependents: number;
  dependencies: number;
  blast: number;
  churn: number;
  isEntrypoint: boolean;
}

export interface ReadingPathDeps {
  symbolsOf: (path: string) => Promise<{ name: string; kind: string; line: number }[]>;
  /** หัวเรื่องจากคำอธิบายที่สรุปไว้แล้วในชั้นความเข้าใจของ v0.5.0 ถ้ามี ช่วยให้อธิบายแม่นขึ้นโดยไม่ต้องอ่านซอร์สใหม่ */
  summaryOf?: (path: string) => Promise<string | null>;
  ask?: (request: AskRequest, options?: AskOptions) => Promise<AskReply>;
}

export interface BuildReadingPathOptions {
  apiKey: string;
  files: ReadingPathFile[];
  edges: DependencyEdge[];
  minSteps?: number;
  maxSteps?: number;
  askOptions?: AskOptions;
}

export interface BuildReadingPathResult {
  steps: ReadingPathStep[];
  model: string | null;
  inputTokens: number;
  outputTokens: number;
}

/** คำอธิบายสำรองเมื่อเรียกโมเดลไม่สำเร็จ — ตรวจย้อนกลับได้ร้อยเปอร์เซ็นต์เพราะมาจากตัวเลขที่วัดได้ตรง ๆ */
function describeWithoutModel(file: ReadingPathFile | undefined, path: string): Claim[] {
  if (!file) return [{ text: `ไฟล์ ${path}`, citations: [{ path, line: 1 }] }];
  if (file.isEntrypoint) {
    return [
      {
        text: `ไฟล์นี้มีลักษณะของจุดเริ่มโปรแกรม และเรียกใช้ไฟล์อื่น ${file.dependencies} ไฟล์`,
        citations: [{ path, line: 1 }],
      },
    ];
  }
  return [
    {
      text: `มี ${file.dependents} ไฟล์ที่พึ่งพาไฟล์นี้ การเข้าใจไฟล์นี้ก่อนจะทำให้อ่านไฟล์ถัดไปง่ายขึ้น`,
      citations: [{ path, line: 1 }],
    },
  ];
}

export async function buildReadingPath(
  options: BuildReadingPathOptions,
  deps: ReadingPathDeps,
): Promise<BuildReadingPathResult> {
  const paths = options.files.map((file) => file.path);
  const order = topologicalReadingOrder(
    paths,
    options.edges.filter((edge) => paths.includes(edge.from) && paths.includes(edge.to)),
  );

  const candidates = new Map(
    options.files.map((file) => [
      file.path,
      {
        path: file.path,
        dependents: file.dependents,
        blast: file.blast,
        churn: file.churn,
        isEntrypoint: file.isEntrypoint,
      },
    ]),
  );

  const selected = selectReadingSteps(order, candidates, {
    min: options.minSteps,
    max: options.maxSteps,
  });

  if (selected.length === 0) {
    return { steps: [], model: null, inputTokens: 0, outputTokens: 0 };
  }

  const byPath = new Map(options.files.map((file) => [file.path, file]));
  const verify = makeVerifier(options.files);
  const fallback: ReadingPathStep[] = selected.map((path, index) => ({
    path,
    order: index + 1,
    why: describeWithoutModel(byPath.get(path), path),
    lookFor: [],
  }));

  const stepInputs: ReadingStepInput[] = [];
  for (const path of selected) {
    const file = byPath.get(path);
    const symbols = await deps.symbolsOf(path).catch(() => []);
    const summary = deps.summaryOf ? await deps.summaryOf(path).catch(() => null) : null;
    stepInputs.push({
      path,
      language: file?.language ?? null,
      loc: file?.loc ?? 0,
      dependents: file?.dependents ?? 0,
      dependencies: file?.dependencies ?? 0,
      symbols,
      summary,
    });
  }

  const ask = deps.ask ?? askClaude;

  try {
    const reply = await ask(
      {
        apiKey: options.apiKey,
        model: READING_PATH_MODEL,
        system: READING_PATH_SYSTEM_PROMPT,
        maxTokens: 1600,
        prefill: '{',
        prompt: buildReadingPathPrompt(stepInputs),
      },
      options.askOptions,
    );

    const parsed = extractJson(reply.text) as { steps?: unknown } | null;
    const rawSteps = Array.isArray(parsed?.steps) ? parsed.steps : [];

    const steps: ReadingPathStep[] = selected.map((path, index) => {
      const raw = rawSteps[index] as { why?: unknown; lookFor?: unknown } | undefined;
      const why = raw ? groundClaims(raw.why, verify, path, 2) : [];
      const lookFor = raw ? groundClaims(raw.lookFor, verify, path, 2) : [];
      return {
        path,
        order: index + 1,
        why: why.length > 0 ? why : fallback[index]!.why,
        lookFor,
      };
    });

    return {
      steps,
      model: READING_PATH_MODEL,
      inputTokens: reply.inputTokens,
      outputTokens: reply.outputTokens,
    };
  } catch (error) {
    if (isAuthError(error)) throw error;
    return { steps: fallback, model: null, inputTokens: 0, outputTokens: 0 };
  }
}
