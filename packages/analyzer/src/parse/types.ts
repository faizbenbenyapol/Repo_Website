export type ImportKind = 'import' | 'require' | 'from' | 'include' | 'use';

export interface RawImport {
  specifier: string;
  line: number;
  kind: ImportKind;
}

export type SymbolKind = 'function' | 'class' | 'method' | 'interface' | 'type';

export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  line: number;
}

export type ParseEngine = 'tree-sitter' | 'pattern';

export interface ParsedFile {
  imports: RawImport[];
  symbols: SymbolInfo[];
  engine: ParseEngine;
}
