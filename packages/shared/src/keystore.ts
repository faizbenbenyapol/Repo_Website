import { API_KEY_TTL_HOURS, type KeyCheck } from './accounts.js';
import { keyHint, open, seal } from './crypto.js';

/**
 * ที่เก็บกุญแจของสมาชิก
 *
 * กุญแจของผู้ใช้ไม่เคยถูกเขียนลงฐานข้อมูลหลัก ตามที่ตกลงไว้ใน ADR 0002
 * มันอยู่ในที่เก็บชั่วคราวในหน่วยความจำเท่านั้น เข้ารหัสไว้ และมีวันหมดอายุของตัวเอง
 * ผลคือสำเนาสำรองของฐานข้อมูลไม่มีวันมีกุญแจของใครติดไปด้วย และเครื่องที่ถูกทิ้งค้างไว้
 * จะใช้กุญแจต่อไม่ได้หลังจากผ่านไปไม่กี่ชั่วโมง
 */

/** สิ่งที่ที่เก็บต้องทำได้ — เล็กพอที่ ioredis เสียบเข้ามาได้ตรง ๆ และของปลอมในเทสต์ก็เขียนง่าย */
export interface KeyStoreBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

export interface StoredKey {
  apiKey: string;
  hint: string;
  check: KeyCheck;
  savedAt: string;
}

export interface KeyRecord {
  hint: string;
  check: KeyCheck;
  savedAt: string;
}

interface Envelope {
  sealed: string;
  hint: string;
  check: KeyCheck;
  savedAt: string;
}

function redisKey(sessionId: string): string {
  return `apikey:${sessionId}`;
}

export class KeyStore {
  constructor(
    private readonly backend: KeyStoreBackend,
    private readonly secret: string,
    private readonly ttlSeconds = API_KEY_TTL_HOURS * 3600,
  ) {}

  /** เก็บกุญแจแบบเข้ารหัส คืนเฉพาะข้อมูลที่ปลอดภัยพอจะส่งกลับไปหน้าบ้าน */
  async put(sessionId: string, apiKey: string, check: KeyCheck): Promise<KeyRecord> {
    const trimmed = apiKey.trim();
    const envelope: Envelope = {
      sealed: seal(trimmed, this.secret),
      hint: keyHint(trimmed),
      check,
      savedAt: new Date().toISOString(),
    };

    await this.backend.set(redisKey(sessionId), JSON.stringify(envelope), 'EX', this.ttlSeconds);
    return { hint: envelope.hint, check: envelope.check, savedAt: envelope.savedAt };
  }

  /** อ่านกุญแจจริง — เรียกได้เฉพาะตอนกำลังจะเรียกโมเดลจริงเท่านั้น */
  async get(sessionId: string): Promise<StoredKey | null> {
    const envelope = await this.read(sessionId);
    if (!envelope) return null;

    const apiKey = open(envelope.sealed, this.secret);
    // ถอดไม่ออกแปลว่ากุญแจของเซิร์ฟเวอร์เปลี่ยนไปแล้ว ของที่เหลืออยู่จึงไม่มีประโยชน์ ลบทิ้งเลย
    if (apiKey === null) {
      await this.drop(sessionId);
      return null;
    }

    return { apiKey, hint: envelope.hint, check: envelope.check, savedAt: envelope.savedAt };
  }

  /** สถานะของกุญแจโดยไม่ถอดรหัส ใช้ตอบหน้าเว็บว่ามีกุญแจผูกอยู่ไหม */
  async describe(sessionId: string): Promise<KeyRecord | null> {
    const envelope = await this.read(sessionId);
    if (!envelope) return null;
    return { hint: envelope.hint, check: envelope.check, savedAt: envelope.savedAt };
  }

  async drop(sessionId: string): Promise<void> {
    await this.backend.del(redisKey(sessionId));
  }

  private async read(sessionId: string): Promise<Envelope | null> {
    const raw = await this.backend.get(redisKey(sessionId)).catch(() => null);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as Partial<Envelope>;
      if (typeof parsed.sealed !== 'string' || typeof parsed.hint !== 'string') return null;
      return {
        sealed: parsed.sealed,
        hint: parsed.hint,
        check: parsed.check ?? 'unknown',
        savedAt: parsed.savedAt ?? new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }
}
