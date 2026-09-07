import { describe, expect, it } from 'vitest';
import { parseSource, supportsTreeSitter } from './index.js';
import { parseWithPatterns } from './patterns.js';

const TS_SOURCE = `import { readFile } from 'node:fs/promises';
import helper from './helper';
export { thing } from '../shared/thing';
const lazy = await import('./lazy');
const legacy = require('./legacy');

export interface Options { deep: boolean }
export type Handler = (input: string) => void;

export async function analyze(path: string) {
  return readFile(path);
}

export const format = (value: string) => value.trim();

export class Reporter {
  render() {
    return helper(lazy, legacy);
  }
}
`;

const PY_SOURCE = `import os
from .sibling import thing
from package.module import other

class Reporter:
    def render(self):
        return thing(other, os)

def analyze(path):
    return path
`;

const GO_SOURCE = `package main

import (
	"fmt"
	"example.com/app/internal/store"
)

type Reporter struct{}

func (r Reporter) Render() string {
	return fmt.Sprint(store.Name)
}

func Analyze(path string) string {
	return path
}
`;

describe('อ่านโครงสร้าง TypeScript', () => {
  it('เก็บการนำเข้าได้ครบทุกรูปแบบ', async () => {
    const parsed = await parseSource(TS_SOURCE, 'typescript');
    const specifiers = parsed.imports.map((item) => item.specifier);
    expect(specifiers).toContain('node:fs/promises');
    expect(specifiers).toContain('./helper');
    expect(specifiers).toContain('../shared/thing');
    expect(specifiers).toContain('./lazy');
    expect(specifiers).toContain('./legacy');
  });

  it('เก็บฟังก์ชัน คลาส และชนิดข้อมูลได้', async () => {
    const parsed = await parseSource(TS_SOURCE, 'typescript');
    const names = parsed.symbols.map((item) => item.name);
    expect(names).toContain('analyze');
    expect(names).toContain('format');
    expect(names).toContain('Reporter');
    expect(names).toContain('Options');
    expect(names).toContain('Handler');
  });

  it('บอกเลขบรรทัดที่ถูกต้อง', async () => {
    const parsed = await parseSource(TS_SOURCE, 'typescript');
    const analyze = parsed.symbols.find((item) => item.name === 'analyze');
    expect(analyze?.line).toBe(10);
  });
});

describe('อ่านโครงสร้าง Python และ Go', () => {
  it('Python: ได้ทั้งการนำเข้าแบบสัมพัทธ์และแบบเต็ม', async () => {
    const parsed = await parseSource(PY_SOURCE, 'python');
    const specifiers = parsed.imports.map((item) => item.specifier);
    expect(specifiers).toContain('os');
    expect(specifiers.some((item) => item.includes('sibling'))).toBe(true);
    expect(specifiers.some((item) => item.includes('package.module'))).toBe(true);
    expect(parsed.symbols.map((item) => item.name)).toEqual(
      expect.arrayContaining(['Reporter', 'render', 'analyze']),
    );
  });

  it('Go: อ่านบล็อก import ได้ และไม่นับสตริงในโค้ดเป็นการนำเข้า', async () => {
    const parsed = await parseSource(GO_SOURCE, 'go');
    const specifiers = parsed.imports.map((item) => item.specifier);
    expect(specifiers).toContain('fmt');
    expect(specifiers).toContain('example.com/app/internal/store');
    expect(specifiers).not.toContain('main');
    expect(parsed.symbols.map((item) => item.name)).toEqual(
      expect.arrayContaining(['Analyze', 'Render']),
    );
  });
});

describe('ตัวแยกโค้ดสำรอง', () => {
  it('ทำงานได้กับภาษาที่ไม่มีไวยากรณ์ tree-sitter', () => {
    const parsed = parseWithPatterns(
      `require 'json'\nrequire_relative 'helper'\nclass Reporter\n  def render\n  end\nend\n`,
      'ruby',
    );
    expect(parsed.imports.map((item) => item.specifier)).toEqual(['json', 'helper']);
    expect(parsed.symbols.map((item) => item.name)).toEqual(
      expect.arrayContaining(['Reporter', 'render']),
    );
  });

  it('ไม่พังกับภาษาที่ยังไม่มีกฎ', () => {
    const parsed = parseWithPatterns('เนื้อหาอะไรก็ไม่รู้', 'cobol');
    expect(parsed.imports).toEqual([]);
    expect(parsed.symbols).toEqual([]);
  });

  it('ข้ามการนำเข้าที่อยู่ในคอมเมนต์', () => {
    const parsed = parseWithPatterns(
      `// import x from './ghost';\nimport y from './real';`,
      'javascript',
    );
    expect(parsed.imports.map((item) => item.specifier)).toEqual(['./real']);
  });
});

describe('เครื่องมือที่ใช้แยกโค้ด', () => {
  it('ภาษาหลักต้องใช้ tree-sitter ไม่ใช่ตัวสำรอง', async () => {
    expect(supportsTreeSitter('typescript')).toBe(true);
    const parsed = await parseSource(TS_SOURCE, 'typescript');
    expect(parsed.engine).toBe('tree-sitter');
  });

  it('ภาษาที่ไม่มีไวยากรณ์ต้องรายงานว่าใช้ตัวสำรอง', async () => {
    const parsed = await parseSource('require "json"', 'ruby');
    expect(parsed.engine).toBe('pattern');
  });
});
