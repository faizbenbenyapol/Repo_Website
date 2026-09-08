import { z } from 'zod';

/**
 * กติกาของบัญชีผู้ใช้ ใช้ร่วมกันทั้งหน้าบ้านและหลังบ้าน
 * ข้อความผิดพลาดเขียนเป็นภาษาไทยไว้ตรงนี้ที่เดียว หน้าบ้านจึงไม่ต้องเดาว่า API จะบ่นว่าอะไร
 */

export const emailSchema = z
  .string({ required_error: 'ยังไม่ได้ใส่อีเมล' })
  .trim()
  .toLowerCase()
  .min(3, 'ยังไม่ได้ใส่อีเมล')
  .max(200, 'อีเมลยาวเกินไป')
  .email('อีเมลนี้ยังไม่ถูกรูปแบบ');

/**
 * ความยาวขั้นต่ำสิบตัวอักษร ไม่บังคับตัวพิมพ์ใหญ่หรืออักขระพิเศษ
 * เพราะกฎจุกจิกทำให้คนตั้งรหัสที่เดาง่ายแต่พิมพ์ยาก ส่วนความยาวคือสิ่งที่กันการเดาได้จริง
 */
export const passwordSchema = z
  .string({ required_error: 'ยังไม่ได้ใส่รหัสผ่าน' })
  .min(10, 'รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร')
  .max(200, 'รหัสผ่านยาวเกินไป');

export const credentialsSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export type Credentials = z.infer<typeof credentialsSchema>;

/**
 * กุญแจของ Anthropic ขึ้นต้นด้วย sk-ant- เสมอ
 * ตรวจรูปแบบตั้งแต่หน้าบ้านเพื่อไม่ให้ผู้ใช้เสียเวลารอไปจนถึงตอนเรียกโมเดลจริงแล้วค่อยรู้ว่าพิมพ์ผิด
 */
export const apiKeySchema = z
  .string({ required_error: 'ยังไม่ได้ใส่ API key' })
  .trim()
  .min(20, 'API key สั้นเกินกว่าจะถูกต้อง')
  .max(300, 'API key ยาวเกินกว่าจะถูกต้อง')
  .regex(/^sk-ant-/, 'API key ของ Claude ขึ้นต้นด้วย sk-ant- เสมอ');

export const apiKeyBodySchema = z.object({ apiKey: apiKeySchema });

/** อายุของ session นับจากครั้งล่าสุดที่ใช้งาน */
export const SESSION_TTL_DAYS = 30;

/**
 * อายุของกุญแจที่ผูกไว้ สั้นกว่าตัว session มาก
 * เพราะกุญแจคือสิ่งที่ใช้จ่ายเงินของผู้ใช้ได้จริง เครื่องที่ถูกทิ้งค้างไว้จึงไม่ควรใช้ได้ข้ามวัน
 */
export const API_KEY_TTL_HOURS = 12;

export const SESSION_COOKIE = 'repolens_session';

export interface AccountUser {
  id: string;
  email: string;
  createdAt: string;
}

/** ผลของการตรวจกุญแจกับ Anthropic ก่อนรับเก็บ */
export type KeyCheck = 'ok' | 'invalid' | 'unknown';

export const KEY_CHECK_MESSAGES: Record<KeyCheck, string> = {
  ok: 'ตรวจกับ Anthropic แล้วว่ากุญแจนี้ใช้ได้จริง',
  invalid: 'Anthropic ปฏิเสธกุญแจนี้ — ตรวจว่าคัดลอกมาครบและยังไม่ถูกยกเลิก',
  unknown:
    'ยังตรวจกับ Anthropic ไม่ได้ในตอนนี้ จึงเก็บไว้ก่อน ถ้าใช้ไม่ได้จะรู้ตอนสั่งสรุปครั้งแรก',
};
