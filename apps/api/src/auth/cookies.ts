/**
 * อ่านและเขียนคุกกี้ด้วยมือ
 *
 * ไม่ใช้ปลั๊กอินสำเร็จรูปเพราะเราต้องการคุกกี้ตัวเดียว ที่ตั้งค่าความปลอดภัยแบบเดียว
 * โค้ดสามสิบบรรทัดที่อ่านจบในหนึ่งนาที ตรวจสอบได้ง่ายกว่า dependency ที่ต้องไล่อ่าน changelog ตาม
 */

export interface CookieOptions {
  maxAgeSeconds: number;
  secure: boolean;
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() !== name) continue;
    return decodeURIComponent(part.slice(index + 1).trim());
  }

  return null;
}

function serialize(name: string, value: string, maxAge: number, secure: boolean): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    // Lax พอสำหรับเว็บที่ทุกอย่างอยู่โดเมนเดียวกัน และยังกันคำขอข้ามเว็บที่เปลี่ยนสถานะได้
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function setCookie(name: string, value: string, options: CookieOptions): string {
  return serialize(name, value, options.maxAgeSeconds, options.secure);
}

/** ลบคุกกี้ด้วยการตั้งอายุเป็นศูนย์ ต้องส่งค่าตั้งอื่นให้ตรงกับตอนตั้ง ไม่งั้นเบราว์เซอร์จะไม่ลบให้ */
export function clearCookie(name: string, options: { secure: boolean }): string {
  return serialize(name, '', 0, options.secure);
}
