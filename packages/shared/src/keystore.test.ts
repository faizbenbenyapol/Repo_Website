import { describe, expect, it } from 'vitest';
import { KeyStore, type KeyStoreBackend } from './keystore.js';

/** ที่เก็บของปลอมที่จำ TTL ไว้ด้วย เพื่อให้ทดสอบได้ว่ากุญแจถูกตั้งวันหมดอายุจริง */
function fakeBackend() {
  const store = new Map<string, { value: string; ttl: number }>();
  const backend: KeyStoreBackend = {
    get: async (key) => store.get(key)?.value ?? null,
    set: async (key, value, _mode, seconds) => {
      store.set(key, { value, ttl: seconds });
      return 'OK';
    },
    del: async (key) => {
      store.delete(key);
      return 1;
    },
  };
  return { backend, store };
}

const secret = 'ความลับของเซิร์ฟเวอร์';

describe('ที่เก็บกุญแจของสมาชิก', () => {
  it('เก็บแล้วอ่านกลับได้ และคืนเฉพาะสี่ตัวท้ายให้ฝั่งที่ไม่ต้องใช้กุญแจจริง', async () => {
    const { backend } = fakeBackend();
    const store = new KeyStore(backend, secret);

    const record = await store.put('session-1', 'sk-ant-api03-ตัวอย่าง1234', 'ok');
    expect(record.hint).toBe('1234');
    expect(record.check).toBe('ok');

    expect((await store.get('session-1'))?.apiKey).toBe('sk-ant-api03-ตัวอย่าง1234');
    expect(await store.describe('session-1')).toMatchObject({ hint: '1234', check: 'ok' });
  });

  it('สิ่งที่เขียนลงที่เก็บต้องไม่มีกุญแจแบบอ่านได้ปนอยู่', async () => {
    const { backend, store: raw } = fakeBackend();
    await new KeyStore(backend, secret).put('session-1', 'sk-ant-api03-ความลับ9999', 'ok');

    const written = raw.get('apikey:session-1')?.value ?? '';
    expect(written).not.toContain('sk-ant-api03-ความลับ9999');
    expect(written).not.toContain('ความลับ');
  });

  it('ตั้งวันหมดอายุให้กุญแจเสมอ ไม่ปล่อยค้างไว้ตลอดไป', async () => {
    const { backend, store: raw } = fakeBackend();
    await new KeyStore(backend, secret, 3600).put('session-1', 'sk-ant-x-abcd', 'ok');
    expect(raw.get('apikey:session-1')?.ttl).toBe(3600);
  });

  it('session ที่ไม่มีกุญแจผูกไว้ต้องคืน null ไม่ใช่ค่าของคนอื่น', async () => {
    const { backend } = fakeBackend();
    const store = new KeyStore(backend, secret);
    await store.put('session-1', 'sk-ant-x-abcd', 'ok');

    expect(await store.get('session-2')).toBeNull();
    expect(await store.describe('session-2')).toBeNull();
  });

  it('ลบแล้วต้องหายจริง', async () => {
    const { backend } = fakeBackend();
    const store = new KeyStore(backend, secret);
    await store.put('session-1', 'sk-ant-x-abcd', 'ok');
    await store.drop('session-1');
    expect(await store.get('session-1')).toBeNull();
  });

  it('กุญแจของเซิร์ฟเวอร์เปลี่ยนแล้วถอดไม่ออก ต้องทิ้งของเก่าไปเลยแทนที่จะค้างไว้', async () => {
    const { backend, store: raw } = fakeBackend();
    await new KeyStore(backend, secret).put('session-1', 'sk-ant-x-abcd', 'ok');

    const withNewSecret = new KeyStore(backend, 'ความลับใหม่');
    expect(await withNewSecret.get('session-1')).toBeNull();
    expect(raw.has('apikey:session-1')).toBe(false);
  });

  it('ข้อมูลที่พังในที่เก็บต้องไม่ทำให้ระบบล้ม', async () => {
    const { backend, store: raw } = fakeBackend();
    raw.set('apikey:session-1', { value: 'ไม่ใช่ JSON', ttl: 10 });
    expect(await new KeyStore(backend, secret).get('session-1')).toBeNull();
  });
});
