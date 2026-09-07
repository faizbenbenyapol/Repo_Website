import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { ParsedFile, RawImport, SymbolInfo, SymbolKind } from './types.js';

/**
 * ตัวแยกโค้ดหลักด้วย tree-sitter (WebAssembly)
 *
 * เลือก wasm แทน binding แบบ native ตั้งแต่ต้น เพราะ native ต้องคอมไพล์ตอนติดตั้ง
 * ซึ่งทำให้อิมเมจ Docker ใหญ่และพังง่ายเวลาเปลี่ยนเวอร์ชัน Node
 * ถ้าโหลดไวยากรณ์ไม่ได้ ระบบจะถอยไปใช้ตัวแยกแบบรูปแบบข้อความแทน ไม่ปล่อยให้ทั้งงานล้ม
 *
 * เวอร์ชันของ runtime กับของไวยากรณ์ต้องเข้าคู่กัน — web-tree-sitter 0.20.8 คู่กับ tree-sitter-wasms 0.1.13
 * รุ่นใหม่กว่านั้นเปลี่ยนรูปแบบไฟล์ wasm จนโหลดไวยากรณ์ชุดนี้ไม่ได้ (ตรวจพบตอนพัฒนา v0.2.0)
 */

const require = createRequire(import.meta.url);

/** ชื่อไฟล์ไวยากรณ์ในแพ็กเกจ tree-sitter-wasms */
const GRAMMAR_FILES: Record<string, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  tsx: 'tree-sitter-tsx.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  python: 'tree-sitter-python.wasm',
  go: 'tree-sitter-go.wasm',
  rust: 'tree-sitter-rust.wasm',
};

interface TsNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  namedChildCount: number;
  namedChild(index: number): TsNode | null;
  childForFieldName(field: string): TsNode | null;
}

interface TsTree {
  rootNode: TsNode;
  delete?: () => void;
}

interface TsParser {
  setLanguage(language: unknown): void;
  parse(source: string): TsTree | null;
  delete?: () => void;
}

let runtime: {
  ParserClass: new () => TsParser;
  loadLanguage: (path: string) => Promise<unknown>;
} | null = null;
let runtimeFailure: string | null = null;
const languageCache = new Map<string, unknown>();

function grammarDirectory(): string {
  const entry = require.resolve('tree-sitter-wasms/package.json');
  return join(dirname(entry), 'out');
}

/**
 * รองรับทั้งรูปแบบ export ของ web-tree-sitter รุ่นเก่าและรุ่นใหม่
 *
 * ข้อควรระวัง: ในรุ่น 0.20 ตัว Parser.Language จะยังไม่มีจนกว่าจะเรียก init() สำเร็จ
 * จึงต้อง init ก่อนแล้วค่อยมองหา Language ไม่ใช่กลับกัน
 */
async function loadRuntime(): Promise<typeof runtime> {
  if (runtime || runtimeFailure) return runtime;

  try {
    const mod = (await import('web-tree-sitter')) as Record<string, unknown>;
    const named = mod.Parser as
      | ((new () => TsParser) & {
          init?: () => Promise<void>;
          Language?: { load(path: string): Promise<unknown> };
        })
      | undefined;
    const legacy = mod.default as
      | ((new () => TsParser) & {
          init?: () => Promise<void>;
          Language?: { load(path: string): Promise<unknown> };
        })
      | undefined;

    const ParserClass = named ?? legacy;
    if (!ParserClass) {
      runtimeFailure = 'ไม่พบคลาส Parser ใน web-tree-sitter';
      return runtime;
    }

    await ParserClass.init?.();

    const LanguageClass =
      (mod.Language as { load(path: string): Promise<unknown> } | undefined) ??
      ParserClass.Language;

    if (!LanguageClass?.load) {
      runtimeFailure = 'ไม่พบตัวโหลดไวยากรณ์ (Language) หลังเรียก init';
      return runtime;
    }

    runtime = { ParserClass, loadLanguage: (path) => LanguageClass.load(path) };
  } catch (error) {
    runtimeFailure = error instanceof Error ? error.message : String(error);
  }

  return runtime;
}

async function loadLanguage(language: string): Promise<unknown | null> {
  const file = GRAMMAR_FILES[language];
  if (!file) return null;
  if (languageCache.has(language)) return languageCache.get(language) ?? null;

  const active = await loadRuntime();
  if (!active) return null;

  try {
    const loaded = await active.loadLanguage(join(grammarDirectory(), file));
    languageCache.set(language, loaded);
    return loaded;
  } catch {
    languageCache.set(language, null);
    return null;
  }
}

export function supportsTreeSitter(language: string): boolean {
  return language in GRAMMAR_FILES;
}

/** เหตุผลที่ tree-sitter ใช้ไม่ได้ (ถ้ามี) — ใช้เขียนลง log ตอนวิเคราะห์ */
export function treeSitterFailure(): string | null {
  return runtimeFailure;
}

