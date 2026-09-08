-- ค้นคืนบริบทสำหรับถาม-ตอบและเส้นทางอ่านโค้ดของ v0.6.0
--
-- เลือก pg_trgm แทนตัวฝังเวกเตอร์ เพราะข้อมูลที่ต้องค้นคือชื่อไฟล์ ชื่อฟังก์ชัน
-- และข้อความสรุปที่มีอยู่แล้ว ซึ่งเป็นข้อความสั้นและไม่ต้องการความเข้าใจเชิงความหมายลึก
-- pg_trgm มากับ Postgres อยู่แล้ว ไม่ต้องเพิ่มคอนเทนเนอร์โมเดลฝังเวกเตอร์ก็ตอบคำถามพื้นฐานได้แม่นพอ

create extension if not exists pg_trgm;

create index if not exists symbols_name_trgm_idx on symbols using gin (name gin_trgm_ops);
create index if not exists files_path_trgm_idx on files using gin (path gin_trgm_ops);
