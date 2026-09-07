# แผนพัฒนา RepoLens — repo.benyapol.com

> เอกสารแผนฉบับเต็ม (ฉบับร่าง v0) — วันที่ 2026-09-07
> ต้นทาง: fork แนวคิดจาก https://github.com/braedonsaunders/codeflow (MIT)

---

## 1. สรุปย่อ

สร้างเว็บ **RepoLens** ที่ `repo.benyapol.com` — วางลิงก์ repo ลงไปหนึ่งอัน แล้วระบบต้อง
"อ่านและเข้าใจโค้ดทั้ง repo" แทนเรา แล้วเล่ากลับมาเป็น **ภาษาไทย** ทั้งภาพรวมสถาปัตยกรรม,
กราฟความสัมพันธ์, การไหลของข้อมูล, ไฟล์สำคัญ, จุดเสี่ยง และตอบคำถามเจาะจงได้พร้อมอ้างอิง `file:line`

ต่างจาก CodeFlow เดิมตรงที่ย้ายการวิเคราะห์ไปฝั่งเซิร์ฟเวอร์ (git clone จริง) จึงอ่านได้ครบทั้ง repo
ไม่ติดโควต้า GitHub API, มีแคช, มีชั้น AI สรุปเป็นภาษาไทย, UI แบบ Minimalist motion,
ทดสอบทุกอย่างใน Docker เท่านั้น และมีระบบเวอร์ชัน/changelog ที่อ่านย้อนหลังได้ทุกรุ่น

---

## 2. เป้าหมายหลัก และนิยามคำว่า "เข้าใจได้ทั้งหมด"

เป้าหมายหลักที่เจ้าของงานย้ำ: **ใส่ลิงก์ repo → ต้องอ่านและทำความเข้าใจได้ทั้งหมด**
แปลงเป็นเกณฑ์วัดผลได้ (Definition of Done) 8 ข้อ:

| #   | เกณฑ์                                                   | วัดผลอย่างไร                                                                               |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| D1  | ดึงซอร์สครบทุกไฟล์ ไม่สุ่ม ไม่ตัดทิ้งเงียบ ๆ            | จำนวนไฟล์ที่ index = จำนวนไฟล์ใน `git ls-files` (ลบ binary/ignore ที่แจ้งชัดเจน)           |
| D2  | บอกได้ว่าโปรเจกต์นี้ทำอะไร ใช้ stack อะไร รันยังไง      | หน้า "สรุป repo" มี 6 บล็อก: ทำอะไร / stack / entrypoint / วิธีรัน / โครงสร้าง / ข้อสังเกต |
| D3  | กราฟ dependency ครบระดับไฟล์ + call graph ระดับฟังก์ชัน | edge coverage ≥ 95% บน fixture repo มาตรฐาน                                                |
| D4  | ทุกไฟล์มีคำอธิบายภาษาไทย 2–4 บรรทัด                     | ไฟล์ที่ยังไม่มีสรุป = 0                                                                    |
| D5  | ถามเป็นภาษาไทยแล้วตอบพร้อมอ้างอิงบรรทัดจริง             | ทุกคำตอบมี citation ≥ 1 และคลิกเปิดโค้ดได้                                                 |
| D6  | บอกลำดับการอ่านโค้ดสำหรับคนใหม่                         | มี "เส้นทางอ่านโค้ด" 7–15 ขั้น เรียงตาม centrality                                         |
| D7  | ส่งออกรายงานภาษาไทยได้ (MD/PDF/JSON)                    | ปุ่มส่งออกทำงานครบ 3 รูปแบบ                                                                |
| D8  | วิเคราะห์ซ้ำแบบ incremental ตาม commit ใหม่             | วิเคราะห์รอบ 2 ของ repo เดิมเร็วกว่ารอบแรก ≥ 70%                                           |

**เป้าหมายรอง:** ใช้ง่ายกว่าเดิม, ภาษาไทยทั้งระบบ, รายละเอียดมากกว่าเดิม, UI Minimalist motion

**นอกขอบเขต (v1):** ไม่รันโค้ดของผู้ใช้, ไม่แก้โค้ดให้, ไม่เป็น IDE, ไม่รองรับ SVN/Perforce

---

## 3. อ่านของเดิมแล้วเจออะไร (CodeFlow)

