-- 002_custom_wheel_weights.sql
-- เปลี่ยนจาก "อัตรา = จำนวนที่เหลือ" เป็น "อัตรากำหนดเอง (weight_bp, หน่วย 0.01%)"
-- จำนวน (qty_remaining) ยังเป็นเพดาน: ช่องที่หมดแล้ว weight = 0 อัตโนมัติ ช่องอื่นเฉลี่ยขึ้นตามสัดส่วน

-- 1) weight ต่อรางวัล + weight ของช่อง CASH บนวงล้อหลัก
alter table ld_prizes add column if not exists weight_bp int not null default 0 check (weight_bp >= 0);

create table if not exists ld_settings (
  key   text primary key,
  value text not null
);
alter table ld_settings enable row level security;  -- ไม่มี policy = เข้าได้เฉพาะ service_role

insert into ld_settings (key, value) values ('main_cash_weight_bp', '400')
on conflict (key) do update set value = excluded.value;

-- วงล้อหลัก: รวม BONUS + CASH(400) = 10000
-- วงล้อเงินสด: รวม CASH_1..7 = 10000
update ld_prizes p set weight_bp = v.w
from (values
  ('BONUS_1',  737), ('BONUS_2',  614), ('BONUS_3',  928), ('BONUS_4', 2760),
  ('BONUS_5',  484), ('BONUS_6',  566), ('BONUS_7', 3481), ('BONUS_8',   30),
  ('CASH_1',   400), ('CASH_2',   400), ('CASH_3',   500), ('CASH_4',   600),
  ('CASH_5',   700), ('CASH_6',  1000), ('CASH_7',  6400)
) as v(code, w)
where p.code = v.code;

-- 2) views อัตราสด (ใช้ทั้ง GET /prizes และใน RPC)
drop view if exists ld_main_wheel_odds;
drop view if exists ld_cash_wheel_odds;

create view ld_main_wheel_odds with (security_invoker = true) as
with seg as (
  select 'CASH'::text as code, 'เงินสด'::text as name, 0 as sort_order,
         sum(qty_total)::int as qty_total, sum(qty_remaining)::int as qty_remaining,
         (select value::int from ld_settings where key = 'main_cash_weight_bp') as weight_bp
    from ld_prizes where prize_group = 'CASH' and is_active
  union all
  select code, name, sort_order, qty_total, qty_remaining, weight_bp
    from ld_prizes where prize_group = 'BONUS' and is_active
), live as (
  select seg.*, case when qty_remaining > 0 then weight_bp else 0 end as w from seg
)
select code, name, sort_order, qty_total, qty_remaining, w,
       round(w * 100.0 / nullif(sum(w) over (), 0), 2) as odds_pct
  from live
 order by sort_order;

create view ld_cash_wheel_odds with (security_invoker = true) as
with live as (
  select code, name, value_lak, image_url, sort_order, qty_total, qty_remaining,
         case when qty_remaining > 0 then weight_bp else 0 end as w
    from ld_prizes where prize_group = 'CASH' and is_active
)
select live.*, round(w * 100.0 / nullif(sum(w) over (), 0), 2) as odds_pct
  from live
 order by sort_order;

-- 3) สุ่มเลข 0..n-1 แบบ crypto
create or replace function ld_random_int(n int)
returns int language sql volatile as $$
  select ((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint) % n)::int;
$$;

-- 4) ld_spin ใหม่: สุ่มวงล้อหลักตาม weight -> ถ้า CASH สุ่มวงล้อเงินสดตาม weight
--    (ตัดสินรางวัลเงินสดตั้งแต่ขั้นนี้ เก็บไว้ เปิดเผยตอน ld_spin_cash เหมือนเดิม)
create or replace function ld_spin(p_player_id uuid)
returns jsonb language plpgsql security definer as $$
declare
  v_player  ld_players;
  v_spin    ld_spins;
  v_prize   ld_prizes;
  v_total   int;
  v_roll    int;
  v_segment text;
  v_code    text;
begin
  select * into v_player from ld_players
   where id = p_player_id and is_active for update;
  if not found then raise exception 'PLAYER_NOT_FOUND'; end if;

  select * into v_spin from ld_spins where player_id = p_player_id;
  if found then
    select * into v_prize from ld_prizes where id = v_spin.prize_id;
    return ld_spin_result(v_spin, v_prize, true);
  end if;

  -- ล็อกรางวัลที่เหลือ กันแจกเกินจำนวน
  perform 1 from ld_prizes where is_active and qty_remaining > 0 order by id for update;

  -- ขั้น 1: วงล้อหลัก
  select coalesce(sum(w), 0) into v_total from ld_main_wheel_odds;
  if v_total = 0 then raise exception 'NO_PRIZES_LEFT'; end if;
  v_roll := ld_random_int(v_total);
  select code into v_segment from (
    select code, sum(w) over (order by sort_order, code) as upto
      from ld_main_wheel_odds where w > 0
  ) c where c.upto > v_roll order by c.upto limit 1;

  -- ขั้น 2: วงล้อเงินสด (เฉพาะตกช่อง CASH)
  if v_segment = 'CASH' then
    select coalesce(sum(w), 0) into v_total from ld_cash_wheel_odds;
    if v_total = 0 then raise exception 'CASH_WEIGHT_ZERO'; end if;
    v_roll := ld_random_int(v_total);
    select code into v_code from (
      select code, sum(w) over (order by sort_order, code) as upto
        from ld_cash_wheel_odds where w > 0
    ) c where c.upto > v_roll order by c.upto limit 1;
  else
    v_code := v_segment;
  end if;

  update ld_prizes set qty_remaining = qty_remaining - 1
   where code = v_code returning * into v_prize;

  insert into ld_spins (player_id, main_segment, prize_id, status)
  values (p_player_id, v_segment, v_prize.id,
          case when v_segment = 'CASH' then 'CASH_PENDING' else 'DONE' end)
  returning * into v_spin;

  return ld_spin_result(v_spin, v_prize, false);
end $$;

revoke execute on function ld_spin(uuid), ld_random_int(int) from anon, authenticated;
