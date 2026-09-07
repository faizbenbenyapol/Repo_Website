export interface GraphNode {
  path: string;
  language: string | null;
  loc: number;
  dependents: number;
  dependencies: number;
  blast: number;
}

export interface GraphEdge {
  src: string;
  dst: string;
  confidence: number;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  totalNodes: number;
}

export interface FileDetail {
  path: string;
  symbols: { name: string; kind: string; line: number }[];
  dependents: string[];
  dependencies: string[];
  churn: number;
  blast: number;
  authors: { name: string; commits: number }[];
}

/** โหมดการลงสีของกราฟ — เปลี่ยนคำถามที่ภาพเดียวกันตอบได้ */
export const COLOR_MODES = [
  { id: 'folder', label: 'โฟลเดอร์', hint: 'ดูว่าโปรเจกต์ถูกแบ่งเป็นส่วนไหนบ้าง' },
  { id: 'language', label: 'ภาษา', hint: 'ดูว่าแต่ละส่วนเขียนด้วยภาษาอะไร' },
  { id: 'dependents', label: 'ความสำคัญ', hint: 'ยิ่งเข้ม ยิ่งมีไฟล์อื่นพึ่งพามาก' },
  { id: 'blast', label: 'รัศมีผลกระทบ', hint: 'ยิ่งเข้ม ยิ่งกระทบไฟล์อื่นกว้างเมื่อแก้' },
] as const;

export type ColorMode = (typeof COLOR_MODES)[number]['id'];

/**
 * จานสีสำหรับแยกกลุ่ม เลือกโทนกลาง ๆ ที่อ่านออกทั้งบนพื้นสว่างและพื้นมืด
 * ไม่ใช้สีเน้นของระบบ เพราะสีเน้นมีความหมายว่า "สิ่งที่เลือกอยู่"
 */
const PALETTE = [
  '#4C7DD9',
  '#2F9E76',
  '#C2843A',
  '#9B62C4',
  '#3E9AA8',
  '#C25E6E',
  '#7A8B45',
  '#8A6FB0',
  '#C08A2E',
  '#5E8F8F',
];

const NEUTRAL = '#8B94A8';

function hash(value: string): number {
  let total = 0;
  for (let i = 0; i < value.length; i += 1) total = (total * 31 + value.charCodeAt(i)) >>> 0;
  return total;
}

export function topFolder(path: string): string {
  const at = path.indexOf('/');
  return at === -1 ? '(รากโปรเจกต์)' : path.slice(0, at);
}

/** ไล่สีตามจำนวนไฟล์ที่พึ่งพา — ใช้ hue เดียวแล้วไล่ความเข้ม เพื่อให้อ่านเป็นลำดับได้จริง */
function heat(value: number, max: number): string {
  const ratio = max <= 0 ? 0 : Math.min(value / max, 1);
  const lightness = 72 - ratio * 34;
  const saturation = 30 + ratio * 45;
  return `hsl(220 ${saturation.toFixed(0)}% ${lightness.toFixed(0)}%)`;
}

export function colorFor(
  node: GraphNode,
  mode: ColorMode,
  maxDependents: number,
  maxBlast = maxDependents,
): string {
  if (mode === 'dependents') return heat(node.dependents, maxDependents);
  if (mode === 'blast') return heat(node.blast, maxBlast);
  const key = mode === 'language' ? (node.language ?? '') : topFolder(node.path);
  if (!key) return NEUTRAL;
  return PALETTE[hash(key) % PALETTE.length] ?? NEUTRAL;
}

/** ขนาดโหนดสื่อถึงขนาดไฟล์ ส่วนความสำคัญสื่อด้วยสีและการเน้น จะได้ไม่ทับความหมายกัน */
export function sizeFor(node: GraphNode): number {
  return Math.min(3 + Math.sqrt(node.loc) / 4, 14);
}

export interface LegendEntry {
  label: string;
  color: string;
  count: number;
}

/** คำอธิบายสีที่แสดงข้างกราฟ — เอาเฉพาะกลุ่มใหญ่สุด เพื่อไม่ให้กลายเป็นรายการยาวจนไม่มีใครอ่าน */
export function legendFor(nodes: GraphNode[], mode: ColorMode, limit = 8): LegendEntry[] {
  if (mode === 'dependents' || mode === 'blast') return [];

  const maxDependents = nodes.reduce((max, node) => Math.max(max, node.dependents), 0);
  const groups = new Map<string, { count: number; color: string }>();

  for (const node of nodes) {
    const key = mode === 'language' ? (node.language ?? 'อื่น ๆ') : topFolder(node.path);
    const current = groups.get(key);
    if (current) current.count += 1;
    else groups.set(key, { count: 1, color: colorFor(node, mode, maxDependents) });
  }

  return [...groups.entries()]
    .map(([label, value]) => ({ label, ...value }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

export interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  /** ไฟล์จริงจะมีข้อมูลนี้ ส่วนโฟลเดอร์เป็น null */
  file: GraphNode | null;
  fileCount: number;
}

/** แปลงรายการพาธแบน ๆ เป็นต้นไม้โฟลเดอร์สำหรับแสดงผล */
export function buildTree(nodes: GraphNode[]): TreeNode {
  const root: TreeNode = { name: '', path: '', children: [], file: null, fileCount: 0 };

  for (const node of [...nodes].sort((a, b) => a.path.localeCompare(b.path))) {
    const segments = node.path.split('/');
    let current = root;

    segments.forEach((segment, index) => {
      const isLeaf = index === segments.length - 1;
      const path = segments.slice(0, index + 1).join('/');
      let child = current.children.find((item) => item.name === segment);

      if (!child) {
        child = { name: segment, path, children: [], file: null, fileCount: 0 };
        current.children.push(child);
      }

      if (isLeaf) child.file = node;
      current = child;
    });
  }

  const count = (node: TreeNode): number => {
    node.fileCount = node.file
      ? 1
      : node.children.reduce((total, child) => total + count(child), 0);
    return node.fileCount;
  };
  count(root);

  const sort = (node: TreeNode): void => {
    node.children.sort((a, b) => {
      const aIsDir = a.file === null;
      const bIsDir = b.file === null;
      if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sort);
  };
  sort(root);

  return root;
}
