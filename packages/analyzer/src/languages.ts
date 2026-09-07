/** แผนที่นามสกุลไฟล์ไปยังภาษา — ใช้ทั้งตอนนับสัดส่วนภาษาและตอนเลือกตัวแยกโค้ด */
const BY_EXTENSION: Record<string, string> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.swift': 'swift',
  '.rb': 'ruby',
  '.php': 'php',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.scala': 'scala',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.lua': 'lua',
  '.dart': 'dart',
  '.sh': 'bash',
  '.bash': 'bash',
  '.zsh': 'bash',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.sql': 'sql',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.css': 'css',
  '.scss': 'css',
  '.html': 'html',
};

/** ไฟล์ที่ไม่มีนามสกุลแต่รู้จักกันดี */
const BY_FILENAME: Record<string, string> = {
  Dockerfile: 'dockerfile',
  Makefile: 'make',
  Caddyfile: 'caddy',
};

/** ภาษาที่เราดึงความสัมพันธ์และ symbol ออกมาได้ (นอกจากนี้จะนับแต่จำนวนบรรทัด) */
export const ANALYZABLE = new Set([
  'typescript',
  'tsx',
  'javascript',
  'python',
  'go',
  'rust',
  'java',
  'kotlin',
  'swift',
  'ruby',
  'php',
  'c',
  'cpp',
  'csharp',
  'scala',
  'elixir',
  'lua',
  'dart',
  'bash',
  'vue',
  'svelte',
]);

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

export function detectLanguage(path: string): string | null {
  const base = path.slice(path.lastIndexOf('/') + 1);
  if (BY_FILENAME[base]) return BY_FILENAME[base];
  return BY_EXTENSION[extensionOf(path)] ?? null;
}

export function isAnalyzable(language: string | null): boolean {
  return language !== null && ANALYZABLE.has(language);
}

/** ลำดับนามสกุลที่ลองเติมให้ตอนแก้เส้นทาง import ที่เขียนไว้แบบไม่มีนามสกุล */
export const RESOLUTION_EXTENSIONS: Record<string, string[]> = {
  typescript: ['.ts', '.tsx', '.d.ts', '.js', '.mjs', '.cjs', '.json'],
  tsx: ['.tsx', '.ts', '.js', '.jsx', '.json'],
  javascript: ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.json'],
  python: ['.py', '.pyi'],
  go: ['.go'],
  rust: ['.rs'],
  ruby: ['.rb'],
  php: ['.php'],
  vue: ['.vue', '.ts', '.js'],
  svelte: ['.svelte', '.ts', '.js'],
};