**จุดแข็งที่ควรเก็บไว้:** วิเคราะห์เร็ว ไม่ต้องติดตั้ง, tree-sitter 18 ภาษา + heuristic รวมกว่า 30 ภาษา,
Blast radius, Health score A–F, Security scan, Pattern detection, Activity heatmap, export หลายรูปแบบ

**ข้อจำกัดจริงที่พบจากการอ่านโค้ด:**

| ข้อจำกัด                      | รายละเอียดที่เจอ                                   | ผลกระทบ                                            |
| ----------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| ทำงานในเบราว์เซอร์ล้วน        | เรียก `api.github.com` ตรงจากหน้าเว็บ              | ไม่มี token = 60 req/ชม. → repo ใหญ่วิเคราะห์ไม่จบ |
| โค้ดก้อนเดียว                 | `index.html` 818 KB / 14,425 บรรทัด                | แก้ยาก ทดสอบยาก โหลดครั้งแรกหนัก                   |
| ไม่มีแคช                      | วิเคราะห์ใหม่ทุกครั้งที่เปิด                       | ช้าและเปลืองโควต้าซ้ำ ๆ                            |
| ไม่มี call graph ระดับ symbol | รู้แค่ไฟล์ไหนพึ่งไฟล์ไหน                           | ยังตอบไม่ได้ว่า "ข้อมูลไหลยังไง"                   |
| ไม่มีชั้นอธิบายเชิงความหมาย   | ได้กราฟ+ตัวเลข แต่ไม่ได้ "ความเข้าใจ"              | ไม่ตรงเป้าหมายหลักของงานนี้                        |
| อังกฤษล้วน                    | ทุก label/รายงาน                                   | ผู้ใช้ไทยอ่านช้า                                   |
| ไม่มีระบบเวอร์ชัน             | `codeflowVersion:'1.0'` ฝังในไฟล์, ไม่มี CHANGELOG | ตามรอยการพัฒนาไม่ได้                               |
| กราฟ SVG/D3                   | ช้าเมื่อ node เกินหลักพัน                          | repo ใหญ่ค้าง                                      |

---

## 4. สิ่งที่ทำให้ดีขึ้น (ข้อจำกัด → ทางแก้)

1. **ย้ายการวิเคราะห์ไปหลังบ้าน** — `git clone --depth 50 --filter=blob:none --single-branch` ในคอนเทนเนอร์แซนด์บ็อกซ์ → อ่านไฟล์จากดิสก์ ไม่ผ่าน API rate limit และได้ git log สำหรับ churn/ownership
2. **แตกโมดูล** — monorepo แยก web / api / worker / analyzer / shared ทดสอบทีละส่วนได้
3. **แคชตาม commit SHA** — วิเคราะห์ซ้ำ = ทำเฉพาะไฟล์ที่ diff เปลี่ยน
4. **เพิ่ม symbol index + call graph** — ใช้ tree-sitter เก็บ symbol, การเรียกใช้, และ resolve import ข้ามไฟล์
5. **ชั้นความเข้าใจ (AI)** — สรุปรายไฟล์/รายโมดูล/ทั้ง repo เป็นภาษาไทย + ถามตอบแบบ RAG ที่ผสม vector search กับกราฟ (ดึงเพื่อนบ้านในกราฟมาเป็นบริบทด้วย ไม่ใช่ vector อย่างเดียว)
6. **ไทยทั้งระบบ** — UI, รายงาน, คำอธิบาย, พร้อม glossary ศัพท์เทคนิค ไทย–อังกฤษ
7. **ระบบเวอร์ชันเต็มรูปแบบ** — SemVer + Conventional Commits + CHANGELOG ไทย + หน้า `/versions` ย้อนหลังได้ทุกรุ่น
8. **กราฟ WebGL** — sigma.js + graphology + ForceAtlas2 ใน worker รองรับ 20,000+ node ลื่น
9. **ผลลัพธ์ทยอยมา (streaming)** — SSE รายงานความคืบหน้าเป็นขั้น ไม่ให้ผู้ใช้จ้อง spinner เปล่า ๆ

---

## 5. สถาปัตยกรรมและ Stack

```
ผู้ใช้ ──▶ Caddy (TLS อัตโนมัติ, repo.benyapol.com)
            ├─▶ web    : Next.js 15 (App Router, RSC) + Tailwind v4 + Motion
            └─▶ api    : Fastify + Zod + SSE  ──▶ Postgres 17 + pgvector
                                              ──▶ Redis 7 (คิว + แคช)
                              │
                              ▼ (BullMQ)
                          worker : clone → parse → graph → metric → summarize
                              │
                              ▼
                          embed  : ONNX bge-m3 (multilingual, ดีกับภาษาไทย)
```

