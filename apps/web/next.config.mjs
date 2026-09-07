/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
  transpilePackages: ['@repolens/shared'],
  // การส่งต่อ /api ไปยัง Fastify อยู่ที่ app/api/[...path]/route.ts เพราะต้องอ่าน API_ORIGIN ตอนรัน ไม่ใช่ตอน build
};

export default nextConfig;
