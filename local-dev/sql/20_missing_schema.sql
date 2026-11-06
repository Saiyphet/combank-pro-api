-- Objects the API uses that are NOT in supabase/migrations (the live database has them, the repo does not).
-- Rebuilt from what src/ reads and writes so a local database works. They are a best guess, not the real definitions:
-- replace this file with the live schema once the team exports it (`supabase db pull` or `pg_dump --schema-only`).

-- clubs: admin.service.ts findClub() / listClubs()
create table if not exists ld_clubs (
  id               uuid primary key default gen_random_uuid(),
  code             text unique not null,          -- lower case, e.g. 'cb'
  name             text not null,
  username_prefix  text not null,
  xpoker_club_id   text unique,
  is_active        boolean not null default true
);
alter table ld_clubs enable row level security;

alter table ld_players add column if not exists club_id uuid references ld_clubs(id);

-- weight history: admin.service.ts weightHistory()
create table if not exists ld_weight_changes (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid not null references ld_admins(id),
  before      jsonb not null,
  after       jsonb not null,
  created_at  timestamptz not null default now()
);
alter table ld_weight_changes enable row level security;

-- 003's view plus the club columns that mappers.ts PlayerRow reads (club_code, club_name)
drop view if exists ld_admin_players;
create view ld_admin_players with (security_invoker = true) as
select
  p.id, p.username, p.display_name, p.xpoker_player_id, p.hands_count, p.is_active, p.created_at,
  a.username                         as created_by,
  coalesce(c.code, '')               as club_code,
  coalesce(c.name, '')               as club_name,
  coalesce(s.status, 'NOT_SPUN')     as spin_status,
  s.id                               as spin_id,
  s.main_segment, s.spun_at, s.cash_spun_at, s.fulfillment_status,
  d.username                         as delivered_by,
  s.delivered_at, s.note,
  case when s.status = 'DONE' then pr.code        end as prize_code,
  case when s.status = 'DONE' then pr.prize_group end as prize_group,
  case when s.status = 'DONE' then pr.name        end as prize_name,
  case when s.status = 'DONE' then pr.value_lak   end as prize_value_lak
from ld_players p
join ld_admins a       on a.id = p.created_by
left join ld_clubs c   on c.id = p.club_id
left join ld_spins s   on s.player_id = p.id
left join ld_prizes pr on pr.id = s.prize_id
left join ld_admins d  on d.id = s.delivered_by;

-- configured weights in basis points: { main: {CASH, BONUS_x...}, cash: {CASH_x...} }
create or replace function ld_current_weights()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'main', coalesce((select jsonb_object_agg(code, weight_bp) from ld_prizes where prize_group = 'BONUS' and is_active), '{}')
            || jsonb_build_object('CASH', (select value::int from ld_settings where key = 'main_cash_weight_bp')),
    'cash', coalesce((select jsonb_object_agg(code, weight_bp) from ld_prizes where prize_group = 'CASH' and is_active), '{}'));
$$;

-- admin.service.ts updateWeights(): the API already checks values and that each wheel sums to 10000
create or replace function ld_set_weights(p_admin_id uuid, p_main jsonb, p_cash jsonb)
returns void language plpgsql security definer as $$
declare
  v_before jsonb := ld_current_weights();
begin
  if p_main is null and p_cash is null then raise exception 'WEIGHTS_EMPTY'; end if;
  if p_main is not null and (select array_agg(k order by k) from jsonb_object_keys(p_main) k)
       is distinct from (select array_agg(k order by k) from jsonb_object_keys(v_before->'main') k) then
    raise exception 'WEIGHTS_INVALID_CODES';
  end if;
  if p_cash is not null and (select array_agg(k order by k) from jsonb_object_keys(p_cash) k)
       is distinct from (select array_agg(k order by k) from jsonb_object_keys(v_before->'cash') k) then
    raise exception 'WEIGHTS_INVALID_CODES';
  end if;

  if p_main is not null then
    update ld_settings set value = p_main->>'CASH' where key = 'main_cash_weight_bp';
    update ld_prizes set weight_bp = (p_main->>code)::int where prize_group = 'BONUS' and is_active;
  end if;
  if p_cash is not null then
    update ld_prizes set weight_bp = (p_cash->>code)::int where prize_group = 'CASH' and is_active;
  end if;

  insert into ld_weight_changes (admin_id, before, after) values (p_admin_id, v_before, ld_current_weights());
end $$;

revoke execute on function ld_set_weights(uuid, jsonb, jsonb), ld_current_weights() from anon, authenticated;
