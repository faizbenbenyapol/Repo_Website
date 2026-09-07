# คู่มือปฏิบัติการ RepoLens

## ข้อกำหนดเดียวของการพัฒนา: ทุกอย่างรันใน Docker

ไม่มีการรัน `pnpm dev` บนเครื่องตัวเอง ทุกคำสั่งเข้าผ่าน `make` และลงเอยที่ `docker compose` เสมอ
CI ก็เรียกคำสั่งเดียวกัน จึงไม่มีสถานการณ์ "เครื่องผมผ่านแต่ CI ไม่ผ่าน" ที่เกิดจากสภาพแวดล้อมต่างกัน

| คำสั่ง                                   | ทำอะไร                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| `make install`                           | สร้าง/อัปเดต `pnpm-lock.yaml` ในคอนเทนเนอร์                               |
| `make dev`                               | ยกสภาพแวดล้อมพัฒนา (web + api) พร้อม hot reload ที่ http://localhost:3000 |
| `make test`                              | prettier + typecheck + unit + integration ในคอนเทนเนอร์เดียวจบ            |
| `make test-e2e`                          | build อิมเมจจริงแล้วรัน Playwright ยิงใส่ระบบที่รันอยู่                   |
| `make test-all`                          | `test` แล้วตามด้วย `test-e2e` — ชุดเดียวกับที่ CI รัน                     |
| `make build`                             | build อิมเมจ production ทั้งหมด                                           |
| `make release V=0.2.0`                   | เลื่อนเวอร์ชัน สร้างโครงบันทึกรุ่น และประกอบ CHANGELOG.md ใหม่            |
| `make logs` / `make down` / `make clean` | ดู log / ปิด / ล้างทั้งหมดรวม volume                                      |

## วงจรการพัฒนาหนึ่งรอบ

1. เขียนโค้ด
2. `make test` ต้องเขียวทั้งหมด — ถ้าแดง ห้ามไปต่อ
3. `make release V=x.y.z` แล้วเขียนเนื้อหาลง `docs/changelog/vx.y.z.md` ให้ครบ
4. `git commit` + `git tag vx.y.z` + `git push --follow-tags`
5. GitHub Actions รันชุดทดสอบเดียวกันแล้ว build อิมเมจขึ้น registry
6. บนเซิร์ฟเวอร์: `make deploy` (git pull → compose pull → up -d → ตรวจ /api/health)
7. ถ้าตรวจสุขภาพไม่ผ่าน: `IMAGE_TAG=<แท็กก่อนหน้า> docker compose -f compose.prod.yaml up -d`

## ขึ้นเซิร์ฟเวอร์ครั้งแรก

1. Ubuntu 24.04 + Docker Engine + Compose plugin, สร้างผู้ใช้ `deploy` (ไม่ใช้ root)
2. ชี้ DNS ระเบียน A ของ `repo.benyapol.com` มาที่ IP เครื่อง แล้วรอให้ propagate
3. `git clone` ลง `/srv/repolens` แล้วคัดลอก `.env.example` เป็น `.env` และเติมค่าให้ครบ
4. `docker compose -f compose.prod.yaml up -d --wait` — Caddy จะขอใบรับรอง TLS ให้เองอัตโนมัติ
5. ตรวจว่า `https://repo.benyapol.com/api/health` ตอบ `{"ok":true}`

## กฎเรื่องความลับ

API key ของสมาชิกและ `SESSION_SECRET` ห้ามโผล่ใน log, ห้ามลงดิสก์แบบไม่เข้ารหัส
และห้ามส่งกลับไปหน้าบ้าน หน้าบ้านเห็นได้แค่สี่ตัวท้ายเพื่อยืนยันว่าใส่กุญแจถูกใบ
