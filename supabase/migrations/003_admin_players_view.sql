-- 003_admin_players_view.sql
-- รวมผู้เล่น + ผลหมุน + รางวัล ไว้ใน view เดียว ให้ API กรอง/แบ่งหน้าได้ง่าย
-- รางวัลเงินสดจะยังไม่แสดงจนกว่าผู้เล่นหมุนวงล้อเงินสด (status = DONE)

drop view if exists ld_admin_players;

create view ld_admin_players with (security_invoker = true) as
select
  p.id,
  p.username,
  p.display_name,
  p.xpoker_player_id,
  p.hands_count,
  p.is_active,
  p.created_at,
  a.username                         as created_by,
  coalesce(s.status, 'NOT_SPUN')     as spin_status,
  s.id                               as spin_id,
  s.main_segment,
  s.spun_at,
  s.cash_spun_at,
  s.fulfillment_status,
  d.username                         as delivered_by,
  s.delivered_at,
  s.note,
  case when s.status = 'DONE' then pr.code        end as prize_code,
  case when s.status = 'DONE' then pr.prize_group end as prize_group,
  case when s.status = 'DONE' then pr.name        end as prize_name,
  case when s.status = 'DONE' then pr.value_lak   end as prize_value_lak
from ld_players p
join ld_admins a       on a.id = p.created_by
left join ld_spins s   on s.player_id = p.id
left join ld_prizes pr on pr.id = s.prize_id
left join ld_admins d  on d.id = s.delivered_by;

create index if not exists ld_spins_status_idx on ld_spins (status);
create index if not exists ld_players_created_at_idx on ld_players (created_at desc);
