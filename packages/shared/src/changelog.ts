import { z } from 'zod';

/** หัวข้อที่อนุญาตในบันทึกรุ่น จงใจให้มีจำกัด เพื่อให้ทุกรุ่นอ่านแล้วเทียบกันได้ */
export const CHANGE_HEADINGS = ['เพิ่ม', 'แก้', 'ปรับ', 'ถอด', 'หมายเหตุอัปเกรด'] as const;
export type ChangeHeading = (typeof CHANGE_HEADINGS)[number];

export const releaseNoteSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'เวอร์ชันต้องอยู่ในรูป x.y.z'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ต้องอยู่ในรูป YYYY-MM-DD'),
  title: z.string().min(1),
  sections: z
    .array(
      z.object({
        heading: z.enum(CHANGE_HEADINGS),
        items: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
});

export type ReleaseNote = z.infer<typeof releaseNoteSchema>;

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** แปลงไฟล์บันทึกรุ่นหนึ่งไฟล์เป็นข้อมูลที่ API และหน้าเว็บใช้ร่วมกัน */
export function parseReleaseNote(markdown: string, source = 'บันทึกรุ่น'): ReleaseNote {
  const match = FRONTMATTER.exec(markdown);
  if (!match?.[1]) {
    throw new Error(`${source}: ไม่พบส่วนหัว --- ที่ต้นไฟล์`);
  }

  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at === -1) continue;
    meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }

  const body = markdown.slice(match[0].length);
  const sections: { heading: ChangeHeading; items: string[] }[] = [];
  let current: { heading: ChangeHeading; items: string[] } | null = null;

  for (const raw of body.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(raw);
    if (heading?.[1]) {
      const name = heading[1] as ChangeHeading;
      if (!CHANGE_HEADINGS.includes(name)) {
        throw new Error(
          `${source}: หัวข้อ "${name}" ใช้ไม่ได้ ต้องเป็นหนึ่งใน ${CHANGE_HEADINGS.join(' / ')}`,
        );
      }
      current = { heading: name, items: [] };
      sections.push(current);
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(raw);
    if (bullet?.[1] !== undefined && current) {
      current.items.push(bullet[1].trim());
      continue;
    }

    // บรรทัดย่อหน้าต่อจากหัวข้อย่อยเดิม ให้ต่อท้ายรายการล่าสุด
    const continued = /^\s+(\S.*)$/.exec(raw);
    if (continued?.[1] && current && current.items.length > 0) {
      const last = current.items.length - 1;
      current.items[last] = `${current.items[last]} ${continued[1].trim()}`;
    }
  }

  const parsed = releaseNoteSchema.safeParse({
    version: meta.version,
    date: meta.date,
    title: meta.title,
    sections,
  });

  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || 'ไฟล์'}: ${i.message}`);
    throw new Error(`${source}: ${detail.join(', ')}`);
  }

  return parsed.data;
}

/** เทียบเวอร์ชันแบบ semver อย่างง่าย (โปรเจกต์นี้ไม่ใช้ prerelease) */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** เรียงจากรุ่นใหม่ไปเก่า ซึ่งเป็นลำดับที่หน้าเว็บใช้แสดงเสมอ */
export function sortReleases(releases: ReleaseNote[]): ReleaseNote[] {
  return [...releases].sort((a, b) => compareVersions(b.version, a.version));
}

export function countChanges(release: ReleaseNote): number {
  return release.sections.reduce((total, section) => total + section.items.length, 0);
}

/** ประกอบ CHANGELOG.md จากบันทึกรุ่นทุกไฟล์ ผลลัพธ์ต้องเหมือนเดิมทุกครั้งที่รัน */
export function renderChangelog(releases: ReleaseNote[]): string {
  const lines = [
    '# บันทึกการเปลี่ยนแปลง',
    '',
    'ไฟล์นี้ประกอบขึ้นอัตโนมัติจาก `docs/changelog/*.md` ด้วยคำสั่ง `make changelog` — อย่าแก้ด้วยมือ',
    '',
  ];

  for (const release of sortReleases(releases)) {
    lines.push(`## v${release.version} — ${release.title}`, '', `วันที่ ${release.date}`, '');
    for (const section of release.sections) {
      lines.push(`### ${section.heading}`, '');
      for (const item of section.items) lines.push(`- ${item}`);
      lines.push('');
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
