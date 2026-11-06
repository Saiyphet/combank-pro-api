# ฐานข้อมูลทดสอบบนเครื่อง (local-dev) — Halloween และ That Luang รวมกัน

Docker ชื่อ `base-local`, ฐานข้อมูลพอร์ต 55342, gateway พอร์ต 55341, API พอร์ต 3002 รันพร้อมชุดอื่นได้ ยกเว้น API ชุดอื่นที่ใช้พอร์ต 3002 เหมือนกัน

ใช้สำหรับพัฒนาบนเครื่องเท่านั้น ข้อมูลอยู่ใน Docker และไม่แตะ Supabase หรือ Render ของจริงเลย ห้ามเอาค่าจากฐานข้อมูลจริงมาใส่ `.env` ที่นี่

ลำดับการสร้างฐานข้อมูล: `001`, `002`, `003`, `sql/20_missing_schema.sql`, `sql/30_seed_halloween.sql`, `004`, `sql/40_seed_thatluang.sql`

## ครั้งแรก

ต้องเปิด Docker Desktop ก่อน แล้วรันในโฟลเดอร์นี้ของ repo (`combank-pro-api`):

```powershell
node local-dev/setup.mjs
docker compose -f local-dev/docker-compose.yml up -d
npm ci
```

`setup.mjs` สร้าง `local-dev/.env` และ `.env` (อยู่ใน `.gitignore` แล้ว)

## รันทุกวัน

1. เปิด Docker Desktop แล้วรัน `docker compose -f local-dev/docker-compose.yml up -d`
2. รัน API: `npm run start:dev` (เปิดที่ http://localhost:3002/api)

## บัญชีทดสอบ

| ใช้ที่ | Username | Password |
|---|---|---|
| หน้าผู้เล่น | `cb10001` ถึง `cb10012` | `Local-Player-2026` |
| หน้าแอดมิน `/admin` (SUPER) | `local.super` | `Local-Admin-2026` |
| หน้าแอดมิน `/admin` (STAFF) | `local.staff` | `Local-Admin-2026` |

**Halloween:** ทุกคนหมุนได้คนละครั้ง ยกเว้น `cb10012` ที่หมุนไปแล้ว ใช้ทดสอบผู้เล่นที่กลับมาดูผลเดิม

**That Luang** เป้าหมาย Hands บนเครื่อง (ค่าทดสอบ ยังไม่ใช่ค่าจริง): ทองแดง 100, เงิน 200, ทอง 300

- `cb10001`: ทองแดงพร้อมหมุน อีกสองวงล็อก
- `cb10002`: พร้อมหมุนครบ 3 วง
- `cb10003`: ล็อกครบ 3 วง
- กระดาน Bronze มีผู้เล่นตัวอย่าง 60 คนชื่อ `Board Filler` (ล็อกอินไม่ได้) ทำให้บัญชีทดสอบอยู่นอก 50 อันดับแรก

## ทดสอบทั้งระบบ

ตอน API รันอยู่ คำสั่งนี้เดินครบทั้งสองกิจกรรมด้วยผู้เล่นใหม่ที่สร้างเอง ต้อง build ก่อนเพราะมันเปิด API ชั่วคราวเพื่อทดสอบช่วงเวลาเปิดหมุน:

```powershell
npm run build
npm run smoke-both -- local.super Local-Admin-2026
```

ล็อกอินจำกัด 5 ครั้งต่อ 15 นาที สคริปต์ใช้ผู้เล่น 2 ครั้งต่อรอบ ถ้าเจอ 429 ให้รีสตาร์ต API

## ล้างผลหมุน (ให้หมุนใหม่ได้)

```powershell
docker compose -f local-dev/docker-compose.yml exec db psql -U postgres -c "delete from tl_spins; update tl_prizes set qty_remaining = qty_total; delete from ld_spins; update ld_prizes set qty_remaining = qty_total;"
```

## เริ่มใหม่ทั้งหมด

คำสั่งนี้ลบฐานข้อมูลทดสอบทิ้ง แล้วสร้างใหม่จาก migrations และข้อมูลทดสอบ

```powershell
docker compose -f local-dev/docker-compose.yml down -v
docker compose -f local-dev/docker-compose.yml up -d
```

## รายงาน Hands จาก X-Poker

`POST /api/admin/tl/reports/hands` รับ CSV ที่มีคอลัมน์ `xpoker_id,stakes,hands` โดย `hands` คือยอดสะสมตั้งแต่เริ่มงาน

**รูปแบบนี้เป็นการสมมติ** ยังไม่เคยเห็นรายงานจริงของ X-Poker ต้องขอไฟล์ตัวอย่างแล้วปรับ `src/thatluang/hands-report.ts`

## ⚠️ สิ่งที่ทีมต้องรู้

- `004_that_luang.sql` สร้างเฉพาะของใหม่ชื่อ `tl_*` ไม่ลบ ไม่แก้ และไม่ยุ่งกับข้อมูล Halloween แต่ยังไม่เคยรันกับฐานข้อมูลจริง ต้องสำรองข้อมูลก่อนรันครั้งแรก
- ต้องรัน `004` **ก่อน** ขึ้น API ตัวนี้ เพราะ `/me` และล็อกอินอ่าน `tl_*` ถ้ายังไม่มีจะล็อกอินไม่ได้ทั้งสองกิจกรรม และ `render.yaml` ตั้ง `autoDeploy: true` การ push เข้า branch หลักจึงขึ้นทันที
- ผู้เล่นที่สร้างจาก `POST /api/admin/tl/players` ได้ `hands_count = 1666` เพราะคอลัมน์นี้บังคับอย่างน้อย 1666 และ `ld_spin` ไม่ตรวจ Hands คนกลุ่มนี้จึงหมุน Halloween ได้ด้วยถ้าช่วง `CAMPAIGN_*` ยังเปิดอยู่
- `supabase/migrations/` ใน repo ไม่ครบเมื่อเทียบกับโค้ด (ขาดตาราง `ld_clubs`, `ld_weight_changes` และคอลัมน์ `ld_players.club_id`) `sql/20_missing_schema.sql` สร้างส่วนที่ขาดบนเครื่อง โดยเดาจากโค้ด ควรเทียบกับ schema จริงก่อนรัน `004`
