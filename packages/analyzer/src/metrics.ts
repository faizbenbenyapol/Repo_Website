import type { Edge } from './graph.js';
import type { FileEntry } from './inventory.js';

export interface Cycle {
  /** ไฟล์ที่อยู่ในวงจรเดียวกัน เรียงตามพาธ */
  files: string[];
}

export interface Hotspot {
  path: string;
  /** จำนวนคอมมิตที่แตะไฟล์นี้ในประวัติที่ดึงมา */
  churn: number;
  loc: number;
  dependents: number;
  /** คะแนนความเสี่ยง = แก้บ่อย × ใหญ่ × มีคนพึ่งพาเยอะ */
  risk: number;
}

export interface HealthBreakdown {
  id: string;
  label: string;
  /** คะแนนที่ถูกหักจากเต็ม 100 */
  penalty: number;
  detail: string;
}

export interface Metrics {
  health: {
    score: number;
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    breakdown: HealthBreakdown[];
  };
  cycles: Cycle[];
  /** ไฟล์ที่ไม่มีใครเรียกใช้และไม่ใช่จุดเริ่มโปรแกรม */
  deadFiles: string[];
  hotspots: Hotspot[];
  coupling: {
    averageDependencies: number;
    /** ไฟล์ที่เรียกใช้ไฟล์อื่นเยอะผิดปกติ มักเป็นสัญญาณว่ารับผิดชอบหลายเรื่องเกินไป */
    highFanOut: { path: string; dependencies: number }[];
  };
}

/**
 * ไฟล์ที่ถือว่าเป็นจุดเริ่ม จึงไม่นับว่าเป็นโค้ดตายแม้ไม่มีใครเรียกใช้
 * ตั้งใจให้กว้างไว้ก่อน เพราะการกล่าวหาว่าไฟล์หนึ่งไร้ประโยชน์ทั้งที่มันคือจุดเริ่มของโปรแกรม
 * ทำให้ผู้ใช้เลิกเชื่อตัวเลขทั้งชุด
 */
const ENTRYPOINT_PATTERNS = [
  /(^|\/)(index|main|app|server|worker|cli|setup|conftest)\.[\w.]+$/i,
  /(^|\/)__init__\.py$/,
  /(^|\/)page\.[jt]sx?$/,
  /(^|\/)layout\.[jt]sx?$/,
  /(^|\/)route\.[jt]sx?$/,
  /(^|\/)middleware\.[jt]sx?$/,
  /\.(test|spec)\.[\w.]+$/i,
  /(^|\/)(tests?|spec|__tests__|fixtures?|examples?|docs?|scripts?|migrations?)\//i,
  /(^|\/)[^/]*\.config\.[\w.]+$/i,
  /(^|\/)(README|CHANGELOG|LICENSE)/i,
];

