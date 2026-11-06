-- Local That Luang test data. These targets and prizes exist only in the local Docker database; the real ones are not confirmed.

update tl_tiers set hands_target = case tier when 'bronze' then 100 when 'silver' then 200 else 300 end;

insert into tl_prizes (code, tier, prize_group, name, value_lak, qty_total, qty_remaining, sort_order, weight_bp)
select upper(t) || '_CASH', t, 'CASH', 'Test cash', 10000, 100, 100, 1, 5000 from unnest(array['bronze', 'silver', 'gold']) as t
union all
select upper(t) || '_BOX', t, 'BONUS', 'Test box', null, 100, 100, 2, 5000 from unnest(array['bronze', 'silver', 'gold']) as t;

-- cb10001: Bronze ready, others locked. cb10002: all ready. cb10003: all locked. The rest fill the leaderboard.
insert into tl_hands (player_id, tier, hands)
select p.id, v.tier, v.hands from (values
  ('10001', 'bronze', 150), ('10001', 'silver', 90),  ('10001', 'gold', 36),
  ('10002', 'bronze', 120), ('10002', 'silver', 260), ('10002', 'gold', 340),
  ('10003', 'bronze', 40),  ('10003', 'silver', 10),  ('10003', 'gold', 0)
) as v(xp, tier, hands)
join ld_players p on p.xpoker_player_id = v.xp;

insert into tl_hands (player_id, tier, hands)
select p.id, t.tier, (p.xpoker_player_id::int * t.k) % 97 + 5
  from ld_players p
 cross join (values ('bronze', 7), ('silver', 11), ('gold', 13)) as t(tier, k)
 where p.xpoker_player_id::int > 10003;

-- Bronze board fillers with no usable password, so a test player falls outside the top 50 and still sees their own rank.
insert into ld_players (username, password_hash, display_name, xpoker_player_id, hands_count, club_id, created_by)
select 'board' || n, '!', 'Board Filler ' || n, 'BOARD' || n, 2000,
       (select id from ld_clubs where code = 'cb'), (select id from ld_admins where username = 'local.super')
  from generate_series(1, 60) as n;

insert into tl_hands (player_id, tier, hands)
select id, 'bronze', 1000 + substr(xpoker_player_id, 6)::int from ld_players where xpoker_player_id like 'BOARD%';
