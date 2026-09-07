'use client';

import { useEffect, useState } from 'react';
import type { FileDetail, GraphNode } from '../../lib/graph-view';

interface Props {
  analysisId: string;
  node: GraphNode | null;
  onSelect: (path: string) => void;
}

const KIND_LABELS: Record<string, string> = {
  function: 'ฟังก์ชัน',
  method: 'เมท็อด',
  class: 'คลาส',
  interface: 'อินเทอร์เฟซ',
  type: 'ชนิดข้อมูล',
};

function PathList({
  title,
  empty,
  paths,
  onSelect,
}: {
  title: string;
  empty: string;
  paths: string[];
  onSelect: (path: string) => void;
}) {
  return (
    <section>
      <p className="label">{title}</p>
      {paths.length === 0 ? (
        <p className="mt-2 text-sm text-faint">{empty}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {paths.map((path) => (
            <li key={path}>
              <button
                className="w-full truncate text-left font-mono text-[12.5px] text-muted transition-colors hover:text-accent"
                onClick={() => onSelect(path)}
                title={path}
                type="button"
              >
                {path}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * แผงรายละเอียดของไฟล์ที่เลือก
 *
 * โหลดข้อมูลเชิงลึกเมื่อผู้ใช้เลือกไฟล์เท่านั้น ไม่ดึงมาล่วงหน้าทั้ง repo
 * เพราะ repo ใหญ่มี symbol เป็นแสนรายการ ซึ่งไม่มีใครดูพร้อมกันทีเดียวอยู่แล้ว
 */
export function Inspector({ analysisId, node, onSelect }: Props) {
  const [detail, setDetail] = useState<FileDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!node) {
      setDetail(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    fetch(`/api/analyses/${analysisId}/files/detail?path=${encodeURIComponent(node.path)}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: FileDetail | null) => setDetail(body))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [analysisId, node]);

  if (!node) {
    return (
      <div className="p-6">
        <p className="label">ยังไม่ได้เลือกไฟล์</p>
        <p className="mt-3 text-sm text-muted">
          คลิกโหนดในกราฟหรือเลือกไฟล์จากรายการทางซ้าย เพื่อดูว่าไฟล์นั้นมีอะไรอยู่ข้างใน
          และเกี่ยวข้องกับไฟล์ไหนบ้าง
        </p>
      </div>
    );
  }

  return (
    <div className="rise flex flex-col gap-6 p-6">
      <div>
        <p className="label">ไฟล์ที่เลือก</p>
        <p className="mt-2 font-mono text-sm break-all">{node.path}</p>
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[11px] text-faint">
          <div className="flex gap-1">
            <dt>ภาษา</dt>
            <dd className="text-muted">{node.language ?? 'ไม่ทราบ'}</dd>
          </div>
          <div className="flex gap-1">
            <dt>บรรทัด</dt>
            <dd className="text-muted tabular-nums">{node.loc.toLocaleString('th-TH')}</dd>
          </div>
          <div className="flex gap-1">
            <dt>ถูกพึ่งพา</dt>
            <dd className="text-muted tabular-nums">{node.dependents}</dd>
          </div>
          <div className="flex gap-1">
            <dt>พึ่งพา</dt>
            <dd className="text-muted tabular-nums">{node.dependencies}</dd>
          </div>
          <div className="flex gap-1" title="จำนวนไฟล์ที่ได้รับผลกระทบถ้าแก้ไฟล์นี้ รวมทางอ้อม">
            <dt>รัศมีผลกระทบ</dt>
            <dd className="text-muted tabular-nums">{node.blast}</dd>
          </div>
          {detail && detail.churn > 0 ? (
            <div className="flex gap-1" title="จำนวนคอมมิตที่แตะไฟล์นี้ในประวัติที่อ่านมา">
              <dt>ถูกแก้</dt>
              <dd className="text-muted tabular-nums">{detail.churn} ครั้ง</dd>
            </div>
          ) : null}
        </dl>
      </div>

      {loading ? <p className="text-sm text-faint">กำลังโหลดรายละเอียด…</p> : null}

      {detail ? (
        <>
          <section>
            <p className="label">สิ่งที่ประกาศไว้ในไฟล์นี้</p>
            {detail.symbols.length === 0 ? (
              <p className="mt-2 text-sm text-faint">
                ไม่พบฟังก์ชันหรือคลาส — อาจเป็นไฟล์ข้อมูล ไฟล์ตั้งค่า
                หรือภาษาที่ยังอ่านโครงสร้างไม่ได้
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {detail.symbols.map((symbol) => (
                  <li
                    key={`${symbol.name}-${symbol.line}`}
                    className="flex items-baseline gap-2 text-sm"
                  >
                    <span className="w-10 shrink-0 text-right font-mono text-[11px] text-faint tabular-nums">
                      {symbol.line}
                    </span>
                    <span className="font-mono text-[12.5px]">{symbol.name}</span>
                    <span className="text-[11px] text-faint">
                      {KIND_LABELS[symbol.kind] ?? symbol.kind}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {detail.authors.length > 0 ? (
            <section>
              <p className="label">ควรถามใครเรื่องไฟล์นี้</p>
              <ul className="mt-2 flex flex-col gap-1">
                {detail.authors.map((author) => (
                  <li
                    key={author.name}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span>{author.name}</span>
                    <span className="font-mono text-[11px] text-faint tabular-nums">
                      {author.commits} คอมมิต
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <PathList
            empty="ยังไม่มีไฟล์ไหนพึ่งพาไฟล์นี้"
            onSelect={onSelect}
            paths={detail.dependents}
            title="ไฟล์ที่พึ่งพาไฟล์นี้"
          />

          <PathList
            empty="ไฟล์นี้ไม่ได้เรียกใช้ไฟล์อื่นในโปรเจกต์"
            onSelect={onSelect}
            paths={detail.dependencies}
            title="ไฟล์ที่ไฟล์นี้เรียกใช้"
          />
        </>
      ) : null}
    </div>
  );
}