export function isEntrypoint(path: string): boolean {
  return ENTRYPOINT_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * หาวงจรพึ่งพาด้วยอัลกอริทึมของ Tarjan
 * เขียนแบบวนซ้ำแทนการเรียกตัวเอง เพราะ repo จริงลึกพอที่จะทำให้ call stack ล้น
 */
export function findCycles(edges: Edge[]): Cycle[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, adjacency.get(edge.to) ?? []);
  }

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: Cycle[] = [];
  let counter = 0;

  for (const start of adjacency.keys()) {
    if (index.has(start)) continue;

    const work: { node: string; child: number }[] = [{ node: start, child: 0 }];
    index.set(start, counter);
    low.set(start, counter);
    counter += 1;
    stack.push(start);
    onStack.add(start);

    while (work.length > 0) {
      const frame = work[work.length - 1];
      if (!frame) break;
      const neighbours = adjacency.get(frame.node) ?? [];

      if (frame.child < neighbours.length) {
        const next = neighbours[frame.child];
        frame.child += 1;
        if (next === undefined) continue;

        if (!index.has(next)) {
          index.set(next, counter);
          low.set(next, counter);
          counter += 1;
          stack.push(next);
          onStack.add(next);
          work.push({ node: next, child: 0 });
        } else if (onStack.has(next)) {
          low.set(frame.node, Math.min(low.get(frame.node) ?? 0, index.get(next) ?? 0));
        }
        continue;
      }

      work.pop();
      const parent = work[work.length - 1];
      if (parent) {
        low.set(parent.node, Math.min(low.get(parent.node) ?? 0, low.get(frame.node) ?? 0));
      }

      if (low.get(frame.node) === index.get(frame.node)) {
        const group: string[] = [];
        for (;;) {
          const item = stack.pop();
          if (item === undefined) break;
          onStack.delete(item);
          group.push(item);
          if (item === frame.node) break;
        }
        // กลุ่มขนาดหนึ่งจะเป็นวงจรก็ต่อเมื่อไฟล์นั้นชี้หาตัวเอง ซึ่งเราไม่สร้างเส้นแบบนั้นอยู่แล้ว
        if (group.length > 1) cycles.push({ files: group.sort() });
      }
    }
  }

  return cycles.sort((a, b) => b.files.length - a.files.length);
}

/**
 * รัศมีผลกระทบ — ถ้าแก้ไฟล์นี้ ไฟล์ไหนได้รับผลบ้าง (ตามเส้นย้อนกลับ)
 * จำกัดจำนวนที่ไล่ต่อหนึ่งไฟล์ไว้ เพราะ repo ใหญ่ที่ทุกอย่างพึ่งพากันหมด
 * จะทำให้การไล่ทั้งกราฟต่อทุกไฟล์กลายเป็นงานระดับล้านครั้ง
 */
export function blastRadius(edges: Edge[], limitPerFile = 2000): Map<string, number> {
  const reverse = new Map<string, string[]>();
  for (const edge of edges) {
    reverse.set(edge.to, [...(reverse.get(edge.to) ?? []), edge.from]);
  }

  const result = new Map<string, number>();

  for (const start of reverse.keys()) {
    const seen = new Set<string>([start]);
    const queue = [start];

    while (queue.length > 0 && seen.size <= limitPerFile) {
      const current = queue.shift();
      if (current === undefined) break;
      for (const dependent of reverse.get(current) ?? []) {
        if (seen.has(dependent)) continue;
        seen.add(dependent);
        queue.push(dependent);
      }
    }

    result.set(start, seen.size - 1);
  }

  return result;
}

export interface MetricsInput {
  files: FileEntry[];
  edges: Edge[];
  churn: Map<string, number>;
  securityPenalty: number;
  /** จำนวนช่องโหว่แยกตามความรุนแรง ใช้เขียนคำอธิบายให้ผู้ใช้อ่าน */
  findingCounts: { high: number; medium: number; low: number };
}

