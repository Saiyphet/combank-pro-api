-- 004_that_luang.sql: That Luang Festival Spin, on the same database as Halloween.
-- Additive only: it creates new tl_* objects and never drops, deletes or alters anything that exists.
-- Three wheels, hands counted per level, one spin per level.
-- Holds no prize or target values: they are not confirmed, and are set on the admin Prizes page.
-- Run this BEFORE the API that reads tl_*: /me and login read these objects.

begin;

create table tl_tiers (
  tier          text primary key check (tier in ('bronze', 'silver', 'gold')),
  hands_target  int check (hands_target > 0),   -- null until confirmed: the wheel stays locked
  sort_order    int not null
);
alter table tl_tiers enable row level security;
insert into tl_tiers (tier, sort_order) values ('bronze', 1), ('silver', 2), ('gold', 3);

create table tl_hands (
  player_id   uuid not null references ld_players(id) on delete cascade,
  tier        text not null references tl_tiers(tier),
  hands       int  not null check (hands >= 0),
  updated_at  timestamptz not null default now(),
  primary key (player_id, tier)
);
create index tl_hands_board on tl_hands (tier, hands desc);
alter table tl_hands enable row level security;

-- Accounts made from the That Luang admin skip Halloween's hands check, so the API gives them no Halloween spin.
create table tl_only_players (
  player_id   uuid primary key references ld_players(id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table tl_only_players enable row level security;

-- Same shape as ld_prizes plus tier. prize_group: CASH shows at once, BONUS sits in a box the player opens.
create table tl_prizes (
  id             uuid primary key default gen_random_uuid(),
  code           text unique not null,
  tier           text not null references tl_tiers(tier),
  prize_group    text not null check (prize_group in ('CASH', 'BONUS')),
  name           text not null,
  value_lak      bigint,
  qty_total      int not null check (qty_total >= 0),
  qty_remaining  int not null check (qty_remaining >= 0),
  sort_order     int not null,
  image_url      text,
  is_active      boolean not null default true,
  weight_bp      int not null default 0 check (weight_bp >= 0)
);
alter table tl_prizes enable row level security;

create table tl_spins (
  id                  uuid primary key default gen_random_uuid(),
  player_id           uuid not null references ld_players(id),
  tier                text not null references tl_tiers(tier),
  slot                int  not null check (slot between 0 and 7),
  prize_id            uuid not null references tl_prizes(id),
  spun_at             timestamptz not null default now(),
  fulfillment_status  text not null default 'PENDING'
    check (fulfillment_status in ('PENDING', 'DELIVERED', 'CANCELLED')),
  delivered_by        uuid references ld_admins(id),
  delivered_at        timestamptz,
  note                text,
  unique (player_id, tier)
);
alter table tl_spins enable row level security;

-- Its own log: the Halloween weight history reads every row of ld_weight_changes as { main, cash }.
create table tl_tier_changes (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid not null references ld_admins(id),
  tier        text not null references tl_tiers(tier),
  before      jsonb not null,
  after       jsonb not null,
  created_at  timestamptz not null default now()
);
alter table tl_tier_changes enable row level security;

-- One row per player, with hands per level and all spins, so /me and the admin pages read the same thing.
create view tl_admin_players with (security_invoker = true) as
select
  p.id, p.username, p.display_name, p.xpoker_player_id, p.is_active, p.created_at,
  a.username           as created_by,
  coalesce(c.code, '') as club_code,
  coalesce(c.name, '') as club_name,
  coalesce((select jsonb_object_agg(h.tier, h.hands) from tl_hands h where h.player_id = p.id), '{}'::jsonb) as hands,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'tier', s.tier, 'slot', s.slot, 'spun_at', s.spun_at,
      'fulfillment_status', s.fulfillment_status, 'delivered_by', d.username, 'delivered_at', s.delivered_at, 'note', s.note,
      'prize_code', pr.code, 'prize_group', pr.prize_group, 'prize_name', pr.name, 'prize_value_lak', pr.value_lak
    ) order by s.spun_at)
    from tl_spins s
    join tl_prizes pr on pr.id = s.prize_id
    left join ld_admins d on d.id = s.delivered_by
    where s.player_id = p.id
  ), '[]'::jsonb) as spins
from ld_players p
join ld_admins a     on a.id = p.created_by
left join ld_clubs c on c.id = p.club_id;

-- The server decides the prize. Slots 0, 2, 4, 6 hold cash and 1, 3, 5, 7 hold a box, matching the 3D wheel.
create function tl_spin(p_player_id uuid, p_tier text)
returns jsonb language plpgsql security definer as $$
declare
  v_target int;
  v_hands  int;
  v_total  int;
  v_roll   int;
  v_prize  tl_prizes;
  v_spin   tl_spins;
