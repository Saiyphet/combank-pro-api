-- Local Halloween test data, as the live database would have it before 004 runs. These logins exist only in the local Docker database.
--   Admin (SUPER):  local.super  / Local-Admin-2026
--   Admin (STAFF):  local.staff  / Local-Admin-2026
--   Players:        cb10001 to cb10012  / Local-Player-2026
-- cb10012 has already spun, so a returning Halloween player can be tested. The prizes come from 001.

insert into ld_clubs (code, name, username_prefix, xpoker_club_id)
values ('cb', 'ComBank CLUB', 'cb', '1216343');

insert into ld_admins (username, password_hash, role) values
  ('local.super', extensions.crypt('Local-Admin-2026', extensions.gen_salt('bf', 10)), 'SUPER'),
  ('local.staff', extensions.crypt('Local-Admin-2026', extensions.gen_salt('bf', 10)), 'STAFF');

insert into ld_players (username, password_hash, display_name, xpoker_player_id, hands_count, club_id, created_by)
select 'cb' || n, extensions.crypt('Local-Player-2026', extensions.gen_salt('bf', 10)), 'Test Player ' || n, n::text, 2000,
       (select id from ld_clubs where code = 'cb'), (select id from ld_admins where username = 'local.super')
  from generate_series(10001, 10012) as n;

select ld_spin(id) from ld_players where username = 'cb10012';
