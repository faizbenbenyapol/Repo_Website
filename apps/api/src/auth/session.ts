import {
  ANONYMOUS_SESSION,
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
  type SessionState,
} from '@repolens/shared';
import { hashToken } from '@repolens/shared/node';
import { findSession, touchSession } from '@repolens/db';
import type { Services } from '../services.js';
import { readCookie } from './cookies.js';

/**
 * ตัวตนของคนที่กำลังยิงคำขอเข้ามา
 * ไม่มีกุญแจของผู้ใช้อยู่ในนี้โดยตั้งใจ — ส่วนไหนต้องใช้กุญแจจริงต้องไปขอจากที่เก็บเองทีละครั้ง
 */
export interface Viewer {
  sessionId: string;
  userId: string;
  email: string;
}

export function sessionExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 3600 * 1000);
}

/**
 * หาว่าใครเป็นเจ้าของคำขอนี้จากคุกกี้
 * ต่ออายุ session ไปด้วยทุกครั้งที่เจอ คนที่ใช้งานอยู่เป็นประจำจึงไม่ถูกเด้งออกกลางทาง
 */
export async function resolveViewer(
  services: Services,
  cookieHeader: string | undefined,
): Promise<Viewer | null> {
  const token = readCookie(cookieHeader, SESSION_COOKIE);
  if (!token) return null;

  const session = await findSession(services.sql, hashToken(token));
  if (!session) return null;

  // ไม่ await เพราะการต่ออายุไม่ควรทำให้ทุกคำขอช้าลง และถ้าพลาดครั้งนี้ครั้งหน้าก็ต่อให้ใหม่ได้
  void touchSession(services.sql, session.id, sessionExpiry()).catch(() => {});

  return { sessionId: session.id, userId: session.userId, email: session.email };
}

/**
 * สถานะที่หน้าเว็บใช้ตัดสินใจว่าจะแสดงอะไร
 *
 * เมื่อยังใช้ AI ไม่ได้ ต้องบอกเสมอว่าเพราะอะไรและต้องทำอะไรต่อ
 * ปุ่มจาง ๆ ที่กดไม่ได้โดยไม่บอกเหตุผลคือสิ่งที่ ADR 0001 ห้ามไว้ตรง ๆ
 */
export async function describeSession(
  services: Services,
  viewer: Viewer | null,
): Promise<SessionState> {
  if (!viewer) return ANONYMOUS_SESSION;

  const key = await services.keys.describe(viewer.sessionId);

  if (!key) {
    return {
      tier: 'member',
      signedIn: true,
      email: viewer.email,
      apiKeyHint: null,
      aiEnabled: false,
      aiBlockedReason:
        'ล็อกอินแล้ว เหลือใส่ API key ของ Claude ที่หน้าตั้งค่าเพื่อเปิดคำอธิบายด้วย AI',
    };
  }

  if (key.check === 'invalid') {
    return {
      tier: 'member',
      signedIn: true,
      email: viewer.email,
      apiKeyHint: key.hint,
      aiEnabled: false,
      aiBlockedReason: 'Anthropic ปฏิเสธกุญแจที่ผูกไว้ — ใส่กุญแจใหม่ที่หน้าตั้งค่า',
    };
  }

  return {
    tier: 'member',
    signedIn: true,
    email: viewer.email,
    apiKeyHint: key.hint,
    aiEnabled: true,
    aiBlockedReason: null,
  };
}
