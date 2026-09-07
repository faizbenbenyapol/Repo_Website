# RepoLens

เว็บสำหรับอ่านโค้ดทั้ง repo แทนคุณ — วางลิงก์ repo หนึ่งอัน แล้วได้แผนที่สถาปัตยกรรม กราฟความสัมพันธ์ระหว่างไฟล์
ตัวชี้วัดสุขภาพโค้ด และคำอธิบายภาษาไทยที่อ้างอิงถึงบรรทัดจริงได้ทุกประโยค

ใช้งานได้สองระดับ — เข้าดูเฉย ๆ โดยไม่ต้องล็อกอินจะได้ผลวิเคราะห์เชิงโครงสร้างทั้งหมด
ส่วนคำอธิบายและการถาม–ตอบด้วย AI เปิดให้สมาชิกที่ล็อกอินแล้วใส่ API key ของตัวเอง

## Stack

- **ภาษา** TypeScript 5 · Node 22 · pnpm workspaces
- **หน้าบ้าน** Next.js 15 (App Router) · Tailwind CSS 4 · sigma.js + graphology (WebGL)
- **หลังบ้าน** Fastify 5 · Zod · Server-Sent Events · BullMQ
- **ข้อมูล** PostgreSQL 17 + pgvector · Redis 7
- **วิเคราะห์โค้ด** web-tree-sitter (WebAssembly)
- **AI** Claude API (`claude-opus-5`) · โมเดลเวกเตอร์ bge-m3 บน ONNX Runtime
- **โครงสร้างพื้นฐาน** Docker · Docker Compose · Caddy 2 · GitHub Actions
