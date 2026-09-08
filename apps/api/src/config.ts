import { resolve } from 'node:path';
import { readBuildInfo } from '@repolens/shared';

/**
 * กุญแจสำหรับเข้ารหัส API key ของสมาชิก
 *
 * บนเซิร์ฟเวอร์จริงต้องมีค่านี้เสมอ ถ้าไม่มีให้ล้มตั้งแต่ตอนเปิดเครื่อง
 * ดีกว่าเปิดบริการขึ้นมาแล้วเข้ารหัสความลับของผู้ใช้ด้วยค่าที่ใคร ๆ ก็เดาได้
 */
function readSessionSecret(): string {
  const secret = process.env.SESSION_SECRET?.trim();
  if (secret && secret.length >= 16) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'ยังไม่ได้ตั้ง SESSION_SECRET — สร้างด้วย openssl rand -hex 32 แล้วใส่ในไฟล์ .env ก่อนเปิดบริการ',
    );
  }

  return 'repolens-dev-secret-ห้ามใช้บนเซิร์ฟเวอร์จริง';
}

/**
 * คุกกี้ session ส่งได้เฉพาะบน HTTPS เมื่ออยู่บนเซิร์ฟเวอร์จริง
 *
 * ค่าที่ตั้งมาเองต้องชนะเสมอ ไม่ใช่ให้ NODE_ENV ตัดสินอยู่ฝ่ายเดียว
 * เพราะชุดทดสอบปลายทางรันอิมเมจ production ตัวจริงแต่ยิงผ่าน http ในเครือข่ายของ compose
 * ถ้าปิดแฟล็กนี้ไม่ได้ เบราว์เซอร์จะทิ้งคุกกี้ และเส้นทางล็อกอินทั้งเส้นจะไม่มีวันถูกทดสอบเลย
 */
function readCookieSecure(): boolean {
  const explicit = process.env.COOKIE_SECURE?.trim();
  if (explicit === '1') return true;
  if (explicit === '0') return false;
  return process.env.NODE_ENV === 'production';
}

export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3001),
  /** โฟลเดอร์บันทึกรุ่น — ในอิมเมจถูกคัดลอกไปไว้ข้าง ๆ โค้ด จึงตั้งค่าผ่าน env ได้ */
  changelogDir: resolve(process.env.CHANGELOG_DIR ?? '../../docs/changelog'),
  buildInfo: readBuildInfo(process.env),
  /** เปิดให้วิเคราะห์โฟลเดอร์ในเครื่องได้เฉพาะตอนทดสอบเท่านั้น ห้ามเปิดบนเซิร์ฟเวอร์จริง */
  allowLocalRepos: process.env.ALLOW_LOCAL_REPOS === '1',
  sessionSecret: readSessionSecret(),
  cookieSecure: readCookieSecure(),
  /**
   * ตรวจกุญแจกับ Anthropic ก่อนรับเก็บ
   * ปิดได้เฉพาะในชุดทดสอบที่ตั้งใจไม่ให้ออกอินเทอร์เน็ต — การตรวจตัวจริงมีเทสต์ของมันเองใน @repolens/ai
   */
  verifyApiKeys: process.env.VERIFY_API_KEYS !== '0',
} as const;
