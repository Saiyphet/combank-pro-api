-- 001_init.sql — Halloween Lucky Draw: ตาราง + seed รางวัล + RPC วงล้อเงินสด
-- รันไฟล์นี้ก่อน แล้วค่อยรัน 002_custom_wheel_weights.sql (มี ld_spin + อัตรา)

create extension if not exists pgcrypto with schema extensions;

-- ---------- ตาราง ----------
create table if not exists ld_admins (
  id            uuid primary key default gen_random_uuid(),
  username      text unique not null,
  password_hash text not null,
  role          text not null default 'STAFF' check (role in ('SUPER','STAFF')),
  created_at    timestamptz not null default now()
);

create table if not exists ld_players (
  id                uuid primary key default gen_random_uuid(),
  username          text unique not null,
  password_hash     text not null,
  display_name      text not null,
  xpoker_player_id  text unique not null,
  hands_count       int  not null check (hands_count >= 1666),
  is_active         boolean not null default true,
  created_by        uuid not null references ld_admins(id),
  created_at        timestamptz not null default now()
);

create table if not exists ld_prizes (
  id             uuid primary key default gen_random_uuid(),
  code           text unique not null,
  prize_group    text not null check (prize_group in ('CASH','BONUS')),
  name           text not null,
  value_lak      bigint,
  qty_total      int not null check (qty_total >= 0),
  qty_remaining  int not null check (qty_remaining >= 0),
  sort_order     int not null,
  image_url      text,
  is_active      boolean not null default true
);

create table if not exists ld_spins (
  id                  uuid primary key default gen_random_uuid(),
  player_id           uuid not null unique references ld_players(id),
  main_segment        text not null,            -- 'CASH' หรือ code โบนัส
  prize_id            uuid not null references ld_prizes(id),
  status              text not null check (status in ('CASH_PENDING','DONE')),
  spun_at             timestamptz not null default now(),
  cash_spun_at        timestamptz,
  fulfillment_status  text not null default 'PENDING'
    check (fulfillment_status in ('PENDING','DELIVERED','CANCELLED')),
  delivered_by        uuid references ld_admins(id),
  delivered_at        timestamptz,
  note                text
);

-- RLS เปิดทุกตาราง ไม่มี policy = เข้าได้เฉพาะ service_role (NestJS)
alter table ld_admins  enable row level security;
alter table ld_players enable row level security;
alter table ld_prizes  enable row level security;
alter table ld_spins   enable row level security;

-- ---------- seed รางวัล ----------
insert into ld_prizes (code, prize_group, name, value_lak, qty_total, qty_remaining, sort_order) values
('CASH_1','CASH','ລາງວັນທີ 1',16666000,1,1,1),
('CASH_2','CASH','ລາງວັນທີ 2',9999000,1,1,2),
('CASH_3','CASH','ລາງວັນທີ 3',7777000,1,1,3),
('CASH_4','CASH','ລາງວັນທີ 4',6666000,1,1,4),
('CASH_5','CASH','ລາງວັນທີ 5',6666000,1,1,5),
('CASH_6','CASH','ລາງວັນທີ 6',6666000,1,1,6),
('CASH_7','CASH','ລາງວັນທີ 7',666000,14,14,7),
('BONUS_1','BONUS','Avatar + VIP ທອງ 3 ມື້',null,13,13,8),
('BONUS_2','BONUS','Avatar + VIP ເງິນ 7 ມື້',null,10,10,9),
('BONUS_3','BONUS','VIP ທອງ 5 ມື້',null,17,17,10),
('BONUS_4','BONUS','VIP ເງິນ 7 ມື້',null,50,50,11),
('BONUS_5','BONUS','VIP ທອງແດງ 15 ມື້',null,10,10,12),
('BONUS_6','BONUS','VIP ທອງແດງ 9 ມື້',null,10,10,13),
('BONUS_7','BONUS','VIP ທອງແດງ 6 ມື້ + ໂມງ 5 ຄັ້ງ ×6',null,60,60,14),
('BONUS_8','BONUS','VIP ເງິນ 3 ມື້ + ໂມງ 5 ຄັ້ງ ×1',null,1,1,15)
on conflict (code) do nothing;

-- ---------- RPC ----------
-- ผลลัพธ์ที่ส่งให้ API (ซ่อนรางวัลเงินสดจนกว่าจะหมุนวงล้อเงินสด)
create or replace function ld_spin_result(s ld_spins, p ld_prizes, replay boolean)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'already_spun', replay, 'spin_id', s.id, 'segment', s.main_segment,
    'status', s.status, 'spun_at', s.spun_at, 'cash_spun_at', s.cash_spun_at,
    'prize', case when s.status = 'CASH_PENDING' then null
                  else to_jsonb(p) - 'qty_total' - 'qty_remaining' - 'weight_bp' end);
$$;

-- วงล้อเงินสด: เปิดเผยรางวัลที่สุ่มไว้ตอนหมุนวงล้อหลัก
create or replace function ld_spin_cash(p_player_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_spin   ld_spins;
  v_prize  ld_prizes;
  v_replay boolean := false;
begin
  select * into v_spin from ld_spins where player_id = p_player_id for update;
  if not found then raise exception 'NOT_SPUN'; end if;
  if v_spin.main_segment <> 'CASH' then raise exception 'NOT_CASH_SEGMENT'; end if;

  if v_spin.status = 'DONE' then
    v_replay := true;
  else
    update ld_spins set status = 'DONE', cash_spun_at = now()
     where id = v_spin.id returning * into v_spin;
  end if;

  select * into v_prize from ld_prizes where id = v_spin.prize_id;
  return ld_spin_result(v_spin, v_prize, v_replay);
end $$;

revoke execute on function ld_spin_cash(uuid) from anon, authenticated;
revoke execute on function ld_spin_result(ld_spins, ld_prizes, boolean) from anon, authenticated;
