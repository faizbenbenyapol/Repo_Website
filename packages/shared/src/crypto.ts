import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

/**
 * งานความลับทั้งหมดของระบบอยู่ในไฟล์นี้ไฟล์เดียว
 *
 * เหตุผลที่รวมไว้ที่เดียวคือความลับพลาดได้ครั้งเดียวก็จบ — ถ้ากระจายอยู่หลายที่
 * จะไม่มีใครตอบได้ว่าตกลงระบบแฮชรหัสผ่านด้วยอะไร หรือกุญแจของผู้ใช้ถูกเข้ารหัสจริงหรือเปล่า
 * ทุกฟังก์ชันในนี้ใช้ของที่มากับ Node เท่านั้น จึงไม่มี dependency ภายนอกให้ต้องไว้ใจเพิ่ม
 */

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * พารามิเตอร์ของ scrypt — N=2^15 คือค่าที่ใช้เวลาราวหนึ่งในสิบวินาทีต่อครั้งบนเครื่องทั่วไป
 * ช้าพอที่การเดารหัสผ่านทีละล้านครั้งไม่คุ้ม แต่ยังเร็วพอที่คนล็อกอินไม่รู้สึกว่ารอ
 */
const SCRYPT = { N: 32768, r: 8, p: 1, keyLength: 64 } as const;
const SCRYPT_MAXMEM = 128 * SCRYPT.N * SCRYPT.r * 2;

/**
 * แฮชรหัสผ่านพร้อมเกลือสุ่มของตัวเอง
 * เก็บพารามิเตอร์ไว้ในสตริงผลลัพธ์ด้วย เพื่อให้ขึ้นค่าความยากในอนาคตได้โดยที่รหัสผ่านเดิมยังใช้ได้
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keyLength, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: SCRYPT_MAXMEM,
  });
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

/** ตรวจรหัสผ่านแบบเทียบเวลาคงที่ รหัสที่ผิดจึงใช้เวลาเท่ากับรหัสที่ถูก */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(rawSalt ?? '', 'base64url');
  const expected = Buffer.from(rawHash ?? '', 'base64url');
  if (salt.length === 0 || expected.length === 0) return false;

  const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
    N,
    r,
    p,
    maxmem: 128 * N * r * 2,
  });
  return timingSafeEqual(derived, expected);
}

/** โทเค็นสุ่มสำหรับใช้เป็นรหัส session — 32 ไบต์คือ 256 บิต เดาไม่ได้ในทางปฏิบัติ */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * ย่อโทเค็นก่อนเก็บลงฐานข้อมูล
 * ถ้าฐานข้อมูลหลุด คนที่ได้ไปจะสวมรอย session ที่ยังไม่หมดอายุไม่ได้ เพราะของจริงไม่เคยถูกเก็บ
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function keyFrom(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/**
 * เข้ารหัสความลับด้วย AES-256-GCM
 * GCM ให้ทั้งความลับและการตรวจว่าข้อมูลไม่ถูกแก้ระหว่างทาง ซึ่งจำเป็นเพราะเราเก็บผลไว้ในที่ที่อื่นแตะได้
 */
export function seal(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    body.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.');
}

/** ถอดรหัส — คืน null เมื่อกุญแจไม่ตรงหรือข้อมูลถูกแก้ ไม่โยน error เพราะทั้งสองกรณีจัดการเหมือนกัน */
export function open(sealed: string, secret: string): string | null {
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      keyFrom(secret),
      Buffer.from(parts[1] ?? '', 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(parts[3] ?? '', 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[2] ?? '', 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/**
 * สี่ตัวท้ายของกุญแจ — มากที่สุดที่ยอมให้หลุดออกไปหน้าบ้านได้
 * พอให้ผู้ใช้ดูออกว่าใส่กุญแจตัวไหนไว้ แต่ไม่พอให้ใครเอาไปใช้
 */
export function keyHint(apiKey: string): string {
  return apiKey.trim().slice(-4);
}