| ชั้น          | เลือกใช้                                                           | เหตุผล                                                 |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| ภาษา          | TypeScript 5 + Node 22 (pnpm workspaces)                           | ภาษาเดียวทั้งระบบ แชร์ type ระหว่าง web/api/worker     |
| Frontend      | Next.js 15 App Router                                              | RSC + streaming UI + route ชัดเจน                      |
| สไตล์         | Tailwind CSS v4 + design tokens                                    | คุมโทน minimalist ได้ทั้งระบบ                          |
| Motion        | Motion (framer-motion) + `prefers-reduced-motion`                  | สเปกแอนิเมชันสม่ำเสมอ                                  |
| กราฟ          | graphology + sigma.js (WebGL); d3-force เมื่อ node < 800           | รองรับ repo ใหญ่                                       |
| Backend       | Fastify + Zod + SSE                                                | เบา เร็ว validate ชัด                                  |
| คิว           | BullMQ + Redis                                                     | งานวิเคราะห์ยาว ต้อง retry/ยกเลิกได้                   |
| ฐานข้อมูล     | Postgres 17 + pgvector + pg_trgm                                   | เก็บผล + เวกเตอร์ + ค้นข้อความไทย                      |
| Parser        | web-tree-sitter (wasm) 20+ ภาษา                                    | ใช้ wasm เลี่ยงปัญหา build native ใน Docker            |
| Embedding     | bge-m3 ผ่าน ONNX Runtime (คอนเทนเนอร์แยก)                          | รันเองในเครื่อง ไม่ส่งโค้ดออกนอก                       |
| LLM           | Anthropic API — `claude-opus-5` (context 1M, $5/$25 ต่อ 1M tokens) | คุณภาพสรุปโค้ด + ภาษาไทยดี, context ใหญ่พอใส่ทั้งโมดูล |
| Reverse proxy | Caddy 2                                                            | TLS อัตโนมัติ คอนฟิก 5 บรรทัด                          |
| Container     | Docker + Compose v5                                                | ตามข้อกำหนด: ทดสอบใน Docker เท่านั้น                   |

### หมายเหตุการใช้ Claude API

- ใช้ `claude-opus-5` เป็นค่าเริ่มต้น, `thinking: {type:"adaptive"}`, และ **streaming** เสมอ
- คุมต้นทุนด้วย **prompt caching** (วางบริบท repo เป็น prefix คงที่ แล้ววาง "คำถาม" ท้ายสุด) — เช็ค `usage.cache_read_input_tokens` ว่ามากกว่า 0 จริง
- งานสรุปรายไฟล์จำนวนมาก → ใช้ **Message Batches API** (ลด 50%) + `output_config.effort: "low"`
- งานสรุปสถาปัตยกรรมทั้ง repo → `effort: "high"`
- อย่าตัดเนื้อหาทิ้งเงียบ ๆ: ถ้าไฟล์ใหญ่เกิน ให้ chunk ตามขอบเขต symbol แล้วสรุปสองชั้น (map → reduce)

---

## 6. โครงสร้างข้อมูล (Postgres)

```
repos(id, host, owner, name, default_branch, is_private, created_at)
analyses(id, repo_id, commit_sha, status, started_at, finished_at, stats jsonb, version)
files(id, analysis_id, path, lang, loc, bytes, hash, layer, summary_th, churn, owners jsonb)
symbols(id, file_id, kind, name, start_line, end_line, signature, doc, summary_th)
edges(id, analysis_id, src_file_id, dst_file_id, kind)          -- import | include | wikilink
calls(id, analysis_id, src_symbol_id, dst_symbol_id, confidence)
findings(id, analysis_id, file_id, severity, rule, line, message_th)
chunks(id, analysis_id, file_id, start_line, end_line, text, embedding vector(1024))
digests(id, analysis_id, scope, scope_ref, content_th, model, tokens_in, tokens_out)
app_versions(version, released_at, git_sha, notes_th)           -- ป้อนหน้า /versions
```

ดัชนีสำคัญ: `chunks USING hnsw (embedding vector_cosine_ops)`, `files(analysis_id, path)`,
`edges(analysis_id, src_file_id)`, `files USING gin (path gin_trgm_ops)`

---

## 7. ไปป์ไลน์การวิเคราะห์ (9 ขั้น)