function unquote(text: string): string {
  return text.replace(/^[`'"]/, '').replace(/[`'"]$/, '');
}

function walk(node: TsNode, visit: (node: TsNode) => void): void {
  visit(node);
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child) walk(child, visit);
  }
}

const JS_FAMILY = new Set(['typescript', 'tsx', 'javascript']);

function extract(root: TsNode, language: string): { imports: RawImport[]; symbols: SymbolInfo[] } {
  const imports: RawImport[] = [];
  const symbols: SymbolInfo[] = [];

  const addSymbol = (node: TsNode, kind: SymbolKind, nameNode: TsNode | null): void => {
    if (!nameNode) return;
    symbols.push({ name: nameNode.text, kind, line: node.startPosition.row + 1 });
  };

  walk(root, (node) => {
    const line = node.startPosition.row + 1;

    if (JS_FAMILY.has(language)) {
      switch (node.type) {
        case 'import_statement':
        case 'export_statement': {
          const source = node.childForFieldName('source');
          if (source) imports.push({ specifier: unquote(source.text), line, kind: 'from' });
          break;
        }
        case 'call_expression': {
          const fn = node.childForFieldName('function');
          if (fn && (fn.text === 'require' || fn.text === 'import')) {
            const args = node.childForFieldName('arguments');
            const first = args?.namedChild(0);
            if (first && first.type.includes('string')) {
              imports.push({
                specifier: unquote(first.text),
                line,
                kind: fn.text === 'require' ? 'require' : 'import',
              });
            }
          }
          break;
        }
        case 'function_declaration':
        case 'generator_function_declaration':
          addSymbol(node, 'function', node.childForFieldName('name'));
          break;
        case 'class_declaration':
          addSymbol(node, 'class', node.childForFieldName('name'));
          break;
        case 'method_definition':
          addSymbol(node, 'method', node.childForFieldName('name'));
          break;
        case 'interface_declaration':
          addSymbol(node, 'interface', node.childForFieldName('name'));
          break;
        case 'type_alias_declaration':
          addSymbol(node, 'type', node.childForFieldName('name'));
          break;
        case 'variable_declarator': {
          const value = node.childForFieldName('value');
          if (value && (value.type === 'arrow_function' || value.type === 'function_expression')) {
            addSymbol(node, 'function', node.childForFieldName('name'));
          }
          break;
        }
        default:
          break;
      }
      return;
    }

    if (language === 'python') {
      switch (node.type) {
        case 'import_statement':
        case 'import_from_statement': {
          const moduleName = node.childForFieldName('module_name');
          const target = moduleName ?? node.namedChild(0);
          if (target) {
            imports.push({
              specifier: target.text,
              line,
              kind: node.type === 'import_statement' ? 'import' : 'from',
            });
          }
          break;
        }
        case 'function_definition':
          addSymbol(node, 'function', node.childForFieldName('name'));
          break;
        case 'class_definition':
          addSymbol(node, 'class', node.childForFieldName('name'));
          break;
        default:
          break;
      }
      return;
    }

    if (language === 'go') {
      switch (node.type) {
        case 'import_spec': {
          const path = node.childForFieldName('path') ?? node.namedChild(0);
          if (path) imports.push({ specifier: unquote(path.text), line, kind: 'import' });
          break;
        }
        case 'function_declaration':
        case 'method_declaration':
          addSymbol(
            node,
            node.type === 'method_declaration' ? 'method' : 'function',
            node.childForFieldName('name'),
          );
          break;
        case 'type_spec':
          addSymbol(node, 'type', node.childForFieldName('name'));
          break;
        default:
          break;
      }
      return;
    }

    if (language === 'rust') {
      switch (node.type) {
        case 'use_declaration': {
          const argument = node.childForFieldName('argument') ?? node.namedChild(0);
          if (argument) imports.push({ specifier: argument.text, line, kind: 'use' });
          break;
        }
        case 'function_item':
          addSymbol(node, 'function', node.childForFieldName('name'));
          break;
        case 'struct_item':
        case 'enum_item':
          addSymbol(node, 'type', node.childForFieldName('name'));
          break;
        default:
          break;
      }
    }
  });

  return { imports, symbols };
}

/** คืน null เมื่อใช้ tree-sitter กับภาษานี้ไม่ได้ ให้ผู้เรียกไปใช้ตัวสำรองแทน */
export async function parseWithTreeSitter(
  source: string,
  language: string,
): Promise<ParsedFile | null> {
  const grammar = await loadLanguage(language);
  const active = runtime;
  if (!grammar || !active) return null;

  const parser = new active.ParserClass();
  try {
    parser.setLanguage(grammar);
    const tree = parser.parse(source);
    if (!tree) return null;
    const { imports, symbols } = extract(tree.rootNode, language);
    tree.delete?.();
    return { imports, symbols, engine: 'tree-sitter' };
  } catch {
    return null;
  } finally {
    parser.delete?.();
  }
}
