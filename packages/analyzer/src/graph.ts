import type { ImportKind, RawImport } from './parse/types.js';
import { RESOLUTION_EXTENSIONS } from './languages.js';

export interface Edge {
  from: string;
  to: string;
  kind: ImportKind;
  line: number;
  /** ความมั่นใจว่าเส้นนี้ถูกต้อง — ต่ำกว่า 1 คือเดาจากกติกาของภาษา */
  confidence: number;
}

export interface ExternalDependency {
  specifier: string;
  count: number;
}

export interface FileExternalUsage {
  path: string;
  specifier: string;
  count: number;
}

export interface GraphResult {
  edges: Edge[];
  external: ExternalDependency[];
  unresolved: number;
  /**
   * แพ็กเกจภายนอกที่แต่ละไฟล์เรียกใช้ แยกไว้ต่างหากจากสรุปรวม `external`
   * เพื่อให้การวิเคราะห์ซ้ำแบบ incremental ของ v0.7.0 คืนค่านับของไฟล์ที่ไม่เปลี่ยนได้
   * โดยไม่ต้องพาร์สไฟล์นั้นใหม่ — ไม่งั้นสรุปรวมจะขาดหายไปตามไฟล์ที่ถูกข้ามการพาร์ส
   */
  externalByFile: FileExternalUsage[];
}

export interface GraphInput {
  files: { path: string; language: string | null }[];
  imports: Map<string, RawImport[]>;
  /** ชื่อโมดูลจาก go.mod ถ้ามี ใช้แปลงเส้นทาง import ของ Go ให้เป็นไฟล์ในโปรเจกต์ */
  goModule?: string | null;
  /**
   * เส้นและการใช้แพ็กเกจภายนอกที่นำมาจากไฟล์ที่ไม่ถูกพาร์สใหม่ในรอบวิเคราะห์นี้
   * (เนื้อหาไม่เปลี่ยนจากรอบก่อน — v0.7.0) กรองตาม `known` ให้อีกชั้นก่อนใช้จริง
   * เผื่อไฟล์ปลายทางถูกลบไปแล้วในรอบนี้
   */
  reused?: {
    edges: Edge[];
    externalByFile: FileExternalUsage[];
  };
}

function normalize(path: string): string {
  const parts: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}

function directoryOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at === -1 ? '' : path.slice(0, at);
}

