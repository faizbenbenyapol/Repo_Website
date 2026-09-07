'use client';

import { useEffect, useRef, useState } from 'react';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import Sigma from 'sigma';
import { colorFor, sizeFor, type ColorMode, type GraphData } from '../../lib/graph-view';

interface Props {
  data: GraphData;
  selected: string | null;
  onSelect: (path: string | null) => void;
  colorMode: ColorMode;
  /** พาธที่ผ่านตัวกรองค้นหา — นอกชุดนี้จะถูกหรี่ลง */
  visible: Set<string> | null;
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function readToken(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * กราฟความสัมพันธ์ระหว่างไฟล์
 *
 * เรนเดอร์ด้วย WebGL ผ่าน sigma เพราะ repo ขนาดจริงมีหลายพันโหนด
 * ซึ่ง SVG วาดไม่ไหว (ข้อจำกัดข้อหนึ่งของเครื่องมือต้นทางที่ตั้งใจแก้ในโปรเจกต์นี้)
 * เครื่องที่ไม่มี WebGL จะได้ตารางแทน ไม่ใช่พื้นที่ว่าง
 */
export function DependencyGraph({ data, selected, onSelect, colorMode, visible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const stateRef = useRef({ selected, visible, hovered: null as string | null });
  const [supported, setSupported] = useState<boolean | null>(null);
  const [laidOut, setLaidOut] = useState(false);

  useEffect(() => {
    setSupported(hasWebGL());
  }, []);

  // สร้างกราฟใหม่เมื่อชุดข้อมูลเปลี่ยน — การจัดวางตำแหน่งทำครั้งเดียวเพราะกินแรงที่สุด
  useEffect(() => {
    if (supported !== true || !containerRef.current) return;

    const graph = new Graph({ type: 'directed', multi: false });
    const maxDependents = data.nodes.reduce((max, node) => Math.max(max, node.dependents), 0);
    const count = Math.max(data.nodes.length, 1);

    data.nodes.forEach((node, index) => {
      // เริ่มจากวงกลม แล้วให้ ForceAtlas2 จัดต่อ ได้ผลนิ่งกว่าเริ่มจากตำแหน่งสุ่มล้วน
      const angle = (index / count) * Math.PI * 2;
      graph.addNode(node.path, {
        label: node.path.slice(node.path.lastIndexOf('/') + 1),
        x: Math.cos(angle) * (1 + (index % 7) / 7),
        y: Math.sin(angle) * (1 + (index % 5) / 5),
        size: sizeFor(node),
        color: colorFor(node, colorMode, maxDependents),
      });
    });

    for (const edge of data.edges) {
      if (
        graph.hasNode(edge.src) &&
        graph.hasNode(edge.dst) &&
        !graph.hasEdge(edge.src, edge.dst)
      ) {
        graph.addDirectedEdge(edge.src, edge.dst, { size: 0.6, weight: edge.confidence });
      }
    }

    if (graph.order > 1) {
      const iterations = graph.order > 1500 ? 80 : graph.order > 400 ? 200 : 400;
      forceAtlas2.assign(graph, {
        iterations,
        settings: { ...forceAtlas2.inferSettings(graph), adjustSizes: true, gravity: 0.6 },
      });
    }

    const dim = readToken('--color-faint', '#8590a8');
    const edgeColor = readToken('--color-line', '#c7d0e1');
    const accent = readToken('--color-accent', '#2a57c6');

    const renderer = new Sigma(graph, containerRef.current, {
      renderLabels: true,
      labelRenderedSizeThreshold: 8,
      labelFont: 'IBM Plex Mono, monospace',
      labelSize: 11,
      labelColor: { color: dim },
      defaultEdgeColor: edgeColor,
      minCameraRatio: 0.05,
      maxCameraRatio: 8,
      nodeReducer: (key, attributes) => {
        const { selected: current, visible: filter, hovered } = stateRef.current;
        const isSelected = key === current;
        const neighbourOf = current ?? hovered;
        const related =
          neighbourOf !== null &&
          (key === neighbourOf ||
            graph.hasEdge(neighbourOf, key) ||
            graph.hasEdge(key, neighbourOf));
        const filteredOut = filter !== null && !filter.has(key);

        if (filteredOut)
          return { ...attributes, color: dim, size: attributes.size * 0.5, label: '' };
        if (isSelected) {
          return {
            ...attributes,
            color: accent,
            size: attributes.size * 1.6,
            zIndex: 2,
            forceLabel: true,
          };
        }
        if (neighbourOf !== null && !related) {
          return { ...attributes, color: dim, label: '' };
        }
        return attributes;
      },
      edgeReducer: (key, attributes) => {
        const { selected: current, visible: filter, hovered } = stateRef.current;
        const focus = current ?? hovered;
        const [src, dst] = graph.extremities(key);
        const filteredOut = filter !== null && (!filter.has(src) || !filter.has(dst));
        if (filteredOut) return { ...attributes, hidden: true };
        if (focus !== null) {
          if (src === focus || dst === focus) {
            return { ...attributes, color: accent, size: 1.2, zIndex: 1 };
          }
          return { ...attributes, hidden: true };
        }
        return attributes;
      },
    });

    renderer.on('clickNode', ({ node }) => onSelect(node));
    renderer.on('clickStage', () => onSelect(null));
    renderer.on('enterNode', ({ node }) => {
      stateRef.current.hovered = node;
      renderer.refresh();
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
    });
    renderer.on('leaveNode', () => {
      stateRef.current.hovered = null;
      renderer.refresh();
      if (containerRef.current) containerRef.current.style.cursor = 'default';
    });

    sigmaRef.current = renderer;
    graphRef.current = graph;
    setLaidOut(true);

    return () => {
      renderer.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
  }, [data, colorMode, onSelect, supported]);

  // เปลี่ยนสิ่งที่เลือกหรือตัวกรอง ไม่ต้องสร้างกราฟใหม่ แค่วาดซ้ำ
  useEffect(() => {
    stateRef.current.selected = selected;
    stateRef.current.visible = visible;
    sigmaRef.current?.refresh();
  }, [selected, visible]);

  if (supported === false) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted">
        เบราว์เซอร์นี้เปิด WebGL ไม่ได้ จึงวาดกราฟให้ไม่ได้ — ใช้รายการไฟล์ทางซ้ายแทนได้เลย
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" data-testid="graph-canvas" />

      {supported === null || !laidOut ? (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-faint">
          กำลังจัดวางกราฟ…
        </p>
      ) : null}

      <div className="pointer-events-none absolute right-3 bottom-3 font-mono text-[11px] text-faint">
        คลิกโหนดเพื่อดูรายละเอียด · ลากเพื่อเลื่อน · สกรอลล์เพื่อซูม
      </div>
    </div>
  );
}
