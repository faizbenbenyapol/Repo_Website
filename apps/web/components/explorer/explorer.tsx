'use client';

import { useCallback, useMemo, useState } from 'react';
import { COLOR_MODES, legendFor, type ColorMode, type GraphData } from '../../lib/graph-view';
import { DependencyGraph } from './dependency-graph';
import { FileTree } from './file-tree';
import { Inspector } from './inspector';

interface Props {
  analysisId: string;
  data: GraphData;
  aiEnabled: boolean;
}

/**
 * พื้นที่ทำงานหลักสามคอลัมน์: รายการไฟล์ · กราฟ · รายละเอียด
 *
 * ทั้งสามส่วนแชร์สิ่งที่เลือกอยู่ตัวเดียวกัน เลือกจากที่ไหนก็ตาม อีกสองส่วนต้องตามไปด้วยเสมอ
 * เพราะสิ่งที่ทำให้เข้าใจโค้ดคือการเห็นของเดียวกันจากหลายมุมพร้อมกัน
 */
export function Explorer({ analysisId, data, aiEnabled }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>('folder');
  const [query, setQuery] = useState('');

  const byPath = useMemo(() => new Map(data.nodes.map((node) => [node.path, node])), [data.nodes]);

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return null;
    return new Set(
      data.nodes.filter((node) => node.path.toLowerCase().includes(keyword)).map((n) => n.path),
    );
  }, [data.nodes, query]);

  const legend = useMemo(() => legendFor(data.nodes, colorMode), [data.nodes, colorMode]);
  const select = useCallback((path: string | null) => setSelected(path), []);
  const activeMode = COLOR_MODES.find((mode) => mode.id === colorMode);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          aria-label="ค้นหาไฟล์"
          className="w-56 rounded-[6px] border border-line bg-surface px-3 py-1.5 font-mono text-[12.5px] outline-none transition-colors placeholder:text-faint focus:border-accent"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="ค้นหาไฟล์…"
          spellCheck={false}
          type="search"
          value={query}
        />

        <div className="flex items-center gap-1 rounded-[6px] border border-line-soft p-0.5">
          {COLOR_MODES.map((mode) => (
            <button
              key={mode.id}
              className={`rounded-[4px] px-3 py-1 text-[12.5px] transition-colors duration-150 ${
                colorMode === mode.id ? 'bg-accent-soft text-accent' : 'text-muted hover:text-text'
              }`}
              onClick={() => setColorMode(mode.id)}
              type="button"
            >
              {mode.label}
            </button>
          ))}
        </div>

        <p className="text-[12.5px] text-faint">{activeMode?.hint}</p>

        <p className="ml-auto font-mono text-[11px] text-faint tabular-nums">
          แสดง {data.nodes.length.toLocaleString('th-TH')} ไฟล์ ·{' '}
          {data.edges.length.toLocaleString('th-TH')} เส้นเชื่อม
          {data.truncated ? ` (จากทั้งหมด ${data.totalNodes.toLocaleString('th-TH')})` : ''}
        </p>
      </div>

      {data.truncated ? (
        <p className="border-l-2 border-brass pl-3 text-[12.5px] text-brass">
          repo นี้ใหญ่เกินกว่าจะวาดทั้งหมดพร้อมกัน จึงแสดงเฉพาะไฟล์ที่มีความสัมพันธ์มากที่สุดก่อน
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[260px_1fr_320px]">
        <div className="panel h-[560px] overflow-y-auto">
          <FileTree nodes={data.nodes} onSelect={select} query={query} selected={selected} />
        </div>

        <div className="panel relative h-[560px] overflow-hidden">
          <DependencyGraph
            colorMode={colorMode}
            data={data}
            onSelect={select}
            selected={selected}
            visible={visible}
          />

          {legend.length > 0 ? (
            <ul className="absolute top-3 left-3 flex max-w-[60%] flex-wrap gap-x-3 gap-y-1">
              {legend.map((entry) => (
                <li key={entry.label} className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="size-2 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="font-mono text-[10.5px] text-muted">{entry.label}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="panel h-[560px] overflow-y-auto">
          <Inspector
            aiEnabled={aiEnabled}
            analysisId={analysisId}
            node={selected ? (byPath.get(selected) ?? null) : null}
            onSelect={select}
          />
        </div>
      </div>
    </div>
  );
}