begin
  -- Locks the player, so two taps at once cannot both spin
  perform 1 from ld_players where id = p_player_id and is_active for update;
  if not found then raise exception 'PLAYER_NOT_FOUND'; end if;

  if exists (select 1 from tl_spins where player_id = p_player_id and tier = p_tier) then
    raise exception 'ALREADY_SPUN';
  end if;

  select hands_target into v_target from tl_tiers where tier = p_tier;
  select hands into v_hands from tl_hands where player_id = p_player_id and tier = p_tier;
  if v_target is null or coalesce(v_hands, 0) < v_target then raise exception 'NOT_UNLOCKED'; end if;

  -- Locks what is left of this wheel, so a prize cannot be given out twice
  perform 1 from tl_prizes where tier = p_tier and is_active and qty_remaining > 0 order by id for update;
  select coalesce(sum(weight_bp), 0) into v_total from tl_prizes where tier = p_tier and is_active and qty_remaining > 0;
  if v_total = 0 then raise exception 'NO_PRIZES_LEFT'; end if;
  v_roll := ld_random_int(v_total);   -- once only: inside the query below it would roll again for every row

  update tl_prizes set qty_remaining = qty_remaining - 1
   where id = (
     select c.id from (
       select id, sum(weight_bp) over (order by sort_order, code) as upto
         from tl_prizes where tier = p_tier and is_active and qty_remaining > 0 and weight_bp > 0
     ) c where c.upto > v_roll order by c.upto limit 1
   )
   returning * into v_prize;

  insert into tl_spins (player_id, tier, slot, prize_id)
  values (p_player_id, p_tier, ld_random_int(4) * 2 + case when v_prize.prize_group = 'CASH' then 0 else 1 end, v_prize.id)
  returning * into v_spin;

  return jsonb_build_object(
    'id', v_spin.id, 'slot', v_spin.slot,
    'prize_group', v_prize.prize_group, 'prize_name', v_prize.name, 'prize_value_lak', v_prize.value_lak);
end $$;

create function tl_tier_snapshot(p_tier text)
returns jsonb language sql stable as $$
  select jsonb_build_object('tier', t.tier, 'hands_target', t.hands_target, 'prizes', coalesce((
    select jsonb_agg(to_jsonb(p) - 'id' - 'image_url' order by p.sort_order) from tl_prizes p where p.tier = t.tier and p.is_active
  ), '[]'::jsonb))
  from tl_tiers t where t.tier = p_tier;
$$;

-- Saves a level's target and prizes together and keeps the before and after. A removed prize is only hidden: spins point at it.
create function tl_save_tier(p_admin_id uuid, p_tier text, p_target int, p_prizes jsonb)
returns void language plpgsql security definer as $$
declare
  v_before jsonb := tl_tier_snapshot(p_tier);
  v_row    jsonb;
  v_code   text;
  v_kept   text[] := '{}';
  v_order  int := 0;
begin
  update tl_tiers set hands_target = p_target where tier = p_tier;
  for v_row in select * from jsonb_array_elements(p_prizes) loop
    v_order := v_order + 1;
    v_code := coalesce(nullif(v_row->>'code', ''), upper(p_tier) || '_' || left(replace(gen_random_uuid()::text, '-', ''), 8));
    v_kept := v_kept || v_code;
    insert into tl_prizes (code, tier, prize_group, name, value_lak, qty_total, qty_remaining, sort_order, weight_bp)
    values (v_code, p_tier, v_row->>'group', v_row->>'name', (v_row->>'value_lak')::bigint, (v_row->>'qty_total')::int, (v_row->>'qty_total')::int, v_order, (v_row->>'weight_bp')::int)
    on conflict (code) do update set
      prize_group = excluded.prize_group, name = excluded.name, value_lak = excluded.value_lak,
      qty_remaining = excluded.qty_total - (tl_prizes.qty_total - tl_prizes.qty_remaining),
      qty_total = excluded.qty_total, sort_order = excluded.sort_order, weight_bp = excluded.weight_bp, is_active = true
    where tl_prizes.tier = p_tier;
  end loop;
  update tl_prizes set is_active = false where tier = p_tier and code <> all (v_kept);
  insert into tl_tier_changes (admin_id, tier, before, after) values (p_admin_id, p_tier, v_before, tl_tier_snapshot(p_tier));
exception when check_violation then
  raise exception 'QTY_BELOW_GIVEN';
end $$;

-- A plain revoke from anon leaves the default PUBLIC grant in place, so it has to name PUBLIC too.
revoke all on function tl_spin(uuid, text), tl_tier_snapshot(text), tl_save_tier(uuid, text, int, jsonb) from public, anon, authenticated;
grant execute on function tl_spin(uuid, text), tl_tier_snapshot(text), tl_save_tier(uuid, text, int, jsonb) to service_role;

commit;
