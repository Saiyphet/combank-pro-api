-- 005_admin_clubs.sql: an Admin (role STAFF) works inside one club; a Super Admin (role SUPER) sees everything.
-- Only adds columns. Run it on a copy first, then on the real database, BEFORE deploying the API that reads them.
-- After it runs, give every STAFF account a club: until then that account gets ADMIN_NO_CLUB and sees nothing.

alter table ld_admins add column if not exists club_id   uuid references ld_clubs(id);
alter table ld_admins add column if not exists is_active boolean not null default true;
