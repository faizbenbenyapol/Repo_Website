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

export interface GraphResult {
  edges: Edge[];
  external: ExternalDependency[];
  unresolved: number;
}

export interface GraphInput {
  files: { path: string; language: string | null }[];
  imports: Map<string, RawImport[]>;
  /** ชื่อโมดูลจาก go.mod ถ้ามี ใช้แปลงเส้นทาง import ของ Go ให้เป็นไฟล์ในโปรเจกต์ */
  goModule?: string | null;
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
        if (specifier.startsWith('.') || specifier.startsWith('/')) unresolved += 1;
        else external.set(specifier, (external.get(specifier) ?? 0) + 1);
      }
    }
  }

  const externalList = [...external.entries()]
    .map(([specifier, count]) => ({ specifier, count }))
    .sort((a, b) => b.count - a.count || a.specifier.localeCompare(b.specifier));

  return { edges, external: externalList, unresolved };
}

/** จำนวนไฟล์ที่พึ่งพาไฟล์นี้ ใช้จัดอันดับว่าไฟล์ไหนสำคัญที่สุดใน repo */
export function countDependents(edges: Edge[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const edge of edges) counts.set(edge.to, (counts.get(edge.to) ?? 0) + 1);
  return counts;
}
