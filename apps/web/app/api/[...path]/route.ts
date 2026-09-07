import type { NextRequest } from 'next/server';

/**
 * ส่งต่อทุกคำขอที่ขึ้นต้นด้วย /api ไปยัง Fastify
 *
 * ทำเป็น route handler แทน rewrites ใน next.config เพราะ rewrites ถูกคำนวณตอน build
 * ค่า API_ORIGIN จึงถูกฝังตายไปกับอิมเมจ ส่วนวิธีนี้อ่านค่าตอนรันจริง
 * และส่งต่อ body แบบสตรีมได้ ซึ่งจำเป็นกับ Server-Sent Events ของไปป์ไลน์วิเคราะห์ในรุ่นถัดไป
 */
export const dynamic = 'force-dynamic';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

function forwardHeaders(source: Headers): Headers {
  const headers = new Headers();
  source.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  return headers;
}

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const origin = process.env.API_ORIGIN ?? 'http://localhost:3001';
  const { path } = await context.params;
  const target = new URL(`/api/${path.join('/')}`, origin);
  target.search = request.nextUrl.search;

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers: forwardHeaders(request.headers),
      body: hasBody ? request.body : undefined,
      // ส่งต่อ body แบบสตรีมโดยไม่ต้องอ่านเข้าหน่วยความจำก่อน
      ...(hasBody ? { duplex: 'half' } : {}),
      redirect: 'manual',
      cache: 'no-store',
    } as RequestInit);

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: forwardHeaders(upstream.headers),
    });
  } catch {
    return Response.json({ error: 'ติดต่อ API ไม่ได้ในขณะนี้' }, { status: 502 });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