| ขั้น | ชื่อ          | ทำอะไร                                                                           | แจ้งผู้ใช้ว่า         |
| ---- | ------------- | -------------------------------------------------------------------------------- | --------------------- |
| 1    | Resolve       | ตรวจ URL, เช็ก host allowlist, ดึง metadata                                      | "ตรวจสอบที่อยู่ repo" |
| 2    | Fetch         | clone แบบตื้นในแซนด์บ็อกซ์ (timeout 180s, cap 1 GB)                              | "ดาวน์โหลดซอร์สโค้ด"  |
| 3    | Inventory     | เดินไฟล์, ตัด binary/lock/vendor, ตรวจภาษา, นับ LOC                              | "สำรวจไฟล์ทั้งหมด"    |
| 4    | Parse         | tree-sitter → AST → symbols + imports (parallel pool)                            | "อ่านโครงสร้างโค้ด"   |
| 5    | Resolve links | แก้ import เป็น path จริง (tsconfig paths, go.mod, package.json) → edges + calls | "เชื่อมความสัมพันธ์"  |
| 6    | Metrics       | centrality, วงจร, blast radius, dead code, coupling, churn, owners, security     | "คำนวณตัวชี้วัด"      |
| 7    | Index         | chunk ตามขอบเขต symbol → embed → เก็บ pgvector                                   | "ทำดัชนีค้นหา"        |
| 8    | Comprehend    | สรุปไฟล์ → โมดูล → ทั้ง repo (map-reduce) เป็นภาษาไทย                            | "สรุปเป็นภาษาไทย"     |
| 9    | Publish       | เขียนผล, ตั้งแคชตาม SHA, ปล่อย permalink                                         | "เสร็จแล้ว"           |

ทุกขั้นส่ง event ผ่าน SSE `{stage, pct, message_th}` — ผู้ใช้เห็นกราฟก่อนตั้งแต่ขั้น 6 แล้วคำอธิบายไทยทยอยเติมที่ขั้น 8

---

## 8. ฟีเจอร์ (แบ่งตามลำดับความสำคัญ)

ฟีเจอร์แบ่งเป็นสองระดับตาม ADR 0001 — ข้อที่ทำงานด้วยการวิเคราะห์เชิงโครงสร้างเปิดให้ทุกคน
ส่วนข้อที่ต้องเรียกโมเดลเปิดให้สมาชิกที่ใส่ API key ของตัวเอง (ทำเครื่องหมาย **[สมาชิก]**)

**P0 — ต้องมีถึงจะเรียกว่าเข้าใจ repo**

1. **[สมาชิก]** สรุป repo ภาษาไทย: ทำอะไร / stack / entrypoint / วิธีรัน / ข้อสังเกต
2. แผนที่สถาปัตยกรรม: โมดูล–ชั้น–ขอบเขต พร้อมคำอธิบายรายโมดูล
3. กราฟ dependency แบบโต้ตอบ (WebGL) + โหมดสี: โฟลเดอร์ / ชั้น / ความร้อน / blast
4. ตัวสำรวจไฟล์ + รายการ symbol (สรุปไทยรายไฟล์เป็นส่วน **[สมาชิก]**)
5. **[สมาชิก]** ถาม-ตอบภาษาไทยกับ repo พร้อมอ้างอิง `file:line` คลิกเปิดได้
6. **[สมาชิก]** เส้นทางอ่านโค้ดสำหรับคนใหม่ (7–15 ขั้น เรียงตามความสำคัญจริง)
7. ลิงก์ถาวร + แคชตาม commit

**P1 — ทำให้เข้าใจลึกขึ้น** 8. Call graph / ตามรอยการไหล: จาก entrypoint → handler → service → ฐานข้อมูล 9. Blast radius "ถ้าแก้ไฟล์นี้ อะไรพังบ้าง" 10. คะแนนสุขภาพ A–F + จุดร้อน (churn × complexity) 11. สแกนความปลอดภัยเบื้องต้น + secret detection (พร้อมกลบค่าก่อนส่งเข้า LLM) 12. เจ้าของโค้ด / bus factor จาก git log 13. **[สมาชิก]** ส่งออกรายงานไทย: Markdown / PDF / JSON 14. **[สมาชิก]** Glossary ศัพท์เทคนิค ไทย–อังกฤษ อธิบายตามบริบท repo นั้น