export function buildGraph(input: GraphInput): GraphResult {
  const known = new Set(input.files.map((file) => file.path));
  const byDirectory = new Map<string, string[]>();
  const byBasename = new Map<string, string[]>();
  const externalByFile = new Map<string, Map<string, number>>();

  for (const file of input.files) {
    const dir = directoryOf(file.path);
    byDirectory.set(dir, [...(byDirectory.get(dir) ?? []), file.path]);
    const base = file.path.slice(file.path.lastIndexOf('/') + 1);
    byBasename.set(base, [...(byBasename.get(base) ?? []), file.path]);
  }

  const edges: Edge[] = [];
  const external = new Map<string, number>();
  let unresolved = 0;
  const seen = new Set<string>();

  const push = (from: string, to: string, kind: ImportKind, line: number, confidence: number) => {
    if (from === to) return;
    const key = `${from} ${to} ${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, kind, line, confidence });
  };

  const candidatesFor = (
    base: string,
    language: string | null,
  ): { path: string; confidence: number }[] => {
    const out: { path: string; confidence: number }[] = [{ path: base, confidence: 1 }];
    const extensions = RESOLUTION_EXTENSIONS[language ?? ''] ?? [];
    for (const extension of extensions) out.push({ path: `${base}${extension}`, confidence: 0.9 });
    for (const extension of extensions) {
      out.push({ path: `${base}/index${extension}`, confidence: 0.85 });
      out.push({ path: `${base}/__init__${extension}`, confidence: 0.85 });
      out.push({ path: `${base}/mod${extension}`, confidence: 0.8 });
    }
    return out;
  };

  for (const file of input.files) {
    const rawImports = input.imports.get(file.path) ?? [];
    const dir = directoryOf(file.path);

    for (const raw of rawImports) {
      const specifier = raw.specifier.trim();
      if (!specifier) continue;

      let resolved = false;

      const tryCandidates = (base: string, penalty = 0): boolean => {
        for (const candidate of candidatesFor(normalize(base), file.language)) {
          if (known.has(candidate.path)) {
            push(file.path, candidate.path, raw.kind, raw.line, candidate.confidence - penalty);
            return true;
          }
        }
        return false;
      };

      const dotted = specifier.split('.').join('/');

      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        resolved = tryCandidates(`${dir}/${specifier}`);
      } else if (file.language === 'python' && specifier.startsWith('.')) {
        // การนำเข้าแบบสัมพัทธ์ของ Python: จุดแรกคือโฟลเดอร์ตัวเอง จุดถัดไปคือถอยขึ้นหนึ่งชั้น
        const dots = /^\.+/.exec(specifier)?.[0].length ?? 1;
        const rest = specifier.slice(dots).split('.').join('/');
        const up = '../'.repeat(dots - 1);
        resolved = tryCandidates(`${dir}/${up}${rest}`);
      } else if (file.language === 'python') {
        resolved = tryCandidates(dotted) || tryCandidates(`src/${dotted}`, 0.2);
      } else if (specifier.startsWith('@/') || specifier.startsWith('~/')) {
        const rest = specifier.slice(2);
        resolved =
          tryCandidates(rest, 0.3) ||
          tryCandidates(`src/${rest}`, 0.3) ||
          tryCandidates(`app/${rest}`, 0.35);
      } else if (input.goModule && specifier.startsWith(`${input.goModule}/`)) {
        const target = specifier.slice(input.goModule.length + 1);
        const inDirectory = byDirectory.get(normalize(target)) ?? [];
        for (const path of inDirectory.filter((item) => item.endsWith('.go'))) {
          push(file.path, path, raw.kind, raw.line, 0.9);
          resolved = true;
        }
      } else if (raw.kind === 'include') {
        const base = specifier.slice(specifier.lastIndexOf('/') + 1);
        const matches = byBasename.get(base) ?? [];
        if (matches.length === 1 && matches[0]) {
          push(file.path, matches[0], raw.kind, raw.line, 0.5);
          resolved = true;
        }
      }

      if (!resolved) {
        if (specifier.startsWith('.') || specifier.startsWith('/')) {
          unresolved += 1;
        } else {
          external.set(specifier, (external.get(specifier) ?? 0) + 1);
          const perFile = externalByFile.get(file.path) ?? new Map<string, number>();
          perFile.set(specifier, (perFile.get(specifier) ?? 0) + 1);
          externalByFile.set(file.path, perFile);
        }
      }
    }
  }

  // ไฟล์ที่ไม่ถูกพาร์สใหม่รอบนี้ (เนื้อหาไม่เปลี่ยน) ยังต้องมีเส้นและยอดแพ็กเกจภายนอกของตัวเอง
  // กรองเส้นที่ปลายทางถูกลบไปแล้วในรอบนี้ทิ้ง เพื่อไม่ให้มีเส้นลอยไปหาไฟล์ที่ไม่มีอยู่จริง
  for (const edge of input.reused?.edges ?? []) {
    if (known.has(edge.from) && known.has(edge.to))
      push(edge.from, edge.to, edge.kind, edge.line, edge.confidence);
  }
  for (const usage of input.reused?.externalByFile ?? []) {
    if (!known.has(usage.path)) continue;
    external.set(usage.specifier, (external.get(usage.specifier) ?? 0) + usage.count);
    const perFile = externalByFile.get(usage.path) ?? new Map<string, number>();
    perFile.set(usage.specifier, (perFile.get(usage.specifier) ?? 0) + usage.count);
    externalByFile.set(usage.path, perFile);
  }

  const externalList = [...external.entries()]
    .map(([specifier, count]) => ({ specifier, count }))
    .sort((a, b) => b.count - a.count || a.specifier.localeCompare(b.specifier));

  const externalByFileList: FileExternalUsage[] = [];
  for (const [path, specifiers] of externalByFile) {
    for (const [specifier, count] of specifiers) {
      externalByFileList.push({ path, specifier, count });
    }
  }

  return { edges, external: externalList, unresolved, externalByFile: externalByFileList };
}

/** จำนวนไฟล์ที่พึ่งพาไฟล์นี้ ใช้จัดอันดับว่าไฟล์ไหนสำคัญที่สุดใน repo */
export function countDependents(edges: Edge[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of edges) counts.set(edge.to, (counts.get(edge.to) ?? 0) + 1);
  return counts;
}
