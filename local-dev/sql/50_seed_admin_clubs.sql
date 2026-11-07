-- Local test data for club Admins. These accounts and players exist only in this local database.
-- local.staff works in ComBank CLUB. Test Club B has players that local.staff must never see.
insert into ld_clubs (code, name, username_prefix, xpoker_club_id)
values ('lt', 'Test Club B', 'lt', '9000002')
on conflict (code) do nothing;

update ld_admins set club_id = (select id from ld_clubs where code = 'cb') where username = 'local.staff';

insert into ld_players (username, password_hash, display_name, xpoker_player_id, hands_count, club_id, created_by)
select 'lt' || n, extensions.crypt('Local-Player-2026', extensions.gen_salt('bf', 10)), 'Club B Player ' || n, n::text, 2000,
       (select id from ld_clubs where code = 'lt'), (select id from ld_admins where username = 'local.super')
  from generate_series(20001, 20003) as n
on conflict (username) do nothing;
