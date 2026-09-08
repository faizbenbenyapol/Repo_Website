import type { Db } from './client.js';

/**
 * บัญชีผู้ใช้และ session
 *
 * ไม่มีฟังก์ชันไหนในไฟล์นี้รับหรือคืนรหัสผ่านหรือกุญแจแบบอ่านได้
 * สิ่งที่ไหลผ่านชั้นนี้มีแค่ค่าที่ผ่านการแฮชมาแล้วจากชั้นบนเท่านั้น
 */

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  email: string;
  expiresAt: string;
}

/** สมัครสมาชิกใหม่ — คืน null เมื่ออีเมลนี้ถูกใช้ไปแล้ว เพราะเป็นเรื่องปกติ ไม่ใช่ข้อผิดพลาดของระบบ */
export async function createUser(
  sql: Db,
  input: { email: string; passwordHash: string },
): Promise<UserRecord | null> {
  const rows = await sql<{ id: string; email: string; created_at: Date }[]>`
    insert into users ${sql({ email: input.email, password_hash: input.passwordHash })}
    on conflict do nothing
    returning id, email, created_at
  `;

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: input.passwordHash,
    createdAt: row.created_at.toISOString(),
  };
}

export async function findUserByEmail(sql: Db, email: string): Promise<UserRecord | null> {
  const rows = await sql<{ id: string; email: string; password_hash: string; created_at: Date }[]>`
    select id, email, password_hash, created_at from users where lower(email) = lower(${email}) limit 1
  `;

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at.toISOString(),
  };
}

export async function createSession(
  sql: Db,
  input: { userId: string; tokenHash: string; expiresAt: Date },
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into sessions ${sql({
      user_id: input.userId,
      token_hash: input.tokenHash,
      expires_at: input.expiresAt,
    })}
    returning id
  `;

  const id = rows[0]?.id;
  if (id === undefined) throw new Error('สร้าง session ไม่สำเร็จ');

  await sql`update users set last_seen_at = now() where id = ${input.userId}`;
  return id;
}

/** หา session จากโทเค็นที่ย่อแล้ว — session ที่หมดอายุถือว่าไม่มี */
export async function findSession(sql: Db, tokenHash: string): Promise<SessionRecord | null> {
  const rows = await sql<{ id: string; user_id: string; email: string; expires_at: Date }[]>`
    select s.id, s.user_id, u.email, s.expires_at
    from sessions s
    join users u on u.id = s.user_id
    where s.token_hash = ${tokenHash} and s.expires_at > now()
    limit 1
  `;

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    expiresAt: row.expires_at.toISOString(),
  };
}

/** ต่ออายุ session ทุกครั้งที่ใช้งาน คนที่เข้าเว็บทุกวันจึงไม่โดนเด้งออกกลางทาง */
export async function touchSession(sql: Db, id: string, expiresAt: Date): Promise<void> {
  await sql`
    update sessions set last_seen_at = now(), expires_at = ${expiresAt} where id = ${id}
  `;
}

export async function deleteSession(sql: Db, tokenHash: string): Promise<void> {
  await sql`delete from sessions where token_hash = ${tokenHash}`;
}

/** เก็บกวาด session ที่หมดอายุ เรียกเป็นระยะเพื่อไม่ให้ตารางโตขึ้นเรื่อย ๆ โดยไม่มีใครใช้ */
export async function deleteExpiredSessions(sql: Db): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    with removed as (delete from sessions where expires_at <= now() returning 1)
    select count(*)::text as count from removed
  `;
  return Number(rows[0]?.count ?? 0);
}
