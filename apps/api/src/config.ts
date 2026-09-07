import { resolve } from 'node:path';
import { readBuildInfo } from '@repolens/shared';

export const config = {
  host: process.env.HOST ?? '0.0.0.0',
  port: Number(process.env.PORT ?? 3001),
  /** โฟลเดอร์บันทึกรุ่น — ในอิมเมจถูกคัดลอกไปไว้ข้าง ๆ โค้ด จึงตั้งค่าผ่าน env ได้ */
  changelogDir: resolve(process.env.CHANGELOG_DIR ?? '../../docs/changelog'),
  buildInfo: readBuildInfo(process.env),
  /** เปิดให้วิเคราะห์โฟลเดอร์ในเครื่องได้เฉพาะตอนทดสอบเท่านั้น ห้ามเปิดบนเซิร์ฟเวอร์จริง */
  allowLocalRepos: process.env.ALLOW_LOCAL_REPOS === '1',
} as const;
