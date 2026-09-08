/**
 * จำกัดจำนวนครั้งต่อหนึ่งกุญแจในช่วงเวลาที่กำหนด
 *
 * เก็บไว้ในหน่วยความจำของกระบวนการเดียว ซึ่งพอสำหรับตอนนี้ที่มี API ตัวเดียว
 * ถ้าวันหนึ่งขยายเป็นหลายตัว ต้องย้ายไปนับที่ Redis แทน ไม่งั้นเพดานจริงจะกลายเป็นเพดานคูณจำนวนเครื่อง
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);

    if (recent.length >= this.limit) {
      const oldest = recent[0] ?? now;
      return {
        allowed: false,
        retryAfterSeconds: Math.ceil((this.windowMs - (now - oldest)) / 1000),
      };
    }

    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** ล้างประวัติของกุญแจหนึ่งค่า ใช้เมื่อทำสำเร็จแล้ว จะได้ไม่ลงโทษคนที่พิมพ์ผิดครั้งเดียว */
  clear(key: string): void {
    this.hits.delete(key);
  }
}
