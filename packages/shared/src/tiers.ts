import { z } from 'zod';

/**
 * ระดับการใช้งานมีสองระดับตาม ADR 0001
 * - visitor: ไม่ล็อกอิน ได้ผลวิเคราะห์เชิงโครงสร้างทั้งหมด
 * - member: ล็อกอินแล้วใส่ API key ของตัวเอง จึงเปิดชั้นความเข้าใจด้วย AI
 * ตารางในไฟล์นี้เป็นแหล่งความจริงเดียว ทั้งหน้าบ้านและหลังบ้านต้องอ่านจากที่นี่
 */
export const TIERS = ['visitor', 'member'] as const;
export type Tier = (typeof TIERS)[number];

export const tierSchema = z.enum(TIERS);

export interface TierInfo {
  id: Tier;
  name: string;
  summary: string;
  requirement: string;
  costBearer: string;
}

export const TIER_INFO: Record<Tier, TierInfo> = {
  visitor: {
    id: 'visitor',
    name: 'ผู้เยี่ยมชม',
    summary: 'เปิดมาก็ใช้ได้เลย ได้ผลวิเคราะห์เชิงโครงสร้างของ repo ทั้งหมด',
    requirement: 'ไม่ต้องล็อกอิน ไม่ต้องใส่อะไร',
    costBearer: 'ไม่มีค่าใช้จ่าย',
  },
  member: {
    id: 'member',
    name: 'สมาชิก',
    summary: 'ได้ทุกอย่างของผู้เยี่ยมชม บวกคำอธิบายภาษาไทยและการถาม–ตอบกับ repo',
    requirement: 'ล็อกอิน แล้วใส่ API key ของ Claude ที่เป็นของคุณเอง',
    costBearer: 'ค่าเรียกใช้โมเดลคิดกับ API key ของคุณโดยตรง',
  },
};

export type FeatureStatus = 'shipped' | 'planned';

export interface Feature {
  id: string;
  name: string;
  detail: string;
  tier: Tier;
  status: FeatureStatus;
  /** รุ่นที่ฟีเจอร์นี้ใช้งานได้จริง */
  since: string;
}

export const FEATURES: Feature[] = [
  {
    id: 'dependency-graph',
    name: 'กราฟความสัมพันธ์ระหว่างไฟล์',
    detail: 'ลากซูมได้ สลับโหมดสีตามโฟลเดอร์ ภาษา หรือความสำคัญของไฟล์',
    tier: 'visitor',
    status: 'shipped',
    since: '0.3.0',
  },
  {
    id: 'file-explorer',
    name: 'ตัวสำรวจไฟล์และรายการฟังก์ชัน',
    detail: 'เลือกไฟล์แล้วเห็นฟังก์ชันและคลาสข้างใน พร้อมไฟล์ที่เกี่ยวข้องทั้งสองทิศทาง',
    tier: 'visitor',
    status: 'shipped',
    since: '0.3.0',
  },
  {
    id: 'health-score',
    name: 'คะแนนสุขภาพและตัวชี้วัด',
    detail: 'เกรด A–F จากโค้ดตาย วงจรพึ่งพา ความผูกกันแน่น และช่องโหว่ที่พบ',
    tier: 'visitor',
    status: 'planned',
    since: '0.4.0',
  },
  {
    id: 'blast-radius',
    name: 'รัศมีผลกระทบ',
    detail: 'ถ้าแก้ไฟล์นี้ ไฟล์ไหนได้รับผลกระทบบ้าง',
    tier: 'visitor',
    status: 'planned',
    since: '0.4.0',
  },
  {
    id: 'export-json',
    name: 'ส่งออกผลวิเคราะห์เป็น JSON',
    detail: 'เอาไปต่อยอดในเครื่องมืออื่นหรือใน CI ของคุณเองได้',
    tier: 'visitor',
    status: 'planned',
    since: '0.4.0',
  },
  {
    id: 'repo-digest',
    name: 'สรุป repo เป็นภาษาไทย',
    detail: 'โปรเจกต์นี้ทำอะไร ใช้อะไร จุดเริ่มโปรแกรมอยู่ไหน รันอย่างไร',
    tier: 'member',
    status: 'planned',
    since: '0.5.0',
  },
  {
    id: 'file-summary',
    name: 'คำอธิบายรายไฟล์',
    detail: 'ทุกไฟล์มีสรุปภาษาไทยสั้น ๆ ว่าไฟล์นี้รับผิดชอบอะไร',
    tier: 'member',
    status: 'planned',
    since: '0.5.0',
  },
  {
    id: 'ask-repo',
    name: 'ถาม–ตอบกับ repo',
    detail: 'ถามเป็นภาษาไทย ได้คำตอบพร้อมอ้างอิงไฟล์และบรรทัดจริงที่คลิกเปิดได้',
    tier: 'member',
    status: 'planned',
    since: '0.6.0',
  },
  {
    id: 'reading-path',
    name: 'เส้นทางอ่านโค้ดสำหรับคนใหม่',
    detail: 'ควรเริ่มอ่านไฟล์ไหนก่อน เรียงจากความสำคัญที่คำนวณจากกราฟจริง',
    tier: 'member',
    status: 'planned',
    since: '0.6.0',
  },
  {
    id: 'thai-report',
    name: 'รายงานภาษาไทย',
    detail: 'ส่งออกเป็น Markdown หรือ PDF สำหรับส่งต่อให้ทีม',
    tier: 'member',
    status: 'planned',
    since: '0.7.0',
  },
];

export function featuresForTier(tier: Tier): Feature[] {
  return tier === 'member' ? FEATURES : FEATURES.filter((f) => f.tier === 'visitor');
}

export function isAvailable(featureId: string, tier: Tier): boolean {
  const feature = FEATURES.find((f) => f.id === featureId);
  if (!feature) return false;
  if (feature.status !== 'shipped') return false;
  return feature.tier === 'visitor' || tier === 'member';
}

export const sessionStateSchema = z.object({
  tier: tierSchema,
  signedIn: z.boolean(),
  /** สี่ตัวท้ายของ API key ที่ผูกไว้ — ไม่มีทางส่งกุญแจเต็มกลับมาหน้าบ้าน */
  apiKeyHint: z.string().nullable(),
  aiEnabled: z.boolean(),
  /** เหตุผลที่ยังใช้ AI ไม่ได้ เขียนให้ผู้ใช้อ่านรู้เรื่องว่าต้องทำอะไรต่อ */
  aiBlockedReason: z.string().nullable(),
});

export type SessionState = z.infer<typeof sessionStateSchema>;

export const ANONYMOUS_SESSION: SessionState = {
  tier: 'visitor',
  signedIn: false,
  apiKeyHint: null,
  aiEnabled: false,
  aiBlockedReason: 'ล็อกอินแล้วใส่ API key ของคุณเองเพื่อเปิดคำอธิบายและการถาม–ตอบด้วย AI',
};
