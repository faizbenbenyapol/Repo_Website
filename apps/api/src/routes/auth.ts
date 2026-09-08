import type { FastifyInstance, FastifyReply } from 'fastify';
import { createSession, createUser, deleteSession, findUserByEmail } from '@repolens/db';
import { credentialsSchema, SESSION_COOKIE, SESSION_TTL_DAYS } from '@repolens/shared';
import { hashPassword, hashToken, randomToken, verifyPassword } from '@repolens/shared/node';
import { clearCookie, readCookie, setCookie } from '../auth/cookies.js';
import { describeSession, resolveViewer, sessionExpiry } from '../auth/session.js';
import { config } from '../config.js';
import { RateLimiter } from '../rate-limit.js';
import type { Services } from '../services.js';

/**
 * แฮชหลอกสำหรับกรณีที่ไม่พบอีเมล
 *
 * ถ้าไม่พบผู้ใช้แล้วตอบกลับทันที เวลาที่ใช้จะสั้นกว่ากรณีที่พบอย่างเห็นได้ชัด
 * ซึ่งพอจะใช้ไล่ได้ว่าอีเมลไหนมีบัญชีอยู่ในระบบ จึงเสียเวลาตรวจให้เท่ากันทั้งสองทาง
 */
const DECOY_HASH = await hashPassword(randomToken());

async function openSession(
  services: Services,
  reply: FastifyReply,
  user: { id: string; email: string },
): Promise<string> {
  const token = randomToken();
  const sessionId = await createSession(services.sql, {
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: sessionExpiry(),
  });

  reply.header(
    'set-cookie',
    setCookie(SESSION_COOKIE, token, {
      maxAgeSeconds: SESSION_TTL_DAYS * 24 * 3600,
      secure: config.cookieSecure,
    }),
  );

  return sessionId;
}

export function authRoutes(services: Services) {
  // การเดารหัสผ่านต้องแพงพอที่ไล่เดาไม่คุ้ม แต่ยังไม่ขวางคนที่พิมพ์ผิดสองสามครั้ง
  const loginLimiter = new RateLimiter(
    Number(process.env.LOGIN_RATE_LIMIT ?? 10),
    Number(process.env.LOGIN_RATE_WINDOW_MS ?? 300_000),
  );

  return async function register(app: FastifyInstance): Promise<void> {
    app.post('/api/auth/register', async (request, reply) => {
      const body = credentialsSchema.safeParse(request.body);
      if (!body.success) {
        return reply
          .status(400)
          .send({ error: body.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' });
      }

      const gate = loginLimiter.check(request.ip);
      if (!gate.allowed) {
        return reply
          .status(429)
          .header('retry-after', String(gate.retryAfterSeconds))
          .send({ error: `ลองบ่อยเกินไป รออีก ${gate.retryAfterSeconds} วินาทีแล้วลองใหม่` });
      }

      const user = await createUser(services.sql, {
        email: body.data.email,
        passwordHash: await hashPassword(body.data.password),
      });

      if (!user) {
        return reply.status(409).send({ error: 'อีเมลนี้มีบัญชีอยู่แล้ว ลองเข้าสู่ระบบแทน' });
      }

      const sessionId = await openSession(services, reply, user);
      loginLimiter.clear(request.ip);

      return reply.status(201).send({
        session: await describeSession(services, { sessionId, userId: user.id, email: user.email }),
      });
    });

    app.post('/api/auth/login', async (request, reply) => {
      const body = credentialsSchema.safeParse(request.body);
      if (!body.success) {
        return reply
          .status(400)
          .send({ error: body.error.issues[0]?.message ?? 'ข้อมูลไม่ถูกต้อง' });
      }

      const gate = loginLimiter.check(request.ip);
      if (!gate.allowed) {
        return reply
          .status(429)
          .header('retry-after', String(gate.retryAfterSeconds))
          .send({ error: `ลองบ่อยเกินไป รออีก ${gate.retryAfterSeconds} วินาทีแล้วลองใหม่` });
      }

      const user = await findUserByEmail(services.sql, body.data.email);
      const matched = await verifyPassword(body.data.password, user?.passwordHash ?? DECOY_HASH);

      // ข้อความเดียวกันทั้งกรณีอีเมลผิดและรหัสผิด เพื่อไม่ให้ใช้หน้านี้ไล่หาว่าใครมีบัญชีอยู่บ้าง
      if (!user || !matched) {
        return reply.status(401).send({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
      }

      const sessionId = await openSession(services, reply, user);
      loginLimiter.clear(request.ip);

      return {
        session: await describeSession(services, { sessionId, userId: user.id, email: user.email }),
      };
    });

    app.post('/api/auth/logout', async (request, reply) => {
      const viewer = await resolveViewer(services, request.headers.cookie);
      const token = readCookie(request.headers.cookie, SESSION_COOKIE);

      // ทิ้งกุญแจไปพร้อมกับ session เสมอ ออกจากระบบแล้วต้องไม่มีอะไรของผู้ใช้ค้างอยู่ในเครื่องเรา
      if (viewer) await services.keys.drop(viewer.sessionId);
      if (token) await deleteSession(services.sql, hashToken(token));

      return reply
        .header('set-cookie', clearCookie(SESSION_COOKIE, { secure: config.cookieSecure }))
        .send({ session: await describeSession(services, null) });
    });
  };
}
