'use client';

import { useEffect, useMemo, useState } from 'react';
import { buildTree, type GraphNode, type TreeNode } from '../../lib/graph-view';

interface Props {
  nodes: GraphNode[];
  selected: string | null;
  onSelect: (path: string) => void;
  query: string;
}

function collectOpenPaths(path: string): string[] {
  const segments = path.split('/');
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'));
}

function Row({
  node,
  depth,
  selected,
  onSelect,
  open,
  toggle,
}: {
  node: TreeNode;
  depth: number;
  selected: string | null;
  onSelect: (path: string) => void;
  open: Set<string>;
  toggle: (path: string) => void;
}) {
  const isDirectory = node.file === null;
  const isOpen = open.has(node.path);
  const isSelected = node.path === selected;

  return (
    <li>
      <button
        className={`flex w-full items-baseline gap-2 rounded-[4px] py-[3px] pr-2 text-left transition-colors duration-100 hover:bg-surface-2 ${
          isSelected ? 'bg-accent-soft text-accent' : ''
        }`}
        onClick={() => (isDirectory ? toggle(node.path) : onSelect(node.path))}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        type="button"
      >
        <span aria-hidden="true" className="w-3 shrink-0 font-mono text-[10px] text-faint">
          {isDirectory ? (isOpen ? '▾' : '▸') : ''}
        </span>
        <span className={`truncate font-mono text-[12.5px] ${isDirectory ? 'text-text' : ''}`}>
          {node.name}
        </span>
        {isDirectory ? (
          <span className="ml-auto shrink-0 font-mono text-[10px] text-faint tabular-nums">
            {node.fileCount}
          </span>
        ) : node.file && node.file.dependents > 0 ? (
          <span
            className="ml-auto shrink-0 font-mono text-[10px] text-faint tabular-nums"
            title={`มี ${node.file.dependents} ไฟล์พึ่งพาไฟล์นี้`}
          >
            ←{node.file.dependents}
          </span>
        ) : null}
      </button>

      {isDirectory && isOpen ? (
        <ul>
          {node.children.map((child) => (
            <Row
              key={child.path}
              depth={depth + 1}
              node={child}
              onSelect={onSelect}
              open={open}
              selected={selected}
              toggle={toggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * ต้นไม้ไฟล์
 *
 * เปิดโฟลเดอร์ชั้นบนสุดไว้ให้ตั้งแต่แรก เพราะการเปิดหน้ามาแล้วเจอรายการปิดหมด
 * ทำให้ต้องคลิกหลายครั้งกว่าจะเห็นว่าโปรเจกต์มีอะไรบ้าง
 */
export function FileTree({ nodes, selected, onSelect, query }: Props) {
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return nodes;
    return nodes.filter((node) => node.path.toLowerCase().includes(keyword));
  }, [nodes, query]);

  const tree = useMemo(() => buildTree(filtered), [filtered]);

  const [open, setOpen] = useState<Set<string>>(new Set());

  // ระหว่างค้นหา ต้องเห็นไฟล์ที่ตรงทันที ไม่ใช่ต้องไล่คลี่โฟลเดอร์เอง
  // ส่วนตอนไม่ได้ค้นหา คลี่แค่ชั้นบนสุดพอ ไม่งั้น repo ใหญ่จะกลายเป็นรายการยาวเหยียดตั้งแต่เปิดหน้า
  const searching = query.trim().length > 0;

  useEffect(() => {
    const directories: string[] = [];
    const collect = (node: TreeNode, depth: number): void => {
      if (node.file !== null) return;
      if (node.path) directories.push(node.path);
      if (searching || depth === 0) node.children.forEach((child) => collect(child, depth + 1));
    };
    collect(tree, 0);

    setOpen((current) => {
      const next = new Set(current);
      for (const path of directories) next.add(path);
      return next;
    });
  }, [tree, searching]);

  // เลือกไฟล์จากกราฟแล้วต้นไม้ต้องคลี่ให้เห็นไฟล์นั้นด้วย ไม่ใช่ให้ผู้ใช้ไปหาเอง
  useEffect(() => {
    if (!selected) return;
    setOpen((current) => {
      const next = new Set(current);
      for (const path of collectOpenPaths(selected)) next.add(path);
      return next;
    });
  }, [selected]);

  const toggle = (path: string): void => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  if (filtered.length === 0) {
    return <p className="px-3 py-4 text-sm text-faint">ไม่พบไฟล์ที่ตรงกับคำค้น</p>;
  }

  return (
    <ul className="py-2">
      {tree.children.map((child) => (
        <Row
          key={child.path}
          depth={0}
          node={child}
          onSelect={onSelect}
          open={open}
          selected={selected}
          toggle={toggle}
        />
      ))}
    </ul>
  );
}