**P2 — ของดีที่มีทีหลังได้** 15. เทียบสองคอมมิต/สอง repo 16. วิเคราะห์ผลกระทบของ PR 17. รองรับโน้ต Markdown/Obsidian (wiki-link graph) 18. ฝัง badge SVG สุขภาพโค้ดใน README (แบบ card ของ CodeFlow) 19. repo ส่วนตัวด้วย token ของผู้ใช้ (เก็บใน session เท่านั้น เข้ารหัส ไม่ลงดิสก์)

---

## 9. UX/UI — Minimalist Motion

**หลักคิด:** ผู้ใช้มาเพราะ "อ่านโค้ดไม่ทัน" — หน้าจอจึงต้องเงียบ ไม่แย่งความสนใจ
ให้เนื้อหาเป็นพระเอก และใช้ motion เพื่อ "บอกความสัมพันธ์" ไม่ใช่เพื่อความสวย

**Design tokens**

- สี: พื้นกลางค่อนขาว/ดำหมึก + เทาเอนน้ำเงินเล็กน้อย, accent เดียว (น้ำเงินแบบพิมพ์เขียว), สีเชิงความหมายแยกต่างหาก (ดี/เตือน/วิกฤต)
- ตัวอักษร: หัวเรื่อง Bai Jamjuree / เนื้อความ IBM Plex Sans Thai / โค้ด IBM Plex Mono + JetBrains Mono
- ระยะ: กริด 4px, คอนเทนต์กว้างสุด 1440px, บรรทัดอ่านยาว ~72 อักษร
- รัศมีมุม 6px, เส้น 1px, เงาแทบไม่ใช้ — ใช้เส้นและระยะแทน

**สเปกการเคลื่อนไหว**

| กรณี                                      | ระยะเวลา   | easing                             |
| ----------------------------------------- | ---------- | ---------------------------------- |
| hover / กดปุ่ม                            | 120 ms     | `cubic-bezier(.2,0,0,1)`           |
| เปลี่ยนแท็บ / เผยแผง                      | 220 ms     | `cubic-bezier(.2,0,0,1)`           |
| เลือก node → เปิดแผงไฟล์ (shared element) | 280 ms     | spring (stiffness 300, damping 30) |
| จัดวางกราฟใหม่                            | 400 ms     | ease-out                           |
| เนื้อหาทยอยเข้า (stagger)                 | 60 ms/ชิ้น | ease-out                           |

- เคารพ `prefers-reduced-motion: reduce` → ตัดเหลือ fade 80 ms
- ห้ามแอนิเมชันวนไม่จบ ยกเว้นตัวบอกความคืบหน้าขณะวิเคราะห์จริง

**หน้าจอหลัก**

1. `/` — ช่องวางลิงก์เดียวกลางจอ + ตัวอย่าง repo ยอดนิยม + ประวัติที่เคยดู
2. `/analyzing/[id]` — ไทม์ไลน์ 9 ขั้น เดินจริงตาม SSE
3. `/r/[owner]/[name]` — 3 คอลัมน์: ต้นไม้ไฟล์ | ผืนผ้าใบกราฟ | แผงรายละเอียด
4. `/r/.../chat` — ถามตอบไทย พร้อมการ์ดอ้างอิงโค้ด
5. `/r/.../report` — รายงานอ่านยาว พร้อมปุ่มส่งออก
6. `/versions` — ไทม์ไลน์เวอร์ชันย้อนหลัง
7. คีย์ลัด: `⌘K` command palette, `/` ค้นหา, `?` ช่วยเหลือ, `Esc` ปิด

**เข้าถึงได้:** คอนทราสต์ ≥ 4.5:1, โฟกัสเห็นชัด, ใช้คีย์บอร์ดได้ทั้งหมด, กราฟมีมุมมองตารางสำรอง

---

## 10. ระบบเวอร์ชันและ Changelog

**กติกา:** SemVer `MAJOR.MINOR.PATCH` + Conventional Commits + **ทุกครั้งที่พัฒนา ต้องบันทึกเวอร์ชัน**

