import postgres, { type Sql } from 'postgres';

export type Db = Sql;

/** สร้างการเชื่อมต่อฐานข้อมูล — ตั้งค่า pool ให้พอดีกับงานสองแบบคือ API และ worker */
export function createDb(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error('ยังไม่ได้ตั้งค่า DATABASE_URL');
  return postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idle_timeout: 30,
    connect_timeout: 15,
    onnotice: () => {},
  });
}
