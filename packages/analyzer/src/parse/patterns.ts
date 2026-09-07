import type { ParsedFile, RawImport, SymbolInfo, SymbolKind } from './types.js';

interface Rule {
  pattern: RegExp;
  /** ตำแหน่งกลุ่มที่จับค่าที่ต้องการ (ค่าเริ่มต้นคือกลุ่มแรกที่ไม่ว่าง) */
  kind?: RawImport['kind'];
}

const IMPORT_RULES: Record<string, Rule[]> = {
  javascript: [
    { pattern: /^\s*import\s+[^'"]*from\s+['"]([^'"]+)['"]/, kind: 'from' },
    { pattern: /^\s*import\s+['"]([^'"]+)['"]/, kind: 'import' },
    { pattern: /\brequire\(\s*['"]([^'"]+)['"]\s*\)/, kind: 'require' },
    { pattern: /^\s*export\s+[^'"]*from\s+['"]([^'"]+)['"]/, kind: 'from' },
    { pattern: /\bimport\(\s*['"]([^'"]+)['"]\s*\)/, kind: 'import' },
  ],
  python: [
    { pattern: /^\s*from\s+([\w.]+)\s+import\b/, kind: 'from' },
    { pattern: /^\s*import\s+([\w.]+)/, kind: 'import' },
  ],
  go: [{ pattern: /^\s*(?:import\s+)?(?:[\w.]+\s+)?"([^"]+)"/, kind: 'import' }],
  rust: [{ pattern: /^\s*(?:pub\s+)?use\s+([\w:]+)/, kind: 'use' }],
  java: [{ pattern: /^\s*import\s+(?:static\s+)?([\w.]+)/, kind: 'import' }],
  kotlin: [{ pattern: /^\s*import\s+([\w.]+)/, kind: 'import' }],
  swift: [{ pattern: /^\s*import\s+([\w.]+)/, kind: 'import' }],
  ruby: [{ pattern: /^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/, kind: 'require' }],
  php: [
    { pattern: /^\s*use\s+([\w\\]+)/, kind: 'use' },
    { pattern: /\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]/, kind: 'include' },
  ],
  c: [{ pattern: /^\s*#include\s+[<"]([^>"]+)[>"]/, kind: 'include' }],
  cpp: [{ pattern: /^\s*#include\s+[<"]([^>"]+)[>"]/, kind: 'include' }],
  csharp: [{ pattern: /^\s*using\s+(?:static\s+)?([\w.]+)\s*;/, kind: 'use' }],
  scala: [{ pattern: /^\s*import\s+([\w.]+)/, kind: 'import' }],
  elixir: [{ pattern: /^\s*(?:import|alias|use)\s+([\w.]+)/, kind: 'use' }],
  lua: [{ pattern: /\brequire\s*\(?\s*['"]([^'"]+)['"]/, kind: 'require' }],
  dart: [{ pattern: /^\s*import\s+['"]([^'"]+)['"]/, kind: 'import' }],
  bash: [{ pattern: /^\s*(?:\.|source)\s+([^\s;]+)/, kind: 'include' }],
};

IMPORT_RULES.typescript = IMPORT_RULES.javascript ?? [];
IMPORT_RULES.tsx = IMPORT_RULES.javascript ?? [];
IMPORT_RULES.vue = IMPORT_RULES.javascript ?? [];
IMPORT_RULES.svelte = IMPORT_RULES.javascript ?? [];

interface SymbolRule {
  pattern: RegExp;
  kind: SymbolKind;
}

const SYMBOL_RULES: Record<string, SymbolRule[]> = {
  javascript: [
    { pattern: /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/, kind: 'function' },
    { pattern: /^\s*(?:export\s+)?class\s+(\w+)/, kind: 'class' },
    {
      pattern:
        /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/,
      kind: 'function',
    },
  ],
  python: [
    { pattern: /^\s*(?:async\s+)?def\s+(\w+)/, kind: 'function' },
    { pattern: /^\s*class\s+(\w+)/, kind: 'class' },
  ],
  go: [
    { pattern: /^\s*func\s+(?:\([^)]*\)\s*)?(\w+)/, kind: 'function' },
    { pattern: /^\s*type\s+(\w+)\s+(?:struct|interface)\b/, kind: 'type' },
  ],
  rust: [
    { pattern: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/, kind: 'function' },
    { pattern: /^\s*(?:pub\s+)?struct\s+(\w+)/, kind: 'type' },
  ],
  java: [
    { pattern: /^\s*(?:public|private|protected)?\s*class\s+(\w+)/, kind: 'class' },
    {
      pattern: /^\s*(?:public|private|protected)\s+(?:static\s+)?[\w<>[\]]+\s+(\w+)\s*\(/,
      kind: 'method',
    },
  ],
  ruby: [
    { pattern: /^\s*def\s+([\w.?!]+)/, kind: 'function' },
    { pattern: /^\s*class\s+(\w+)/, kind: 'class' },
  ],
  php: [
    { pattern: /^\s*(?:public|private|protected)?\s*function\s+(\w+)/, kind: 'function' },
    { pattern: /^\s*class\s+(\w+)/, kind: 'class' },
  ],
  csharp: [
    {
      pattern: /^\s*(?:public|private|protected|internal)\s+(?:partial\s+)?class\s+(\w+)/,
      kind: 'class',
    },
  ],
  bash: [{ pattern: /^\s*(?:function\s+)?(\w+)\s*\(\)\s*\{/, kind: 'function' }],
};

const TS_EXTRA: SymbolRule[] = [
  { pattern: /^\s*(?:export\s+)?interface\s+(\w+)/, kind: 'interface' },
  { pattern: /^\s*(?:export\s+)?type\s+(\w+)\s*=/, kind: 'type' },
];

SYMBOL_RULES.typescript = [...(SYMBOL_RULES.javascript ?? []), ...TS_EXTRA];
SYMBOL_RULES.tsx = SYMBOL_RULES.typescript;
SYMBOL_RULES.vue = SYMBOL_RULES.typescript;
SYMBOL_RULES.svelte = SYMBOL_RULES.typescript;
SYMBOL_RULES.kotlin = [
  { pattern: /^\s*(?:public|private|internal)?\s*fun\s+(\w+)/, kind: 'function' },
  { pattern: /^\s*(?:data\s+)?class\s+(\w+)/, kind: 'class' },
];
SYMBOL_RULES.swift = [
  { pattern: /^\s*(?:public|private|internal)?\s*func\s+(\w+)/, kind: 'function' },
  { pattern: /^\s*(?:public\s+)?(?:final\s+)?class\s+(\w+)/, kind: 'class' },
];

/** ตัดคอมเมนต์บรรทัดเดียวและสตริงยาวออกอย่างหยาบ ๆ เพื่อลดการจับผิดตัว */
function stripNoise(line: string, language: string): string {
  if (language === 'python' || language === 'ruby' || language === 'bash') {
    return line.replace(/#.*$/, '');
  }
  return line.replace(/\/\/.*$/, '');
}

/**
 * ตัวแยกโค้ดสำรองที่ทำงานได้กับทุกภาษาที่มีกฎ
 * ใช้เมื่อ tree-sitter โหลดไม่ได้หรือยังไม่มีไวยากรณ์ของภาษานั้น — ผลอาจหยาบกว่าแต่ต้องไม่พัง
 */
export function parseWithPatterns(source: string, language: string): ParsedFile {
  const importRules = IMPORT_RULES[language] ?? [];
  const symbolRules = SYMBOL_RULES[language] ?? [];
  const imports: RawImport[] = [];
  const symbols: SymbolInfo[] = [];

  if (importRules.length === 0 && symbolRules.length === 0) {
    return { imports, symbols, engine: 'pattern' };
  }

  const lines = source.split('\n');
  let inGoImportBlock = false;

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index] ?? '';
    const line = stripNoise(raw, language);
    const lineNumber = index + 1;

    if (language === 'go') {
      if (/^\s*import\s*\(/.test(line)) {
        inGoImportBlock = true;
        continue;
      }
      if (inGoImportBlock && /^\s*\)/.test(line)) {
        inGoImportBlock = false;
        continue;
      }
      if (!inGoImportBlock && !/^\s*import\s/.test(line)) {
        // นอกบล็อก import ของ Go สตริงในโค้ดไม่ใช่การนำเข้า
        for (const rule of symbolRules) {
          const match = rule.pattern.exec(line);
          if (match?.[1]) symbols.push({ name: match[1], kind: rule.kind, line: lineNumber });
        }
        continue;
      }
    }

    for (const rule of importRules) {
      const match = rule.pattern.exec(line);
      if (match?.[1]) {
        imports.push({ specifier: match[1], line: lineNumber, kind: rule.kind ?? 'import' });
        break;
      }
    }

    for (const rule of symbolRules) {
      const match = rule.pattern.exec(line);
      if (match?.[1]) {
        symbols.push({ name: match[1], kind: rule.kind, line: lineNumber });
        break;
      }
    }
  }

  return { imports, symbols, engine: 'pattern' };
}