function gradeFor(score: number): Metrics['health']['grade'] {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

/**
 * คะแนนสุขภาพ
 *
 * เริ่มจากเต็ม 100 แล้วหักตามปัญหาที่วัดได้จริง ทุกข้อที่หักต้องบอกได้ว่าหักเพราะอะไรและเท่าไร
 * ตัวเลขที่อธิบายที่มาไม่ได้ ไม่มีประโยชน์กับคนที่ต้องเอาไปตัดสินใจ
 */
export function computeMetrics(input: MetricsInput): Metrics {
  const parsed = input.files.filter((file) => file.parsed);
  const parsedCount = Math.max(parsed.length, 1);

  const dependents = new Map<string, number>();
  const dependencies = new Map<string, number>();
  for (const edge of input.edges) {
    dependents.set(edge.to, (dependents.get(edge.to) ?? 0) + 1);
    dependencies.set(edge.from, (dependencies.get(edge.from) ?? 0) + 1);
  }

  const cycles = findCycles(input.edges);
  const filesInCycles = new Set(cycles.flatMap((cycle) => cycle.files));

  const deadFiles = parsed
    .filter((file) => (dependents.get(file.path) ?? 0) === 0 && !isEntrypoint(file.path))
    .map((file) => file.path)
    .sort();

  const totalDependencies = [...dependencies.values()].reduce((sum, value) => sum + value, 0);
  const averageDependencies = Number((totalDependencies / parsedCount).toFixed(2));

  const highFanOut = [...dependencies.entries()]
    .filter(([, value]) => value >= 12)
    .map(([path, value]) => ({ path, dependencies: value }))
    .sort((a, b) => b.dependencies - a.dependencies)
    .slice(0, 20);

  const hotspots = parsed
    .map((file) => {
      const churn = input.churn.get(file.path) ?? 0;
      const dependentCount = dependents.get(file.path) ?? 0;
      const risk = Number(
        (churn * Math.log10(file.loc + 10) * (1 + dependentCount / 5)).toFixed(2),
      );
      return { path: file.path, churn, loc: file.loc, dependents: dependentCount, risk };
    })
    .filter((item) => item.churn > 1 && item.risk > 0)
    .sort((a, b) => b.risk - a.risk)
    .slice(0, 20);

  const deadRatio = deadFiles.length / parsedCount;
  const cycleRatio = filesInCycles.size / parsedCount;
  const couplingExcess = Math.max(averageDependencies - 4, 0);

  const breakdown: HealthBreakdown[] = [
    {
      id: 'dead-code',
      label: 'โค้ดที่ไม่มีใครเรียกใช้',
      penalty: Math.round(Math.min(deadRatio * 100, 25)),
      detail: `${deadFiles.length} จาก ${parsed.length} ไฟล์ที่อ่านโครงสร้างได้ ไม่มีไฟล์อื่นเรียกใช้และไม่ใช่จุดเริ่มโปรแกรม`,
    },
    {
      id: 'cycles',
      label: 'วงจรพึ่งพา',
      penalty: Math.round(Math.min(cycleRatio * 150, 25)),
      detail:
        cycles.length === 0
          ? 'ไม่พบไฟล์ที่พึ่งพากันเป็นวงกลม'
          : `พบ ${cycles.length} วงจร ครอบคลุม ${filesInCycles.size} ไฟล์ ซึ่งทำให้แยกส่วนไปทดสอบหรือแก้ทีละชิ้นได้ยาก`,
    },
    {
      id: 'coupling',
      label: 'ความผูกกันแน่น',
      penalty: Math.round(Math.min(couplingExcess * 3, 20)),
      detail: `ไฟล์หนึ่งเรียกใช้ไฟล์อื่นเฉลี่ย ${averageDependencies} ไฟล์${
        highFanOut.length > 0 ? ` และมี ${highFanOut.length} ไฟล์ที่เรียกใช้เกินสิบสองไฟล์` : ''
      }`,
    },
    {
      id: 'security',
      label: 'ความปลอดภัย',
      penalty: Math.round(Math.min(input.securityPenalty, 30)),
      detail:
        input.findingCounts.high + input.findingCounts.medium + input.findingCounts.low === 0
          ? 'ไม่พบรูปแบบที่น่ากังวลจากการสแกนเบื้องต้น'
          : `พบข้อสังเกต ${input.findingCounts.high} รายการระดับสูง, ${input.findingCounts.medium} ระดับกลาง และ ${input.findingCounts.low} ระดับต่ำ`,
    },
  ];

  const score = Math.max(
    0,
    Math.round(100 - breakdown.reduce((total, item) => total + item.penalty, 0)),
  );

  return {
    health: { score, grade: gradeFor(score), breakdown },
    cycles: cycles.slice(0, 50),
    deadFiles: deadFiles.slice(0, 200),
    hotspots,
    coupling: { averageDependencies, highFanOut },
  };
}