- `CHANGELOG.md` (ภาษาไทย) สร้างอัตโนมัติจาก commit ด้วย `git-cliff`
- `docs/changelog/vX.Y.Z.md` หนึ่งไฟล์ต่อรุ่น — หัวข้อคงที่: **เพิ่ม / แก้ / ปรับ / ถอด / หมายเหตุอัปเกรด**
- หน้า `/versions` ในเว็บ อ่านไฟล์เหล่านี้ → ไทม์ไลน์ย้อนหลังได้ทุกรุ่น กรองตามชนิดการเปลี่ยนแปลง ลิงก์ไป git tag
- ป้ายเวอร์ชันมุมล่าง: `v1.4.2 · 2026-09-07 · a1b2c3d` ฝังตอน build ผ่าน build args
- `GET /api/version` → `{version, gitSha, builtAt, analyzerSchema}`
- **CI บังคับ:** PR ที่ไม่มีไฟล์ changelog ใหม่ → เช็กไม่ผ่าน (ทำให้ "อัปเดตทุกครั้งที่พัฒนา" เกิดขึ้นจริง ไม่ใช่แค่ตั้งใจ)
- `analyzerSchema` แยกเวอร์ชันต่างหาก — เปลี่ยนเมื่อไหร่ = แคชผลวิเคราะห์เก่าใช้ไม่ได้ ต้องล้าง

---

## 11. วงจรการพัฒนา (ทดสอบใน Docker เท่านั้น)

```
เขียนโค้ด → make dev (Docker) → make test (Docker, ต้องเขียว 100%)
   → บันทึกเวอร์ชัน + changelog → commit + tag → push GitHub
   → GitHub Actions build image → GHCR
   → บน Ubuntu server: git pull → docker compose pull → up -d → healthcheck ผ่าน
   → เสร็จ (ถ้าไม่ผ่าน: rollback ไป tag ก่อนหน้า)
```

**ห้ามรันบนเครื่อง host** — ไม่มี `npm run dev` นอก Docker เลย ทุกคำสั่งผ่าน Makefile:

| คำสั่ง                                   | ทำอะไร                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| `make dev`                               | `compose.yaml` — hot reload, bind mount, Postgres/Redis ครบ                       |
| `make test`                              | `compose.test.yaml` — lint + typecheck + unit + integration + e2e จบในคอนเทนเนอร์ |
| `make test-e2e`                          | Playwright บนอิมเมจ `mcr.microsoft.com/playwright`                                |
| `make build`                             | build อิมเมจ production หลาย stage                                                |
| `make release`                           | bump เวอร์ชัน + สร้าง changelog + tag                                             |
| `make deploy`                            | สั่ง deploy บนเซิร์ฟเวอร์ผ่าน ssh                                                 |
| `make logs` / `make down` / `make clean` | จัดการคอนเทนเนอร์                                                                 |

**ชั้นการทดสอบ**

1. Unit (Vitest) — parser, resolver, metric, ฟอร์แมตไทย
2. Golden — fixture repo 6 แบบ (TS monorepo, Python, Go, ผสมภาษา, repo ใหญ่ 10k ไฟล์, repo ว่าง) เทียบ snapshot JSON
3. Integration — API + Postgres + Redis จริงใน compose
4. E2E — Playwright: วางลิงก์ → เห็นกราฟ → ถามคำถาม → ได้คำตอบพร้อม citation
5. Visual regression — สแนปช็อตหน้าหลัก ทั้งธีมสว่าง/มืด
6. a11y — axe-core ต้องไม่มี violation ระดับ critical
7. Performance budget — repo 10k ไฟล์ ต้องวิเคราะห์จบ < 90 วินาที, กราฟ 60fps
8. Security — `npm audit`, trivy สแกนอิมเมจ, ทดสอบ path traversal / SSRF

CI (GitHub Actions) เรียก **คำสั่งเดียวกับที่นักพัฒนารันในเครื่อง** — `docker compose -f compose.test.yaml run --rm test`
ไม่มีเส้นทางทดสอบสองแบบให้เถียงกันว่า "เครื่องผมผ่าน"

---

## 12. การนำขึ้นเซิร์ฟเวอร์ (Ubuntu)

