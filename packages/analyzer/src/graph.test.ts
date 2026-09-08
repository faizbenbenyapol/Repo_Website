import { describe, expect, it } from 'vitest';
import { buildGraph, countDependents } from './graph.js';
import type { RawImport } from './parse/types.js';

const imp = (specifier: string, kind: RawImport['kind'] = 'from', line = 1): RawImport => ({
  specifier,
  line,
  kind,
});

describe('เชื่อมความสัมพันธ์ระหว่างไฟล์', () => {
  it('แก้เส้นทางสัมพัทธ์ที่ไม่มีนามสกุลได้', () => {
    const result = buildGraph({
      files: [
        { path: 'src/app.ts', language: 'typescript' },
        { path: 'src/helper.ts', language: 'typescript' },
      ],
      imports: new Map([['src/app.ts', [imp('./helper')]]]),
    });

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({ from: 'src/app.ts', to: 'src/helper.ts' });
    expect(result.edges[0]?.confidence).toBeLessThan(1);
  });

  it('แก้เส้นทางที่ชี้ไปโฟลเดอร์ให้เป็นไฟล์ index', () => {
    const result = buildGraph({
      files: [
        { path: 'src/app.ts', language: 'typescript' },
        { path: 'src/utils/index.ts', language: 'typescript' },
      ],
      imports: new Map([['src/app.ts', [imp('./utils')]]]),
    });

    expect(result.edges[0]?.to).toBe('src/utils/index.ts');
  });

  it('ไฟล์ที่ระบุนามสกุลตรงตัวได้ความมั่นใจเต็ม', () => {
    const result = buildGraph({
      files: [
        { path: 'a.js', language: 'javascript' },
        { path: 'b.js', language: 'javascript' },
      ],
      imports: new Map([['a.js', [imp('./b.js')]]]),
    });

    expect(result.edges[0]?.confidence).toBe(1);
  });

  it('นับแพ็กเกจภายนอกแทนที่จะทิ้ง', () => {
    const result = buildGraph({
      files: [
        { path: 'a.ts', language: 'typescript' },
        { path: 'b.ts', language: 'typescript' },
      ],
      imports: new Map([
        ['a.ts', [imp('react'), imp('node:fs')]],
        ['b.ts', [imp('react')]],
      ]),
    });

    expect(result.edges).toHaveLength(0);
    expect(result.external[0]).toEqual({ specifier: 'react', count: 2 });
    expect(result.external.map((item) => item.specifier)).toContain('node:fs');
  });

  it('แยกนับแพ็กเกจภายนอกรายไฟล์ไว้ด้วย เพื่อให้วิเคราะห์ซ้ำแบบ incremental คืนค่านับได้โดยไม่ต้องพาร์สใหม่', () => {
    const result = buildGraph({
      files: [
        { path: 'a.ts', language: 'typescript' },
        { path: 'b.ts', language: 'typescript' },
      ],
      imports: new Map([
        ['a.ts', [imp('react'), imp('react')]],
        ['b.ts', [imp('lodash')]],
      ]),
    });

    expect(result.externalByFile).toEqual(
      expect.arrayContaining([
        { path: 'a.ts', specifier: 'react', count: 2 },
        { path: 'b.ts', specifier: 'lodash', count: 1 },
      ]),
    );
    expect(result.externalByFile).toHaveLength(2);
  });

  it('นับจำนวนที่แก้ไม่ได้ แทนที่จะเงียบ', () => {
    const result = buildGraph({
      files: [{ path: 'a.ts', language: 'typescript' }],
      imports: new Map([['a.ts', [imp('./หายไป')]]]),
    });

    expect(result.unresolved).toBe(1);
    expect(result.edges).toHaveLength(0);
  });
});

describe('กติกาเฉพาะภาษา', () => {
  it('Python: จุดนำหน้าคือการนำเข้าแบบสัมพัทธ์', () => {
    const result = buildGraph({
      files: [
        { path: 'pkg/app.py', language: 'python' },
        { path: 'pkg/helper.py', language: 'python' },
        { path: 'other.py', language: 'python' },
      ],
      imports: new Map([['pkg/app.py', [imp('.helper', 'from'), imp('..other', 'from')]]]),
    });

    const targets = result.edges.map((edge) => edge.to);
    expect(targets).toContain('pkg/helper.py');
    expect(targets).toContain('other.py');
  });

  it('Python: ชื่อโมดูลแบบจุดชี้ไปไฟล์ในโปรเจกต์ได้', () => {
    const result = buildGraph({
      files: [
        { path: 'app.py', language: 'python' },
        { path: 'package/module.py', language: 'python' },
      ],
      imports: new Map([['app.py', [imp('package.module')]]]),
    });

    expect(result.edges[0]?.to).toBe('package/module.py');
  });

  it('Go: ใช้ชื่อโมดูลจาก go.mod แยกของในโปรเจกต์ออกจากของภายนอก', () => {
    const result = buildGraph({
      files: [
        { path: 'main.go', language: 'go' },
        { path: 'internal/store/store.go', language: 'go' },
      ],
      imports: new Map([['main.go', [imp('example.com/app/internal/store'), imp('fmt')]]]),
      goModule: 'example.com/app',
    });

    expect(result.edges[0]?.to).toBe('internal/store/store.go');
    expect(result.external.map((item) => item.specifier)).toEqual(['fmt']);
  });

  it('นามแฝง @/ ชี้กลับเข้าโปรเจกต์ แต่ความมั่นใจต่ำกว่าเส้นทางตรง', () => {
    const result = buildGraph({
      files: [
        { path: 'app/page.tsx', language: 'tsx' },
        { path: 'components/card.tsx', language: 'tsx' },
      ],
      imports: new Map([['app/page.tsx', [imp('@/components/card')]]]),
    });

    expect(result.edges[0]?.to).toBe('components/card.tsx');
    expect(result.edges[0]?.confidence).toBeLessThan(0.9);
  });

  it('C: #include ที่ชื่อไฟล์ไม่ซ้ำ ชี้ไปไฟล์นั้นได้', () => {
    const result = buildGraph({
      files: [
        { path: 'src/main.c', language: 'c' },
        { path: 'include/util.h', language: 'c' },
      ],
      imports: new Map([['src/main.c', [imp('util.h', 'include')]]]),
    });

    expect(result.edges[0]?.to).toBe('include/util.h');
    expect(result.edges[0]?.confidence).toBeLessThan(0.6);
  });
});

describe('สรุปผลจากกราฟ', () => {
  it('ไม่สร้างเส้นซ้ำและไม่ให้ไฟล์ชี้หาตัวเอง', () => {
    const result = buildGraph({
      files: [
        { path: 'a.ts', language: 'typescript' },
        { path: 'b.ts', language: 'typescript' },
      ],
      imports: new Map([['a.ts', [imp('./b'), imp('./b'), imp('./a')]]]),
    });

    expect(result.edges).toHaveLength(1);
  });

  it('นับจำนวนไฟล์ที่พึ่งพาไฟล์หนึ่ง ๆ ได้', () => {
    const result = buildGraph({
      files: [
        { path: 'a.ts', language: 'typescript' },
        { path: 'b.ts', language: 'typescript' },
        { path: 'core.ts', language: 'typescript' },
      ],
      imports: new Map([
        ['a.ts', [imp('./core')]],
        ['b.ts', [imp('./core')]],
      ]),
    });

    expect(countDependents(result.edges).get('core.ts')).toBe(2);
  });
});