- เซิร์ฟเวอร์: Ubuntu 24.04 LTS, Docker Engine + Compose plugin, ผู้ใช้ `deploy` (ไม่ใช่ root)
- โฟลเดอร์: `/srv/repolens` (checkout เฉพาะ `compose.prod.yaml`, `Caddyfile`, `.env`)
- DNS: `repo.benyapol.com` A record → IP เซิร์ฟเวอร์; Caddy ขอใบรับรอง TLS อัตโนมัติ
- ขั้นตอน deploy: `git pull` → `docker compose -f compose.prod.yaml pull` → `up -d --wait` → เช็ก `/api/health`
- ภาพลักษณ์ที่ deploy คืออิมเมจที่ CI สร้างและติดแท็กด้วยเวอร์ชัน (ไม่ build บนเซิร์ฟเวอร์ = เร็วและได้ของชิ้นเดียวกับที่ทดสอบ)
- Rollback: `IMAGE_TAG=v1.4.1 docker compose up -d` (แท็กเก่ายังอยู่ใน registry)
- สำรองข้อมูล: `pg_dump` รายวัน เก็บ 14 วัน + ทดสอบกู้คืนเดือนละครั้ง
- ตรวจสุขภาพ: healthcheck ในทุก service, `docker compose up -d --wait`, log ผ่าน json-file + rotation
- ทรัพยากรขั้นต่ำที่แนะนำ: 4 vCPU / 8 GB RAM / SSD 80 GB (worker กินแรมตอน parse repo ใหญ่)

---

## 13. โครงสร้างโปรเจกต์

```
repolens/
├─ apps/
│  ├─ web/            Next.js 15
│  ├─ api/            Fastify
│  └─ worker/         BullMQ consumer
├─ packages/
│  ├─ analyzer/       clone, parse, graph, metrics
│  ├─ comprehend/     chunk, embed, สรุปไทย, RAG
│  ├─ ui/             design tokens + คอมโพเนนต์
│  └─ shared/         type + zod schema ร่วม
├─ services/embed/    ONNX embedding (Python เล็ก ๆ)
├─ docs/
│  ├─ changelog/      vX.Y.Z.md ทุกรุ่น
│  ├─ architecture.md
│  └─ runbook.md
├─ tests/fixtures/    repo ตัวอย่างสำหรับ golden test
├─ compose.yaml  compose.test.yaml  compose.prod.yaml
├─ Caddyfile  Makefile  CHANGELOG.md  README.md
```

**README.md ที่ขึ้น GitHub — เขียนแค่ 2 อย่างตามที่สั่ง:** คำอธิบายว่าเว็บนี้คืออะไร/ทำอะไรได้ และ stack ที่ใช้
ไม่มีวิธีติดตั้ง ไม่มีวิธีรัน ไม่มี badge รก ๆ (รายละเอียดปฏิบัติการอยู่ใน `docs/` ทั้งหมด)

---

## 14. ความปลอดภัย

- **ไม่รันโค้ดของผู้ใช้เด็ดขาด** — อ่านและ parse เท่านั้น
- worker: non-root, read-only rootfs, `--cap-drop ALL`, จำกัด CPU/RAM, timeout, ไม่มี network ออกนอกยกเว้น git host ที่อนุญาต
- กัน SSRF: allowlist เฉพาะ github.com / gitlab.com / bitbucket.org (+ self-host ที่ตั้งค่าเอง), บล็อก IP ภายใน
- กัน path traversal / zip bomb / symlink escape ตอนเดินไฟล์
- token ของผู้ใช้: เก็บใน session ฝั่งเซิร์ฟเวอร์ เข้ารหัส หมดอายุ ไม่ลง log ไม่ลงดิสก์
- กลบ secret ก่อนส่งเข้า LLM ทุกครั้ง (regex + entropy) และไม่ส่ง repo ส่วนตัวเข้า LLM ถ้าผู้ใช้ไม่กดยอมรับ
- rate limit ต่อ IP, จำกัดขนาด repo และคิวต่อผู้ใช้
- security headers + CSP เข้ม, ไม่มี inline script ที่ไม่ได้ hash

---

## 15. แผนการปล่อยเวอร์ชัน

| รุ่น   | ได้อะไร                                                                                  | เกณฑ์ผ่าน                           |
| ------ | ---------------------------------------------------------------------------------------- | ----------------------------------- |
| v0.1.0 | โครงโปรเจกต์, Docker dev/test, CI, ระบบ changelog, หน้า `/versions`                      | `make test` เขียวใน Docker          |
| v0.2.0 | Ingest: clone + inventory + parse + edges + เก็บลง DB                                    | วิเคราะห์ repo ตัวเองได้ครบทุกไฟล์  |
| v0.3.0 | โครง UI + กราฟ WebGL + ต้นไม้ไฟล์ + SSE ความคืบหน้า                                      | ผู้ใช้เห็นกราฟจริงจากลิงก์จริง      |
| v0.4.0 | ตัวชี้วัด: สุขภาพ, blast radius, จุดร้อน, เจ้าของโค้ด, สแกนความปลอดภัย                   | ตรงกับ golden fixture               |
| v0.5.0 | ระบบล็อกอิน + ช่องใส่ API key ของผู้ใช้ + ชั้นความเข้าใจ: สรุปไทยรายไฟล์/โมดูล/ทั้ง repo | ครอบคลุมไฟล์ 100% (D2, D4)          |
| v0.6.0 | ถาม-ตอบไทย + citation + เส้นทางอ่านโค้ด                                                  | คำตอบมีอ้างอิงจริงทุกครั้ง (D5, D6) |
| v0.7.0 | ส่งออกรายงาน, ลิงก์ถาวร, วิเคราะห์ซ้ำแบบ incremental                                     | รอบสองเร็วขึ้น ≥ 70% (D7, D8)       |
| v0.8.0 | ปรับ motion/a11y/มือถือ + performance budget                                             | axe ไม่มี critical, 60fps           |
| v0.9.0 | ขึ้นเซิร์ฟเวอร์จริง + TLS + สำรองข้อมูล + runbook                                        | เปิด repo.benyapol.com ได้          |
| v1.0.0 | ผ่านครบ D1–D8                                                                            | ปล่อยจริง                           |

---

## 16. ความเสี่ยงและการรับมือ

| ความเสี่ยง                                  | รับมือ                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| repo ใหญ่มาก (Linux kernel) ทำให้เครื่องล่ม | จำกัดขนาด/จำนวนไฟล์, ทำ progressive analysis, วิเคราะห์เฉพาะโฟลเดอร์ที่เลือกได้         |
| ค่า LLM บานปลาย                             | prompt caching + Batch API + effort ต่ำสำหรับสรุปรายไฟล์ + แคชตาม SHA + โควต้าต่อผู้ใช้ |
| resolve import ข้ามภาษาไม่แม่น              | ใส่ค่า confidence ทุก edge, แสดงเส้นที่ไม่มั่นใจแบบประ, มี golden test คุมถอยหลัง       |
| tree-sitter native build พังใน Docker       | ใช้ wasm (`web-tree-sitter`) ตั้งแต่ต้น                                                 |
| AI สรุปผิด (hallucination)                  | ทุกคำอธิบายต้องผูกกับ `file:line` จริง, ตัวไหนไม่มีอ้างอิงไม่แสดง                       |
| งานโตเกินคนเดียวดูแล                        | ทำ P0 ให้จบก่อน ปล่อยใช้จริง แล้วค่อยเพิ่ม P1/P2 ทีละรุ่น                               |
| ใบอนุญาต MIT ของ CodeFlow                   | เก็บ LICENSE เดิม + ให้เครดิตในหน้า about (ถ้ายืมโค้ดมาใช้จริง)                         |

---

## 17. เรื่องที่ตัดสินใจแล้ว

1. **ชั้น AI — เอา และแบ่งเป็นสองระดับ** (ดู [ADR 0001](docs/decisions/0001-two-tier-byok.md))
   - **ผู้เยี่ยมชม** ไม่ต้องล็อกอิน ได้ผลวิเคราะห์เชิงโครงสร้างทั้งหมด เทียบเท่าที่ CodeFlow ต้นทางทำได้
   - **สมาชิก** ล็อกอินแล้วใส่ API key ของตัวเอง จึงเปิดชั้นความเข้าใจ — ค่าเรียกใช้โมเดลคิดกับกุญแจของผู้ใช้เอง
   - ระบบล็อกอินและช่องใส่กุญแจลงจริงในรุ่น v0.5.0 พร้อมชั้นความเข้าใจ
2. **ตารางระดับการใช้งานเป็นแหล่งความจริงเดียว** อยู่ที่ `packages/shared/src/tiers.ts`
   ทั้งหน้าบ้านและหลังบ้านอ่านจากที่เดียวกัน จะได้ไม่มีปุ่มที่กดได้แต่ API ปฏิเสธ

### ยังต้องการข้อมูลจากเจ้าของงาน

- สเปกเซิร์ฟเวอร์ Ubuntu และมี reverse proxy เดิมอยู่แล้วหรือไม่
- ชื่อ repo บน GitHub ที่จะ push และ DNS ของ repo.benyapol.com ชี้มาหรือยัง
- วิธีล็อกอินที่อยากได้ในรุ่น v0.5.0 (GitHub OAuth / อีเมล + ลิงก์เข้าใช้ / อย่างอื่น)
